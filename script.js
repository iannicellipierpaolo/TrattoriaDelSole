/* ========================================================
   TRATTORIA DEL SOLE
   Menu mobile accessibile + animazioni leggere
   ======================================================== */

(() => {
    "use strict";

    document.documentElement.classList.add("js");

    const menuButton = document.querySelector(".menu-button");
    const siteNav = document.querySelector(".site-nav");
    const revealElements = document.querySelectorAll(".reveal");

    /* MENU MOBILE ---------------------------------------- */

    function closeMenu() {
        if (!menuButton || !siteNav) {
            return;
        }

        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Apri il menu");
        siteNav.classList.remove("is-open");
        document.body.classList.remove("menu-is-open");
    }

    function toggleMenu() {
        if (!menuButton || !siteNav) {
            return;
        }

        const isOpen = menuButton.getAttribute("aria-expanded") === "true";

        menuButton.setAttribute("aria-expanded", String(!isOpen));
        menuButton.setAttribute(
            "aria-label",
            isOpen ? "Apri il menu" : "Chiudi il menu"
        );

        siteNav.classList.toggle("is-open", !isOpen);
        document.body.classList.toggle("menu-is-open", !isOpen);
    }

    if (menuButton && siteNav) {
        menuButton.addEventListener("click", toggleMenu);

        siteNav.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", closeMenu);
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeMenu();
            }
        });

        document.addEventListener("pointerdown", (event) => {
            const clickedInsideMenu = siteNav.contains(event.target);
            const clickedToggle = menuButton.contains(event.target);

            if (!clickedInsideMenu && !clickedToggle) {
                closeMenu();
            }
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth > 1020) {
                closeMenu();
            }
        });
    }

    /* FINESTRE DEMO ACCESSIBILI --------------------------- */

    const dialogTriggers = document.querySelectorAll("[data-dialog]");

    dialogTriggers.forEach((trigger) => {
        const dialog = document.getElementById(trigger.dataset.dialog);

        if (!dialog || typeof dialog.showModal !== "function") {
            return;
        }

        trigger.setAttribute("aria-haspopup", "dialog");
        trigger.setAttribute("aria-controls", dialog.id);

        trigger.addEventListener("click", (event) => {
            event.preventDefault();
            closeMenu();

            if (!dialog.open) {
                dialog.showModal();
                document.body.classList.add("dialog-is-open");
            }
        });

        dialog.addEventListener("close", () => {
            document.body.classList.remove("dialog-is-open");
            trigger.focus({ preventScroll: true });
        });

        dialog.addEventListener("click", (event) => {
            if (event.target !== dialog) {
                return;
            }

            const bounds = dialog.getBoundingClientRect();
            const outside = event.clientX < bounds.left
                || event.clientX > bounds.right
                || event.clientY < bounds.top
                || event.clientY > bounds.bottom;

            if (outside) {
                dialog.close();
            }
        });
    });

    /* REVEAL AL PRIMO INGRESSO --------------------------- */

    const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    ).matches;

    /* SLIDER CUCINA: DUPLICAZIONE PER IL LOOP CONTINUO ---- */

    const kitchenSlider = document.querySelector(".kitchen-slider");
    const kitchenTrack = document.querySelector(".kitchen-track");
    const kitchenGroup = document.querySelector(".kitchen-group");

    if (kitchenSlider && kitchenTrack && kitchenGroup) {
        // Ogni copia include foto e calamita nello stesso elemento.
        const duplicate = kitchenGroup.cloneNode(true);

        duplicate.setAttribute("aria-hidden", "true");
        duplicate.setAttribute("inert", "");

        duplicate.querySelectorAll("img").forEach((image) => {
            image.alt = "";
        });

        kitchenTrack.appendChild(duplicate);
        kitchenSlider.classList.add("is-ready");

        document.addEventListener("visibilitychange", () => {
            kitchenSlider.classList.toggle("is-paused", document.hidden);
        });
    }

    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
        revealElements.forEach((element) => {
            element.classList.add("is-visible");
        });

        return;
    }

    const observer = new IntersectionObserver(
        (entries, activeObserver) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }

                entry.target.classList.add("is-visible");
                activeObserver.unobserve(entry.target);
            });
        },
        {
            threshold: 0.08,
            rootMargin: "0px 0px 80px 0px"
        }
    );

    revealElements.forEach((element) => {
        observer.observe(element);
    });
})();
