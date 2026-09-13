/* ============================================================
   EPICENTERDSP — /links/  (hub oficial de enlaces para el QR)
   ------------------------------------------------------------
   - Detecta la plataforma (iOS / Android / escritorio) y da
     prioridad visual a la app del dispositivo del visitante,
     SIN ocultar nunca las demás opciones.
   - Cablea la versión iOS gratis y las redes desde
     window.SITE_CONFIG (js/config.js es la única fuente).
   - iOS gratis sin URL → queda como "Próximamente" (no oculto).
     Las redes SIN URL se ocultan (jamás botones muertos).
   Los enlaces de apps reales (Play Lite/Pro, App Store Pro) ya
   traen href en el HTML y los reafirma js/config.js.
   La entrada suave es 100% CSS (ver css/links.css).
   ============================================================ */
(() => {
  "use strict";
  const cfg = window.SITE_CONFIG || {};

  /* ---------- Plataforma ---------- */
  const ua = navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS
  const isAndroid = /Android/.test(ua);
  const body = document.body;
  body.classList.add(isIOS ? "plat-ios" : isAndroid ? "plat-android" : "plat-desktop");

  /* ---------- Cablear enlaces opcionales (ocultos si faltan) ---------- */
  const wire = (el, url) => {
    if (url) {
      el.href = url;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  };

  /* iOS gratis: si NO hay URL, se queda visible como "Próximamente"
     (no oculto, no clicable). En cuanto pegues la URL en config, se activa. */
  document.querySelectorAll('[data-link="iosfree"]').forEach((el) => {
    if (cfg.appStoreFreeUrl) {
      el.href = cfg.appStoreFreeUrl;
      el.hidden = false;
      el.classList.remove("soon");
      el.removeAttribute("aria-disabled");
      el.setAttribute("target", "_blank");
    } else {
      el.hidden = false;
      el.classList.add("soon");
      el.removeAttribute("href");
      el.removeAttribute("target");
      el.setAttribute("aria-disabled", "true");
    }
  });

  const social = cfg.social || {};
  document.querySelectorAll("[data-social]").forEach((el) => {
    wire(el, social[el.getAttribute("data-social")]);
  });

  /* ---------- Ocultar un grupo entero si se quedó sin enlaces ---------- */
  /* (el grupo iOS nunca se oculta: siempre está iOS Pro; y iOS gratis
     queda como "Próximamente". Aquí se ocultaría, p. ej., el bloque de
     redes solo si TODAS estuvieran vacías.) */
  document.querySelectorAll("[data-lk-group]").forEach((grp) => {
    const links = Array.from(grp.querySelectorAll("a"));
    const anyVisible = links.some((a) => !a.hidden && (a.hasAttribute("href") || a.classList.contains("soon")));
    if (!anyVisible) grp.hidden = true;
  });

  /* La entrada suave es 100% CSS (mejora progresiva, sin JS): ver
     css/links.css → .lk-rv dentro de @media (prefers-reduced-motion: no-preference). */

})();
