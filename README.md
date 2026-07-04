# EPICENTERDSP — Sitio oficial

Sitio estático (HTML + CSS + JS puro) de **EPICENTERDSP**, bilingüe **ES/EN**, listo para
publicarse en **GitHub Pages** con el dominio **https://epicenterdsp.com/**.
Sin frameworks, sin backend, sin analytics.

---

## 🗂️ Estructura

```
/
├── index.html              → Landing (bilingüe ES/EN en un solo archivo)
├── privacy/index.html      → Política de privacidad
├── terms/index.html        → Términos de uso
├── support/index.html      → Soporte (Android + iOS)
├── support/ios/index.html  → Soporte específico iOS (iOS 15.6+)
├── 404.html
├── css/styles.css          → Diseño (negro/rojo, hardware premium) + bilingüe + responsive
├── js/config.js            → ⭐ Enlaces de tiendas y correo (edítalo aquí)
├── js/i18n.js              → Motor bilingüe (detección + cambio manual)
├── js/main.js              → Preloader, nav, animaciones, iOS "muy pronto"
├── assets/
│   ├── logo.svg            → Logo (lockup) — real
│   ├── mark.svg            → Isotipo — real
│   ├── hires-audio.svg     → Badge Hi-Res Audio
│   ├── favicon.svg         → Favicon
│   ├── icon.svg            → Fuente del icono de app (exportar a PNG, ver abajo)
│   ├── og-image.svg        → Fuente de la imagen social (exportar a PNG 1200×630)
│   └── screenshots/*.png   → Capturas reales
├── sitemap.xml   robots.txt   site.webmanifest   CNAME   .nojekyll
```

> Las rutas son **absolutas** (`/css/…`, `/assets/…`) porque el sitio se sirve en el **dominio raíz**
> `epicenterdsp.com`. Si algún día lo pruebas en `usuario.github.io/repo/`, cambia a rutas relativas.

---

## ✏️ Cómo editar lo que más cambia

### 1) Enlaces de tiendas y correo → `js/config.js`
```js
playLiteUrl: "https://play.google.com/store/apps/details?id=com.epicenter.dsp.lite",
playFullUrl: "https://play.google.com/store/apps/details?id=com.epicenter.hifi",
appStoreUrl: "",                       // ← pega aquí el link de App Store cuando exista
supportEmail: "epicenterdsp@gmail.com"
```
**iOS:** mientras `appStoreUrl` esté vacío, los botones de iOS muestran **"Muy pronto / En revisión"**.
En cuanto pegues el enlace real, se convierten en botones de descarga automáticamente (no toques el HTML).

### 2) Precios
Aparecen como texto en `index.html` (busca `$175 MXN` y `$199 MXN`) y en `terms/index.html`.
Actualízalos ahí si cambian.

### 3) Textos legales
`privacy/index.html`, `terms/index.html`. Cada bloque tiene la versión ES y EN
(`<span data-lang="es">…</span><span data-lang="en">…</span>`). Cambia la fecha "Última actualización"
si actualizas el contenido.

### 4) Idioma
`js/i18n.js` detecta el idioma (español si el navegador es ES; inglés en el resto) y permite el cambio
manual con el botón **EN/ES** del menú. La elección se guarda en `localStorage`. Para traducir un texto
nuevo, escribe las dos variantes con `data-lang="es"` / `data-lang="en"`.

---

## 🖼️ Iconos e imagen social (ya generados)

Ya están creados y enlazados: `favicon.ico` (raíz), `assets/favicon-16/32/48.png`, `assets/favicon.svg`,
`assets/apple-touch-icon.png` (180), `assets/icon-192.png`, `assets/icon-512.png` y `assets/og-image.png` (1200×630).
Se generaron desde los SVG fuente (`assets/icon.svg`, `assets/favicon.svg`, `assets/og-image.svg`).
Si cambias el logo, regénralos desde esos SVG (con cualquier exportador o `sharp`).

**Rendimiento (recomendado):** convierte las capturas de `assets/screenshots/*.png` (≈0.8–1.9 MB c/u)
a **WebP** y actualiza los `src` en `index.html` (o usa `<picture>`), o al menos recomprímelas. Ya tienen
`width/height`, `loading="lazy"`, `decoding="async"` y la crítica `fetchpriority="high"`.

---

## 🚀 Publicar en GitHub Pages (tienes git y gh instalados)

```powershell
cd "C:\Users\Isaias\Desktop\pagina web epicenter"
git init
git add .
git commit -m "Sitio EPICENTERDSP"
git branch -M main
gh auth login                 # una vez (navegador)
gh repo create epicenterdsp-site --public --source=. --remote=origin --push
```
Luego: repo → **Settings → Pages → Deploy from a branch → main / root**.
El archivo `CNAME` ya trae `epicenterdsp.com`.

### Dominio (DNS en Cloudflare — ahí vive tu DNS)
En Cloudflare → `epicenterdsp.com` → DNS: 4 registros **A** en `@` → `185.199.108.153`, `.109`, `.110`, `.111`
y **CNAME** `www` → `TU-USUARIO.github.io`, todos en **DNS only (nube gris)**. En GitHub, Custom domain
`epicenterdsp.com` + **Enforce HTTPS**.

### Actualizar
```powershell
git add . && git commit -m "update" && git push
```

---

## ✅ Notas para App Store / Google Play
- **Support URL** para Apple: `https://epicenterdsp.com/support` (funcional, bilingüe, con contacto visible).
- Página iOS específica: `https://epicenterdsp.com/support/ios/` (requisito iOS 15.6+).
- El correo `epicenterdsp@gmail.com` está visible y clicable en soporte, privacidad y términos.
- Los botones de descarga apuntan a las apps reales (Lite y Pro en Google Play). iOS queda "muy pronto"
  hasta que pegues `appStoreUrl`.
