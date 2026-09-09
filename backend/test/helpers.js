'use strict';
// Arranca `backend/index.js` como subproceso con una DATA_DIR temporal y un
// puerto propio, espera a que /api/health responda, y devuelve helpers para
// hablar con él. Cada test que lo use es una prueba de integración real: si el
// server no arranca (crash al cargar, ruta rota…), el test falla.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const INDEX = path.join(__dirname, '..', 'index.js');

async function startServer(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rayver-test-'));

  const child = spawn(process.execPath, [INDEX], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATA_DIR: dataDir,
      BACKEND_PORT: '0',            // el SO asigna un puerto libre; lo leemos del log
      TOKEN_SECRET: 'test-token-secret-not-real',
      ADMIN_PASSWORD: 'test-admin-pass',
      FRONTEND_ORIGIN: '*',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });

  // Esperar a que anuncie el puerto real y a que /api/health responda.
  let port = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`El backend salió con código ${child.exitCode} antes de estar listo:\n${out}`);
    }
    if (!port) {
      const m = out.match(/escuchando en :(\d+)/);
      if (m) port = Number(m[1]);
    }
    if (port) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (r.ok) break;
      } catch { /* aún arrancando */ }
    }
    await new Promise(res => setTimeout(res, 100));
  }
  if (!port) throw new Error(`El backend no anunció puerto en 20s:\n${out}`);

  const base = `http://127.0.0.1:${port}`;
  async function stop() {
    child.kill('SIGKILL');
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  return {
    base,
    dataDir,
    log: () => out,
    stop,
    get: (p, opts) => fetch(base + p, opts),
    post: (p, body, headers = {}) => fetch(base + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  };
}

async function adminToken(srv, password = 'test-admin-pass') {
  const r = await srv.post('/api/auth/login', { password });
  if (!r.ok) throw new Error(`login admin falló: ${r.status}`);
  return (await r.json()).token;
}

module.exports = { startServer, adminToken };
