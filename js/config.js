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

  /* --- App Store (EPICENTERDSP Pro para iOS) --- */
  appStoreUrl: "https://apps.apple.com/mx/app/epicenterdsp-player/id6785658490",

  /* --- Soporte --- */
  supportEmail: "epicenterdsp@gmail.com",
};

document.addEventListener("DOMContentLoaded", () => {
  const c = SITE_CONFIG;

  document.querySelectorAll('[data-link="playlite"]').forEach((el) => (el.href = c.playLiteUrl));
  document.querySelectorAll('[data-link="playfull"]').forEach((el) => (el.href = c.playFullUrl));
  if (c.appStoreUrl) {
    document.querySelectorAll('[data-link="appstore"]').forEach((el) => (el.href = c.appStoreUrl));
  }

  document.querySelectorAll("[data-email]").forEach((el) => {
    el.href = "mailto:" + c.supportEmail;
    if (el.hasAttribute("data-email-text")) el.textContent = c.supportEmail;
  });
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
});
