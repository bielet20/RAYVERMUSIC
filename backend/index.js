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

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ───────────────────────── DB helpers ─────────────────────────
function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      tracks: [], albums: [], videos: [], products: [], members: [], orders: [],
      password_hash: crypto.createHash('sha256').update('rayver2025').digest('hex'),
      syncLog: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
let db = loadDB();

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ───────────────────────── Auth ─────────────────────────
const SESSIONS = new Set();
function authMiddleware(req, res, next) {
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  if (!tok || !SESSIONS.has(tok)) return res.status(401).json({ error: 'No autorizado' });
  next();
}

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  const hash = crypto.createHash('sha256').update(password || '').digest('hex');
  if (hash !== db.password_hash) return res.status(401).json({ error: 'Contraseña incorrecta' });
  const token = crypto.randomBytes(24).toString('hex');
  SESSIONS.add(token);
  res.json({ token });
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
  saveDB(db);
  return result;
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
          const trackData = {
            id: existing ? existing.id : uid(),
            title: t.title,
            artist: (t.user && t.user.username) || 'RAYVER',
            scId: t.id,
            scUrl: t.permalink_url,
            cover: t.artwork_url ? t.artwork_url.replace('-large', '-t500x500') : ((t.user && t.user.avatar_url) || ''),
            durationMs: t.duration,
            genre: t.genre || '',
            source: existing && existing.source === 'spotify' ? existing.source : 'soundcloud',
            order: existing ? existing.order : db.tracks.length,
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

  // 2. Fallback: oEmbed de la playlist pública (no requiere credenciales, siempre funciona si la URL es correcta)
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
  res.json((db.tracks || []).slice().sort((a,b)=>(a.order||0)-(b.order||0)));
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

app.listen(PORT, () => console.log('Backend escuchando en :' + PORT));
