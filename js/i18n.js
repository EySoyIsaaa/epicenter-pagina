/* ============================================================
   EPICENTERDSP — Bilingüe ES/EN (estático, sin backend)
   ------------------------------------------------------------
   Mecánica:
   - El contenido bilingüe se escribe en el HTML con dos variantes:
       <span data-lang="es">…</span><span data-lang="en">…</span>
     El CSS oculta el idioma inactivo según <html lang="es|en">.
   - Este script: detecta idioma (localStorage → navegador),
     permite cambio manual, actualiza <title>/description y el
     botón de idioma. Persiste la elección en localStorage.
   ============================================================ */
(() => {
  "use strict";
  const KEY = "edsp_lang";
  const SUPPORTED = ["es", "en"];

  const detect = () => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch (e) {}
    const list = navigator.languages || [navigator.language || "en"];
    return list.some((l) => String(l).toLowerCase().startsWith("es")) ? "es" : "en";
  };

  const applyMeta = (lang) => {
    const el = document.getElementById("i18n-meta");
    if (!el) return;
    let data;
    try { data = JSON.parse(el.textContent); } catch (e) { return; }
    const m = data[lang];
    if (!m) return;
    if (m.title) document.title = m.title;
    const set = (sel, val) => { const n = document.querySelector(sel); if (n && val) n.setAttribute("content", val); };
    if (m.desc) {
      set('meta[name="description"]', m.desc);
      set('meta[property="og:description"]', m.desc);
      set('meta[name="twitter:description"]', m.desc);
    }
    if (m.title) {
      set('meta[property="og:title"]', m.title);
      set('meta[name="twitter:title"]', m.title);
    }
    set('meta[property="og:locale"]', lang === "es" ? "es_MX" : "en_US");
  };

  const setLang = (lang) => {
    if (!SUPPORTED.includes(lang)) lang = "en";
    document.documentElement.lang = lang;
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    applyMeta(lang);
    document.querySelectorAll("[data-lang-btn]").forEach((b) => {
      const other = lang === "es" ? "EN" : "ES";
      b.textContent = other;
      b.setAttribute("aria-label", lang === "es" ? "Switch to English" : "Cambiar a español");
    });
  };

  // Idioma inicial (el <head> ya fijó lang para evitar parpadeo; reconfirmamos)
  setLang(document.documentElement.lang || detect());

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-lang-btn]").forEach((b) => {
      b.addEventListener("click", () => {
        setLang(document.documentElement.lang === "es" ? "en" : "es");
      });
    });
    setLang(document.documentElement.lang);
  });

  window.EDSP_setLang = setLang;
})();
