/* ============================================================
   EPICENTERDSP — CONFIGURACIÓN DEL SITIO
   ------------------------------------------------------------
   EDITA SOLO ESTE ARCHIVO. Los enlaces, el correo y el año se
   inyectan en todas las páginas.
   ============================================================ */

const SITE_CONFIG = {
  /* --- Google Play (enlaces reales) --- */
  playLiteUrl: "https://play.google.com/store/apps/details?id=com.epicenter.dsp.lite",
  playFullUrl: "https://play.google.com/store/apps/details?id=com.epicenter.hifi",

  /* --- App Store ---
     Mientras esté vacío (""), los botones de iOS muestran "Muy pronto / En revisión".
     Cuando la app esté aprobada, pega aquí el enlace y los botones se convierten
     en descargas reales automáticamente. Ejemplo:
     "https://apps.apple.com/app/id0000000000"
  */
  appStoreUrl: "",

  /* --- Soporte --- */
  supportEmail: "epicenterdsp@gmail.com",
};

document.addEventListener("DOMContentLoaded", () => {
  const c = SITE_CONFIG;

  document.querySelectorAll('[data-link="playlite"]').forEach((el) => (el.href = c.playLiteUrl));
  document.querySelectorAll('[data-link="playfull"]').forEach((el) => (el.href = c.playFullUrl));

  // iOS: si ya hay enlace, convierte los botones "muy pronto" en enlaces reales.
  if (c.appStoreUrl) {
    document.querySelectorAll("[data-ios-soon]").forEach((btn) => {
      const a = document.createElement("a");
      a.className = btn.className.replace("ios-soon", "").trim();
      a.href = c.appStoreUrl;
      a.rel = "noopener";
      // conserva el contenido salvo el "muy pronto"/ribbon
      btn.querySelectorAll(".soon-ribbon").forEach((r) => r.remove());
      a.innerHTML = btn.innerHTML;
      btn.replaceWith(a);
    });
    document.querySelectorAll(".foot-soon").forEach((el) => {
      const a = document.createElement("a");
      a.href = c.appStoreUrl; a.rel = "noopener"; a.textContent = "App Store — iOS";
      el.replaceWith(a);
    });
  }

  document.querySelectorAll("[data-email]").forEach((el) => {
    el.href = "mailto:" + c.supportEmail;
    if (el.hasAttribute("data-email-text")) el.textContent = c.supportEmail;
  });
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
});
