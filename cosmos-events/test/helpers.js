'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmp;
process.env.COOKIE_SECURE = '0';
process.env.REQUIRE_2FA_ROLES = '';
process.env.APP_ORIGIN = '';
delete process.env.SPOTIFY_CLIENT_ID;

const { createApp } = require('../src/app');
const { getDb, closeDb } = require('../src/db');
const { seed, DEMO_PASSWORD } = require('../src/seed');

let server, baseUrl;

async function start() {
  if (server) return baseUrl;
  seed({ log: () => {} });
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

async function stop() {
  if (server) await new Promise((r) => server.close(r));
  server = null;
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
}

// Minimaler Client mit Cookie-Jar
function client() {
  let cookie = '';
  async function req(method, url, body, opts = {}) {
    const headers = { Origin: baseUrl, ...(opts.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    let payload = body;
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(baseUrl + url, { method, headers, body: payload, redirect: 'manual' });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (k === 'cosmos_sid') cookie = v ? `cosmos_sid=${v}` : '';
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  return {
    get: (u, o) => req('GET', u, null, o),
    post: (u, b, o) => req('POST', u, b, o),
    put: (u, b, o) => req('PUT', u, b, o),
    patch: (u, b, o) => req('PATCH', u, b, o),
    del: (u, o) => req('DELETE', u, null, o),
    login: async (email, password = DEMO_PASSWORD) => req('POST', '/api/auth/login', { email, password }),
  };
}

module.exports = { start, stop, client, getDb, DEMO_PASSWORD, tmp };
