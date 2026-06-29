'use strict';

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const https    = require('https');

const app  = express();
const PORT = process.env.BACKEND_PORT || 3001;
const DATA    = path.join('/app/data', 'db.json');
const UPLOADS = path.join('/app/data', 'uploads');
const ORIGIN  = process.env.FRONTEND_ORIGIN || '*';

// Credenciales de APIs externas
const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID     || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const YOUTUBE_API_KEY       = process.env.YOUTUBE_API_KEY       || '';
// IDs de artistas Spotify separados por coma
const SPOTIFY_ARTIST_IDS    = (process.env.SPOTIFY_ARTIST_IDS || '0GmwWh84e70RNGNkYOwE6d,5nSppopCQHlvoqzITdo0D5,0f0nSRoIlPdvZyPuBIZD8M,5GzN9yf1adZZKKUBFHArg5,5kOm7nsefS4UwlK9B11iom').split(',').map(s => s.trim()).filter(Boolean);
// IDs de canal YouTube separados por coma (o handle como @RAYVER)
const YOUTUBE_CHANNEL_IDS   = (process.env.YOUTUBE_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const SITE_URL              = process.env.SITE_URL || 'https://rayvermusic.com';
const STRIPE_SECRET         = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// SoundCloud API
const SC_CLIENT_ID       = process.env.SC_CLIENT_ID || 'k2D1eFX4gQdXMiTb98JNEuPC5XRSrfqP';
const SC_USER_PERMALINK  = process.env.SC_USER_PERMALINK || 'biel-rivero-sampol';
const SC_PLAYLIST_URL    = process.env.SC_PLAYLIST_URL || 'https://soundcloud.com/biel-rivero-sampol/sets/marzo-best-ranking';

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({ origin: ORIGIN, methods: ['GET','POST','PUT','DELETE','PATCH'] }));
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// ── PERSISTENCIA ──────────────────────────────────────────────────────────────
function defaultDb() {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPwd('rayver2025', salt);
  return {
    auth: { hash, salt },
    tracks: [], albums: [], videos: [],
    products: [], members: [], orders: [],
    downloadTokens: {},
    syncLog: []   // historial de sincronizaciones
  };
}

function loadDb() {
  try { if (fs.existsSync(DATA)) return JSON.parse(fs.readFileSync(DATA, 'utf8')); }
  catch (_) {}
  return defaultDb();
}

function saveDb(db) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.mkdirSync(UPLOADS, { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(db, null, 2));
}

let db = loadDb();
// Garantizar campos nuevos en DB existente
['products','members','orders','syncLog'].forEach(k => { if (!db[k]) db[k] = []; });
if (!db.downloadTokens) db.downloadTokens = {};
saveDb(db);

// ── AUTH ──────────────────────────────────────────────────────────────────────
const TOKEN_TTL = 8 * 60 * 60 * 1000;
const tokens = new Map();

function hashPwd(pwd, salt) { return crypto.scryptSync(pwd, salt, 64).toString('hex'); }
function uid() { return Date.now().toString(36) + crypto.randomBytes(3).toString('hex'); }

function genToken() {
  const t = crypto.randomBytes(32).toString('hex');
  tokens.set(t, Date.now() + TOKEN_TTL);
  return t;
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t || !tokens.has(t) || tokens.get(t) < Date.now())
    return res.status(401).json({ error: 'No autorizado' });
  tokens.set(t, Date.now() + TOKEN_TTL);
  next();
}

setInterval(() => { const n = Date.now(); for (const [k,e] of tokens) if (e < n) tokens.delete(k); }, 3600000);

// ── HTTP HELPER ───────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    }).on('error', reject);
  });
}

function httpPost(hostname, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body;
    const opts = { hostname, path, method: 'POST', headers: { 'Content-Length': Buffer.byteLength(data), ...headers } };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── SPOTIFY AUTH ──────────────────────────────────────────────────────────────
let spotifyToken = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) throw new Error('Spotify credentials missing');

  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const { data } = await httpPost('accounts.spotify.com', '/api/token',
    'grant_type=client_credentials',
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${creds}` }
  );
  spotifyToken = data.access_token;
  spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return spotifyToken;
}

async function spotifyGet(endpoint) {
  const token = await getSpotifyToken();
  const { data } = await httpGet(`https://api.spotify.com/v1${endpoint}`);
  // Si necesitamos autenticación Bearer la añadimos via headers — usar https.get con headers
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.spotify.com/v1${endpoint}`);
    const opts = {
      hostname: url.hostname, path: url.pathname + url.search, method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    };
    https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({}); }
      });
    }).on('error', reject).end();
  });
}

// ── SPOTIFY SYNC ──────────────────────────────────────────────────────────────
async function syncSpotify() {
  const results = { added: 0, updated: 0, skipped: 0, errors: [] };

  for (const artistId of SPOTIFY_ARTIST_IDS) {
    try {
      // Obtener info del artista
      const artist = await spotifyGet(`/artists/${artistId}`);
      const artistName = artist.name || 'RAYVER';

      // Obtener álbumes (incluye singles, albums, compilations)
      let offset = 0, total = Infinity;
      while (offset < total) {
        const albumsData = await spotifyGet(
          `/artists/${artistId}/albums?include_groups=album,single&market=ES&limit=50&offset=${offset}`
        );
        total = albumsData.total || 0;
        const albums = albumsData.items || [];
        if (!albums.length) break;

        for (const album of albums) {
          // Obtener tracks del álbum
          let trackOffset = 0, trackTotal = Infinity;
          while (trackOffset < trackTotal) {
            const tracksData = await spotifyGet(
              `/albums/${album.id}/tracks?market=ES&limit=50&offset=${trackOffset}`
            );
            trackTotal = tracksData.total || 0;
            const tracks = tracksData.items || [];
            if (!tracks.length) break;

            for (const t of tracks) {
              const spotifyUrl = `https://open.spotify.com/track/${t.id}`;
              // Buscar si ya existe
              const existing = db.tracks.find(x =>
                x.platforms?.spotify === spotifyUrl ||
                (x.title?.toLowerCase() === t.name?.toLowerCase() && x.source === 'spotify')
              );

              const trackData = {
                title:  t.name,
                album:  album.name,
                type:   album.album_type === 'album' ? 'Álbum' : 'Single',
                year:   album.release_date?.slice(0, 4) || '',
                cover:  album.images?.[0]?.url || '',
                source: 'spotify',
                sourceId: t.id,
                streamUrl: t.preview_url || '', // preview de 30s de Spotify
                platforms: { spotify: spotifyUrl, ...(existing?.platforms || {}) },
                updatedAt: new Date().toISOString()
              };

              if (existing) {
                Object.assign(existing, trackData);
                results.updated++;
              } else {
                db.tracks.unshift({ id: uid(), createdAt: new Date().toISOString(), ...trackData });
                results.added++;
              }
            }
            trackOffset += tracks.length;
            if (trackOffset >= trackTotal) break;
          }
        }
        offset += albums.length;
        if (offset >= total) break;
      }
    } catch (e) {
      results.errors.push(`Spotify artist ${artistId}: ${e.message}`);
    }
  }

  return results;
}

// ── YOUTUBE SYNC ──────────────────────────────────────────────────────────────
async function syncYouTube() {
  const results = { added: 0, updated: 0, skipped: 0, errors: [] };
  if (!YOUTUBE_API_KEY) return { ...results, errors: ['YouTube API key missing'] };

  for (const channelId of YOUTUBE_CHANNEL_IDS) {
    try {
      // Obtener uploads playlist del canal
      const channelRes = await httpGet(
        `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&id=${channelId}&key=${YOUTUBE_API_KEY}`
      );
      const channel = channelRes.data?.items?.[0];
      if (!channel) { results.errors.push(`Canal no encontrado: ${channelId}`); continue; }

      const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsPlaylistId) continue;

      // Paginar todos los videos
      let pageToken = '';
      do {
        const listUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${uploadsPlaylistId}&maxResults=50&key=${YOUTUBE_API_KEY}${pageToken ? '&pageToken=' + pageToken : ''}`;
        const listRes = await httpGet(listUrl);
        const items   = listRes.data?.items || [];
        pageToken     = listRes.data?.nextPageToken || '';

        for (const item of items) {
          const videoId   = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
          const title     = item.snippet?.title || '';
          const desc      = item.snippet?.description || '';
          const thumb     = item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || '';
          const published = item.snippet?.publishedAt?.slice(0, 4) || '';
          const ytUrl     = `https://www.youtube.com/watch?v=${videoId}`;

          // Skip privados/eliminados
          if (title === 'Private video' || title === 'Deleted video' || !videoId) continue;

          // ¿Es video oficial (no shorts)? Detectar por duración si hay details
          const existing = db.videos.find(v => v.videoId === videoId);
          const videoData = {
            videoId,
            title,
            desc:     desc.slice(0, 200),
            thumb,
            year:     published,
            source:   'youtube',
            featured: existing?.featured || false,
            updatedAt: new Date().toISOString()
          };

          // También vincular a track si coincide el título
          const matchTrack = db.tracks.find(t =>
            t.title?.toLowerCase().includes(title.toLowerCase().split(' ').slice(0, 2).join(' ')) ||
            title.toLowerCase().includes(t.title?.toLowerCase().split(' ').slice(0, 2).join(' ') || '')
          );
          if (matchTrack && !matchTrack.platforms?.youtube) {
            matchTrack.platforms = matchTrack.platforms || {};
            matchTrack.platforms.youtube = ytUrl;
          }

          if (existing) {
            Object.assign(existing, videoData);
            results.updated++;
          } else {
            db.videos.unshift({ id: uid(), createdAt: new Date().toISOString(), ...videoData });
            results.added++;
          }
        }
      } while (pageToken);

    } catch (e) {
      results.errors.push(`YouTube channel ${channelId}: ${e.message}`);
    }
  }

  return results;
}

// ── SYNC PRINCIPAL ─────────────────────────────────────────────────────────────
let syncRunning = false;

async function runSync(trigger = 'auto') {
  if (syncRunning) return { error: 'Sync ya en progreso' };
  syncRunning = true;

  const log = {
    id: uid(),
    startedAt: new Date().toISOString(),
    trigger,
    spotify: null,
    youtube: null,
    error: null
  };

  try {
    console.log(`[sync] Iniciando sincronización (${trigger})…`);

    // Spotify
    if (SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET) {
      log.spotify = await syncSpotify();
      console.log(`[sync] Spotify: +${log.spotify.added} / ~${log.spotify.updated}`);
    } else {
      log.spotify = { skipped: true, error: 'Credenciales no configuradas' };
    }

    // SoundCloud
    if (SC_CLIENT_ID) {
      log.soundcloud = await syncSoundCloud();
      console.log(`[sync] SoundCloud: +${log.soundcloud.added} / ~${log.soundcloud.updated}`);
    } else {
      log.soundcloud = { skipped: true, error: 'SC_CLIENT_ID no configurado' };
    }

    // YouTube
    if (YOUTUBE_API_KEY && YOUTUBE_CHANNEL_IDS.length) {
      log.youtube = await syncYouTube();
      console.log(`[sync] YouTube: +${log.youtube.added} / ~${log.youtube.updated}`);
    } else {
      log.youtube = { skipped: true, error: 'API key o canal no configurados' };
    }

    log.finishedAt = new Date().toISOString();
    log.totalTracks = db.tracks.length;
    log.totalVideos = db.videos.length;

    saveDb(db);

    // Guardar en log (máximo 20 entradas)
    db.syncLog.unshift(log);
    if (db.syncLog.length > 20) db.syncLog = db.syncLog.slice(0, 20);
    saveDb(db);

  } catch (e) {
    log.error = e.message;
    log.finishedAt = new Date().toISOString();
    console.error('[sync] Error:', e.message);
  }

  syncRunning = false;
  return log;
}

// ── CRON — SYNC DIARIO ────────────────────────────────────────────────────────
function scheduleSync() {
  // Primera sync 30s después de arrancar
  setTimeout(() => runSync('startup'), 30000);

  // Luego cada 24h
  setInterval(() => runSync('daily-cron'), 24 * 60 * 60 * 1000);
  console.log('[sync] Scheduler activo — primera sync en 30s, luego cada 24h');
}

// ── RUTAS PÚBLICAS ────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Falta contraseña' });
  const { hash, salt } = db.auth;
  if (hashPwd(password, salt) !== hash) return res.status(401).json({ error: 'Contraseña incorrecta' });
  res.json({ token: genToken() });
});

app.get('/api/public/tracks',   (_, res) => res.json(db.tracks));
app.get('/api/public/albums',   (_, res) => res.json(db.albums));
app.get('/api/public/videos',   (_, res) => res.json(db.videos));
app.get('/api/public/products', (_, res) => res.json(
  db.products.filter(p => p.active).map(p => ({
    id: p.id, name: p.name, description: p.description,
    price: p.price, currency: p.currency || 'eur',
    type: p.type, cover: p.cover, features: p.features || [],
    stripePriceId: p.stripePriceId
  }))
));

app.get('/api/health', (_, res) => res.json({
  ok: true,
  tracks: db.tracks.length,
  albums: db.albums.length,
  videos: db.videos.length,
  products: db.products.filter(p=>p.active).length,
  members: db.members.filter(m=>m.status==='active').length,
  syncRunning,
  lastSync: db.syncLog[0]?.finishedAt || null,
  sc: { configured: !!SC_CLIENT_ID, user: SC_USER_PERMALINK }
}));

// ── RUTAS PRIVADAS — SYNC ─────────────────────────────────────────────────────
// Trigger manual desde el admin
app.post('/api/sync/run', auth, async (req, res) => {
  if (syncRunning) return res.status(409).json({ error: 'Sync ya en progreso' });
  // Lanzar async y responder inmediatamente
  res.json({ ok: true, message: 'Sincronización iniciada' });
  await runSync('manual');
});

app.get('/api/sync/status', auth, (req, res) => {
  res.json({
    running: syncRunning,
    logs: db.syncLog,
    totals: {
      tracks: db.tracks.length,
      videos: db.videos.length
    },
    config: {
      spotifyArtists: SPOTIFY_ARTIST_IDS,
      youtubeChannels: YOUTUBE_CHANNEL_IDS,
      hasSpotifyCreds: !!(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET),
      hasYoutubeCreds: !!YOUTUBE_API_KEY
    }
  });
});

// ── RUTAS PRIVADAS — AUTH ─────────────────────────────────────────────────────
app.post('/api/auth/change-password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Faltan campos' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres' });
  const { hash, salt } = db.auth;
  if (hashPwd(currentPassword, salt) !== hash) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  const newSalt = crypto.randomBytes(16).toString('hex');
  db.auth = { hash: hashPwd(newPassword, newSalt), salt: newSalt };
  saveDb(db);
  const cur = (req.headers.authorization || '').slice(7);
  for (const k of tokens.keys()) if (k !== cur) tokens.delete(k);
  res.json({ ok: true });
});

// ── TRACKS CRUD ───────────────────────────────────────────────────────────────
app.get('/api/tracks', auth, (_, res) => res.json(db.tracks));
app.post('/api/tracks', auth, (req, res) => {
  const t = { id: uid(), createdAt: new Date().toISOString(), source: 'manual', ...req.body };
  db.tracks.unshift(t); saveDb(db); res.status(201).json(t);
});
app.put('/api/tracks/:id', auth, (req, res) => {
  const i = db.tracks.findIndex(t => t.id === req.params.id);
  if (i===-1) return res.status(404).json({error:'No encontrado'});
  db.tracks[i] = { ...db.tracks[i], ...req.body, id: req.params.id }; saveDb(db); res.json(db.tracks[i]);
});
app.delete('/api/tracks/:id', auth, (req, res) => {
  const i = db.tracks.findIndex(t => t.id === req.params.id);
  if (i===-1) return res.status(404).json({error:'No encontrado'});
  db.tracks.splice(i,1); saveDb(db); res.json({ok:true});
});

// ── ALBUMS CRUD ───────────────────────────────────────────────────────────────
app.get('/api/albums', auth, (_, res) => res.json(db.albums));
app.post('/api/albums', auth, (req, res) => {
  const a = { id: uid(), createdAt: new Date().toISOString(), ...req.body };
  db.albums.unshift(a); saveDb(db); res.status(201).json(a);
});
app.put('/api/albums/:id', auth, (req, res) => {
  const i = db.albums.findIndex(a => a.id === req.params.id);
  if (i===-1) return res.status(404).json({error:'No encontrado'});
  db.albums[i] = { ...db.albums[i], ...req.body, id: req.params.id }; saveDb(db); res.json(db.albums[i]);
});
app.delete('/api/albums/:id', auth, (req, res) => {
  const i = db.albums.findIndex(a => a.id === req.params.id);
  if (i===-1) return res.status(404).json({error:'No encontrado'});
  db.albums.splice(i,1); saveDb(db); res.json({ok:true});
});

// ── VIDEOS CRUD ───────────────────────────────────────────────────────────────
app.get('/api/videos', auth, (_, res) => res.json(db.videos));
app.post('/api/videos', auth, (req, res) => {
  const v = { id: uid(), createdAt: new Date().toISOString(), ...req.body };
  db.videos.unshift(v); saveDb(db); res.status(201).json(v);
});
app.put('/api/videos/:id', auth, (req, res) => {
  const i = db.videos.findIndex(v => v.id === req.params.id);
  if (i===-1) return res.status(404).json({error:'No encontrado'});
  db.videos[i] = { ...db.videos[i], ...req.body, id: req.params.id }; saveDb(db); res.json(db.videos[i]);
});
app.delete('/api/videos/:id', auth, (req, res) => {
  const i = db.videos.findIndex(v => v.id === req.params.id);
  if (i===-1) return res.status(404).json({error:'No encontrado'});
  db.videos.splice(i,1); saveDb(db); res.json({ok:true});
});
app.patch('/api/videos/reorder', auth, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({error:'ids required'});
  db.videos = ids.map(id=>db.videos.find(v=>v.id===id)).filter(Boolean); saveDb(db); res.json({ok:true});
});

// ── PRODUCTS CRUD ─────────────────────────────────────────────────────────────
app.get('/api/products', auth, (_, res) => res.json(db.products));
app.post('/api/products', auth, (req, res) => {
  const p = { id: uid(), createdAt: new Date().toISOString(), active: true, ...req.body };
  db.products.unshift(p); saveDb(db); res.status(201).json(p);
});
app.put('/api/products/:id', auth, (req, res) => {
  const i = db.products.findIndex(p => p.id === req.params.id);
  if (i===-1) return res.status(404).json({error:'No encontrado'});
  db.products[i] = { ...db.products[i], ...req.body, id: req.params.id }; saveDb(db); res.json(db.products[i]);
});
app.delete('/api/products/:id', auth, (req, res) => {
  const i = db.products.findIndex(p => p.id === req.params.id);
  if (i===-1) return res.status(404).json({error:'No encontrado'});
  db.products.splice(i,1); saveDb(db); res.json({ok:true});
});

// ── MEMBERS & ORDERS ──────────────────────────────────────────────────────────
app.get('/api/members', auth, (_, res) => res.json(db.members));
app.get('/api/orders',  auth, (_, res) => res.json(db.orders));
app.get('/api/stats', auth, (_, res) => {
  const activeMembers = db.members.filter(m => m.status === 'active').length;
  const totalRevenue  = db.orders.reduce((s, o) => s + (o.amount || 0), 0);
  res.json({
    tracks: db.tracks.length, albums: db.albums.length, videos: db.videos.length,
    products: db.products.filter(p=>p.active).length,
    members: activeMembers, orders: db.orders.length,
    revenueEur: (totalRevenue / 100).toFixed(2),
    lastSync: db.syncLog[0]?.finishedAt || null,
    syncRunning
  });
});

// ── STRIPE (simplificado — mantener de versión anterior) ──────────────────────
function stripeReq(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    if (!STRIPE_SECRET) return reject(new Error('STRIPE_SECRET_KEY no configurada'));
    const data = body ? new URLSearchParams(flattenObj(body)).toString() : '';
    const opts = {
      hostname: 'api.stripe.com', path: `/v1/${endpoint}`, method,
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { reject(new Error('Stripe parse error')); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function flattenObj(obj, prefix='') {
  const flat = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) Object.assign(flat, flattenObj(v, key));
    else if (Array.isArray(v)) v.forEach((item, i) => { if (typeof item==='object') Object.assign(flat, flattenObj(item, `${key}[${i}]`)); else flat[`${key}[${i}]`]=item; });
    else if (v !== undefined && v !== null) flat[key] = String(v);
  }
  return flat;
}

app.post('/api/checkout/product', async (req, res) => {
  const { productId, email } = req.body || {};
  const product = db.products.find(p => p.id === productId && p.active);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  if (!product.stripePriceId) return res.status(400).json({ error: 'Precio Stripe no configurado' });
  try {
    const { data } = await stripeReq('POST', 'checkout/sessions', {
      mode: 'payment', customer_email: email||undefined,
      line_items: [{ price: product.stripePriceId, quantity: 1 }],
      success_url: `${SITE_URL}/gracias.html?session_id={CHECKOUT_SESSION_ID}&product=${productId}`,
      cancel_url: `${SITE_URL}/#beats`, metadata: { productId, type: 'product' }
    });
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ url: data.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/checkout/membership', async (req, res) => {
  const { planId, email } = req.body || {};
  const plan = db.products.find(p => p.id === planId && p.type === 'membership' && p.active);
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
  if (!plan.stripePriceId) return res.status(400).json({ error: 'Precio Stripe no configurado' });
  try {
    const { data } = await stripeReq('POST', 'checkout/sessions', {
      mode: 'subscription', customer_email: email||undefined,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${SITE_URL}/gracias.html?session_id={CHECKOUT_SESSION_ID}&plan=${planId}`,
      cancel_url: `${SITE_URL}/#membership`, metadata: { planId, type: 'membership' }
    });
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ url: data.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products/:id/stripe-price', auth, async (req, res) => {
  const product = db.products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'No encontrado' });
  try {
    let stripeProductId = product.stripeProductId;
    if (!stripeProductId) {
      const { data: sp } = await stripeReq('POST', 'products', { name: product.name, description: product.description||'' });
      stripeProductId = sp.id; product.stripeProductId = stripeProductId;
    }
    const priceBody = { product: stripeProductId, unit_amount: Math.round(product.price*100), currency: product.currency||'eur' };
    if (product.type === 'membership') priceBody.recurring = { interval: 'month' };
    const { data: price } = await stripeReq('POST', 'prices', priceBody);
    product.stripePriceId = price.id; saveDb(db);
    res.json({ ok: true, stripePriceId: price.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stripe/webhook', (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET) return res.json({ received: true });
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    const parts = sig.split(',').reduce((a,p) => { const [k,v]=p.split('='); a[k]=v; return a; }, {});
    const payload = `${parts.t}.${req.body.toString()}`;
    const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(payload).digest('hex');
    if (expected !== parts.v1) return res.status(400).json({ error: 'Firma inválida' });
    event = JSON.parse(req.body.toString());
  } catch { return res.status(400).json({ error: 'Webhook error' }); }
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    const ex = db.members.find(m => m.stripeSubscriptionId === sub.id);
    if (!ex) db.members.push({ id: uid(), stripeCustomerId: sub.customer, stripeSubscriptionId: sub.id, status: sub.status, planId: sub.items?.data?.[0]?.price?.id||'', createdAt: new Date().toISOString(), currentPeriodEnd: new Date(sub.current_period_end*1000).toISOString() });
    else { ex.status = sub.status; ex.currentPeriodEnd = new Date(sub.current_period_end*1000).toISOString(); }
    saveDb(db);
  }
  if (event.type === 'customer.subscription.deleted') {
    const m = db.members.find(m => m.stripeSubscriptionId === event.data.object.id);
    if (m) { m.status = 'canceled'; saveDb(db); }
  }
  if (event.type === 'checkout.session.completed' && event.data.object.metadata?.type === 'product') {
    const s = event.data.object;
    db.orders.push({ id: uid(), productId: s.metadata.productId, email: s.customer_details?.email||'', stripeSessionId: s.id, amount: s.amount_total, currency: s.currency, createdAt: new Date().toISOString() });
    saveDb(db);
  }
  res.json({ received: true });
});

// ── SOUNDCLOUD SYNC ──────────────────────────────────────────────────────────
async function syncSoundCloud() {
  const results = { added: 0, updated: 0, errors: [] };
  if (!SC_CLIENT_ID) return { ...results, errors: ['SC_CLIENT_ID no configurado'] };

  try {
    // Resolver el usuario para obtener su ID numérico
    const userRes = await httpGet(
      `https://api.soundcloud.com/resolve?url=https://soundcloud.com/${SC_USER_PERMALINK}&client_id=${SC_CLIENT_ID}`
    );
    if (!userRes.data || userRes.data.kind !== 'user') {
      return { ...results, errors: ['Usuario SC no encontrado'] };
    }
    const userId = userRes.data.id;

    // Obtener todos los tracks del usuario paginando
    let nextUrl = `https://api.soundcloud.com/users/${userId}/tracks?client_id=${SC_CLIENT_ID}&limit=200&linked_partitioning=1`;
    let totalFetched = 0;

    while (nextUrl) {
      const res = await httpGet(nextUrl);
      const trackList = res.data?.collection || res.data || [];
      if (!Array.isArray(trackList) || !trackList.length) break;

      for (const t of trackList) {
        if (!t.streamable && !t.permalink_url) continue;

        const scUrl = t.permalink_url;
        const existing = db.tracks.find(x =>
          x.platforms?.soundcloud === scUrl ||
          x.sourceId === String(t.id)
        );

        const trackData = {
          title:     t.title,
          type:      'Single',
          year:      t.created_at ? t.created_at.slice(0, 4) : '',
          cover:     t.artwork_url ? t.artwork_url.replace('large', 't300x300') : '',
          streamUrl: scUrl,
          source:    'soundcloud',
          sourceId:  String(t.id),
          duration:  t.duration,
          genre:     t.genre || '',
          platforms: { soundcloud: scUrl, ...(existing?.platforms || {}) },
          updatedAt: new Date().toISOString()
        };

        if (existing) {
          Object.assign(existing, trackData);
          results.updated++;
        } else {
          db.tracks.push({ id: uid(), createdAt: new Date().toISOString(), ...trackData });
          results.added++;
        }
        totalFetched++;
      }

      // Paginar si hay más
      nextUrl = res.data?.next_href
        ? res.data.next_href + `&client_id=${SC_CLIENT_ID}`
        : null;

      if (totalFetched >= 500) break; // límite de seguridad
    }

    // También obtener la playlist principal
    try {
      const plRes = await httpGet(
        `https://api.soundcloud.com/resolve?url=${encodeURIComponent(SC_PLAYLIST_URL)}&client_id=${SC_CLIENT_ID}`
      );
      if (plRes.data?.tracks) {
        // Marcar el orden de la playlist en los tracks
        plRes.data.tracks.forEach((t, i) => {
          const match = db.tracks.find(x => x.sourceId === String(t.id));
          if (match) match.playlistOrder = i + 1;
        });
      }
    } catch(e) {
      results.errors.push('Playlist SC: ' + e.message);
    }

  } catch(e) {
    results.errors.push('SC sync: ' + e.message);
  }

  return results;
}

// Endpoint público para obtener tracks de SC sin auth (para la radio)
app.get('/api/public/sc-playlist', async (req, res) => {
  if (!SC_CLIENT_ID) return res.json({ tracks: [], error: 'SC_CLIENT_ID no configurado' });
  try {
    const plRes = await httpGet(
      `https://api.soundcloud.com/resolve?url=${encodeURIComponent(SC_PLAYLIST_URL)}&client_id=${SC_CLIENT_ID}`
    );
    if (!plRes.data?.tracks) return res.json({ tracks: [] });

    const tracks = plRes.data.tracks.map(t => ({
      id:        String(t.id),
      title:     t.title,
      artist:    t.user?.username || 'RAYVER',
      cover:     t.artwork_url ? t.artwork_url.replace('large','t300x300') : '',
      permalink: t.permalink_url,
      duration:  t.duration,
      streamUrl: t.permalink_url,
      streamable: t.streamable
    }));

    res.json({ tracks, total: tracks.length });
  } catch(e) {
    res.status(500).json({ tracks: [], error: e.message });
  }
});

// Endpoint para obtener tracks del perfil completo
app.get('/api/public/sc-tracks', async (req, res) => {
  if (!SC_CLIENT_ID) return res.json({ tracks: [], error: 'SC_CLIENT_ID no configurado' });
  try {
    // Resolver user
    const userRes = await httpGet(
      `https://api.soundcloud.com/resolve?url=https://soundcloud.com/${SC_USER_PERMALINK}&client_id=${SC_CLIENT_ID}`
    );
    if (!userRes.data?.id) return res.json({ tracks: [] });

    const tracksRes = await httpGet(
      `https://api.soundcloud.com/users/${userRes.data.id}/tracks?client_id=${SC_CLIENT_ID}&limit=200`
    );
    const rawTracks = tracksRes.data?.collection || tracksRes.data || [];

    const tracks = rawTracks.map(t => ({
      id:        String(t.id),
      title:     t.title,
      artist:    t.user?.username || 'RAYVER',
      cover:     t.artwork_url ? t.artwork_url.replace('large','t300x300') : '',
      permalink: t.permalink_url,
      duration:  t.duration,
      genre:     t.genre || '',
      streamable: t.streamable
    }));

    res.json({ tracks, total: tracks.length });
  } catch(e) {
    res.status(500).json({ tracks: [], error: e.message });
  }
});

// ── ARRANCAR ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Rayvermusic backend v4 :${PORT}`);
  scheduleSync();
});
