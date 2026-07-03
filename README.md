# EpicenterDSP Player — Sitio web oficial

Landing profesional para **EpicenterDSP Player** (Android · iOS en camino).
Estética de **hardware de audio** (negro mate + rojo señal), en español, con preloader de arranque.
HTML + CSS + JS puros. Sin backend, sin build. Lista para **GitHub Pages**.

---

## ⭐ LO PRIMERO: coloca tus archivos reales

El sitio ya está cableado a tus imágenes reales por **nombre de archivo**. Mientras no existan,
verás *placeholders honestos* (marcos con el nombre del archivo que va ahí, NO imitaciones de tu app).
En cuanto arrastres tus archivos con estos nombres exactos, aparecen solos:

| Archivo a colocar | Qué es |
|---|---|
| `assets/logo.png` | Tu logo real (el de la bocina + "EPICENTER DSP"). Se usa en nav y footer. Sin él se muestra el wordmark en texto. |
| `assets/screenshots/app-1.png` | Captura real del **reproductor** (Head Unit). También se usa en el mockup del hero. |
| `assets/screenshots/app-2.png` | Captura real de **Epicenter DSP** (la perilla de intensidad). |
| `assets/screenshots/app-3.png` | Captura real de **Efectos espaciales**. |
| `assets/screenshots/app-4.png` | Captura real de la **pantalla de inicio / splash**. |

> Tamaño ideal de capturas: PNG ~1080×2340 (proporción de teléfono). Si usas otro formato (`.jpg`),
> actualiza los `src` en `index.html` (busca `app-1.png`, etc.).
>
> El logo grande que compartiste queda perfecto exportado a PNG con **fondo transparente**.

---

## 📁 Estructura

```
/
├── index.html              → Landing
├── privacy/  terms/  support/   → Páginas legales y soporte (/privacy/, /terms/, /support/)
├── 404.html
├── css/styles.css          → Diseño (hardware negro/rojo + preloader)
├── js/config.js            → ⭐ Links, correo, nombre legal
├── js/main.js              → Preloader, nav, animaciones
├── assets/
│   ├── logo.png            → (colócalo tú)
│   ├── favicon.svg         → Favicon (perilla roja; cámbialo si quieres)
│   └── screenshots/        → app-1.png … app-4.png (colócalos tú)
├── .nojekyll
├── robots.txt
└── README.md
```

---

## ✏️ Otros placeholders a editar

### `js/config.js` (un archivo actualiza todo)
| Valor | Estado |
|---|---|
| `playLiteUrl` | ✅ `com.epicenter.dsp.lite` |
| `playFullUrl` | ✅ `com.epicenter.hifi` |
| `appStoreUrl` | ⏳ Déjalo `""`. Los botones muestran "Próximamente" y se activan solos cuando pegues el link. |
| `supportEmail` | ⚠️ Cambia `soporte@tudominio.com` por tu correo real |
| `developerName` | ⚠️ Tu nombre legal si aplica |

### Páginas legales (`privacy/`, `terms/`, `support/`)
- Fechas `[DD de MES de AAAA]`, jurisdicción en Términos `[PAÍS / ESTADO]`, tiempo de respuesta en Soporte.
- **Privacidad**: si usas anuncios/analítica (AdMob, Firebase…) DEBES declararlos en la sección 4.

> 💡 Busca `PLACEHOLDER` en el proyecto para ubicar cada punto editable.

---

## 🎬 Preloader
Al abrir: la perilla (o tu logo real si existe `logo.png`) palpita con doble golpe tipo beat, con anillos
y barra de progreso, y hace fade al sitio. Completo una vez por sesión, rápido después. Respeta
`prefers-reduced-motion`. Sin configuración.

## 🎛️ Sección "Herencia"
Conecta la app con los procesadores de **bass restoration del car audio** (la perilla roja del faceplate
es arte de marca decorativo, no una captura). Refuerza el posicionamiento premium y diferenciado.

---

## 🚀 Publicar en GitHub Pages
1. Crea un repo **público** (ej. `epicenterdsp-site`).
2. Sube TODO el contenido de la carpeta (incluye `.nojekyll` y las subcarpetas).
   - Web: repo → "uploading an existing file" → arrastra todo.
   - Git:
     ```bash
     cd "C:\Users\Isaias\Desktop\pagina web epicenter"
     git init && git add . && git commit -m "Sitio EpicenterDSP"
     git branch -M main
     git remote add origin https://github.com/TUUSUARIO/epicenterdsp-site.git
     git push -u origin main
     ```
3. **Settings → Pages → Deploy from a branch → main / root → Save**.
4. En ~1–2 min: `https://TUUSUARIO.github.io/epicenterdsp-site/`

> Si es *project page* (URL con `/nombre-repo/`), edita las rutas absolutas de `404.html` con el nombre del repo.

## 🌐 Dominio propio
Settings → Pages → Custom domain. En tu DNS: 4 registros **A** a `185.199.108.153`, `.109`, `.110`, `.111`
para el dominio raíz, y **CNAME** `www` → `TUUSUARIO.github.io`. Activa **Enforce HTTPS**.

---

## 📈 Conversión (rápido)
- **Capturas reales** = lo que más convierte. Primer screenshot de Google Play = la pantalla del motor DSP.
- **Video preview** 15–30 s con antes/después del efecto.
- Mensaje coherente entre web, título y descripción corta de Play (bass restoration / DSP / epicenter).
- El popup "Premium" dentro de la app debe listar lo mismo que la tabla Lite vs Full de la web.
- Responde reseñas (ASO). Keywords: bass boost, bass booster, DSP, ecualizador, subwoofer, car audio, epicenter.
- **Nunca inventes cifras ni testimonios** (viola políticas y destruye confianza).

## 🛡️ Verse serio
- Dominio propio + correo con tu dominio (Cloudflare Email Routing gratis).
- Páginas legales completas de verdad (Google Play exige URL de privacidad válida).
- Consistencia visual entre ícono de la app, logo web y capturas (negro + rojo).

---
*Revisa los textos legales con un asesor antes de publicar.*
