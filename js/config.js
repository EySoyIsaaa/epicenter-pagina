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
  // ← Versión GRATIS de iOS. Mientras esté vacío, en /links/ el botón se
  //   muestra como "Próximamente". Pega el enlace de App Store cuando exista.
  appStoreFreeUrl: "",

  /* --- Redes sociales (usadas en /links/) ---
     Cada red vacía se OCULTA automáticamente en la página de enlaces. */
  social: {
    tiktok: "https://www.tiktok.com/@epicenterdsp",
    youtube: "https://www.youtube.com/@EpicenterDSP",
    instagram: "https://www.instagram.com/epicenterdsp/",
    facebook: "https://www.facebook.com/EpicenterDSP/",
  },

  /* --- Soporte --- */
  supportEmail: "epicenterdsp@gmail.com",
};

/* Disponible para otras páginas (p. ej. /links/ lee window.SITE_CONFIG). */
window.SITE_CONFIG = SITE_CONFIG;

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
