# RAYVER Music (rayvermusic.com) - Directivas Maestras del Sistema

## 🎯 Contexto Central
Este documento establece las reglas absolutas de operación, arquitectura y seguridad para el proyecto **rayvermusic.com**. Claude DEBE leer, asimilar y aplicar estas reglas antes de procesar cualquier prompt o generar código.

Web pública del artista RAYVER (Progressive/Melodic Trance): catálogo, radio embebida (SoundCloud), videos (YouTube), tienda de beats con pago real (Stripe), cuentas de usuario con listas de reproducción, sistema de música ambiente por suscripción, y generación de música/letras con IA (Claude, Suno, y modelos propios en GPU local).

⚠️ **El repo se desarrolla desde dos máquinas (portátil + Mac mini) sincronizadas vía GitHub (`bielet20/RAYVERMUSIC`).** Antes de tocar código, SIEMPRE `git fetch && git status` para comprobar que `main` local está al día con `origin/main` — no asumir que el estado local es el más reciente.

---

## 🛠️ Stack Tecnológico y Persistencia de Datos
* **Frontend:** HTML + CSS + JavaScript vanilla (sin framework, sin build step). Archivos clave: `index.html`, `styles.css`, `script.js` (~2000 líneas: UI, player, ambient, auth cliente), `radio.js` (~2400 líneas: motor SoundCloud + Master Player), `admin.html` (backoffice, todas las secciones), `tracker.js` (analytics propio sin cookies de terceros), `platform-switcher.js`, `pwa-install.js`, `service-worker.js`/`manifest.json` (PWA instalable).
* **Backend:** Node.js + Express, monolito en `backend/index.js` (~2900 líneas, todas las rutas `/api/*`) + `backend/server.js` (API pública auxiliar de catálogo). Servicios auxiliares en `backend/services/` (`spotify.js`, `youtube.js`). Sin TypeScript.
* **Base de Datos:** Ninguna DB relacional/documental real — fichero plano `backend/data/db.json`, leído/escrito completo vía `loadDB()`/`saveDB()`. `saveDB()` hace backup automático a `db.json.bak` antes de cada escritura, y `loadDB()` recupera desde `.bak` si el fichero principal falta o está corrupto. Colecciones: `tracks`, `albums`, `videos`, `products`, `members`, `orders`, `users`, `playlists`, `likes`, `userPlays`, `downloadTokens`, `genres`, `syncLog`, `radioPlaylist`, `ambientZones`, `ambientChannels`, `ambientTracks`, `ambientPacks`, `ambientPlans`, `ambientAccess`.
* **Auth:** Dos sistemas independientes, ambos HMAC-SHA256 propios (no JWT de librería), stateless:
  - **Admin** (`admin.html`): token firmado con `TOKEN_SECRET`, middleware `authMiddleware`.
  - **Usuario final** (cuentas + playlists + ambient): contraseñas con salt (`hashPassword`/`verifyPassword`, con fallback legacy sin salt), middleware `userAuth`.
* **Pagos:** Stripe (checkout, webhook `/api/stripe/webhook` con raw body montado ANTES de `express.json()`, tickets, tokens de descarga con expiración).
* **APIs externas:** Spotify Web API (Client Credentials), YouTube Data API v3, SoundCloud Widget API (cliente, sin key), Anthropic (Claude API — asistente de letras), Suno vía goapi.ai (`GOAPI_KEY` — generación de música por texto), Google API (`GOOGLE_API_KEY` — import de Google Drive para ambient).
* **Generación de música propia (self-hosted):** `gpu-server/ace-step/` y `gpu-server/yue/` — servidores API (Docker) que envuelven los modelos open-source ACE-Step y YuE, pensados para correr en una GPU (local o remota, `ACE_STEP_URL`/`YUE_URL`). `local-studio/studio.py` es una app Python + Gradio que se ejecuta en el ordenador con GPU: genera audio localmente y lo sube directamente a `rayvermusic.com` vía su API (usa `rayvermusic_password` + `anthropic_api_key` en `local-studio/config.json`, no committeado).
* **Entorno y CLI:** macOS (host, carpeta sincronizada por iCloud) → Docker → Coolify (producción, `rayvermusic.com`).

---

## 🎵 Sistema de Música Ambiente (Zonas/Canales)
Suscripción/paquetes de música ambiente separada del catálogo principal de RAYVER:
- **Zonas** (`ambientZones`) agrupan **canales** (`ambientChannels`), que a su vez agrupan **tracks** (`ambientTracks`).
- **Packs** (`ambientPacks`) y **planes** (`ambientPlans`) son las unidades de venta/suscripción, con precio sincronizable a Stripe (`/api/admin/ambient/packs/:id/stripe-price`, `/api/admin/ambient/plans/:id/stripe-price`).
- **Acceso** (`ambientAccess`) vincula usuario ↔ pack/plan comprado.
- Streaming protegido: `/api/ambient/stream/:id` genera un token corto (`_ambStreamTokens`, Map en memoria) que permite que el `<audio src>` reproduzca sin cabeceras de auth vía `/api/ambient/audio/:token`.
- Import masivo de audio: subida directa (`multer`, `/api/admin/ambient/upload/track`) o import desde carpeta de Google Drive (`/api/admin/ambient/gdrive-folder-import`, usa `GOOGLE_API_KEY`) o escaneo de rutas locales (`AMBIENT_SCAN_PATHS`).

## 🤖 Generación de Música con IA (panel admin)
Tres vías distintas, todas en `backend/index.js` bajo `/api/admin/generate/*`:
1. **Letras:** `/api/admin/generate/lyrics` → Claude API (`ANTHROPIC_API_KEY`).
2. **Música por prompt (Suno):** `/api/admin/generate/music` + polling `/api/admin/generate/music/:taskId` → goapi.ai (`GOAPI_KEY`).
3. **Música propia (GPU local/self-hosted):** `/api/admin/generate/own-music` + polling `/api/admin/generate/own-music/:jobId` → delega en `ACE_STEP_URL`/`YUE_URL` (ver `gpu-server/`), o se genera directamente desde `local-studio/studio.py` y se sube ya terminada.
Todo lo generado puede guardarse directamente como ambient track (`/api/admin/generate/save-to-ambient`).

---

## 🐳 Contenedores y Entorno Local (Docker & macOS)
1. **Optimización para Apple Silicon (macOS):** priorizar SIEMPRE imágenes Docker nativas `arm64` (`node:20-alpine`, `nginx:alpine`) para evitar Rosetta.
2. **Construcción Eficiente (Multi-stage Builds):**
   - `Dockerfile` (raíz) es multi-stage: stage `backend-deps` instala dependencias Node, stage final combina `nginx:alpine` + Node en un solo contenedor (frontend estático servido por nginx + backend Node vía `start.sh`, que arranca el backend en loop con reinicio automático y espera a que `/api/tracks` responda antes de levantar nginx).
   - `backend/Dockerfile` es la variante desacoplada (backend solo) usada por `docker-compose.yml` cuando frontend y backend corren como servicios separados en local.
   - `gpu-server/*/Dockerfile` son imágenes aparte, pensadas para un host con GPU (no forman parte del build de producción de Coolify).
   - Mantener las imágenes "Zero-Waste": `npm install --omit=dev`, limpiar cachés en la misma capa.
3. **Gestión de Volúmenes y Redes:**
   - `/app/data` (contiene `db.json` + `.bak`) lo gestiona **Coolify desde su pestaña Storages** — NO definir volumen para `/app/data` en `docker-compose.yml` de producción: si compose y Coolify montan volúmenes distintos ahí, cada redeploy sobreescribe el persistente con uno vacío.
   - `DB_INIT` (env var, JSON en base64) permite sembrar/restaurar `db.json` completo al arrancar si el fichero no existe — útil para recuperar producción sin depender del volumen.
   - Red aislada `app_net` (`bridge`) para la comunicación frontend↔backend en compose.
   - Healthcheck del backend vía `GET /api/health`.
4. **Seguridad del Contenedor:**
   - Exponer solo el puerto 80 (contenedor único) o 80/3001 (modo compose separado) al host.
   - Variables sensibles (`SPOTIFY_CLIENT_SECRET`, `YOUTUBE_API_KEY`, `TOKEN_SECRET`, `ADMIN_PASSWORD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `GOAPI_KEY`, `GOOGLE_API_KEY`, `SC_CLIENT_SECRET`) SIEMPRE vía `.env` / variables de entorno de Coolify, nunca en el `Dockerfile`.

---

## ⚖️ Reglas de Datos Adaptativas (Obligatorio)
Este proyecto NO usa SQL ni NoSQL — usa un **fichero JSON plano** (`backend/data/db.json`) como única fuente de verdad. Claude aplicará este comportamiento:
1. **Integridad manual:** no hay transacciones ni integridad referencial automática. Toda operación que modifique varias colecciones relacionadas (ej. borrar un track ambient y sus referencias en canales/playlists/access) debe limpiar todos los lados explícitamente en el mismo handler.
2. **Concurrencia:** `loadDB()`/`saveDB()` leen y escriben el fichero completo — evitar escrituras concurrentes sin await; no asumir atomicidad entre `loadDB()` y `saveDB()` si se paraleliza lógica.
3. **Backup automático:** `saveDB()` ya copia el estado anterior a `db.json.bak` en cada escritura — no reinventar ese mecanismo, y no eliminar el `.bak` sin motivo.
4. **Tamaño:** vigilar que `db.json` no crezca sin control (`syncLog`, `userPlays`, analítica) — rotar/limitar, no dejar crecer indefinidamente.
5. **Migraciones:** el patrón establecido es "seed de colecciones faltantes al arrancar" (bloques `if (!db.x) { db.x = []; saveDB(db); }` al inicio de `backend/index.js`) — seguir ese mismo patrón para nuevas colecciones/campos, no introducir un sistema de migraciones aparte sin que se pida.
6. **Si en el futuro se migra a SQLite/Postgres**: avisar explícitamente antes de hacerlo y plantear el cambio como una migración deliberada, no mezclarlo silenciosamente con el fichero JSON actual.

---

## 🛡️ Protocolos Estrictos de Seguridad (Cero Tolerancia)
1. **Validación Exhaustiva:** todo input de usuario o dato externo (formularios, query params, body JSON) DEBE ser validado y sanitizado antes de procesarse. El frontend usa `esc()` (scope global de `script.js`) para escapar HTML — usarla siempre al inyectar datos dinámicos en el DOM.
2. **Gestión de Secretos:** NUNCA hardcodear credenciales o claves API. Usar siempre `.env` / variables de entorno de Coolify.
   - ⚠️ Deuda conocida: `backend/index.js` tiene defaults hardcodeados (`TOKEN_SECRET = 'rayver-secret-2025-change-me'`, `ADMIN_PASSWORD = 'rayver2025'`) que solo aplican si la env var no está definida. Verificar SIEMPRE que producción (Coolify) tenga sus propios valores.
3. **Webhook de Stripe:** `/api/stripe/webhook` requiere el body RAW (montado antes de `express.json()`) para poder verificar la firma con `STRIPE_WEBHOOK_SECRET` — no mover ni envolver esa ruta con middlewares que parseen el body antes.
4. **Tokens de streaming ambient:** `_ambStreamTokens` vive en memoria (Map) — se pierde en cada reinicio/redeploy; no asumir persistencia entre despliegues, es un comportamiento esperado (son tokens de corta duración).
5. **Manejo de Errores Seguro:** `try/catch` obligatorios en toda ruta async del backend. Las respuestas de error NUNCA deben exponer stack traces ni detalles internos al cliente — solo `{ error: 'mensaje genérico' }`.
6. **CORS:** respetar `FRONTEND_ORIGIN` — no abrir a `*` en producción.

---

## ⚡ Eficiencia y Calidad del Código
1. **Código "Zero-Waste":** solo el código estrictamente necesario, sin boilerplate. El frontend es vanilla JS deliberadamente — no introducir frameworks (React, Vue, jQuery, etc.) ni bundlers sin que se pida explícitamente.
2. **Optimización:** priorizar operaciones asíncronas (`fetch`, `async/await`) y evitar bloquear el hilo principal en el frontend (animaciones, partículas del hero, etc. ya usan `requestAnimationFrame`).
3. **Modularidad:** mantener separados: lógica de negocio backend (`index.js`/`server.js`/`services/`), UI/estado del reproductor + ambient (`script.js`), motor de radio SoundCloud + Master Player (`radio.js`), analytics (`tracker.js`). No mezclar responsabilidades entre estos ficheros.
4. **Un solo reproductor "fuente de verdad":** todo (canciones, videos, ambient) pasa por el Master Player (barra fija bajo la navbar) — no reintroducir controles de reproducción sueltos en otras secciones de la página.
5. **Modo claro/oscuro:** auto-detección por hora ya implementada — no duplicar lógica de tema en nuevos componentes, reutilizar las clases/variables CSS existentes.

---

## 🔄 Protocolo de Análisis y Evolución Dinámica
1. **Sincronización previa:** antes de nada, `git fetch && git status` — con desarrollo desde dos máquinas, el estado local puede estar desactualizado respecto a `origin/main` (o al revés).
2. **Análisis Previo Obligatorio:** antes de modificar nada, Claude DEBE inspeccionar los ficheros relevantes (`index.html`/`script.js`/`radio.js`/`styles.css`/`backend/`/`gpu-server/`/`local-studio/` según el área) y el estado de git para alinear su respuesta al proyecto real, no a supuestos.
3. **Ejecución Quirúrgica y Verificación:** proporcionar solo los cambios necesarios. Tras cada cambio relevante, verificar sirviendo el sitio localmente (`python3 -m http.server` para el frontend estático, o `docker compose up` para el stack completo) antes de dar el cambio por terminado.
4. **Evolución del Archivo:** si se implementa un nuevo patrón arquitectónico o un subsistema esencial (nueva colección en `db.json`, nueva vía de generación IA, etc.), Claude actualizará autónomamente este documento para registrar el estándar.

---

## 📌 Notas de Arquitectura Vivas
- **Master Player** (`#master-player` en `index.html`, lógica en `script.js` + `radio.js`): barra fija bajo la navbar que fusiona el motor de radio (SoundCloud widget vía `window.RADIO_PLAYER`), el motor de video (YouTube iframe) y el motor de ambient. Un `activeEngine` determina a cuál se dirigen play/prev/next.
- **Deploy:** `rayvermusic.com` corre en Coolify sobre el `Dockerfile` de la raíz (contenedor único nginx+node, `/app/data` gestionado por Coolify Storages). `docker-compose.yml` es para desarrollo/tests locales con servicios separados. `gpu-server/` y `local-studio/` NO se despliegan en Coolify — corren en la máquina con GPU del artista.
- **Proyecto hermano (no desplegado):** `A RAYVER FREE ZONE/rayver-music` — SaaS B2B de música ambiente/Jukebox (Next.js + Supabase + Stripe), arquitectura totalmente distinta. No confundir ni mezclar código entre ambos.
