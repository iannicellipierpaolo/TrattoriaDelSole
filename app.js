'use strict';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const darkPreference = window.matchMedia('(prefers-color-scheme: dark)');
const themeButton = document.querySelector('.theme-switch');
let manualTheme = false;
function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeButton.setAttribute('aria-label', dark ? 'Attiva tema chiaro' : 'Attiva tema scuro');
  themeButton.title = dark ? 'Attiva tema chiaro' : 'Attiva tema scuro';
}
applyTheme(darkPreference.matches);
themeButton.addEventListener('click', () => { manualTheme = true; applyTheme(document.documentElement.dataset.theme !== 'dark'); });
darkPreference.addEventListener('change', e => { if (!manualTheme) applyTheme(e.matches); });
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
    sun.style.transform = `rotate(${Math.min(y * .035, 120)}deg)`;
    heroImage.style.transform = `scale(${1 + Math.min(y / 20000, .035)})`;
  }
  ticking = false;
}
addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(scrollEffects); ticking = true; } }, {passive:true});
scrollEffects();
const reveals = [...document.querySelectorAll('.reveal')];
if (!reduceMotion.matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    const el = entry.target;
    if (entry.isIntersecting) {
      el.classList.add('visible');
      el.classList.remove('pending','from-top');
    } else {
      const r = entry.boundingClientRect, mid = r.top + r.height / 2;
      const above = mid < (entry.rootBounds ? entry.rootBounds.top + entry.rootBounds.height / 2 : innerHeight / 2);
      el.classList.remove('visible');
      el.classList.toggle('from-top', above);
      el.classList.add('pending');
    }
  }), {threshold:.12, rootMargin:'-6% 0px -6% 0px'});
  reveals.forEach(el => { el.classList.add('pending'); observer.observe(el); });
}
reduceMotion.addEventListener('change', e => {
  if (e.matches) { reveals.forEach(el => el.classList.remove('pending','from-top')); heroImage.style.transform='none'; sun.style.transform='none'; }
});
const navButton = document.querySelector('.nav-toggle');
const nav = document.querySelector('.nav');
function closeNav(){ nav.classList.remove('open'); navButton.setAttribute('aria-expanded','false'); navButton.setAttribute('aria-label','Apri navigazione'); }
navButton.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  navButton.setAttribute('aria-expanded', String(open)); navButton.setAttribute('aria-label', open ? 'Chiudi navigazione' : 'Apri navigazione');
});
nav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeNav));
addEventListener('keydown', e => { if(e.key==='Escape') closeNav(); });
const motion = (el, frames, opts={}) => { if(!reduceMotion.matches) el.animate(frames,{duration:450,easing:'cubic-bezier(.16,1,.3,1)',...opts}); };
let dialogTrigger;
document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click', () => {
  const dialog=document.getElementById(button.dataset.dialog);
  dialogTrigger=button;
  if(dialog.id==='booking') resetBooking();
  dialog.showModal();
  motion(dialog,[{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}]);
}));
document.querySelectorAll('dialog').forEach(dialog=>{
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{ if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();} });
  dialog.addEventListener('close',()=>dialogTrigger?.focus({preventScroll:true}));
});
const menu={
  antipasti:[['Un incontro di mare','Una selezione di assaggi, tra profumi agrumati ed erbe mediterranee.'],['Il lato buono della terra','Verdure di stagione e olio extravergine: la semplicità che fa casa.']],
  primi:[['Linguine, profumo di mare','Frutti di mare, pomodoro e una nota fresca di prezzemolo.'],['Il riso incontra lo Ionio','Un primo cremoso ispirato ai sapori della costa.']],
  secondi:[['Il mare alla griglia','Una proposta di pesce con verdure di stagione e limone.'],['Dorato e leggero','Un’idea di frittura di mare, da condividere al centro della tavola.']]
};
const tabs=[...document.querySelectorAll('[role=tab]')];
const panel=document.getElementById('menu-panel');
function selectTab(tab){
  tabs.forEach(t=>{t.setAttribute('aria-selected',String(t===tab));t.tabIndex=t===tab?0:-1;});
  panel.setAttribute('aria-labelledby',tab.id);
  panel.replaceChildren();
  menu[tab.dataset.category].forEach(([title,description],i)=>{
    const article=document.createElement('article');article.className='dish';
    const body=document.createElement('div'),heading=document.createElement('h3'),p=document.createElement('p'),number=document.createElement('span');
    heading.textContent=title;p.textContent=description;number.textContent=`0${i+1}`;
    body.append(heading,p);article.append(body,number);panel.append(article);
  });
  motion(panel,[{opacity:.2},{opacity:1}]);
}
tabs.forEach((tab,i)=>{
  tab.addEventListener('click',()=>selectTab(tab));
  tab.addEventListener('keydown',e=>{
    let index;
    if(e.key==='ArrowRight')index=(i+1)%tabs.length;
    if(e.key==='ArrowLeft')index=(i+tabs.length-1)%tabs.length;
    if(e.key==='Home')index=0;
    if(e.key==='End')index=tabs.length-1;
    if(index!==undefined){e.preventDefault();tabs[index].focus();selectTab(tabs[index]);}
  });
});
const form=document.getElementById('booking-form'),result=document.getElementById('booking-result');
function resetBooking(){ form.hidden=false;result.hidden=true;form.reset(); }
form.addEventListener('submit',e=>{
  e.preventDefault();
  document.getElementById('guest-result').textContent=document.getElementById('guests').value;
  document.getElementById('meal-result').textContent=document.getElementById('meal').value;
  form.hidden=true;result.hidden=false;
  motion(result,[{opacity:0},{opacity:1}]);
  document.getElementById('booking-reset').focus();
});
document.getElementById('booking-reset').addEventListener('click',()=>{resetBooking();document.getElementById('guests').focus();});
