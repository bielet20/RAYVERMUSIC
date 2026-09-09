'use strict';
// El fix de seguridad: TOKEN_SECRET nunca debe caer a un valor público conocido.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

test('sin TOKEN_SECRET: arranca igual y avisa por log', async () => {
  const srv = await startServer({ TOKEN_SECRET: '' });
  try {
    assert.equal((await srv.get('/api/health')).status, 200);
    assert.match(srv.log(), /\[SEC\].*TOKEN_SECRET/i);
  } finally {
    await srv.stop();
  }
});

test('con el secreto público hardcodeado viejo: se ignora y se genera uno efímero', async () => {
  const srv = await startServer({ TOKEN_SECRET: 'rayver-secret-2025-change-me' });
  try {
    assert.equal((await srv.get('/api/health')).status, 200);
    assert.match(srv.log(), /\[SEC\].*(inseguro|EFÍMERO|efímero)/i);

    // Un token forjado con el secreto público NO debe validar.
    const crypto = require('node:crypto');
    const ts = Date.now().toString(36);
    const sig = crypto.createHmac('sha256', 'rayver-secret-2025-change-me')
      .update('admin:' + ts).digest('hex').slice(0, 24);
    const forged = Buffer.from(`admin:${ts}:${sig}`).toString('base64url');

    const r = await srv.get('/api/tracks', { headers: { authorization: `Bearer ${forged}` } });
    assert.equal(r.status, 401);
  } finally {
    await srv.stop();
  }
});

test('sin ADMIN_PASSWORD válido en DB nueva: no se puede entrar con la vieja por defecto', async () => {
  const srv = await startServer({ ADMIN_PASSWORD: '' });
  try {
    const r = await srv.post('/api/auth/login', { password: 'rayver2025' });
    assert.equal(r.status, 401);
  } finally {
    await srv.stop();
  }
});
