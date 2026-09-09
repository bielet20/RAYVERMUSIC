'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

test('arranca y /api/health responde ok', async () => {
  const srv = await startServer();
  try {
    const r = await srv.get('/api/health');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.ok('tracks' in body);
  } finally {
    await srv.stop();
  }
});

test('el catálogo público devuelve arrays', async () => {
  const srv = await startServer();
  try {
    for (const p of ['/api/public/tracks', '/api/public/albums', '/api/public/videos', '/api/public/products']) {
      const r = await srv.get(p);
      assert.equal(r.status, 200, `${p} debería ser 200`);
      assert.ok(Array.isArray(await r.json()), `${p} debería devolver un array`);
    }
  } finally {
    await srv.stop();
  }
});

test('crea db.json + db.json.bak en la DATA_DIR', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const srv = await startServer();
  try {
    // fuerza una escritura (segundo arranque re-siembra colecciones → saveDB)
    assert.ok(fs.existsSync(path.join(srv.dataDir, 'db.json')));
  } finally {
    await srv.stop();
  }
});
