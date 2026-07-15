'use strict';
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

// ── DIAGNÓSTICO DE ARRANQUE ──────────────────────────────────────
function bootDiag() {
  console.log('=== RAYVER BOOT DIAG ===');
  console.log(`DATA_DIR  : ${DATA_DIR}`);
  console.log(`DATA_FILE : ${DATA_FILE}`);
  console.log(`DIR exists: ${fs.existsSync(DATA_DIR)}`);
  console.log(`FILE exists: ${fs.existsSync(DATA_FILE)}`);
  if (fs.existsSync(DATA_FILE)) {
    try { console.log(`FILE size : ${fs.statSync(DATA_FILE).size} bytes`); } catch(e) {}
  }
  // ¿Está /app/data montado como volumen?
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    const hit = mounts.split('\n').find(l => l.includes('/app/data') || l.includes(DATA_DIR));
    console.log(`MOUNT /app/data: ${hit ? 'SI → ' + hit.trim() : 'NO (sin volumen montado)'}`);
  } catch(e) { console.log('MOUNT check: error leyendo /proc/mounts'); }
  // Contenido del directorio
  try {
    const files = fs.readdirSync(DATA_DIR);
    console.log(`DIR contents: [${files.join(', ')}]`);
  } catch(e) { console.log('DIR contents: error -', e.message); }
  console.log('========================');
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

bootDiag();

if (!fs.existsSync(DATA_FILE) && process.env.DB_INIT) {
  try {
    const decoded = Buffer.from(process.env.DB_INIT.trim(), 'base64').toString('utf8');
    JSON.parse(decoded);
    fs.writeFileSync(DATA_FILE, decoded);
    console.log('[DB] Restaurado desde DB_INIT env var');
  } catch (e) {
    console.warn('[DB] DB_INIT parse error:', e.message);
  }
}

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
app.use(cors({
  origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN.split(',').map(s => s.trim()),
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// ───────────────────────── DB helpers ─────────────────────────
function loadDB() {
  const BAK = DATA_FILE + '.bak';
  if (!fs.existsSync(DATA_FILE)) {
    // Intentar recuperar desde backup antes de crear DB vacía
    if (fs.existsSync(BAK)) {
      try {
        const bak = JSON.parse(fs.readFileSync(BAK, 'utf8'));
        console.log('[DB] db.json no encontrado — restaurando desde backup');
        fs.writeFileSync(DATA_FILE, JSON.stringify(bak, null, 2));
        return bak;
      } catch (e) { console.warn('[DB] Backup corrupto, creando DB nueva:', e.message); }
    }
    const defaultPass = process.env.ADMIN_PASSWORD || 'rayver2025';
    const initial = {
      tracks: [], albums: [], videos: [], products: [], members: [], orders: [],
      password_hash: crypto.createHash('sha256').update(defaultPass).digest('hex'),
      syncLog: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    // DB corrupta — intentar backup
    console.error('[DB] ERROR leyendo db.json:', e.message);
    if (fs.existsSync(BAK)) {
      try {
        const bak = JSON.parse(fs.readFileSync(BAK, 'utf8'));
        console.log('[DB] Restaurando desde backup tras error de lectura');
        fs.copyFileSync(BAK, DATA_FILE);
        return bak;
      } catch (_) {}
    }
    throw e;
  }
}
function saveDB(db) {
  const BAK = DATA_FILE + '.bak';
  // Backup del estado anterior antes de sobreescribir
  try { if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, BAK); } catch (_) {}
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
let db = loadDB();
console.log(`[DB] Archivo: ${DATA_FILE} | Usuarios: ${(db.users||[]).length} | Listas: ${(db.playlists||[]).length} | Tracks: ${(db.tracks||[]).length}`);

// Si ADMIN_PASSWORD está definida en el entorno, aplicarla siempre al arrancar.
// Esto permite resetear la contraseña desde Coolify sin perder datos.
if (process.env.ADMIN_PASSWORD) {
  const envHash = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex');
  if (db.password_hash !== envHash) {
    db.password_hash = envHash;
    saveDB(db);
    console.log('[DB] Contraseña de admin actualizada desde ADMIN_PASSWORD env var');
  }
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// Migrate: seed missing collections
if (!db.users)    { db.users    = []; saveDB(db); }
if (!db.playlists){ db.playlists= []; saveDB(db); }
if (!db.genres) {
  db.genres = [
    { id:'g1', name:'Trance',       slug:'trance',      color:'#8a2be2', order:0 },
    { id:'g2', name:'Electrónica',  slug:'electronica', color:'#00e5ff', order:1 },
    { id:'g3', name:'Orquestal',    slug:'orquestal',   color:'#f59e0b', order:2 },
    { id:'g4', name:'Pop / Balada', slug:'pop',         color:'#ec4899', order:3 },
  ];
  saveDB(db);
}
if (!db.radioPlaylist) { db.radioPlaylist = []; saveDB(db); }

// ───────────────────────── Auth (admin) ─────────────────────────
// Token HMAC stateless — sobrevive reinicios del servidor
const ADMIN_SECRET = process.env.TOKEN_SECRET || 'rayver-secret-2025-change-me';
const ADMIN_MARKER = 'admin';

function createAdminToken() {
  const ts  = Date.now().toString(36);
  const sig = crypto.createHmac('sha256', ADMIN_SECRET)
    .update(ADMIN_MARKER + ':' + ts).digest('hex').slice(0, 24);
  return Buffer.from(`${ADMIN_MARKER}:${ts}:${sig}`).toString('base64url');
}

function verifyAdminToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts   = decoded.split(':');
    if (parts.length !== 3 || parts[0] !== ADMIN_MARKER) return false;
    const [, ts, sig] = parts;
    const expected = crypto.createHmac('sha256', ADMIN_SECRET)
      .update(ADMIN_MARKER + ':' + ts).digest('hex').slice(0, 24);
    return sig === expected;
  } catch { return false; }
}

function authMiddleware(req, res, next) {
  const tok = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!tok || !verifyAdminToken(tok)) return res.status(401).json({ error: 'No autorizado' });
  next();
}

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  const hash = crypto.createHash('sha256').update(password || '').digest('hex');
  if (hash !== db.password_hash) return res.status(401).json({ error: 'Contraseña incorrecta' });
  res.json({ token: createAdminToken() });
});

app.post('/api/auth/change-password', authMiddleware, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Contraseña muy corta' });
  db.password_hash = crypto.createHash('sha256').update(newPassword).digest('hex');
  saveDB(db);
  res.json({ ok: true });
});

// ───────────────────────── HTTP helper (sin dependencias externas) ─────────────────────────
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOptions = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 15000
    };
    const req = https.request(reqOptions, (resp) => {
      let data = '';
      resp.on('data', (chunk) => (data += chunk));
      resp.on('end', () => {
        resolve({ status: resp.statusCode, headers: resp.headers, body: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function httpJSON(url, options = {}) {
  const r = await httpRequest(url, options);
  let json = null;
  try { json = JSON.parse(r.body); } catch (e) { /* not json */ }
  return { status: r.status, json, raw: r.body };
}

// ───────────────────────── Config / Env parsing ─────────────────────────
// Limpia variables de entorno que Coolify a veces guarda con el nombre incluido
// (ej. "YOUTUBE_CHANNEL_IDS=UC123" en vez de solo "UC123")
function cleanEnvList(raw, varName) {
  if (!raw) return [];
  let v = raw.trim();
  const prefix = varName + '=';
  if (v.startsWith(prefix)) v = v.slice(prefix.length);
  return v.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const p2 = varName + '=';
    return s.startsWith(p2) ? s.slice(p2.length) : s;
  });
}

const CONFIG = {
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
  spotifyArtistIds: cleanEnvList(process.env.SPOTIFY_ARTIST_IDS, 'SPOTIFY_ARTIST_IDS'),
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  youtubeChannelIds: cleanEnvList(process.env.YOUTUBE_CHANNEL_IDS, 'YOUTUBE_CHANNEL_IDS'),
  scClientId: process.env.SC_CLIENT_ID || '',
  scClientSecret: process.env.SC_CLIENT_SECRET || '',
  scPublicClientId: process.env.SC_CLIENT_ID_PUBLIC || '',
  scUser: process.env.SC_USER || process.env.SC_USER_PERMALINK || 'biel-rivero-sampol',
  scPlaylistUrl: process.env.SC_PLAYLIST_URL || ''
};

// ───────────────────────── SPOTIFY SYNC ─────────────────────────
let spotifyTokenCache = { token: null, expiresAt: 0 };

async function getSpotifyToken() {
  if (spotifyTokenCache.token && Date.now() < spotifyTokenCache.expiresAt) {
    return spotifyTokenCache.token;
  }
  if (!CONFIG.spotifyClientId || !CONFIG.spotifyClientSecret) {
    throw new Error('Spotify: faltan SPOTIFY_CLIENT_ID o SPOTIFY_CLIENT_SECRET');
  }
  const creds = Buffer.from(CONFIG.spotifyClientId + ':' + CONFIG.spotifyClientSecret).toString('base64');
  const r = await httpJSON('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + creds,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (r.status !== 200 || !r.json || !r.json.access_token) {
    throw new Error('Spotify token error: ' + r.status + ' ' + (r.raw || '').slice(0, 200));
  }
  spotifyTokenCache.token = r.json.access_token;
  spotifyTokenCache.expiresAt = Date.now() + (r.json.expires_in - 60) * 1000;
  return spotifyTokenCache.token;
}

async function syncSpotify() {
  const result = { added: 0, updated: 0, skipped: 0, errors: [] };
  if (!CONFIG.spotifyClientId || !CONFIG.spotifyClientSecret) {
    result.errors.push('Credenciales de Spotify no configuradas');
    return result;
  }
  if (!CONFIG.spotifyArtistIds.length) {
    result.errors.push('SPOTIFY_ARTIST_IDS vacío — añade al menos un Artist ID de Spotify');
    return result;
  }
  let token;
  try { token = await getSpotifyToken(); }
  catch (e) { result.errors.push(e.message); return result; }

  for (const artistId of CONFIG.spotifyArtistIds) {
    try {
      let url = 'https://api.spotify.com/v1/artists/' + artistId + '/albums?include_groups=album,single&limit=50&market=ES';
      let allAlbums = [];
      while (url) {
        const r = await httpJSON(url, { headers: { 'Authorization': 'Bearer ' + token } });
        if (r.status !== 200 || !r.json) {
          result.errors.push('Artista ' + artistId + ': HTTP ' + r.status + ' ' + (r.raw||'').slice(0,150));
          break;
        }
        allAlbums = allAlbums.concat(r.json.items || []);
        url = r.json.next || null;
      }
      for (const album of allAlbums) {
        const tr = await httpJSON('https://api.spotify.com/v1/albums/' + album.id + '/tracks?limit=50', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (tr.status !== 200 || !tr.json) continue;
        for (const t of (tr.json.items || [])) {
          const existing = db.tracks.find(x => x.spotifyId === t.id);
          const trackData = {
            id: existing ? existing.id : uid(),
            title: t.name,
            artist: (t.artists || []).map(a => a.name).join(', ') || 'RAYVER',
            spotifyId: t.id,
            spotifyUrl: t.external_urls && t.external_urls.spotify,
            cover: album.images && album.images[0] ? album.images[0].url : (existing ? existing.cover : ''),
            album: album.name,
            releaseDate: album.release_date,
            durationMs: t.duration_ms,
            source: 'spotify',
            order: existing ? existing.order : db.tracks.length,
            updatedAt: new Date().toISOString()
          };
          if (existing) {
            Object.assign(existing, trackData);
            result.updated++;
          } else {
            db.tracks.push(trackData);
            result.added++;
          }
        }
      }
    } catch (e) {
      result.errors.push('Artista ' + artistId + ': ' + e.message);
    }
  }
  saveDB(db);
  return result;
}

// ───────────────────────── YOUTUBE SYNC ─────────────────────────
async function syncYouTube() {
  const result = { added: 0, updated: 0, skipped: 0, errors: [] };
  if (!CONFIG.youtubeApiKey) {
    result.errors.push('YOUTUBE_API_KEY no configurada');
    return result;
  }
  if (!CONFIG.youtubeChannelIds.length) {
    result.errors.push('YOUTUBE_CHANNEL_IDS vacío');
    return result;
  }
  for (const channelId of CONFIG.youtubeChannelIds) {
    try {
      const chR = await httpJSON('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=' + channelId + '&key=' + CONFIG.youtubeApiKey);
      if (chR.status !== 200 || !chR.json || !chR.json.items || !chR.json.items.length) {
        result.errors.push('Canal no encontrado: ' + channelId + (chR.json && chR.json.error ? ' — ' + chR.json.error.message : ''));
        continue;
      }
      const uploadsPlaylistId = chR.json.items[0].contentDetails.relatedPlaylists.uploads;
      let pageToken = '';
      let videos = [];
      do {
        const plR = await httpJSON('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=' + uploadsPlaylistId + '&maxResults=50&pageToken=' + pageToken + '&key=' + CONFIG.youtubeApiKey);
        if (plR.status !== 200 || !plR.json) {
          result.errors.push('Error obteniendo videos de ' + channelId + ': HTTP ' + plR.status);
          break;
        }
        videos = videos.concat(plR.json.items || []);
        pageToken = plR.json.nextPageToken || '';
      } while (pageToken);

      for (const v of videos) {
        const videoId = v.snippet.resourceId.videoId;
        const existing = db.videos.find(x => x.videoId === videoId);
        const videoData = {
          id: existing ? existing.id : uid(),
          videoId,
          title: v.snippet.title,
          desc: v.snippet.description || '',
          thumbnail: (v.snippet.thumbnails && (v.snippet.thumbnails.maxres || v.snippet.thumbnails.high || v.snippet.thumbnails.default) || {}).url || '',
          channelId,
          publishedAt: v.snippet.publishedAt,
          order: existing ? existing.order : db.videos.length,
          featured: existing ? existing.featured : false,
          source: 'youtube',
          updatedAt: new Date().toISOString()
        };
        if (existing) { Object.assign(existing, videoData); result.updated++; }
        else { db.videos.push(videoData); result.added++; }
      }
    } catch (e) {
      result.errors.push('Canal ' + channelId + ': ' + e.message);
    }
  }
  // Auto-match: enlazar videos recién sincronizados con tracks por título
  autoMatchVideoTracks();
  saveDB(db);
  return result;
}

function normTitle(s) {
  return (s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

function autoMatchVideoTracks() {
  let matched = 0;
  for (const track of (db.tracks || [])) {
    if (track.videoId) continue;
    const nt = normTitle(track.title);
    if (!nt) continue;
    const video = (db.videos || []).find(v => {
      const nv = normTitle(v.title);
      return nv === nt || nv.includes(nt) || nt.includes(nv);
    });
    if (video) { track.videoId = video.videoId; matched++; }
  }
  return matched;
}

// ───────────────────────── SOUNDCLOUD SYNC ─────────────────────────
let scTokenCache = { token: null, expiresAt: 0 };

async function getSCToken() {
  if (scTokenCache.token && Date.now() < scTokenCache.expiresAt) return scTokenCache.token;
  if (!CONFIG.scClientId || !CONFIG.scClientSecret) {
    throw new Error('SoundCloud: faltan SC_CLIENT_ID o SC_CLIENT_SECRET');
  }
  const r = await httpJSON('https://secure.soundcloud.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json; charset=utf-8' },
    body: 'grant_type=client_credentials&client_id=' + encodeURIComponent(CONFIG.scClientId) + '&client_secret=' + encodeURIComponent(CONFIG.scClientSecret)
  });
  if (r.status !== 200 || !r.json || !r.json.access_token) {
    throw new Error('SoundCloud OAuth falló (credenciales inválidas o app no autorizada por SoundCloud): HTTP ' + r.status + ' ' + (r.raw||'').slice(0,200));
  }
  scTokenCache.token = r.json.access_token;
  scTokenCache.expiresAt = Date.now() + ((r.json.expires_in || 3600) - 60) * 1000;
  return scTokenCache.token;
}

// Fallback sin autenticación: oEmbed público de SoundCloud.
// Funciona siempre (sin client_id) pero solo da datos básicos de UNA url (track o playlist).
async function scOEmbed(targetUrl) {
  const r = await httpJSON('https://soundcloud.com/oembed?format=json&url=' + encodeURIComponent(targetUrl));
  if (r.status !== 200 || !r.json) return null;
  return r.json;
}

// ── SC API v2 pública (la misma que usa el web player de SC) ──────────────
// No requiere credenciales OAuth — extrae el client_id del propio sitio de SC.
// Permite obtener TODOS los tracks públicos de una cuenta sin límite de Widget.
let _scPublicClientId = null;

async function getSCPublicClientId() {
  if (_scPublicClientId) return _scPublicClientId;

  // 1. Env var configurada manualmente en Coolify (más fiable)
  if (CONFIG.scPublicClientId) {
    _scPublicClientId = CONFIG.scPublicClientId;
    return _scPublicClientId;
  }

  // 2. Extraer del sitio web de SC
  try {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const page = await httpRequest('https://soundcloud.com/', { headers: { 'User-Agent': UA } });
    if (page.status !== 200) throw new Error('SC devolvió ' + page.status);

    // Buscar URLs de bundles JS en el HTML (m[0] = match completo, no m[1])
    const scriptUrls = [];
    const re = /https:\/\/[a-z0-9-]+\.sndcdn\.com\/assets\/[^"' ]+\.js/g;
    let m;
    while ((m = re.exec(page.body)) !== null) {
      if (!scriptUrls.includes(m[0])) scriptUrls.push(m[0]); // m[0], no m[1]
    }

    // Buscar client_id también directamente en el HTML
    const htmlMatch = page.body.match(/[?&,{]?client_id[=:"']+([a-zA-Z0-9]{20,50})/);
    if (htmlMatch) { _scPublicClientId = htmlMatch[1]; return _scPublicClientId; }

    // Si no está en el HTML, buscarlo en los bundles JS
    for (const url of scriptUrls.slice(0, 15)) {
      try {
        const r = await httpRequest(url, { headers: { 'User-Agent': UA } });
        if (r.status !== 200) continue;
        const match = r.body.match(/[?&,{]?client_id[=:"']+([a-zA-Z0-9]{20,50})/);
        if (match) { _scPublicClientId = match[1]; return _scPublicClientId; }
      } catch (_) { /* ignorar error de bundle individual */ }
    }
  } catch (e) {
    console.warn('[SC] getSCPublicClientId error:', e.message);
  }
  return null;
}

async function syncSCTracksPublic(username) {
  const clientId = await getSCPublicClientId();
  if (!clientId) throw new Error('No se pudo obtener client_id público de SC — configura SC_CLIENT_ID_PUBLIC en Coolify como alternativa');
  console.log('[SC v2] client_id obtenido, sincronizando usuario:', username);

  // Resolver el usuario via API v2
  const resolveR = await httpJSON(
    `https://api-v2.soundcloud.com/resolve?url=https://soundcloud.com/${encodeURIComponent(username)}&client_id=${clientId}`
  );
  if (resolveR.status !== 200 || !resolveR.json?.id) {
    throw new Error(`Usuario SC no encontrado: ${username} (HTTP ${resolveR.status})`);
  }
  const userId = resolveR.json.id;

  // Paginar todos los tracks públicos (limit=200 por página)
  let allTracks = [];
  let nextUrl = `https://api-v2.soundcloud.com/users/${userId}/tracks?client_id=${clientId}&limit=200&linked_partitioning=1`;
  let guard = 0;
  while (nextUrl && guard < 20) {
    const r = await httpJSON(nextUrl);
    if (r.status !== 200 || !r.json) break;
    const items = r.json.collection || (Array.isArray(r.json) ? r.json : []);
    allTracks = allTracks.concat(items);
    nextUrl = r.json.next_href || null;
    // Asegurar que next_href lleva el client_id
    if (nextUrl && !nextUrl.includes('client_id')) nextUrl += `&client_id=${clientId}`;
    guard++;
  }
  console.log(`[SC v2 public] ${username}: ${allTracks.length} tracks obtenidos`);
  return allTracks;
}

async function syncSoundCloud() {
  const result = { added: 0, updated: 0, skipped: 0, errors: [], mode: null };

  // 1. Intentar vía API oficial con OAuth2 (da catálogo completo)
  let token = null;
  try {
    token = await getSCToken();
  } catch (e) {
    result.errors.push(e.message);
  }

  if (token) {
    try {
      result.mode = 'api';
      const resolveR = await httpJSON('https://api.soundcloud.com/resolve?url=' + encodeURIComponent('https://soundcloud.com/' + CONFIG.scUser), {
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json; charset=utf-8' }
      });
      if (resolveR.status !== 200 || !resolveR.json || !resolveR.json.id) {
        result.errors.push('Usuario SC no encontrado: ' + CONFIG.scUser + ' (HTTP ' + resolveR.status + ')');
      } else {
        const userId = resolveR.json.id;
        let url = 'https://api.soundcloud.com/users/' + userId + '/tracks?limit=200';
        let allTracks = [];
        let guard = 0;
        while (url && guard < 10) {
          const tR = await httpJSON(url, { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json; charset=utf-8' } });
          if (tR.status !== 200 || !tR.json) break;
          const items = Array.isArray(tR.json) ? tR.json : (tR.json.collection || []);
          allTracks = allTracks.concat(items);
          url = tR.json.next_href || null;
          guard++;
        }
        for (const t of allTracks) {
          const existing = db.tracks.find(x => x.scId === t.id);
          const newCover = (t.artwork_url ? t.artwork_url.replace('-large', '-t500x500') : '')
            || (t.user && t.user.avatar_url) || (existing ? existing.cover : '') || '';
          const trackData = {
            id: existing ? existing.id : uid(),
            title: t.title,
            artist: (t.user && t.user.username) || 'RAYVER',
            scId: t.id,
            scUrl: t.permalink_url,
            cover: newCover,
            durationMs: t.duration,
            genre: t.genre || '',
            source: existing && existing.source === 'spotify' ? existing.source : 'soundcloud',
            order: existing ? existing.order : db.tracks.length,
            visible: existing ? existing.visible !== false : true,
            updatedAt: new Date().toISOString()
          };
          if (existing) { Object.assign(existing, trackData); result.updated++; }
          else { db.tracks.push(trackData); result.added++; }
        }
      }
    } catch (e) {
      result.errors.push('SC API: ' + e.message);
    }
  }

  // 2. Fallback: SC API v2 pública (extrae client_id del propio sitio de SC, sin credenciales OAuth)
  //    Obtiene TODOS los tracks públicos del usuario con paginación real
  if (result.added === 0 && result.updated === 0 && CONFIG.scUser) {
    try {
      result.mode = (result.mode ? result.mode + '+' : '') + 'sc_v2_public';
      const scTracks = await syncSCTracksPublic(CONFIG.scUser);
      for (const t of scTracks) {
        const existing = db.tracks.find(x => x.scId === String(t.id));
        const newCoverPub = (t.artwork_url ? t.artwork_url.replace('-large', '-t500x500') : '')
          || (t.user && t.user.avatar_url) || (existing ? existing.cover : '') || '';
        const trackData = {
          id:         existing ? existing.id : uid(),
          title:      t.title,
          artist:     (t.user && t.user.username) || 'RAYVER',
          scId:       String(t.id),
          scUrl:      t.permalink_url,
          cover:      newCoverPub,
          durationMs: t.duration,
          genre:      t.genre || '',
          source:     existing && existing.source === 'spotify' ? existing.source : 'soundcloud',
          order:      existing ? existing.order : db.tracks.length,
          visible:    existing ? existing.visible !== false : true,
          updatedAt:  new Date().toISOString(),
        };
        if (existing) { Object.assign(existing, trackData); result.updated++; }
        else { db.tracks.push(trackData); result.added++; }
      }
    } catch (e) {
      result.errors.push('SC v2 public: ' + e.message);
    }
  }

  // 3. Fallback final: oEmbed de la playlist pública (solo da datos de 1 URL)
  if (CONFIG.scPlaylistUrl && (result.added === 0 && result.updated === 0)) {
    try {
      result.mode = (result.mode ? result.mode + '+' : '') + 'oembed';
      const embed = await scOEmbed(CONFIG.scPlaylistUrl);
      if (embed && embed.title) {
        const existing = db.tracks.find(x => x.scUrl === CONFIG.scPlaylistUrl);
        const data = {
          id: existing ? existing.id : uid(),
          title: embed.title,
          artist: embed.author_name || 'RAYVER',
          scUrl: CONFIG.scPlaylistUrl,
          cover: (embed.thumbnail_url || '').replace('-large', '-t500x500'),
          source: 'soundcloud',
          embedHtml: embed.html || '',
          order: existing ? existing.order : db.tracks.length,
          updatedAt: new Date().toISOString()
        };
        if (existing) { Object.assign(existing, data); result.updated++; }
        else { db.tracks.push(data); result.added++; }
      } else {
        result.errors.push('oEmbed: no se pudo resolver ' + CONFIG.scPlaylistUrl);
      }
    } catch (e) {
      result.errors.push('oEmbed error: ' + e.message);
    }
  }

  saveDB(db);
  return result;
}

// ───────────────────────── SYNC orquestador ─────────────────────────
let syncRunning = false;

async function runFullSync(trigger) {
  if (syncRunning) return { error: 'Ya hay una sincronización en curso' };
  syncRunning = true;
  const log = { id: uid(), trigger: trigger || 'manual', startedAt: new Date().toISOString() };
  try {
    log.spotify = await syncSpotify();
    log.youtube = await syncYouTube();
    log.soundcloud = await syncSoundCloud();
  } catch (e) {
    log.fatalError = e.message;
  }
  log.finishedAt = new Date().toISOString();
  log.totalTracks = db.tracks.length;
  log.totalVideos = db.videos.length;
  db.syncLog = db.syncLog || [];
  db.syncLog.unshift(log);
  db.syncLog = db.syncLog.slice(0, 20);
  saveDB(db);
  syncRunning = false;
  return log;
}

app.get('/api/sync/status', authMiddleware, (req, res) => {
  res.json({
    running: syncRunning,
    logs: db.syncLog || [],
    totals: {
      tracks: (db.tracks || []).length,
      videos: (db.videos || []).length,
    },
    config: {
      spotifyArtists: CONFIG.spotifyArtistIds,
      youtubeChannels: CONFIG.youtubeChannelIds,
      hasSpotifyCreds: !!(CONFIG.spotifyClientId && CONFIG.spotifyClientSecret),
      hasYoutubeCreds: !!CONFIG.youtubeApiKey,
      hasSCCreds: !!(CONFIG.scClientId && CONFIG.scClientSecret),
      scUser: CONFIG.scUser,
      scPlaylistUrl: CONFIG.scPlaylistUrl
    }
  });
});

app.post('/api/sync/run', authMiddleware, async (req, res) => {
  const result = await runFullSync('manual');
  res.json(result);
});

// Sync automático cada 6 horas + uno al arrancar (a los 20s para no bloquear el boot)
setTimeout(() => runFullSync('startup').catch(e => console.error('sync startup error', e)), 20000);
setInterval(() => runFullSync('scheduled').catch(e => console.error('sync scheduled error', e)), 6 * 60 * 60 * 1000);

// ───────────────────────── RUTAS PÚBLICAS (frontend) ─────────────────────────
app.get('/api/public/tracks', (req, res) => {
  let tracks = (db.tracks || []).filter(t => t.visible !== false);

  // Filtros opcionales: ?genre=Trance&type=single&q=feel&sort=newest&bpm_min=120&bpm_max=140
  const { genre, type, q, sort, bpm_min, bpm_max } = req.query;

  if (genre && genre !== 'all') {
    tracks = tracks.filter(t => (t.genre || '').toLowerCase() === genre.toLowerCase());
  }
  if (type && type !== 'all') {
    tracks = tracks.filter(t => (t.type || 'single').toLowerCase() === type.toLowerCase());
  }
  if (q) {
    const s = q.toLowerCase();
    tracks = tracks.filter(t =>
      (t.title  || '').toLowerCase().includes(s) ||
      (t.artist || '').toLowerCase().includes(s) ||
      (t.genre  || '').toLowerCase().includes(s) ||
      (t.album  || '').toLowerCase().includes(s)
    );
  }
  if (bpm_min) tracks = tracks.filter(t => t.bpm && t.bpm >= parseInt(bpm_min));
  if (bpm_max) tracks = tracks.filter(t => t.bpm && t.bpm <= parseInt(bpm_max));

  switch (sort) {
    case 'newest':   tracks.sort((a,b) => new Date(b.releaseDate||b.updatedAt||0) - new Date(a.releaseDate||a.updatedAt||0)); break;
    case 'az':       tracks.sort((a,b) => (a.title||'').localeCompare(b.title||'')); break;
    case 'bpm_asc':  tracks.sort((a,b) => (a.bpm||0) - (b.bpm||0)); break;
    case 'bpm_desc': tracks.sort((a,b) => (b.bpm||0) - (a.bpm||0)); break;
    default:         tracks.sort((a,b) => (a.order||0) - (b.order||0)); break;
  }

  res.json(tracks);
});
app.get('/api/public/albums', (req, res) => res.json(db.albums || []));
app.get('/api/public/videos', (req, res) => {
  res.json((db.videos || []).slice().sort((a,b)=>(a.order||0)-(b.order||0)));
});
app.get('/api/public/products', (req, res) => res.json(db.products || []));

app.get('/api/public/sc-playlist', (req, res) => {
  const scTracks = (db.tracks || []).filter(t => t.source === 'soundcloud' || t.scUrl);
  res.json({ tracks: scTracks });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    tracks: (db.tracks || []).length,
    albums: (db.albums || []).length,
    videos: (db.videos || []).length,
    products: (db.products || []).length,
    members: (db.members || []).length,
    syncRunning,
    lastSync: (db.syncLog && db.syncLog[0] && db.syncLog[0].finishedAt) || null,
    sc: { configured: !!(CONFIG.scClientId && CONFIG.scClientSecret), user: CONFIG.scUser }
  });
});

// ───────────────────────── RUTAS PRIVADAS (admin CRUD) ─────────────────────────
function crud(entity) {
  app.get('/api/' + entity, authMiddleware, (req, res) => res.json(db[entity] || []));
  app.post('/api/' + entity, authMiddleware, (req, res) => {
    const item = { id: uid(), order: (db[entity]||[]).length, createdAt: new Date().toISOString(), ...req.body };
    db[entity] = db[entity] || [];
    db[entity].push(item);
    saveDB(db);
    res.json(item);
  });
  app.put('/api/' + entity + '/:id', authMiddleware, (req, res) => {
    const idx = (db[entity]||[]).findIndex(x => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
    db[entity][idx] = { ...db[entity][idx], ...req.body, id: req.params.id };
    saveDB(db);
    res.json(db[entity][idx]);
  });
  app.delete('/api/' + entity + '/:id', authMiddleware, (req, res) => {
    db[entity] = (db[entity]||[]).filter(x => x.id !== req.params.id);
    saveDB(db);
    res.json({ ok: true });
  });
}
['tracks', 'albums', 'videos', 'products', 'members', 'orders'].forEach(crud);

app.patch('/api/videos/reorder', authMiddleware, (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds requerido' });
  orderedIds.forEach((id, i) => {
    const v = (db.videos || []).find(x => x.id === id);
    if (v) v.order = i;
  });
  saveDB(db);
  res.json({ ok: true });
});

// ───────────────────────── USUARIOS & PLAYLISTS ─────────────────────────
// Tokens HMAC firmados — stateless, sobreviven reinicios del servidor
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'rayver-secret-2025-change-me';

function createUserToken(userId) {
  const ts  = Date.now().toString(36);
  const sig = crypto.createHmac('sha256', TOKEN_SECRET)
    .update(userId + ':' + ts).digest('hex').slice(0, 24);
  return Buffer.from(`${userId}:${ts}:${sig}`).toString('base64url');
}

function verifyUserToken(token) {
  try {
    const decoded  = Buffer.from(token, 'base64url').toString();
    const parts    = decoded.split(':');
    if (parts.length < 3) return null;
    const sig      = parts.pop();
    const tsStr    = parts.pop();
    const userId   = parts.join(':'); // por si el id contiene ':'
    const expected = crypto.createHmac('sha256', TOKEN_SECRET)
      .update(userId + ':' + tsStr).digest('hex').slice(0, 24);
    if (sig !== expected) return null;
    return userId;
  } catch { return null; }
}

function userAuth(req, res, next) {
  const tok    = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const userId = tok ? verifyUserToken(tok) : null;
  if (!userId) return res.status(401).json({ error: 'Debes iniciar sesión' });
  const user   = (db.users || []).find(u => u.id === userId);
  if (!user)   return res.status(401).json({ error: 'Usuario no encontrado' });
  req.user = { userId: user.id, email: user.email, name: user.name };
  next();
}

app.post('/api/user/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'Faltan campos' });
  if (password.length < 6) return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });
  const emailNorm = email.toLowerCase().trim();
  if ((db.users || []).find(u => u.email === emailNorm))
    return res.status(409).json({ error: 'Este email ya está registrado' });
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  const user = { id: uid(), email: emailNorm, name: name.trim(), passwordHash, createdAt: new Date().toISOString() };
  db.users.push(user);
  saveDB(db);
  const token = createUserToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.post('/api/user/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Faltan campos' });
  const emailNorm = email.toLowerCase().trim();
  const user = (db.users || []).find(u => u.email === emailNorm);
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (!user || hash !== user.passwordHash)
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  const token = createUserToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.post('/api/user/logout', (req, res) => {
  // Con tokens stateless no hay nada que invalidar en servidor.
  // El cliente simplemente descarta el token.
  res.json({ ok: true });
});

app.get('/api/user/me', userAuth, (req, res) => res.json(req.user));

app.get('/api/user/playlists', userAuth, (req, res) => {
  res.json((db.playlists || []).filter(p => p.userId === req.user.userId));
});

app.post('/api/user/playlists', userAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  const trimmed = name.trim();
  const userLists = (db.playlists || []).filter(p => p.userId === req.user.userId);
  if (userLists.find(p => p.name.toLowerCase() === trimmed.toLowerCase()))
    return res.status(409).json({ error: 'Ya tienes una lista con ese nombre' });
  const pl = { id: uid(), userId: req.user.userId, name: trimmed, tracks: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.playlists.push(pl);
  saveDB(db);
  res.json(pl);
});

app.put('/api/user/playlists/:id', userAuth, (req, res) => {
  const pl = (db.playlists || []).find(p => p.id === req.params.id && p.userId === req.user.userId);
  if (!pl) return res.status(404).json({ error: 'No encontrada' });
  if (req.body.name) {
    const trimmed = req.body.name.trim();
    const conflict = (db.playlists || []).find(p => p.userId === req.user.userId && p.id !== req.params.id && p.name.toLowerCase() === trimmed.toLowerCase());
    if (conflict) return res.status(409).json({ error: 'Ya tienes una lista con ese nombre' });
    pl.name = trimmed;
  }
  pl.updatedAt = new Date().toISOString();
  saveDB(db);
  res.json(pl);
});

app.delete('/api/user/playlists/:id', userAuth, (req, res) => {
  const before = db.playlists.length;
  db.playlists = db.playlists.filter(p => !(p.id === req.params.id && p.userId === req.user.userId));
  if (db.playlists.length === before) return res.status(404).json({ error: 'No encontrada' });
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/user/playlists/:id/tracks', userAuth, (req, res) => {
  const pl = (db.playlists || []).find(p => p.id === req.params.id && p.userId === req.user.userId);
  if (!pl) return res.status(404).json({ error: 'No encontrada' });
  const { type, itemId, title, cover, url } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Título requerido' });
  if (pl.tracks.find(t => t.itemId === itemId && t.type === type))
    return res.status(409).json({ error: 'Ya está en la lista' });
  const track = { id: uid(), type: type || 'track', itemId: itemId || '', title, cover: cover || '', url: url || '', addedAt: new Date().toISOString() };
  pl.tracks.push(track);
  pl.updatedAt = new Date().toISOString();
  saveDB(db);
  res.json(track);
});

app.delete('/api/user/playlists/:id/tracks/:trackId', userAuth, (req, res) => {
  const pl = (db.playlists || []).find(p => p.id === req.params.id && p.userId === req.user.userId);
  if (!pl) return res.status(404).json({ error: 'No encontrada' });
  const before = pl.tracks.length;
  pl.tracks = pl.tracks.filter(t => t.id !== req.params.trackId);
  if (pl.tracks.length === before) return res.status(404).json({ error: 'Track no encontrado' });
  pl.updatedAt = new Date().toISOString();
  saveDB(db);
  res.json({ ok: true });
});

app.put('/api/user/playlists/:id/reorder', userAuth, (req, res) => {
  const pl = (db.playlists || []).find(p => p.id === req.params.id && p.userId === req.user.userId);
  if (!pl) return res.status(404).json({ error: 'No encontrada' });
  const { trackIds } = req.body || {};
  if (!Array.isArray(trackIds)) return res.status(400).json({ error: 'trackIds requerido' });
  const reordered = trackIds.map(id => pl.tracks.find(t => t.id === id)).filter(Boolean);
  pl.tracks = reordered;
  pl.updatedAt = new Date().toISOString();
  saveDB(db);
  res.json({ ok: true });
});

// ───────────────────────── GÉNEROS ─────────────────────────
app.get('/api/public/genres', (req, res) => {
  res.json((db.genres || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)));
});

app.get('/api/genres', authMiddleware, (req, res) => res.json(db.genres || []));

app.post('/api/genres', authMiddleware, (req, res) => {
  const { name, slug, color } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: 'name y slug requeridos' });
  const genre = { id: uid(), name, slug, color: color || '#8a2be2', order: (db.genres || []).length };
  db.genres = db.genres || [];
  db.genres.push(genre);
  saveDB(db);
  res.json(genre);
});

app.put('/api/genres/:id', authMiddleware, (req, res) => {
  const g = (db.genres || []).find(x => x.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'No encontrado' });
  Object.assign(g, req.body, { id: req.params.id });
  saveDB(db);
  res.json(g);
});

app.delete('/api/genres/:id', authMiddleware, (req, res) => {
  db.genres = (db.genres || []).filter(x => x.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ───────────────────────── DB Export/Restore ─────────────────────────
app.get('/api/admin/db-export', authMiddleware, (req, res) => {
  const json = JSON.stringify(db, null, 2);
  const base64 = Buffer.from(json).toString('base64');
  res.json({ base64, size: json.length, users: (db.users || []).length, playlists: (db.playlists || []).length });
});

// Diagnóstico SC: prueba la extracción de client_id y el acceso a la API v2
app.get('/api/admin/sc-diag', authMiddleware, async (req, res) => {
  const result = { steps: [] };
  try {
    // Paso 1: fetch soundcloud.com
    result.steps.push({ step: 'fetch soundcloud.com' });
    const page = await httpRequest('https://soundcloud.com/');
    result.scPageStatus = page.status;
    result.scPageSize = page.body.length;

    // Paso 2: encontrar URLs de bundles
    const re = /https:\/\/a-v2\.sndcdn\.com\/assets\/[^"' ]+\.js/g;
    const found = [];
    let m;
    while ((m = re.exec(page.body)) !== null) found.push(m[1]);
    result.bundleUrls = found.slice(0, 5);

    // Paso 3: buscar client_id en los bundles
    let clientId = null;
    for (const url of found.slice(0, 8)) {
      const r = await httpRequest(url);
      const match = r.body.match(/client_id[=:"]+([a-zA-Z0-9]{20,50})/);
      if (match) { clientId = match[1]; result.clientIdFoundIn = url; break; }
    }
    result.clientId = clientId;

    // Paso 4: si tenemos client_id, probar la API v2
    if (clientId) {
      const testR = await httpJSON(`https://api-v2.soundcloud.com/resolve?url=https://soundcloud.com/${CONFIG.scUser}&client_id=${clientId}`);
      result.v2ResolveStatus = testR.status;
      result.v2UserId = testR.json?.id;
    }
  } catch (e) {
    result.error = e.message;
  }
  res.json(result);
});

// Diagnóstico del sistema de ficheros
app.get('/api/admin/diag', authMiddleware, (req, res) => {
  const info = { DATA_DIR, DATA_FILE, fileExists: false, fileSize: 0, files: [], mountInfo: 'unknown', users: 0, playlists: 0, tracks: 0, totalPlaylistTracks: 0 };
  info.fileExists = fs.existsSync(DATA_FILE);
  if (info.fileExists) try { info.fileSize = fs.statSync(DATA_FILE).size; } catch(e) {}
  try { info.files = fs.readdirSync(DATA_DIR); } catch(e) { info.files = ['ERR:' + e.message]; }
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    const hit = mounts.split('\n').find(l => l.includes('/app/data') || l.includes(DATA_DIR));
    info.mountInfo = hit ? hit.trim() : 'NOT MOUNTED';
  } catch(e) { info.mountInfo = 'error: ' + e.message; }
  info.users = (db.users || []).length;
  info.playlists = (db.playlists || []).length;
  info.tracks = (db.tracks || []).length;
  info.totalPlaylistTracks = (db.playlists || []).reduce((s, p) => s + (p.tracks?.length || 0), 0);
  res.json(info);
});

// Lista usuarios (sin passwords) con conteo de listas
app.get('/api/admin/users', authMiddleware, (req, res) => {
  const users = (db.users || []).map(u => ({
    id:            u.id,
    email:         u.email,
    createdAt:     u.createdAt,
    playlistCount: (db.playlists || []).filter(p => p.userId === u.id).length,
  }));
  res.json(users);
});

// Eliminar usuario y sus listas
app.delete('/api/admin/users/:id', authMiddleware, (req, res) => {
  const before = (db.users || []).length;
  db.users     = (db.users     || []).filter(u => u.id !== req.params.id);
  db.playlists = (db.playlists || []).filter(p => p.userId !== req.params.id);
  if (db.users.length === before) return res.status(404).json({ error: 'No encontrado' });
  saveDB(db);
  res.json({ ok: true });
});

// Restaurar DB desde JSON subido por el admin
app.post('/api/admin/db-restore', authMiddleware, (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.tracks))
    return res.status(400).json({ error: 'Formato inválido' });
  const oldHash = db.password_hash; // preservar contraseña de admin
  db = { ...payload };
  if (!db.password_hash) db.password_hash = oldHash;
  saveDB(db);
  res.json({ ok: true, users: (db.users || []).length, playlists: (db.playlists || []).length });
});

// Enlazar video de YouTube con un track manualmente
// Visibilidad masiva — activar o desactivar todos los tracks de una vez
// (debe ir ANTES de /:id/visible para que Express no lo trate como id)
app.patch('/api/admin/tracks/bulk-visible', authMiddleware, (req, res) => {
  const { visible, ids } = req.body || {};
  const targets = ids?.length
    ? (db.tracks || []).filter(t => ids.includes(String(t.id)))
    : (db.tracks || []);
  targets.forEach(t => { t.visible = visible !== false; });
  saveDB(db);
  res.json({ ok: true, updated: targets.length, visible: visible !== false });
});

// Toggle visibilidad en la web pública
app.patch('/api/admin/tracks/:id/visible', authMiddleware, (req, res) => {
  const track = (db.tracks || []).find(t => String(t.id) === String(req.params.id));
  if (!track) return res.status(404).json({ error: 'Track no encontrado' });
  track.visible = req.body.visible !== false;
  saveDB(db);
  res.json({ ok: true, id: track.id, visible: track.visible });
});

app.patch('/api/admin/tracks/:id/videoId', authMiddleware, (req, res) => {
  const track = (db.tracks || []).find(t => String(t.id) === String(req.params.id));
  if (!track) return res.status(404).json({ error: 'Track no encontrado' });
  track.videoId = (req.body.videoId || '').trim();
  saveDB(db);
  res.json({ ok: true, id: track.id, videoId: track.videoId });
});

// Auto-match: enlazar todos los tracks con videos por título
app.post('/api/admin/video-track-match', authMiddleware, (req, res) => {
  const matched = autoMatchVideoTracks();
  if (matched > 0) saveDB(db);
  res.json({ ok: true, matched, total: (db.tracks || []).length, videos: (db.videos || []).length });
});

// Actualizar scUrl de un track manualmente
app.patch('/api/admin/tracks/:id/scUrl', authMiddleware, (req, res) => {
  const track = (db.tracks || []).find(t => String(t.id) === String(req.params.id));
  if (!track) return res.status(404).json({ error: 'Track no encontrado' });
  track.scUrl = (req.body.scUrl || '').trim();
  saveDB(db);
  res.json({ ok: true, id: track.id, scUrl: track.scUrl });
});

// Auto-sync scUrl: construye el slug SC a partir del título y verifica via oEmbed
app.post('/api/admin/sc-url-sync', authMiddleware, async (req, res) => {
  const scUser = (req.body.scUser || process.env.SC_USER || 'biel-rivero-sampol').trim();

  function toSlug(title) {
    return (title || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar acentos
      .replace(/[^a-z0-9\s-]/g, '')
      .trim().replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  function checkUrl(url) {
    return new Promise(resolve => {
      const oEmbed = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
      https.get(oEmbed, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
        resolve(r.statusCode === 200);
        r.resume();
      }).on('error', () => resolve(false));
    });
  }

  const tracks = db.tracks || [];
  const results = { checked: 0, found: 0, skipped: 0 };

  for (const t of tracks) {
    if (t.scUrl) { results.skipped++; continue; }
    const slug = toSlug(t.title);
    if (!slug) continue;
    const url = `https://soundcloud.com/${scUser}/${slug}`;
    results.checked++;
    const ok = await checkUrl(url);
    if (ok) { t.scUrl = url; results.found++; }
    await new Promise(r => setTimeout(r, 120)); // rate limit suave
  }

  if (results.found > 0) saveDB(db);
  res.json({ ok: true, scUser, ...results });
});

// ── RAYVER RADIO DEFAULT PLAYLIST ────────────────────────────────
app.get('/api/public/radio-playlist', (req, res) => {
  const ids = db.radioPlaylist || [];
  const tracks = ids
    .map(id => (db.tracks || []).find(t => t.id === id))
    .filter(Boolean)
    .map(t => ({
      id: t.id, title: t.title, artist: t.artist || 'RAYVER',
      cover: t.cover || null, scUrl: t.scUrl || null,
      videoId: t.videoId || null, spotifyUrl: t.spotifyUrl || null,
      durationMs: t.durationMs || 0,
    }));
  res.json({ tracks });
});

app.get('/api/admin/radio-playlist', authMiddleware, (req, res) => {
  res.json({ trackIds: db.radioPlaylist || [] });
});

app.put('/api/admin/radio-playlist', authMiddleware, (req, res) => {
  const { trackIds } = req.body || {};
  if (!Array.isArray(trackIds)) return res.status(400).json({ error: 'trackIds debe ser un array' });
  // Solo guardar IDs que existen en la BD
  db.radioPlaylist = trackIds.filter(id => (db.tracks || []).some(t => t.id === id));
  saveDB(db);
  res.json({ ok: true, count: db.radioPlaylist.length });
});

// ══════════════════════════════════════════════════════════════
// AMBIENT MUSIC SYSTEM
// ══════════════════════════════════════════════════════════════
const multer = require('multer');
const mm     = require('music-metadata');

const AMBIENT_DIR        = path.join(DATA_DIR, 'ambient');
const AMBIENT_TRACKS_DIR = path.join(AMBIENT_DIR, 'tracks');
const AMBIENT_COVERS_DIR = path.join(AMBIENT_DIR, 'covers');
[AMBIENT_DIR, AMBIENT_TRACKS_DIR, AMBIENT_COVERS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// DB migrations
if (!db.ambientTracks) { db.ambientTracks = []; saveDB(db); }
if (!db.ambientPacks)  { db.ambientPacks  = []; saveDB(db); }
if (!db.ambientAccess) { db.ambientAccess = []; saveDB(db); }
if (!db.ambientPlans) {
  db.ambientPlans = [
    { id: 'plan_monthly', title: 'Mensual',   description: 'Acceso completo a toda la biblioteca',    price: 4.99,  currency: 'EUR', durationDays: 30,  badge: null,             active: true, order: 0 },
    { id: 'plan_annual',  title: 'Anual',     description: 'Acceso completo — 2 meses de regalo',     price: 39.99, currency: 'EUR', durationDays: 365, badge: '2 meses gratis', active: true, order: 1 },
  ];
  saveDB(db);
}

// Multer: audio (500MB) y covers (5MB)
const _audioStorage = multer.diskStorage({
  destination: AMBIENT_TRACKS_DIR,
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')),
});
const _coverStorage = multer.diskStorage({
  destination: AMBIENT_COVERS_DIR,
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')),
});
const uploadAudio = multer({ storage: _audioStorage, limits: { fileSize: 500 * 1024 * 1024 } });
const uploadCover = multer({ storage: _coverStorage, limits: { fileSize: 10  * 1024 * 1024 } });

// ── Helper: check user ambient access ──────────────────────────
function checkAmbientAccess(userId, packId) {
  const now    = Date.now();
  const access = (db.ambientAccess || []).filter(a => a.userId === userId);
  const hasSub = access.some(a => a.type === 'subscription' && (!a.expiresAt || new Date(a.expiresAt).getTime() > now));
  if (hasSub) return { ok: true, type: 'subscription' };
  if (packId) {
    const hasPack = access.some(a => a.type === 'pack' && a.packId === packId);
    if (hasPack) return { ok: true, type: 'pack' };
  }
  return { ok: false };
}

// ── PUBLIC endpoints ────────────────────────────────────────────
app.get('/api/public/ambient/packs', (req, res) => {
  const packs = (db.ambientPacks || [])
    .filter(p => p.active !== false)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .map(p => ({
      ...p,
      trackCount: (db.ambientTracks || []).filter(t => t.packId === p.id && t.active !== false).length,
    }));
  res.json({ packs });
});

app.get('/api/public/ambient/tracks', (req, res) => {
  const { packId } = req.query;
  let tracks = (db.ambientTracks || []).filter(t => t.active !== false);
  if (packId) tracks = tracks.filter(t => t.packId === packId);
  res.json({
    tracks: tracks
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .map(({ id, title, description, cover, tags, duration, packId, previewUrl }) =>
        ({ id, title, description, cover: cover || null, tags: tags || [], duration: duration || 0, packId: packId || null, previewUrl: previewUrl || null })),
  });
});

app.get('/api/public/ambient/plans', (req, res) => {
  res.json({ plans: (db.ambientPlans || []).filter(p => p.active !== false).sort((a, b) => (a.order ?? 999) - (b.order ?? 999)) });
});

// ── USER: access check + stream ─────────────────────────────────
app.get('/api/ambient/access', userAuth, (req, res) => {
  const now    = Date.now();
  const myAcc  = (db.ambientAccess || []).filter(a => a.userId === req.user.userId);
  const sub    = myAcc.find(a => a.type === 'subscription' && (!a.expiresAt || new Date(a.expiresAt).getTime() > now));
  const packs  = myAcc.filter(a => a.type === 'pack').map(a => a.packId);
  res.json({ hasSubscription: !!sub, subscription: sub || null, packs });
});

app.get('/api/ambient/stream/:id', userAuth, (req, res) => {
  const track = (db.ambientTracks || []).find(t => t.id === req.params.id && t.active !== false);
  if (!track) return res.status(404).json({ error: 'Track no encontrado' });
  const acc = checkAmbientAccess(req.user.userId, track.packId);
  if (!acc.ok) return res.status(403).json({ error: 'Sin acceso', code: 'NO_ACCESS' });
  const src = track.source || {};
  if (src.type === 'file') return res.json({ type: 'file', url: `/api/ambient/media/${path.basename(src.file)}` });
  if (src.type === 'url')  return res.json({ type: 'url',  url: src.url });
  if (src.type === 'gdrive') {
    if (!src.fileId) return res.status(400).json({ error: 'fileId de Google Drive no configurado' });
    const url = `https://drive.google.com/uc?export=download&id=${src.fileId}&confirm=t`;
    return res.json({ type: 'url', url });
  }
  if (src.type === 'platform') return res.json({ type: 'platform', platformType: src.platformType, url: src.url });
  res.status(400).json({ error: 'Fuente no configurada para este track' });
});

// Serve uploaded audio (requires user auth + access)
app.get('/api/ambient/media/:filename', userAuth, (req, res) => {
  const filename = path.basename(req.params.filename); // sanitize
  const track    = (db.ambientTracks || []).find(t => t.source?.type === 'file' && t.source.file && path.basename(t.source.file) === filename);
  if (!track) return res.status(404).json({ error: 'No encontrado' });
  const acc = checkAmbientAccess(req.user.userId, track.packId);
  if (!acc.ok) return res.status(403).json({ error: 'Sin acceso', code: 'NO_ACCESS' });
  const filePath = path.join(AMBIENT_TRACKS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado en disco' });
  const stat     = fs.statSync(filePath);
  const range    = req.headers.range;
  const mime     = filename.endsWith('.flac') ? 'audio/flac' : filename.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
  if (range) {
    const [s, e]    = range.replace(/bytes=/, '').split('-');
    const start     = parseInt(s, 10);
    const end       = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': mime });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': mime, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Covers are public (no auth)
app.use('/api/ambient/covers', express.static(AMBIENT_COVERS_DIR));

// ── ADMIN: Folder scanner ───────────────────────────────────────
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a', '.opus', '.wma']);

// Allowed scan roots: DATA_DIR always allowed + any path in AMBIENT_SCAN_PATHS env var
function _getAllowedRoots() {
  const roots = [DATA_DIR];
  const extra = process.env.AMBIENT_SCAN_PATHS || '';
  extra.split(':').map(s => s.trim()).filter(Boolean).forEach(p => roots.push(p));
  return roots;
}

function _isAllowedPath(p) {
  const resolved = path.resolve(p);
  return _getAllowedRoots().some(root => resolved.startsWith(path.resolve(root)));
}

function _walkDir(dir, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      _walkDir(full, results);
    } else if (e.isFile() && AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

async function _extractMeta(filePath) {
  try {
    const meta    = await mm.parseFile(filePath, { duration: true, skipCovers: false });
    const { common, format } = meta;
    let coverUrl = null;
    // Save embedded cover art if present
    if (common.picture && common.picture.length > 0) {
      const pic  = common.picture[0];
      const ext  = pic.format.replace('image/', '.').replace('jpeg', 'jpg') || '.jpg';
      const fn   = path.basename(filePath, path.extname(filePath)) + '_cover' + ext;
      const dest = path.join(AMBIENT_COVERS_DIR, fn);
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, pic.data);
      coverUrl = `/api/ambient/covers/${fn}`;
    }
    return {
      title:    common.title  || path.basename(filePath, path.extname(filePath)),
      artist:   common.artist || common.albumartist || null,
      album:    common.album  || null,
      year:     common.year   || null,
      genre:    common.genre  || [],
      duration: format.duration ? Math.round(format.duration) : 0,
      cover:    coverUrl,
    };
  } catch {
    return {
      title:    path.basename(filePath, path.extname(filePath)),
      artist:   null, album: null, year: null, genre: [], duration: 0, cover: null,
    };
  }
}

app.post('/api/admin/ambient/scan', authMiddleware, async (req, res) => {
  const { scanPath, packId, autoActive = true } = req.body || {};

  // Default: ambient tracks dir
  const targetPath = scanPath ? path.resolve(scanPath) : AMBIENT_TRACKS_DIR;

  if (!_isAllowedPath(targetPath)) {
    return res.status(403).json({ error: `Ruta no permitida. Añade la ruta a AMBIENT_SCAN_PATHS en las variables de entorno.` });
  }
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: `Ruta no encontrada: ${targetPath}` });
  }

  const files   = _walkDir(targetPath);
  const results = { found: files.length, imported: 0, skipped: 0, errors: 0, tracks: [] };

  // Build set of already-known files to skip duplicates
  const knownFiles = new Set(
    (db.ambientTracks || [])
      .filter(t => t.source?.type === 'file' && t.source.file)
      .map(t => path.resolve(t.source.file))
  );

  for (const filePath of files) {
    const resolved = path.resolve(filePath);
    if (knownFiles.has(resolved)) { results.skipped++; continue; }

    let meta;
    try { meta = await _extractMeta(filePath); } catch(e) { results.errors++; continue; }

    // Determine if file is inside AMBIENT_TRACKS_DIR (served via /api/ambient/media)
    // or in an external path (served directly — user must ensure it's accessible)
    const isInternal = resolved.startsWith(path.resolve(AMBIENT_TRACKS_DIR));
    const sourceFile = isInternal ? path.basename(filePath) : filePath;

    const track = {
      id:          uid(),
      title:       meta.title,
      description: [meta.artist, meta.album, meta.year].filter(Boolean).join(' · '),
      cover:       meta.cover || null,
      tags:        meta.genre || [],
      duration:    meta.duration,
      packId:      packId || null,
      previewUrl:  null,
      source:      { type: 'file', file: sourceFile },
      order:       (db.ambientTracks || []).length + results.imported,
      active:      autoActive !== false,
      createdAt:   new Date().toISOString(),
      importedFrom: filePath,
    };

    db.ambientTracks = [...(db.ambientTracks || []), track];
    knownFiles.add(resolved);
    results.imported++;
    results.tracks.push({ id: track.id, title: track.title, duration: track.duration, cover: track.cover });
  }

  if (results.imported > 0) saveDB(db);
  res.json(results);
});

// ── ADMIN: File uploads ─────────────────────────────────────────
app.post('/api/admin/ambient/upload/track', authMiddleware, uploadAudio.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  res.json({ filename: req.file.filename, url: `/api/ambient/media/${req.file.filename}` });
});
app.post('/api/admin/ambient/upload/cover', authMiddleware, uploadCover.single('cover'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  res.json({ filename: req.file.filename, url: `/api/ambient/covers/${req.file.filename}` });
});

// ── ADMIN: Tracks CRUD ──────────────────────────────────────────
app.get('/api/admin/ambient/tracks', authMiddleware, (req, res) => res.json({ tracks: db.ambientTracks || [] }));

app.post('/api/admin/ambient/tracks', authMiddleware, (req, res) => {
  const { title, description, cover, tags, duration, packId, previewUrl, source, order } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Título requerido' });
  const track = {
    id: uid(), title, description: description || '', cover: cover || null,
    tags: tags || [], duration: duration || 0, packId: packId || null,
    previewUrl: previewUrl || null, source: source || { type: 'url', url: '' },
    order: order ?? (db.ambientTracks || []).length,
    active: true, createdAt: new Date().toISOString(),
  };
  db.ambientTracks = [...(db.ambientTracks || []), track];
  saveDB(db);
  res.json({ track });
});

app.put('/api/admin/ambient/tracks/:id', authMiddleware, (req, res) => {
  const idx = (db.ambientTracks || []).findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' });
  db.ambientTracks[idx] = { ...db.ambientTracks[idx], ...req.body, id: req.params.id };
  saveDB(db);
  res.json({ track: db.ambientTracks[idx] });
});

app.delete('/api/admin/ambient/tracks/:id', authMiddleware, (req, res) => {
  const track = (db.ambientTracks || []).find(t => t.id === req.params.id);
  if (!track) return res.status(404).json({ error: 'No encontrado' });
  if (track.source?.type === 'file' && track.source.file) {
    const fp = path.join(AMBIENT_TRACKS_DIR, path.basename(track.source.file));
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch(e) {}
  }
  db.ambientTracks = (db.ambientTracks || []).filter(t => t.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ── ADMIN: Google Drive folder batch import ────────────────────
app.post('/api/admin/ambient/gdrive-folder-import', authMiddleware, async (req, res) => {
  const { folderUrl, packId } = req.body || {};
  if (!folderUrl) return res.status(400).json({ error: 'folderUrl requerido' });

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_API_KEY no configurada en el servidor' });

  // Extract folder ID from URL
  const folderMatch = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  const folderId = folderMatch ? folderMatch[1] : (/^[a-zA-Z0-9_-]{20,}$/.test(folderUrl.trim()) ? folderUrl.trim() : null);
  if (!folderId) return res.status(400).json({ error: 'No se pudo extraer el ID de la carpeta de Google Drive de la URL proporcionada' });

  const AUDIO_MIME = new Set([
    'audio/mpeg', 'audio/mp3', 'audio/flac', 'audio/wav', 'audio/ogg',
    'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/opus', 'audio/webm'
  ]);

  try {
    let allFiles = [];
    let pageToken = null;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType)',
        pageSize: '100',
        key: apiKey,
      });
      if (pageToken) params.set('pageToken', pageToken);
      const apiRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
      if (!apiRes.ok) {
        const err = await apiRes.json().catch(() => ({}));
        return res.status(502).json({ error: `Error de Google Drive API: ${err.error?.message || apiRes.status}` });
      }
      const data = await apiRes.json();
      allFiles = allFiles.concat(data.files || []);
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    const audioFiles = allFiles.filter(f => AUDIO_MIME.has(f.mimeType));
    const existingIds = new Set((db.ambientTracks || []).map(t => t.source?.fileId).filter(Boolean));

    const imported = [];
    const skipped  = [];

    for (const f of allFiles) {
      if (!AUDIO_MIME.has(f.mimeType)) {
        skipped.push({ name: f.name, reason: 'not-audio' });
        continue;
      }
      if (existingIds.has(f.id)) {
        skipped.push({ name: f.name, reason: 'exists' });
        continue;
      }
      const track = {
        id: uid(),
        title: f.name.replace(/\.[^.]+$/, ''),
        description: '',
        cover: null,
        tags: [],
        duration: 0,
        packId: packId || null,
        previewUrl: null,
        source: { type: 'gdrive', fileId: f.id },
        order: (db.ambientTracks || []).length,
        active: true,
        createdAt: new Date().toISOString(),
      };
      db.ambientTracks = [...(db.ambientTracks || []), track];
      imported.push({ name: f.name, id: track.id });
    }

    if (imported.length) saveDB(db);
    res.json({ imported, skipped, total: allFiles.length });
  } catch (e) {
    console.error('gdrive-folder-import error:', e);
    res.status(500).json({ error: e.message || 'Error interno' });
  }
});

// ── ADMIN: Packs CRUD ──────────────────────────────────────────
app.get('/api/admin/ambient/packs', authMiddleware, (req, res) => res.json({ packs: db.ambientPacks || [] }));

app.post('/api/admin/ambient/packs', authMiddleware, (req, res) => {
  const { title, description, cover, price, currency, order, badge } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Título requerido' });
  const pack = {
    id: uid(), title, description: description || '', cover: cover || null,
    price: price || 0, currency: currency || 'EUR', badge: badge || null,
    order: order ?? (db.ambientPacks || []).length,
    active: true, createdAt: new Date().toISOString(),
  };
  db.ambientPacks = [...(db.ambientPacks || []), pack];
  saveDB(db);
  res.json({ pack });
});

app.put('/api/admin/ambient/packs/:id', authMiddleware, (req, res) => {
  const idx = (db.ambientPacks || []).findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' });
  db.ambientPacks[idx] = { ...db.ambientPacks[idx], ...req.body, id: req.params.id };
  saveDB(db);
  res.json({ pack: db.ambientPacks[idx] });
});

app.delete('/api/admin/ambient/packs/:id', authMiddleware, (req, res) => {
  db.ambientPacks = (db.ambientPacks || []).filter(p => p.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ── ADMIN: Plans ────────────────────────────────────────────────
app.get('/api/admin/ambient/plans', authMiddleware, (req, res) => res.json({ plans: db.ambientPlans || [] }));

app.put('/api/admin/ambient/plans/:id', authMiddleware, (req, res) => {
  const idx = (db.ambientPlans || []).findIndex(p => p.id === req.params.id);
  if (idx < 0) {
    db.ambientPlans = [...(db.ambientPlans || []), { id: req.params.id, ...req.body }];
  } else {
    db.ambientPlans[idx] = { ...db.ambientPlans[idx], ...req.body, id: req.params.id };
  }
  saveDB(db);
  res.json({ ok: true });
});

// ── ADMIN: Access management ────────────────────────────────────
app.get('/api/admin/ambient/access', authMiddleware, (req, res) => {
  const enriched = (db.ambientAccess || []).map(a => {
    const user = (db.users || []).find(u => u.id === a.userId);
    const pack = a.packId ? (db.ambientPacks || []).find(p => p.id === a.packId) : null;
    const plan = a.planId ? (db.ambientPlans || []).find(p => p.id === a.planId) : null;
    return { ...a, userName: user?.name || '—', userEmail: user?.email || a.email || '—', packTitle: pack?.title || null, planTitle: plan?.title || null };
  }).sort((a, b) => new Date(b.grantedAt) - new Date(a.grantedAt));
  res.json({ access: enriched });
});

app.post('/api/admin/ambient/access', authMiddleware, (req, res) => {
  const { email, type, packId, planId, expiresAt, note } = req.body || {};
  if (!email || !type) return res.status(400).json({ error: 'email y type son requeridos' });
  const user = (db.users || []).find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado — debe registrarse primero en la web.' });
  const access = {
    id: uid(), userId: user.id, email: user.email, type,
    packId: packId || null, planId: planId || null,
    grantedAt: new Date().toISOString(), expiresAt: expiresAt || null, note: note || null,
  };
  db.ambientAccess = [...(db.ambientAccess || []), access];
  saveDB(db);
  res.json({ access });
});

app.delete('/api/admin/ambient/access/:id', authMiddleware, (req, res) => {
  if (!(db.ambientAccess || []).some(a => a.id === req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  db.ambientAccess = (db.ambientAccess || []).filter(a => a.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
// ANALYTICS SYSTEM
// ══════════════════════════════════════════════════════════════
const ANALYTICS_MAX = 200000; // eventos máximos en DB
const ANALYTICS_TTL = 90;     // días de retención

// Migración
if (!db.analyticsEvents) { db.analyticsEvents = []; saveDB(db); }

// Rate limiting en memoria (sessionId → timestamp del último lote)
const _aRateMap = new Map();
const _aRateLimit = 10000; // ms mínimos entre lotes del mismo session

function _saveAnalytics() {
  // Limpiar eventos > TTL días
  const cutoff = new Date(Date.now() - ANALYTICS_TTL * 86400000).toISOString();
  const before = db.analyticsEvents.length;
  db.analyticsEvents = db.analyticsEvents.filter(e => e.ts > cutoff);
  // Cap al máximo
  if (db.analyticsEvents.length > ANALYTICS_MAX) {
    db.analyticsEvents = db.analyticsEvents.slice(-ANALYTICS_MAX);
  }
  saveDB(db);
}

// POST /api/analytics/batch — ingesta de eventos (sin auth, anónimo)
app.post('/api/analytics/batch', (req, res) => {
  const { events } = req.body || {};
  if (!Array.isArray(events) || !events.length) return res.json({ ok: true });

  const sid = events[0]?.sessionId || 'unknown';
  const now = Date.now();

  // Rate limiting: un lote cada 10s por sesión
  if (_aRateMap.has(sid) && now - _aRateMap.get(sid) < _aRateLimit) {
    return res.json({ ok: true, skipped: true });
  }
  _aRateMap.set(sid, now);
  // Limpiar el map si crece demasiado
  if (_aRateMap.size > 50000) {
    const old = now - 3600000; // 1h
    _aRateMap.forEach((t, k) => { if (t < old) _aRateMap.delete(k); });
  }

  // Anonimizar IP: guardar solo país aproximado via header CF o similar
  // No guardamos IP completa — solo primeros 2 octetos para geo muy aproximado
  const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
  const anonIp = rawIp.split('.').slice(0, 2).join('.') + '.x.x';

  const ua = req.headers['user-agent'] || '';

  const stored = events.slice(0, 200).map(ev => ({ // max 200 eventos por lote
    id:        uid(),
    type:      String(ev.type || 'unknown').slice(0, 60),
    sessionId: String(ev.sessionId || sid).slice(0, 64),
    data:      ev.data && typeof ev.data === 'object' ? ev.data : {},
    device:    String(ev.device || '').slice(0, 20),
    ua:        ua.slice(0, 200),
    ip:        anonIp,
    ts:        typeof ev.ts === 'string' ? ev.ts : new Date().toISOString(),
  }));

  db.analyticsEvents = [...(db.analyticsEvents || []), ...stored];
  _saveAnalytics();
  res.json({ ok: true, received: stored.length });
});

// ── Helpers de análisis ────────────────────────────────────────
function _windowStart(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function _groupBy(arr, fn) {
  const out = {};
  for (const item of arr) {
    const key = fn(item);
    if (key == null) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}

function _topN(arr, fn, n = 10) {
  return _groupBy(arr, fn).slice(0, n).map(([k, v]) => ({ label: k, count: v }));
}

function _uniqueSessions(events) {
  return new Set(events.map(e => e.sessionId)).size;
}

function _playsPerDay(events, days = 14) {
  const map = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    map[d] = 0;
  }
  for (const e of events) {
    const d = e.ts.slice(0, 10);
    if (d in map) map[d]++;
  }
  return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
}

// GET /api/admin/analytics/summary
app.get('/api/admin/analytics/summary', authMiddleware, (req, res) => {
  const all   = db.analyticsEvents || [];
  const now7  = _windowStart(7);
  const now30 = _windowStart(30);
  const now1  = _windowStart(1);

  const last30 = all.filter(e => e.ts >= now30);
  const last7  = all.filter(e => e.ts >= now7);
  const last1  = all.filter(e => e.ts >= now1);

  const plays30 = last30.filter(e => e.type === 'track_play');
  const plays7  = last7.filter(e => e.type === 'track_play');
  const plays1  = last1.filter(e => e.type === 'track_play');

  const summary = {
    totals: {
      events:    all.length,
      sessions:  _uniqueSessions(last30),
      sessions7: _uniqueSessions(last7),
      sessions1: _uniqueSessions(last1),
      plays:     plays30.length,
      plays7:    plays7.length,
      plays1:    plays1.length,
      logins:    last30.filter(e => e.type === 'auth_login').length,
      registers: last30.filter(e => e.type === 'auth_register').length,
    },
    topTracks:    _topN(plays30, e => e.data?.title, 15),
    topSections:  _topN(last30.filter(e => e.type === 'section_view'), e => e.data?.label, 10),
    topPlatforms: _topN(last30.filter(e => e.type === 'link_click'),   e => e.data?.platform, 8),
    topSources:   _topN(last30.filter(e => e.type === 'session_start' && e.data?.source), e => e.data?.source, 10),
    devices:      _topN(last30, e => e.device, 4),
    playsPerDay:  _playsPerDay(plays30, 14),
    beatClicks:   _topN(last30.filter(e => e.type === 'beat_card_click' || e.type === 'beat_buy_intent'), e => e.data?.title, 5),
    ambientPlays: _topN(last30.filter(e => e.type === 'ambient_play'), e => e.data?.title, 5),
    finishRate: (() => {
      const finished = last30.filter(e => e.type === 'track_finish').length;
      const played   = plays30.length;
      return played ? Math.round((finished / played) * 100) : 0;
    })(),
  };

  res.json(summary);
});

// GET /api/admin/analytics/events?page=0&limit=50&type=
app.get('/api/admin/analytics/events', authMiddleware, (req, res) => {
  const page  = Math.max(0, parseInt(req.query.page) || 0);
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const type  = req.query.type || '';

  let evs = [...(db.analyticsEvents || [])].reverse(); // más recientes primero
  if (type) evs = evs.filter(e => e.type === type);

  res.json({
    total: evs.length,
    page,
    items: evs.slice(page * limit, (page + 1) * limit),
  });
});

app.listen(PORT, () => console.log('Backend escuchando en :' + PORT));
