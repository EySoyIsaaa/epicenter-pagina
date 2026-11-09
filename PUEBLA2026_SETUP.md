# EpicenterDSP · Puebla 2026

El módulo usa dos páginas estáticas del sitio y dos Edge Functions de Supabase. GitHub Pages sirve `/puebla2026/` y `/puebla2026/admin/` desde sus respectivos `index.html`. La campaña viene desactivada. Su ventana inicial va del 22 de noviembre de 2026 a las 00:00 hasta el 28 a las 00:00, hora de `America/Mexico_City`. El último día de entrega es el 27. El [TecNM](https://innova.tecnm.mx/) publica el 23–27 como fechas de la etapa nacional.

## 1. Crear el proyecto de Supabase

1. Crea un proyecto dedicado en el [Dashboard de Supabase](https://supabase.com/dashboard). Mantén Data API habilitada para los RPC, desactiva la exposición automática de tablas nuevas y habilita RLS automático. Guarda la contraseña de la base y anota la referencia y URL del proyecto.
2. Instala la [CLI de Supabase v3](https://supabase.com/docs/guides/local-development/cli/getting-started) e inicia sesión. Ejecuta estos comandos desde la raíz del repositorio. Sustituye `REF_DEL_PROYECTO` por la referencia del proyecto dedicado a Puebla.

   ```powershell
   supabase login
   supabase projects list
   supabase link --project-ref REF_DEL_PROYECTO
   ```

3. En Authentication → Providers, habilita Email y desactiva el registro público. Los administradores se crean desde el Dashboard. En API Settings conserva `puebla_private` fuera de los esquemas expuestos por la API.

## 2. Aplicar las migraciones

```powershell
supabase db push --dry-run --remote=REF_DEL_PROYECTO
```

Confirma que el destino es Puebla y que la simulación solo muestra las migraciones de Puebla esperadas. Después aplícalas y verifica el historial remoto.

```powershell
supabase db push --remote=REF_DEL_PROYECTO
supabase migration list --remote=REF_DEL_PROYECTO
```

Las migraciones versionadas crean las tablas privadas con RLS, la campaña `puebla2026` y las funciones RPC ejecutables por `service_role`. Las invitaciones guardan el HMAC del PIN. La asignación bloquea la campaña y la invitación dentro de una transacción. Las restricciones únicas vinculan cada código con una sola invitación, y una repetición devuelve la asignación original.

## 3. Configurar las variables de entorno

1. En [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/get-started/), crea un widget administrado para el hostname `epicenterdsp.com`. Guarda la clave pública del widget y su secreto por separado.
2. Copia `.env.example` a un archivo privado fuera del repositorio. En `PUEBLA_ALLOWED_ORIGINS` usa orígenes completos separados por coma, sin barra final. Para producción basta `https://epicenterdsp.com`. Usa un proyecto y widget distintos para pruebas.
3. Genera dos valores aleatorios independientes de 32 bytes para `PUEBLA_PIN_PEPPER` y `PUEBLA_RATE_PEPPER`. Guarda cada uno en formato hexadecimal de 64 caracteres en tu gestor de secretos y en el archivo privado del paso anterior.

4. Completa `PUEBLA_TURNSTILE_SECRET` con el secreto del widget. `PUEBLA_SHOW_INVENTORY_COUNTS=true` habilita el número de licencias disponibles en el portal. `PUEBLA_CAMPAIGN_ID` selecciona el ID sembrado por la migración. Conserva el secreto `PUEBLA_PIN_PEPPER` mientras las invitaciones deban funcionar. Cambiarlo invalida tanto los PIN existentes sin usar como la recuperación de los ya asignados.
5. En `puebla2026/config.js` configura `supabaseUrl`, `supabasePublishableKey` y `turnstileSiteKey`. Es un archivo público. La clave de Supabase debe ser la `publishable` del Dashboard o la `anon` de un proyecto legado. La clave de Turnstile debe ser la **site key**. Si usas un dominio personalizado de Supabase, añádelo a `connect-src` en los dos HTML de Puebla.

## 4. Desplegar las Edge Functions

```powershell
supabase secrets set --env-file "C:\ruta-privada\puebla.env" --remote=REF_DEL_PROYECTO
supabase functions deploy puebla-public --use-api --remote=REF_DEL_PROYECTO
supabase functions deploy puebla-admin --use-api --remote=REF_DEL_PROYECTO
```

`--use-api` empaqueta las funciones sin Docker. Supabase inyecta la URL y claves de servicio en el entorno de las funciones. `puebla-public` atiende disponibilidad, entrega y recuperación. Cada solicitud de entrega o recuperación pasa por Siteverify de Turnstile con el hostname y la acción `puebla_claim`, además del límite compartido en PostgreSQL. `puebla-admin` valida el JWT del usuario con Supabase Auth y consulta la lista de administradores en cada operación. Los RPC vuelven a comprobar la autorización. [Autorización de Edge Functions](https://supabase.com/docs/guides/functions/auth)

Los límites del portal son de 300 solicitudes de entrega por minuto para la campaña y 45 por dirección cuando la infraestructura de Supabase proporciona `CF-Connecting-IP`. La consulta de disponibilidad tiene límites separados de 1 200 y 120. Los identificadores HMAC de los límites vencen en un minuto y la base purga los registros vencidos con el tráfico posterior. La bitácora usa identificadores internos, estados y conteos. Si PostgreSQL responde, guarda hasta un error interno por minuto por función, con la función como único detalle. Las visitas y las analíticas de tienda quedan fuera de la configuración inicial.

## 5. Crear el primer administrador

1. En Authentication → Users, crea una cuenta con correo y contraseña. Confirma el correo y copia el UUID de esa cuenta.
2. En SQL Editor, ejecuta la siguiente consulta con el UUID real. El acceso depende de esta lista y de la cuenta de Supabase Auth.

   ```sql
   insert into puebla_private.admin_users (user_id)
   select id from auth.users where id = 'UUID_DEL_USUARIO'::uuid
   on conflict do nothing;
   ```

3. Abre `/puebla2026/admin/` e inicia sesión. Para retirar el permiso, elimina el UUID de `puebla_private.admin_users` desde SQL Editor. El permiso se comprueba en la siguiente operación.

## 6. Importar los códigos de las tiendas

1. Descarga los códigos de un solo uso para la **app Pro de pago** desde Play Console. En App Store Connect solicita los códigos promocionales de la versión de **EpicenterDSP Player** y descarga el TXT. Comprueba la app, la región y la vigencia de cada lote. Los códigos promocionales de app de Apple caducan cuatro semanas después de generarse. [Play Console](https://support.google.com/googleplay/android-developer/answer/6321495?hl=es) · [App Store Connect](https://developer.apple.com/help/app-store-connect/offer-promo-codes/request-and-manage-promo-codes/)
2. En **Importar códigos**, selecciona la plataforma y el CSV o TXT. Revisa la vista previa y confirma el lote. El panel oculta parte de los códigos en la vista previa. Los lotes se envían en grupos de hasta 500 y el servidor omite duplicados aunque se reintente un archivo. Usa una columna de códigos o un código por línea para un archivo preparado manualmente.
3. Verifica que suba el inventario de la plataforma correcta. Guarda el archivo de tienda en almacenamiento privado fuera del repositorio. Si una importación se interrumpe, usa **Reanudar importación**. Si ya cerraste o recargaste el panel, selecciona de nuevo el mismo archivo.

## 7. Generar y repartir invitaciones

1. En el panel, genera los PIN en lotes de hasta 200. Descarga el CSV o imprime las tarjetas mientras está visible la lista. El panel muestra el PIN completo en la respuesta de creación. La base conserva el HMAC y el UUID que aparece en la tarjeta y en la bitácora.
2. Entrega un PIN individual por visitante. Conserva el archivo de impresión como material privado. Si una generación se interrumpe antes de recibir los PIN, revisa las invitaciones sin usar y revoca las correspondientes antes de crear un nuevo lote.
3. Usa el QR general `https://epicenterdsp.com/puebla2026/`. Programa las tarjetas NFC con `https://epicenterdsp.com/puebla2026/?platform=android` y `https://epicenterdsp.com/puebla2026/?platform=ios`. Los enlaces seleccionan la plataforma y el visitante completa el canje con su PIN.

## 8. Publicar en GitHub Pages

GitHub Pages toma `main` y `/` del repositorio `EySoyIsaaa/epicenter-pagina`. Antes de integrar la rama, verifica que `puebla-public` responda a disponibilidad, `puebla-admin` rechace una solicitud sin JWT y la API de datos deniegue el acceso al inventario con la clave pública. Confirma en SQL Editor que `puebla_private.campaigns.enabled` es `false` para `puebla2026`. Las rutas son directorios estáticos con barra final y usan el `CNAME` y `.nojekyll` existentes. Después del despliegue, abre ambas rutas en una pestaña nueva y recarga cada enlace NFC. [Fuente de publicación de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 9. Probar Android, iPhone y permisos

1. En un proyecto de pruebas, importa códigos sintéticos, crea algunos PIN y configura una ventana temporal activa. Verifica el flujo desde el QR y ambos enlaces NFC. Confirma la entrega, copia el código y vuelve a ingresar el mismo PIN tras recargar y después de desactivar la campaña. Debe aparecer la misma asignación, incluso si seleccionaste otra plataforma al recuperar.
2. En Android, comprueba que se abra `https://play.google.com/redeem?code=…` con el código asignado. En iPhone, copia el código y abre la app App Store → perfil → **Canjear tarjeta de regalo o código** → ingreso manual. Los códigos sintéticos sirven para comprobar la navegación y la copia. La aceptación de un código de tienda se confirma en la consola o con una prueba operativa de canje real por el responsable. [Google Play](https://support.google.com/googleplay/answer/3422659?hl=es) · [Menú de canje de Apple](https://support.apple.com/es-mx/118242?device-type=iphone)
3. Inicia sesión con una cuenta de prueba fuera de la lista autorizada y confirma que el panel rechaza las operaciones. Revisa el límite y el estado de agotado en pruebas, y comprueba que un PIN nuevo queda sin usar cuando la entrega se rechaza.

Pruebas automatizadas desde la raíz del repositorio, con Node.js 22 o posterior y Deno 2. La suite de PostgreSQL requiere una base de pruebas desechable con las migraciones aplicadas y `psycopg` en el entorno de Python.

```powershell
deno check supabase/functions/puebla-public/index.ts supabase/functions/puebla-admin/index.ts
deno test supabase/functions/_shared/puebla_test.ts
node --test tests/puebla-pages.test.mjs tests/puebla-import.test.mjs
python -m pip install "psycopg[binary]"
python -B -m unittest discover -s supabase/tests -p 'test_*.py' -v
```

Para una base local de Supabase, `supabase start` y `supabase db reset` preparan la instancia de prueba. El valor predeterminado de `PUEBLA_TEST_DATABASE_URL` apunta a PostgreSQL en `127.0.0.1:54322`. Puedes configurar otra instancia local desechable en esa variable. Las pruebas usan valores sintéticos. Para probar la verificación de CAPTCHA de extremo a extremo en un entorno de ensayo, configura un widget de Turnstile para ese hostname. La respuesta de las claves ficticias de Turnstile carece del hostname y la acción que espera el backend. [Claves de prueba de Turnstile](https://developers.cloudflare.com/turnstile/troubleshooting/testing/#dummy-token-behavior)

## 10. Cerrar la promoción

Configura los límites y el calendario en el panel antes de activar la entrega. La hora de cierre es exclusiva. Para cerrar antes, desactiva la campaña. También puedes suspender Android o iOS individualmente. Los PIN ya usados siguen recuperando la misma asignación, y la tienda aplica su propia caducidad al canje.

Exporta las estadísticas del panel y usa la bitácora para revisar las entregas. Marca un código como canjeado únicamente después de confirmar el canje. Para un evento futuro, crea una campaña con otro ID y sus fechas y usa ese valor en `PUEBLA_CAMPAIGN_ID` en el despliegue correspondiente. Conserva la configuración de Puebla y sus secretos mientras ofrezcas recuperación de sus licencias.
