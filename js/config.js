/* ============================================================
   EpicenterDSP Player — CONFIGURACIÓN DEL SITIO
   ------------------------------------------------------------
   EDITA SOLO ESTE ARCHIVO. Los links, el correo y el nombre
   se inyectan automáticamente en todas las páginas.
   ============================================================ */

const SITE_CONFIG = {
  /* --- Google Play (links reales) --- */
  playLiteUrl: "https://play.google.com/store/apps/details?id=com.epicenter.dsp.lite",
  playFullUrl: "https://play.google.com/store/apps/details?id=com.epicenter.hifi",

  /* --- App Store ---
     Déjalo VACÍO ("") mientras esté en proceso: los botones se mostrarán
     como "Próximamente" y no serán clicables. Cuando la app esté publicada,
     pega aquí el link y los botones se activan solos.
     Ejemplo: "https://apps.apple.com/app/id1234567890"
  */
  appStoreUrl: "",

  /* --- Soporte y legal ---
     IMPORTANTE (App Store / Google Play): este correo DEBE existir y recibir mensajes.
     Apple revisa que la Support URL y el contacto funcionen. Si aún no tienes buzón,
     créalo gratis con Cloudflare Email Routing y reenvíalo a tu Gmail. */
  supportEmail: "epicenterdsp@gmail.com",  // Correo de soporte (recibe mensajes)
  developerName: "EpicenterDSP",           // PLACEHOLDER — nombre legal / de desarrollador
};

/* Inyección (no editar debajo) */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll('[data-link="playlite"]').forEach((el) => (el.href = SITE_CONFIG.playLiteUrl));
  document.querySelectorAll('[data-link="playfull"]').forEach((el) => (el.href = SITE_CONFIG.playFullUrl));

  const appEls = document.querySelectorAll('[data-link="appstore"]');
  appEls.forEach((el) => {
    if (SITE_CONFIG.appStoreUrl) {
      el.href = SITE_CONFIG.appStoreUrl;
      el.classList.remove("soon");
      el.removeAttribute("aria-disabled");
    } else {
      el.href = "#";
      el.classList.add("soon");
      el.setAttribute("aria-disabled", "true");
      el.addEventListener("click", (e) => e.preventDefault());
    }
  });

  document.querySelectorAll("[data-email]").forEach((el) => {
    el.href = "mailto:" + SITE_CONFIG.supportEmail;
    if (el.hasAttribute("data-email-text")) el.textContent = SITE_CONFIG.supportEmail;
  });
  document.querySelectorAll("[data-dev-name]").forEach((el) => (el.textContent = SITE_CONFIG.developerName));
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
});
