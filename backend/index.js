'use strict';

const express    = require('express');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');

const app  = express();
const PORT = process.env.BACKEND_PORT || 3001;
const DATA = path.join('/app/data', 'db.json');
const ORIGIN = process.env.FRONTEND_ORIGIN || '*';

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({ origin: ORIGIN, methods: ['GET','POST','PUT','DELETE','PATCH'] }));
app.use(express.json({ limit: '10mb' }));   // 10mb para portadas en base64

// ── PERSISTENCIA ─────────────────────────────────────────────────────────────
function defaultDb() {
  // Hash por defecto de "rayver2025"
  const salt    = crypto.randomBytes(16).toString('hex');
  const hash    = hashPwd('rayver2025', salt);
  return { auth: { hash, salt }, tracks: [], albums: [], videos: [] };
}

function loadDb() {
  try {
    if (fs.existsSync(DATA)) return JSON.parse(fs.readFileSync(DATA, 'utf8'));
  } catch (_) {}
  return defaultDb();
}

function saveDb(db) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(db, null, 2));
}

let db = loadDb();

// ── AUTH UTILS ────────────────────────────────────────────────────────────────
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL    = 8 * 60 * 60 * 1000;   // 8 horas
const tokens       = new Map();             // token → expiry (en memoria)

function hashPwd(pwd, salt) {
  return crypto.scryptSync(pwd, salt, 64).toString('hex');
}

function genToken() {
  const t = crypto.randomBytes(32).toString('hex');
  tokens.set(t, Date.now() + TOKEN_TTL);
  return t;
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t || !tokens.has(t) || tokens.get(t) < Date.now()) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  tokens.set(t, Date.now() + TOKEN_TTL); // renovar
  next();
}

// Limpiar tokens expirados cada hora
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of tokens) if (exp < now) tokens.delete(k);
}, 60 * 60 * 1000);

// ── ID GENERATOR ─────────────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── RUTAS PÚBLICAS ────────────────────────────────────────────────────────────

// Login
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Falta contraseña' });
  const { hash, salt } = db.auth;
  const attempt = hashPwd(password, salt);
  if (attempt !== hash) return res.status(401).json({ error: 'Contraseña incorrecta' });
  res.json({ token: genToken() });
});

// Datos públicos — lo que lee index.html
app.get('/api/public/tracks',  (_, res) => res.json(db.tracks));
app.get('/api/public/albums',  (_, res) => res.json(db.albums));
app.get('/api/public/videos',  (_, res) => res.json(db.videos));

// ── RUTAS PRIVADAS ────────────────────────────────────────────────────────────

// Cambiar contraseña
app.post('/api/auth/change-password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Faltan campos' });
  if (newPassword.length < 8)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  const { hash, salt } = db.auth;
  if (hashPwd(currentPassword, salt) !== hash)
    return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  const newSalt = crypto.randomBytes(16).toString('hex');
  db.auth = { hash: hashPwd(newPassword, newSalt), salt: newSalt };
  saveDb(db);
  // Invalidar todos los tokens excepto el actual
  const cur = (req.headers.authorization || '').slice(7);
  for (const k of tokens.keys()) if (k !== cur) tokens.delete(k);
  res.json({ ok: true });
});

// ── TRACKS ────────────────────────────────────────────────────────────────────
app.get('/api/tracks', auth, (_, res) => res.json(db.tracks));

app.post('/api/tracks', auth, (req, res) => {
  const t = { id: uid(), createdAt: new Date().toISOString(), ...req.body };
  db.tracks.unshift(t);
  saveDb(db);
  res.status(201).json(t);
});

app.put('/api/tracks/:id', auth, (req, res) => {
  const i = db.tracks.findIndex(t => t.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'No encontrado' });
  db.tracks[i] = { ...db.tracks[i], ...req.body, id: req.params.id };
  saveDb(db);
  res.json(db.tracks[i]);
});

app.delete('/api/tracks/:id', auth, (req, res) => {
  const i = db.tracks.findIndex(t => t.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'No encontrado' });
  db.tracks.splice(i, 1);
  saveDb(db);
  res.json({ ok: true });
});

// ── ALBUMS ────────────────────────────────────────────────────────────────────
app.get('/api/albums', auth, (_, res) => res.json(db.albums));

app.post('/api/albums', auth, (req, res) => {
  const a = { id: uid(), createdAt: new Date().toISOString(), ...req.body };
  db.albums.unshift(a);
  saveDb(db);
  res.status(201).json(a);
});

app.put('/api/albums/:id', auth, (req, res) => {
  const i = db.albums.findIndex(a => a.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'No encontrado' });
  db.albums[i] = { ...db.albums[i], ...req.body, id: req.params.id };
  saveDb(db);
  res.json(db.albums[i]);
});

app.delete('/api/albums/:id', auth, (req, res) => {
  const i = db.albums.findIndex(a => a.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'No encontrado' });
  db.albums.splice(i, 1);
  saveDb(db);
  res.json({ ok: true });
});

// ── VIDEOS ────────────────────────────────────────────────────────────────────
app.get('/api/videos', auth, (_, res) => res.json(db.videos));

app.post('/api/videos', auth, (req, res) => {
  const v = { id: uid(), createdAt: new Date().toISOString(), ...req.body };
  db.videos.unshift(v);
  saveDb(db);
  res.status(201).json(v);
});

app.put('/api/videos/:id', auth, (req, res) => {
  const i = db.videos.findIndex(v => v.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'No encontrado' });
  db.videos[i] = { ...db.videos[i], ...req.body, id: req.params.id };
  saveDb(db);
  res.json(db.videos[i]);
});

app.delete('/api/videos/:id', auth, (req, res) => {
  const i = db.videos.findIndex(v => v.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'No encontrado' });
  db.videos.splice(i, 1);
  saveDb(db);
  res.json({ ok: true });
});

// ── REORDER ───────────────────────────────────────────────────────────────────
app.patch('/api/tracks/reorder', auth, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array requerido' });
  db.tracks = ids.map(id => db.tracks.find(t => t.id === id)).filter(Boolean);
  saveDb(db);
  res.json({ ok: true });
});

app.patch('/api/videos/reorder', auth, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array requerido' });
  db.videos = ids.map(id => db.videos.find(v => v.id === id)).filter(Boolean);
  saveDb(db);
  res.json({ ok: true });
});

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true, tracks: db.tracks.length, albums: db.albums.length, videos: db.videos.length }));

app.listen(PORT, () => console.log(`Rayvermusic backend :${PORT}`));
