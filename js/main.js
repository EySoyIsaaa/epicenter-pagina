/* ============================================================
   EPICENTERDSP — Interacciones del sitio
   Preloader ligero, nav accesible, scroll reveal, tilt, iOS soon
   (El idioma lo maneja js/i18n.js; el FAQ usa <details> nativo.)
   ============================================================ */
(() => {
  "use strict";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Preloader (ligero, no bloquea) ---------- */
  const pre = document.getElementById("preloader");
  const endPreload = () => {
    document.body.classList.remove("preloading");
    if (pre && !pre.classList.contains("done")) {
      pre.classList.add("done");
      window.setTimeout(() => pre && pre.remove(), 600);
    }
  };
  if (pre && !reduced) {
    const seen = sessionStorage.getItem("edsp_intro");
    const HOLD = seen ? 300 : 1100;
    if (seen) pre.classList.add("quick");
    const t0 = performance.now();
    const kick = () => window.setTimeout(endPreload, Math.max(0, HOLD - (performance.now() - t0)));
    if (document.readyState === "complete") kick();
    else window.addEventListener("load", kick, { once: true });
    window.setTimeout(endPreload, 4000); // salvavidas
    try { sessionStorage.setItem("edsp_intro", "1"); } catch (e) {}
  } else {
    endPreload();
  }

  /* ---------- Nav ---------- */
  const nav = document.getElementById("nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const burger = nav.querySelector(".nav-burger");
    if (burger) {
      burger.addEventListener("click", () => {
        const open = nav.classList.toggle("open");
        burger.setAttribute("aria-expanded", open ? "true" : "false");
      });
      nav.querySelectorAll(".nav-links a").forEach((a) =>
        a.addEventListener("click", () => {
          nav.classList.remove("open");
          burger.setAttribute("aria-expanded", "false");
        })
      );
    }
  }

  /* ---------- Scroll reveal ---------- */
  const reveals = document.querySelectorAll(".reveal");
  if (reveals.length && "IntersectionObserver" in window && !reduced) {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }),
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* ---------- Tilt 3D del teléfono ---------- */
  const phone = document.getElementById("heroPhone");
  const hero = document.querySelector(".hero");
  if (phone && hero && !reduced && matchMedia("(pointer: fine)").matches) {
    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      phone.style.transform = `rotateY(${x * 9}deg) rotateX(${-y * 7}deg)`;
    });
    hero.addEventListener("pointerleave", () => { phone.style.transform = ""; });
  }

  /* ---------- iOS "coming soon": feedback sutil ---------- */
  document.querySelectorAll("[data-ios-soon]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (reduced) return;
      btn.classList.add("is-shaking");
      window.setTimeout(() => btn.classList.remove("is-shaking"), 420);
    });
  });
})();
