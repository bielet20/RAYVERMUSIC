'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, adminToken } = require('./helpers');

test('admin: contraseña incorrecta → 401', async () => {
  const srv = await startServer();
  try {
    const r = await srv.post('/api/auth/login', { password: 'mala' });
    assert.equal(r.status, 401);
  } finally {
    await srv.stop();
  }
});

test('admin: contraseña correcta → token que abre una ruta protegida', async () => {
  const srv = await startServer();
  try {
    const token = await adminToken(srv);
    assert.ok(token && token.length > 10);

    const r = await srv.get('/api/tracks', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(await r.json()));
  } finally {
    await srv.stop();
  }
});

test('admin: ruta protegida sin token o con token manipulado → 401', async () => {
  const srv = await startServer();
  try {
    assert.equal((await srv.get('/api/tracks')).status, 401);

    const token = await adminToken(srv);
    const tampered = token.slice(0, -4) + 'AAAA';
    const r = await srv.get('/api/tracks', { headers: { authorization: `Bearer ${tampered}` } });
    assert.equal(r.status, 401);
  } finally {
    await srv.stop();
  }
});

test('un token firmado con OTRO secreto no vale', async () => {
  const a = await startServer({ TOKEN_SECRET: 'secreto-A' });
  const b = await startServer({ TOKEN_SECRET: 'secreto-B' });
  try {
    const tokenA = await adminToken(a);
    // el token de A no debe abrir nada en B
    const r = await b.get('/api/tracks', { headers: { authorization: `Bearer ${tokenA}` } });
    assert.equal(r.status, 401);
  } finally {
    await a.stop();
    await b.stop();
  }
});

test('usuario: registro → login → /api/user/me', async () => {
  const srv = await startServer();
  try {
    const email = `t${Date.now()}@example.com`;
    const reg = await srv.post('/api/user/register', { email, password: 'secret123', name: 'Test' });
    assert.ok([200, 201].includes(reg.status), `registro status ${reg.status}`);

    const login = await srv.post('/api/user/login', { email, password: 'secret123' });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    assert.ok(token);

    const me = await srv.get('/api/user/me', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).email, email);
  } finally {
    await srv.stop();
  }
});
