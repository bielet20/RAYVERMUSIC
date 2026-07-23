# RAYVER Music (rayvermusic.com) - Directivas Maestras del Sistema

## 🎯 Contexto Central
Este documento establece las reglas absolutas de operación, arquitectura y seguridad para el proyecto **rayvermusic.com**. Claude DEBE leer, asimilar y aplicar estas reglas antes de procesar cualquier prompt o generar código.

Web pública del artista RAYVER (Progressive/Melodic Trance): catálogo, radio embebida (SoundCloud), videos (YouTube), tienda de beats, cuentas de usuario y listas de reproducción personales.

---

## 🛠️ Stack Tecnológico y Persistencia de Datos
* **Frontend:** HTML + CSS + JavaScript vanilla (sin framework, sin build step). Archivos clave: `index.html`, `styles.css`, `script.js`, `radio.js`, `admin.html` (backoffice), `platform-switcher.js`, `pwa-install.js`.
* **Backend:** Node.js + Express (`backend/index.js` API de usuarios/playlists/admin, `backend/server.js` API pública de catálogo). Sin TypeScript.
* **Base de Datos Principal:** Ninguna DB real — persistencia en fichero plano `backend/data/db.json` (leído/escrito completo en cada operación vía `loadDB()`/`saveDB()`). Colecciones: `tracks`, `albums`, `videos`, `products`, `members`, `orders`, `users`, `playlists`, `genres`, `syncLog`.
* **ORM/ODM:** No aplica (no hay DB relacional ni documental).
* **Auth:** Tokens HMAC-SHA256 propios (no JWT de librería) firmados con `TOKEN_SECRET`/`ADMIN_SECRET`, stateless (sobreviven reinicios). Dos roles: admin (backoffice `admin.html`) y usuario final (cuentas + listas personales).
* **APIs externas:** Spotify Web API (Client Credentials), YouTube Data API v3, SoundCloud Widget API (cliente, sin key).
* **Entorno y CLI:** macOS (host, carpeta sincronizada por iCloud) → Docker → Coolify (producción, `rayvermusic.com`).

---

## 🐳 Contenedores y Entorno Local (Docker & macOS)
Claude aplicará las siguientes reglas estrictas para garantizar el máximo rendimiento en el entorno de desarrollo local:

1. **Optimización para Apple Silicon (macOS):**
   - Priorizar SIEMPRE imágenes Docker nativas `arm64` (`node:20-alpine`, `nginx:alpine`) para evitar Rosetta.
2. **Construcción Eficiente (Multi-stage Builds):**
   - `Dockerfile` (raíz) ya es multi-stage: stage `backend-deps` instala dependencias Node, stage final combina `nginx:alpine` + Node en un solo contenedor (frontend estático servido por nginx + backend Node vía `start.sh`).
   - `backend/Dockerfile` es la variante desacoplada (backend solo) usada por `docker-compose.yml` cuando frontend y backend corren como servicios separados.
   - Mantener las imágenes "Zero-Waste": `npm install --omit=dev`, limpiar cachés en la misma capa.
3. **Gestión de Volúmenes y Redes:**
   - `backend_data` es un volumen nombrado para `db.json` — NUNCA montar `node_modules` como bind mount.
   - Red aislada `app_net` (`bridge`) en `docker-compose.yml` para la comunicación frontend↔backend.
   - Healthcheck del backend vía `GET /api/health` (usado por `depends_on: condition: service_healthy`).
4. **Seguridad del Contenedor:**
   - Exponer solo el puerto 80 (contenedor único) o 80/3001 (modo compose separado) al host.
   - Variables sensibles (`SPOTIFY_CLIENT_SECRET`, `YOUTUBE_API_KEY`, `TOKEN_SECRET`, `ADMIN_PASSWORD`) SIEMPRE vía `.env` / variables de entorno de Coolify, nunca en el `Dockerfile`.

---

## ⚖️ Reglas de Datos Adaptativas (Obligatorio)
Este proyecto NO usa SQL ni NoSQL — usa un **fichero JSON plano** (`backend/data/db.json`) como única fuente de verdad. Claude aplicará este comportamiento:
1. **Integridad manual:** No hay transacciones ni claims de integridad referencial automáticas. Toda operación que modifique varias colecciones relacionadas (ej. borrar un track y sus referencias en playlists) debe limpiar ambos lados explícitamente en el mismo handler.
2. **Concurrencia:** `loadDB()`/`saveDB()` leen y escriben el fichero completo — evitar escrituras concurrentes sin await; no asumir atomicidad entre `loadDB()` y `saveDB()` si se paraleliza lógica.
3. **Tamaño:** vigilar que `db.json` no crezca sin control (ej. `syncLog` debe rotarse/limitarse, no crecer indefinidamente).
4. **Migraciones:** el patrón ya establecido es "seed de colecciones faltantes al arrancar" (ver bloque `if (!db.x) { db.x = []; saveDB(db); }` en `backend/index.js`) — seguir ese mismo patrón para nuevos campos/colecciones, no introducir un sistema de migraciones aparte sin que se pida.
5. **Si en el futuro se migra a SQLite/Postgres** (ya insinuado como opcional en `backend/.env.example` vía `DB_PATH`): avisar explícitamente antes de hacerlo y plantear el cambio como una migración deliberada, no mezclarlo silenciosamente con el fichero JSON actual.

---

## 🛡️ Protocolos Estrictos de Seguridad (Cero Tolerancia)
1. **Validación Exhaustiva:** Todo input de usuario o dato externo (formularios, query params, body JSON) DEBE ser validado y sanitizado antes de procesarse. El frontend ya usa `esc()` (ahora en scope global de `script.js`) para escapar HTML — usarla siempre al inyectar datos dinámicos en el DOM.
2. **Gestión de Secretos:** NUNCA hardcodear credenciales o claves API. Usar siempre `.env` / variables de entorno de Coolify.
   - ⚠️ Deuda conocida: `backend/index.js` tiene valores por defecto hardcodeados (`ADMIN_SECRET`/`TOKEN_SECRET = 'rayver-secret-2025-change-me'`, `ADMIN_PASSWORD = 'rayver2025'`) que solo aplican si la env var correspondiente no está definida. Verificar SIEMPRE que producción (Coolify) tenga sus propios valores; no depender de estos defaults.
3. **Manejo de Errores Seguro:** `try/catch` obligatorios en toda ruta async del backend. Las respuestas de error NUNCA deben exponer stack traces ni detalles internos al cliente — solo `{ error: 'mensaje genérico' }`.
4. **CORS:** respetar `FRONTEND_ORIGIN` — no abrir a `*` en producción.

---

## ⚡ Eficiencia y Calidad del Código
1. **Código "Zero-Waste":** Solo el código estrictamente necesario, sin boilerplate. El frontend es vanilla JS deliberadamente — no introducir frameworks (React, Vue, jQuery, etc.) ni bundlers sin que se pida explícitamente.
2. **Optimización:** Priorizar operaciones asíncronas (`fetch`, `async/await`) y evitar bloquear el hilo principal en el frontend (animaciones, partículas del hero, etc. ya usan `requestAnimationFrame`).
3. **Modularidad:** Mantener separados: lógica de negocio (backend `index.js`/`server.js`), UI/estado del reproductor (`script.js`), motor de radio SoundCloud (`radio.js`). No mezclar responsabilidades entre estos ficheros.
4. **Un solo reproductor "fuente de verdad":** desde la introducción del Master Player (barra fija bajo la navbar), toda reproducción (canciones, videos) debe pasar por él — no reintroducir controles de reproducción sueltos en otras secciones de la página.

---

## 🔄 Protocolo de Análisis y Evolución Dinámica
1. **Análisis Previo Obligatorio:** Antes de modificar nada, Claude DEBE inspeccionar `index.html` / `script.js` / `radio.js` / `styles.css` / `backend/` y el estado de git (`git status`, `git log`) para alinear su respuesta al proyecto real, no a supuestos.
2. **Ejecución Quirúrgica y Verificación:** Proporcionar solo los cambios necesarios. Tras cada cambio relevante, verificar sirviendo el sitio localmente (`python3 -m http.server` para el frontend estático, o `docker compose up` para el stack completo) y comprobando en el navegador antes de dar el cambio por terminado.
3. **Evolución del Archivo:** Si se implementa un nuevo patrón arquitectónico o un comando esencial (ej. el Master Player, nuevas colecciones en `db.json`), Claude actualizará autónomamente este documento para registrar el estándar.

---

## 📌 Notas de Arquitectura Vivas
- **Master Player** (`#master-player` en `index.html`, lógica en `script.js`): barra fija bajo la navbar que fusiona el motor de radio (SoundCloud widget, gestionado por `radio.js` vía `window.RADIO_PLAYER`) y el motor de video (YouTube iframe, gestionado en `script.js`). Un solo `activeEngine` (`'radio'` | `'video'`) determina a cuál se dirigen play/prev/next.
- **Deploy:** `rayvermusic.com` corre en Coolify sobre el `Dockerfile` de la raíz (contenedor único nginx+node). `docker-compose.yml` es para desarrollo/tests locales con servicios separados.
- **Proyecto hermano (no desplegado):** `A RAYVER FREE ZONE/rayver-music` — SaaS B2B de música ambiente/Jukebox (Next.js + Supabase + Stripe), arquitectura totalmente distinta. No confundir ni mezclar código entre ambos.
