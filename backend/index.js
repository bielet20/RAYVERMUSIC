'use strict';

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const https   = require('https');

const app  = express();
const PORT = process.env.BACKEND_PORT || 3001;
const DATA = path.join('/app/data', 'db.json');
const UPLOADS = path.join('/app/data', 'uploads');
const ORIGIN  = process.env.FRONTEND_ORIGIN || '*';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SITE_URL = process.env.SITE_URL || 'https://rayvermusic.com';

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({ origin: ORIGIN, methods: ['GET','POST','PUT','DELETE','PATCH'] }));

// Raw body para webhooks de Stripe (debe ir ANTES de express.json)
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// ── PERSISTENCIA ──────────────────────────────────────────────────────────────
function defaultDb() {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPwd('rayver2025', salt);
  return {
    auth: { hash, salt },
    tracks: [], albums: [], videos: [],
    products: [],    // beats, packs, stems
    members: [],     // suscriptores activos
    orders: [],      // compras únicas (tienda)
    downloadTokens: {} // token temporal → { productId, expires }
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

// Asegurar campos nuevos en DB existente
if (!db.products) db.products = [];
if (!db.members)  db.members  = [];
if (!db.orders)   db.orders   = [];
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

// ── STRIPE HELPER ─────────────────────────────────────────────────────────────
function stripeRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    if (!STRIPE_SECRET) return reject(new Error('STRIPE_SECRET_KEY no configurada'));
    const data = body ? new URLSearchParams(flattenStripeBody(body)).toString() : '';
    const options = {
      hostname: 'api.stripe.com',
      path: `/v1/${endpoint}`,
      method,
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, res => {
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

function flattenStripeBody(obj, prefix = '') {
  const flat = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(flat, flattenStripeBody(v, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object') Object.assign(flat, flattenStripeBody(item, `${key}[${i}]`));
        else flat[`${key}[${i}]`] = item;
      });
    } else if (v !== undefined && v !== null) {
      flat[key] = String(v);
    }
  }
  return flat;
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
app.get('/api/public/membership', (_, res) => res.json(
  db.products.filter(p => p.active && p.type === 'membership').map(p => ({
    id: p.id, name: p.name, description: p.description,
    price: p.price, currency: p.currency || 'eur',
    features: p.features || [], stripePriceId: p.stripePriceId
  }))
));

app.get('/api/health', (_, res) => res.json({
  ok: true, tracks: db.tracks.length, albums: db.albums.length,
  videos: db.videos.length, products: db.products.length, members: db.members.length
}));

// ── CHECKOUT — TIENDA (pago único) ───────────────────────────────────────────
app.post('/api/checkout/product', async (req, res) => {
  const { productId, email } = req.body || {};
  const product = db.products.find(p => p.id === productId && p.active);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  if (!product.stripePriceId) return res.status(400).json({ error: 'Producto sin precio Stripe configurado' });

  try {
    const { data } = await stripeRequest('POST', 'checkout/sessions', {
      mode: 'payment',
      customer_email: email || undefined,
      line_items: [{ price: product.stripePriceId, quantity: 1 }],
      success_url: `${SITE_URL}/gracias.html?session_id={CHECKOUT_SESSION_ID}&product=${productId}`,
      cancel_url: `${SITE_URL}/#store`,
      metadata: { productId, type: 'product' }
    });
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ url: data.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CHECKOUT — MEMBRESÍA (suscripción) ───────────────────────────────────────
app.post('/api/checkout/membership', async (req, res) => {
  const { planId, email } = req.body || {};
  const plan = db.products.find(p => p.id === planId && p.type === 'membership' && p.active);
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
  if (!plan.stripePriceId) return res.status(400).json({ error: 'Plan sin precio Stripe configurado' });

  try {
    const { data } = await stripeRequest('POST', 'checkout/sessions', {
      mode: 'subscription',
      customer_email: email || undefined,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${SITE_URL}/gracias.html?session_id={CHECKOUT_SESSION_ID}&plan=${planId}`,
      cancel_url: `${SITE_URL}/#membership`,
      metadata: { planId, type: 'membership' }
    });
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ url: data.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DESCARGA SEGURA ───────────────────────────────────────────────────────────
// Verificar sesión de Stripe y generar token de descarga temporal
app.post('/api/download/verify', async (req, res) => {
  const { sessionId, productId } = req.body || {};
  if (!sessionId || !productId) return res.status(400).json({ error: 'Faltan datos' });

  try {
    const { data: session } = await stripeRequest('GET', `checkout/sessions/${sessionId}`, null);
    if (session.payment_status !== 'paid' && session.status !== 'complete')
      return res.status(402).json({ error: 'Pago no completado' });
    if (session.metadata?.productId !== productId)
      return res.status(403).json({ error: 'Sesión no coincide con producto' });

    // Generar token de descarga válido 24h
    const token = crypto.randomBytes(32).toString('hex');
    db.downloadTokens[token] = {
      productId,
      email: session.customer_details?.email || '',
      expires: Date.now() + 24 * 60 * 60 * 1000
    };
    saveDb(db);
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Descarga del archivo con token
app.get('/api/download/:token', (req, res) => {
  const entry = db.downloadTokens[req.params.token];
  if (!entry || entry.expires < Date.now())
    return res.status(403).json({ error: 'Token inválido o expirado' });

  const product = db.products.find(p => p.id === entry.productId);
  if (!product?.file) return res.status(404).json({ error: 'Archivo no encontrado' });

  const filePath = path.join(UPLOADS, product.file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no disponible' });

  res.download(filePath, product.fileName || product.file);
});

// ── WEBHOOK STRIPE ────────────────────────────────────────────────────────────
app.post('/api/stripe/webhook', (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET) return res.json({ received: true });

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    // Verificación manual de firma Stripe (sin SDK)
    const parts = sig.split(',').reduce((acc, part) => {
      const [k, v] = part.split('=');
      acc[k] = v;
      return acc;
    }, {});
    const payload = `${parts.t}.${req.body.toString()}`;
    const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(payload).digest('hex');
    if (expected !== parts.v1) return res.status(400).json({ error: 'Firma inválida' });
    event = JSON.parse(req.body.toString());
  } catch (e) {
    return res.status(400).json({ error: 'Webhook error' });
  }

  // Suscripción creada/renovada
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    const existing = db.members.find(m => m.stripeSubscriptionId === sub.id);
    if (!existing) {
      db.members.push({
        id: uid(),
        stripeCustomerId: sub.customer,
        stripeSubscriptionId: sub.id,
        email: sub.customer_email || '',
        status: sub.status,
        planId: sub.items?.data?.[0]?.price?.id || '',
        createdAt: new Date().toISOString(),
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString()
      });
    } else {
      existing.status = sub.status;
      existing.currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
    }
    saveDb(db);
  }

  // Suscripción cancelada
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const m = db.members.find(m => m.stripeSubscriptionId === sub.id);
    if (m) { m.status = 'canceled'; saveDb(db); }
  }

  // Pago único completado
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.metadata?.type === 'product') {
      db.orders.push({
        id: uid(),
        productId: session.metadata.productId,
        email: session.customer_details?.email || '',
        stripeSessionId: session.id,
        amount: session.amount_total,
        currency: session.currency,
        createdAt: new Date().toISOString()
      });
      saveDb(db);
    }
  }

  res.json({ received: true });
});

// ── RUTAS PRIVADAS — ADMIN ────────────────────────────────────────────────────
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

// Tracks
app.get('/api/tracks', auth, (_, res) => res.json(db.tracks));
app.post('/api/tracks', auth, (req, res) => { const t = { id: uid(), createdAt: new Date().toISOString(), ...req.body }; db.tracks.unshift(t); saveDb(db); res.status(201).json(t); });
app.put('/api/tracks/:id', auth, (req, res) => { const i = db.tracks.findIndex(t => t.id === req.params.id); if (i===-1) return res.status(404).json({error:'No encontrado'}); db.tracks[i]={...db.tracks[i],...req.body,id:req.params.id}; saveDb(db); res.json(db.tracks[i]); });
app.delete('/api/tracks/:id', auth, (req, res) => { const i = db.tracks.findIndex(t => t.id === req.params.id); if (i===-1) return res.status(404).json({error:'No encontrado'}); db.tracks.splice(i,1); saveDb(db); res.json({ok:true}); });

// Albums
app.get('/api/albums', auth, (_, res) => res.json(db.albums));
app.post('/api/albums', auth, (req, res) => { const a = { id: uid(), createdAt: new Date().toISOString(), ...req.body }; db.albums.unshift(a); saveDb(db); res.status(201).json(a); });
app.put('/api/albums/:id', auth, (req, res) => { const i = db.albums.findIndex(a => a.id === req.params.id); if (i===-1) return res.status(404).json({error:'No encontrado'}); db.albums[i]={...db.albums[i],...req.body,id:req.params.id}; saveDb(db); res.json(db.albums[i]); });
app.delete('/api/albums/:id', auth, (req, res) => { const i = db.albums.findIndex(a => a.id === req.params.id); if (i===-1) return res.status(404).json({error:'No encontrado'}); db.albums.splice(i,1); saveDb(db); res.json({ok:true}); });

// Videos
app.get('/api/videos', auth, (_, res) => res.json(db.videos));
app.post('/api/videos', auth, (req, res) => { const v = { id: uid(), createdAt: new Date().toISOString(), ...req.body }; db.videos.unshift(v); saveDb(db); res.status(201).json(v); });
app.put('/api/videos/:id', auth, (req, res) => { const i = db.videos.findIndex(v => v.id === req.params.id); if (i===-1) return res.status(404).json({error:'No encontrado'}); db.videos[i]={...db.videos[i],...req.body,id:req.params.id}; saveDb(db); res.json(db.videos[i]); });
app.delete('/api/videos/:id', auth, (req, res) => { const i = db.videos.findIndex(v => v.id === req.params.id); if (i===-1) return res.status(404).json({error:'No encontrado'}); db.videos.splice(i,1); saveDb(db); res.json({ok:true}); });

// ── PRODUCTOS (admin) ─────────────────────────────────────────────────────────
app.get('/api/products', auth, (_, res) => res.json(db.products));

app.post('/api/products', auth, (req, res) => {
  const p = { id: uid(), createdAt: new Date().toISOString(), active: true, ...req.body };
  db.products.unshift(p);
  saveDb(db);
  res.status(201).json(p);
});

app.put('/api/products/:id', auth, (req, res) => {
  const i = db.products.findIndex(p => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'No encontrado' });
  db.products[i] = { ...db.products[i], ...req.body, id: req.params.id };
  saveDb(db);
  res.json(db.products[i]);
});

app.delete('/api/products/:id', auth, (req, res) => {
  const i = db.products.findIndex(p => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'No encontrado' });
  db.products.splice(i, 1);
  saveDb(db);
  res.json({ ok: true });
});

// Subir archivo de producto (base64 → disco)
app.post('/api/products/:id/upload', auth, (req, res) => {
  const product = db.products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'No encontrado' });
  const { file, fileName } = req.body;
  if (!file) return res.status(400).json({ error: 'Falta archivo (base64)' });
  const buf = Buffer.from(file, 'base64');
  const safeName = `${req.params.id}_${Date.now()}_${(fileName||'file').replace(/[^a-z0-9._-]/gi,'_')}`;
  fs.mkdirSync(UPLOADS, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS, safeName), buf);
  product.file = safeName;
  product.fileName = fileName || safeName;
  saveDb(db);
  res.json({ ok: true, file: safeName });
});

// ── MIEMBROS Y PEDIDOS (admin) ────────────────────────────────────────────────
app.get('/api/members', auth, (_, res) => res.json(db.members));
app.get('/api/orders',  auth, (_, res) => res.json(db.orders));

app.get('/api/stats', auth, (_, res) => {
  const activeMembers = db.members.filter(m => m.status === 'active').length;
  const totalRevenue  = db.orders.reduce((s, o) => s + (o.amount || 0), 0);
  res.json({
    tracks: db.tracks.length, albums: db.albums.length, videos: db.videos.length,
    products: db.products.filter(p=>p.active).length,
    members: activeMembers, orders: db.orders.length,
    revenueEur: (totalRevenue / 100).toFixed(2)
  });
});

// Crear precio en Stripe y asociar al producto
app.post('/api/products/:id/stripe-price', auth, async (req, res) => {
  const product = db.products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'No encontrado' });

  try {
    // Crear producto en Stripe si no existe
    let stripeProductId = product.stripeProductId;
    if (!stripeProductId) {
      const { data: sp } = await stripeRequest('POST', 'products', {
        name: product.name,
        description: product.description || ''
      });
      stripeProductId = sp.id;
      product.stripeProductId = stripeProductId;
    }

    // Crear precio
    const priceBody = {
      product: stripeProductId,
      unit_amount: Math.round(product.price * 100),
      currency: product.currency || 'eur'
    };
    if (product.type === 'membership') {
      priceBody.recurring = { interval: 'month' };
    }
    const { data: price } = await stripeRequest('POST', 'prices', priceBody);
    product.stripePriceId = price.id;
    saveDb(db);
    res.json({ ok: true, stripePriceId: price.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reorders existentes
app.patch('/api/tracks/reorder', auth, (req, res) => { const { ids } = req.body; if (!Array.isArray(ids)) return res.status(400).json({error:'ids required'}); db.tracks = ids.map(id=>db.tracks.find(t=>t.id===id)).filter(Boolean); saveDb(db); res.json({ok:true}); });
app.patch('/api/videos/reorder', auth, (req, res) => { const { ids } = req.body; if (!Array.isArray(ids)) return res.status(400).json({error:'ids required'}); db.videos = ids.map(id=>db.videos.find(v=>v.id===id)).filter(Boolean); saveDb(db); res.json({ok:true}); });

app.listen(PORT, () => console.log(`Rayvermusic backend v2 :${PORT}`));
