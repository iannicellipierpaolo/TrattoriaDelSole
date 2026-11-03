'use strict';


(function () {
  if (window === window.top) return;


  const MAX_FONT_BYTES = 500 * 1024;
  const MAX_TOTAL_FONT_BYTES = 2 * 1024 * 1024;
  const DEFAULT_LINE_HEIGHT = 16;
  let scrollForwarding = false;
  let scrollRaf = 0;
  let trustedTopOrigin = null;


  function matchesAllowedOrigin(origin) {
    if (!origin) return false;
    for (const entry of allowedParentOrigins) {
      if (!entry.includes('*')) {
        if (entry === origin) return true;
        continue;
      }
      const pattern = new RegExp(
        '^' + entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+') + '$'
      );
      if (pattern.test(origin)) return true;
    }
    return false;
  }


  function getTrustedParentOrigin(event) {
    const forwardedParentOrigin =
      typeof event.data.parentOrigin === 'string' ? event.data.parentOrigin : null;
    const parentOrigin = event.origin === 'null' ? forwardedParentOrigin : event.origin;
    return matchesAllowedOrigin(parentOrigin) ? parentOrigin : null;
  }

  
  function postToTrustedTop(message) {
    if (!trustedTopOrigin) return;
    try {
      window.top.postMessage(message, trustedTopOrigin);
    } catch (_error) {}
  }

  const PICK_CAPABILITIES = ['pick'];
  const PICK_CHAIN_LENGTH = 4;
  const PICK_MAX_TEXT_CHARS = 120;
  const PICK_MAX_HTML_CHARS = 300;

  function truncate(value, maxChars) {
    return value.length > maxChars ? value.slice(0, maxChars - 1) + '…' : value;
  }

  function isPickableElement(element) {
    return (
      element instanceof Element &&
      element !== document.documentElement &&
      element !== document.body
    );
  }

  function resolvePickTarget(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const element = document.elementFromPoint(x, y);
    return isPickableElement(element) ? element.closest('svg') || element : null;
  }

  function pickLabel(element) {
    if (element.id) return element.localName + '#' + element.id;
    return [element.localName]
      .concat(Array.from(element.classList).slice(0, 2))
      .join('.');
  }


  const PICK_ATTRIBUTES = new Set([
    'id',
    'class',
    'name',
    'type',
    'role',
    'alt',
    'aria-label',
    'href',
    'src'
  ]);

  function pickAttributeValue(attribute) {
    return attribute.name === 'href' || attribute.name === 'src'
      ? attribute.value.split(/[?#]/)[0]
      : attribute.value;
  }

  function describePickElement(element) {
    const chain = [];
    for (
      let current = element;
      isPickableElement(current) && chain.length < PICK_CHAIN_LENGTH;
      current = current.parentElement
    ) {
      chain.unshift(current);
    }
    const attributes = Array.from(element.attributes)
      .filter((attribute) => PICK_ATTRIBUTES.has(attribute.name))
      .map(
        (attribute) =>
          ` ${attribute.name}="${pickAttributeValue(attribute).replace(/"/g, '&quot;')}"`
      )
      .join('');
    const text = (element.innerText || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      chain: chain.map(pickLabel),
      html: truncate(`<${element.localName}${attributes}>`, PICK_MAX_HTML_CHARS),
      text: text ? truncate(text, PICK_MAX_TEXT_CHARS) : undefined
    };
  }

  
  let lastPick = null;

  function describePickTarget(element, fresh) {
    if (fresh || lastPick?.element !== element) {
      lastPick = { element, details: describePickElement(element) };
    }
    const rect = element.getBoundingClientRect();
    return {
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      ...lastPick.details
    };
  }

  function inlineAll(original, clone) {
    if (original.nodeType !== 1 || clone.nodeType !== 1) return;

    try {
      const computedStyle = getComputedStyle(original);

      const serialized = computedStyle.cssText;
      if (serialized) {
        clone.style.cssText = serialized;
      } else {
        const parts = new Array(computedStyle.length);
        for (let index = 0; index < computedStyle.length; index += 1) {
          const property = computedStyle[index];
          parts[index] = `${property}:${computedStyle.getPropertyValue(property)};`;
        }
        clone.style.cssText = parts.join('');
      }
    } catch (_error) {}

    const originalChildren = original.children;
    const clonedChildren = clone.children;
    for (
      let index = 0;
      index < originalChildren.length && index < clonedChildren.length;
      index += 1
    ) {
      inlineAll(originalChildren[index], clonedChildren[index]);
    }
  }

  function extractFontUrl(srcValue) {
    const matches = [
      ...srcValue.matchAll(
        /url\(["']?([^"')]+)["']?\)(?:\s*format\(["']?([^"')]+)["']?\))?/gi
      )
    ];
    if (matches.length === 0) return null;
    const woff2 = matches.find((m) => m[2] && m[2].toLowerCase().includes('woff2'));
    if (woff2) return woff2[1];
    const woff = matches.find((m) => m[2] && m[2].toLowerCase().includes('woff'));
    if (woff) return woff[1];
    return matches[0][1];
  }


  const fontDataUriCache = new Map();
  const SRC_DECLARATION_RE = /src\s*:\s*[^;}]+/i;

  async function fetchAsDataUri(url) {
    if (fontDataUriCache.has(url)) return fontDataUriCache.get(url);
    let dataUri = null;
    try {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (response.ok) {
        const blob = await response.blob();
        if (blob.size <= MAX_FONT_BYTES) {
          dataUri = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () =>
              resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        }
      }
    } catch (_error) {
      dataUri = null;
    }
    fontDataUriCache.set(url, dataUri);
    return dataUri;
  }

  function collectFontFaceRuleTexts() {
    const rules = [];
    for (const sheet of document.styleSheets) {
      let cssRules;
      try {
        cssRules = sheet.cssRules;
      } catch (_error) {
        continue;
      }
      if (!cssRules) continue;
      for (const rule of cssRules) {
        const cssText = rule.cssText || '';
        if (cssText.startsWith('@font-face')) rules.push(cssText);
      }
    }
    return rules;
  }

  async function buildInlinedFontCss() {
    const ruleTexts = collectFontFaceRuleTexts();
    if (ruleTexts.length === 0) return null;

    const resolved = ruleTexts.map((cssText) => {
      if (!SRC_DECLARATION_RE.test(cssText)) return null;
      const srcMatch = cssText.match(/src\s*:\s*([^;}]+)[;}]/i);
      if (!srcMatch) return null;
      const url = extractFontUrl(srcMatch[1]);
      if (!url) return null;
      try {
        return { cssText, url: new URL(url, document.baseURI).href };
      } catch (_error) {
        return null;
      }
    });

    const dataUris = await Promise.all(
      resolved.map((entry) =>
        entry ? fetchAsDataUri(entry.url) : Promise.resolve(null)
      )
    );

    const inlined = [];
    let totalBytes = 0;
    for (let index = 0; index < resolved.length; index += 1) {
      const entry = resolved[index];
      const dataUri = dataUris[index];
      if (!entry || !dataUri) continue;
      const approxBytes = dataUri.length * 0.75;
      if (totalBytes + approxBytes > MAX_TOTAL_FONT_BYTES) break;
      totalBytes += approxBytes;
      inlined.push(entry.cssText.replace(SRC_DECLARATION_RE, `src: url("${dataUri}")`));
    }
    return inlined.length > 0 ? inlined.join('\n') : null;
  }

  function stripExternal(clone) {
    const images = clone.querySelectorAll('img');
    for (let index = 0; index < images.length; index += 1) {
      const src = images[index].getAttribute('src');
      if (src && !src.startsWith('data:')) images[index].removeAttribute('src');
    }

    const elements = clone.querySelectorAll('*');
    for (let index = 0; index < elements.length; index += 1) {
      const style = elements[index].style.cssText;
      if (style && style.includes('url(')) {
        elements[index].style.cssText = style.replace(
          /url\(["']?(?!data:)[^)"']*["']?\)/gi,
          'none'
        );
      }
    }
  }

  function emitScroll() {
    scrollRaf = 0;
    if (!scrollForwarding) return;
    postToTrustedTop({
      type: 'INLINE_EDIT_SCROLL',
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      capabilities: PICK_CAPABILITIES
    });
  }

  window.addEventListener(
    'scroll',
    function () {
      if (!scrollForwarding || scrollRaf) return;
      scrollRaf = requestAnimationFrame(emitScroll);
    },
    { passive: true, capture: true }
  );

  async function handleCaptureRequest(event) {
    const requestId = event.data.requestId;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const width = window.innerWidth;
    const height = window.innerHeight;

    function postResult(dataUrl) {
      postToTrustedTop({
        type: 'INLINE_EDIT_SCREENSHOT_RESULT',
        requestId,
        dataUrl,
        scrollX,
        scrollY
      });
    }

    try {
      if (document.fonts && document.fonts.ready) {
        try {
          await document.fonts.ready;
        } catch (_error) {}
      }

      const clone = document.documentElement.cloneNode(true);
      inlineAll(document.documentElement, clone);

      const removedNodes = clone.querySelectorAll(
        'script,link[rel="stylesheet"],style'
      );
      for (let index = 0; index < removedNodes.length; index += 1) {
        removedNodes[index].remove();
      }

      stripExternal(clone);

    
      const inlinedFontCss = await buildInlinedFontCss();
      if (inlinedFontCss) {
        const styleEl = document.createElement('style');
        styleEl.textContent = inlinedFontCss;
        const head = clone.querySelector('head');
        if (head) head.appendChild(styleEl);
        else clone.insertBefore(styleEl, clone.firstChild);
      }

      const html = new XMLSerializer().serializeToString(clone);
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        '<foreignObject width="100%" height="100%">' +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden">` +
        `<div style="position:relative;left:-${scrollX}px;top:-${scrollY}px">` +
        html +
        '</div></div></foreignObject></svg>';
      const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      const image = new Image();
      image.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(image, 0, 0);
        postResult(canvas.toDataURL('image/png'));
      };
      image.onerror = function () {
        postResult(null);
      };
      image.src = svgUrl;
    } catch (_error) {
      postResult(null);
    }
  }

  window.addEventListener('message', function (event) {
    if (!event.data) return;

    if (event.source !== window.parent) return;

    const trustedParentOrigin = getTrustedParentOrigin(event);
    if (!trustedParentOrigin) return;
    trustedTopOrigin = trustedParentOrigin;

    if (event.data.type === 'INLINE_EDIT_PICK') {
      const element = resolvePickTarget(event.data.x, event.data.y);
      postToTrustedTop({
        type: 'INLINE_EDIT_PICK_RESULT',
        seq: event.data.seq,
        target: element ? describePickTarget(element, event.data.fresh === true) : null
      });
      return;
    }

    if (event.data.type === 'INLINE_EDIT_SCROLL_START') {
      scrollForwarding = true;
      emitScroll();
      return;
    }

    if (event.data.type === 'INLINE_EDIT_SCROLL_STOP') {
      scrollForwarding = false;
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
      return;
    }

    if (event.data.type === 'INLINE_EDIT_SCROLL_BY') {
      const { deltaX, deltaY, deltaMode } = event.data;
      if (!scrollForwarding || !Number.isFinite(deltaX) || !Number.isFinite(deltaY))
        return;
      if (deltaMode !== 0 && deltaMode !== 1 && deltaMode !== 2) return;
      const lineHeight =
        parseFloat(getComputedStyle(document.documentElement).lineHeight) ||
        DEFAULT_LINE_HEIGHT;
      const scaleX =
        deltaMode === 1 ? lineHeight : deltaMode === 2 ? window.innerWidth : 1;
      const scaleY =
        deltaMode === 1 ? lineHeight : deltaMode === 2 ? window.innerHeight : 1;

      window.scrollBy({
        left: deltaX * scaleX,
        top: deltaY * scaleY,
        behavior: 'instant'
      });
      emitScroll();
      return;
    }

    if (event.data.type !== 'INLINE_EDIT_CAPTURE_REQUEST') return;

    handleCaptureRequest(event);
  });
})();

// ============================================================
// Funzionamento del sito
// ============================================================


// Preferenze di movimento e tema
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const darkPreference = window.matchMedia('(prefers-color-scheme: dark)');
const themeButton = document.querySelector('.theme-switch');
let manualTheme = false;
function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeButton.setAttribute(
    'aria-label',
    dark ? 'Attiva tema chiaro' : 'Attiva tema scuro'
  );
  themeButton.title = dark ? 'Attiva tema chiaro' : 'Attiva tema scuro';
}
applyTheme(darkPreference.matches);
themeButton.addEventListener('click', () => {
  manualTheme = true;
  applyTheme(document.documentElement.dataset.theme !== 'dark');
});
darkPreference.addEventListener('change', (e) => {
  if (!manualTheme) applyTheme(e.matches);
});

// Effetti di scorrimento
const header = document.querySelector('.header');
const progress = document.querySelector('.scroll-progress');
const heroImage = document.querySelector('.hero-photo img');
const sun = document.querySelector('.sun');
let ticking = false;
function scrollEffects() {
  const y = window.scrollY;
  header.classList.toggle('scrolled', y > 40);
  const max = document.documentElement.scrollHeight - innerHeight;
  progress.style.transform = `scaleX(${max ? y / max : 0})`;
  if (!reduceMotion.matches) {
    sun.style.transform = `rotate(${Math.min(y * 0.035, 120)}deg)`;
    heroImage.style.transform = `scale(${1 + Math.min(y / 20000, 0.035)})`;
  }
  ticking = false;
}
addEventListener(
  'scroll',
  () => {
    if (!ticking) {
      requestAnimationFrame(scrollEffects);
      ticking = true;
    }
  },
  { passive: true }
);
scrollEffects();

// Animazioni delle sezioni
const reveals = [...document.querySelectorAll('.reveal')];
if (!reduceMotion.matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        const el = entry.target;
        if (entry.isIntersecting) {
          el.classList.add('visible');
          el.classList.remove('pending', 'from-top');
        } else {
          const r = entry.boundingClientRect,
            mid = r.top + r.height / 2;
          const above =
            mid <
            (entry.rootBounds
              ? entry.rootBounds.top + entry.rootBounds.height / 2
              : innerHeight / 2);
          el.classList.remove('visible');
          el.classList.toggle('from-top', above);
          el.classList.add('pending');
        }
      }),
    { threshold: 0.12, rootMargin: '-6% 0px -6% 0px' }
  );
  reveals.forEach((el) => {
    el.classList.add('pending');
    observer.observe(el);
  });
}
reduceMotion.addEventListener('change', (e) => {
  if (e.matches) {
    reveals.forEach((el) => el.classList.remove('pending', 'from-top'));
    heroImage.style.transform = 'none';
    sun.style.transform = 'none';
  }
});

// Navigazione mobile
const navButton = document.querySelector('.nav-toggle');
const nav = document.querySelector('.nav');
function closeNav() {
  nav.classList.remove('open');
  navButton.setAttribute('aria-expanded', 'false');
  navButton.setAttribute('aria-label', 'Apri navigazione');
}
navButton.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  navButton.setAttribute('aria-expanded', String(open));
  navButton.setAttribute(
    'aria-label',
    open ? 'Chiudi navigazione' : 'Apri navigazione'
  );
});
nav.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeNav));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeNav();
});

// Animazioni e finestre di dialogo
const motion = (el, frames, opts = {}) => {
  if (!reduceMotion.matches)
    el.animate(frames, { duration: 450, easing: 'cubic-bezier(.16,1,.3,1)', ...opts });
};
let dialogTrigger;
document.querySelectorAll('[data-dialog]').forEach((button) =>
  button.addEventListener('click', () => {
    const dialog = document.getElementById(button.dataset.dialog);
    dialogTrigger = button;
    if (dialog.id === 'booking') resetBooking();
    dialog.showModal();
    motion(dialog, [
      { opacity: 0, transform: 'translateY(12px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ]);
  })
);
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        dialog.close();
    }
  });
  dialog.addEventListener('close', () => dialogTrigger?.focus({ preventScroll: true }));
});

// Categorie del menù
const menu = {
  antipasti: [
    [
      'Un incontro di mare',
      'Una selezione di assaggi, tra profumi agrumati ed erbe mediterranee.'
    ],
    [
      'Il lato buono della terra',
      'Verdure di stagione e olio extravergine: la semplicità che fa casa.'
    ]
  ],
  primi: [
    [
      'Linguine, profumo di mare',
      'Frutti di mare, pomodoro e una nota fresca di prezzemolo.'
    ],
    ['Il riso incontra lo Ionio', 'Un primo cremoso ispirato ai sapori della costa.']
  ],
  secondi: [
    ['Il mare alla griglia', 'Una proposta di pesce con verdure di stagione e limone.'],
    [
      'Dorato e leggero',
      'Un’idea di frittura di mare, da condividere al centro della tavola.'
    ]
  ]
};
const tabs = [...document.querySelectorAll('[role=tab]')];
const panel = document.getElementById('menu-panel');
function selectTab(tab) {
  tabs.forEach((t) => {
    t.setAttribute('aria-selected', String(t === tab));
    t.tabIndex = t === tab ? 0 : -1;
  });
  panel.setAttribute('aria-labelledby', tab.id);
  panel.replaceChildren();
  menu[tab.dataset.category].forEach(([title, description], i) => {
    const article = document.createElement('article');
    article.className = 'dish';
    const body = document.createElement('div'),
      heading = document.createElement('h3'),
      p = document.createElement('p'),
      number = document.createElement('span');
    heading.textContent = title;
    p.textContent = description;
    number.textContent = `0${i + 1}`;
    body.append(heading, p);
    article.append(body, number);
    panel.append(article);
  });
  motion(panel, [{ opacity: 0.2 }, { opacity: 1 }]);
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    let index;
    if (e.key === 'ArrowRight') index = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') index = (i + tabs.length - 1) % tabs.length;
    if (e.key === 'Home') index = 0;
    if (e.key === 'End') index = tabs.length - 1;
    if (index !== undefined) {
      e.preventDefault();
      tabs[index].focus();
      selectTab(tabs[index]);
    }
  });
});

// Anteprima di prenotazione
const form = document.getElementById('booking-form'),
  result = document.getElementById('booking-result');
function resetBooking() {
  form.hidden = false;
  result.hidden = true;
  form.reset();
}
form.addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('guest-result').textContent =
    document.getElementById('guests').value;
  document.getElementById('meal-result').textContent =
    document.getElementById('meal').value;
  form.hidden = true;
  result.hidden = false;
  motion(result, [{ opacity: 0 }, { opacity: 1 }]);
  document.getElementById('booking-reset').focus();
});
document.getElementById('booking-reset').addEventListener('click', () => {
  resetBooking();
  document.getElementById('guests').focus();
});
