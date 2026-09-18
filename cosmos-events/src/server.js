'use strict';
const fs = require('fs');
const http = require('http');
const https = require('https');
const config = require('./config');
const { createApp } = require('./app');
const { getDb } = require('./db');
const { getDataKey } = require('./crypto');
const { ensureAdmin } = require('./bootstrap');
const { cleanupSessions } = require('./auth');
const { scheduleBackups } = require('./backup');

getDb();
getDataKey();
ensureAdmin();
cleanupSessions();
setInterval(cleanupSessions, 60 * 60 * 1000).unref();
scheduleBackups();

const app = createApp();
let server;
if (config.tls) {
  server = https.createServer({ cert: fs.readFileSync(config.tls.cert), key: fs.readFileSync(config.tls.key), minVersion: 'TLSv1.2' }, app);
} else {
  server = http.createServer(app);
  if (config.isProd && !config.trustProxy) {
    console.warn('[server] Produktion ohne TLS_CERT_FILE und ohne TRUST_PROXY: bitte hinter einem TLS-terminierenden Reverse-Proxy betreiben (siehe README).');
  }
}
server.listen(config.port, () => {
  console.log(`[server] Cosmos Events Dashboard läuft auf ${config.tls ? 'https' : 'http'}://localhost:${config.port} (${config.isProd ? 'production' : 'development'})`);
  if (!config.spotify) console.log('[server] Hinweis: Spotify nicht konfiguriert – Songsuche deaktiviert, manuelle Eingabe aktiv.');
});

function shutdown() {
  console.log('[server] Beende ...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
