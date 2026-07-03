/* ============================================================
   EpicenterDSP Player — Interacciones del sitio
   Preloader, nav, scroll reveal, FAQ, tilt del teléfono
   ============================================================ */

(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Preloader (power-on) ---------- */
  const preloader = document.getElementById("preloader");
  if (preloader) {
    const seen = sessionStorage.getItem("edsp_intro");
    const HOLD = seen || reducedMotion ? 450 : 2800;
    if (seen || reducedMotion) preloader.classList.add("quick");

    const finish = () => {
      if (preloader.classList.contains("done")) return;
      preloader.classList.add("done");
      document.body.classList.remove("preloading");
      sessionStorage.setItem("edsp_intro", "1");
      window.setTimeout(() => preloader.remove(), 800);
    };

    const start = performance.now();
    const kick = () => window.setTimeout(finish, Math.max(0, HOLD - (performance.now() - start)));
    if (document.readyState === "complete") kick();
    else window.addEventListener("load", kick, { once: true });
    window.setTimeout(finish, 5000); // salvavidas
  } else {
    document.body.classList.remove("preloading");
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
        a.addEventListener("click", () => nav.classList.remove("open"))
      );
    }
  }

  /* ---------- Scroll reveal ---------- */
  const revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length && "IntersectionObserver" in window && !reducedMotion) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }

  /* ---------- FAQ ---------- */
  document.querySelectorAll(".faq-item").forEach((item) => {
    const q = item.querySelector(".faq-q");
    const a = item.querySelector(".faq-a");
    if (!q || !a) return;
    q.addEventListener("click", () => {
      const isOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach((other) => {
        if (other !== item) {
          other.classList.remove("open");
          other.querySelector(".faq-a").style.maxHeight = null;
          other.querySelector(".faq-q").setAttribute("aria-expanded", "false");
        }
      });
      item.classList.toggle("open", !isOpen);
      a.style.maxHeight = isOpen ? null : a.scrollHeight + "px";
      q.setAttribute("aria-expanded", String(!isOpen));
    });
  });

  /* ---------- Tilt 3D del teléfono ---------- */
  const phone = document.getElementById("heroPhone");
  const hero = document.querySelector(".hero");
  if (phone && hero && !reducedMotion && matchMedia("(pointer: fine)").matches) {
    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      phone.style.transform = `rotateY(${x * 9}deg) rotateX(${-y * 7}deg)`;
    });
    hero.addEventListener("pointerleave", () => {
      phone.style.transform = "rotateY(0deg) rotateX(0deg)";
    });
  }
})();
