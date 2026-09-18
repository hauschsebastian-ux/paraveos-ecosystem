'use strict';
const path = require('path');
const fs = require('fs');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadDotEnv(path.resolve(process.cwd(), '.env'));

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const dataDir = path.resolve(process.cwd(), env.DATA_DIR || './data');

const config = {
  isProd,
  isTest: env.NODE_ENV === 'test',
  port: Number(env.PORT || 3000),
  origins: (env.APP_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  tls: env.TLS_CERT_FILE && env.TLS_KEY_FILE ? { cert: env.TLS_CERT_FILE, key: env.TLS_KEY_FILE } : null,
  dataDir,
  dbFile: env.DB_FILE || path.join(dataDir, 'cosmos.sqlite'),
  uploadDir: path.join(dataDir, 'uploads'),
  backupDir: path.join(dataDir, 'backups'),
  keyDir: path.join(dataDir, 'keys'),
  dataKeyHex: env.DATA_ENCRYPTION_KEY || null,
  require2faRoles: (env.REQUIRE_2FA_ROLES === undefined ? 'admin,dj' : env.REQUIRE_2FA_ROLES)
    .split(',').map((s) => s.trim()).filter(Boolean),
  sessionHours: Number(env.SESSION_HOURS || 12),
  defaultCommissionPercent: Number(env.DEFAULT_COMMISSION_PERCENT || 15),
  backupHour: Number(env.BACKUP_HOUR || 3),
  backupRetentionDays: Number(env.BACKUP_RETENTION_DAYS || 30),
  spotify: env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET
    ? { clientId: env.SPOTIFY_CLIENT_ID, clientSecret: env.SPOTIFY_CLIENT_SECRET }
    : null,
  adminEmail: env.ADMIN_EMAIL || 'admin@cosmos-events.de',
  adminPassword: env.ADMIN_PASSWORD || null,
  maxUploadBytes: 20 * 1024 * 1024,
  cookieName: 'cosmos_sid',
  cookieSecure: env.COOKIE_SECURE !== undefined ? env.COOKIE_SECURE === '1' : isProd,
  questionnaireFile: env.QUESTIONNAIRE_FILE || path.resolve(process.cwd(), 'config', 'questionnaire.json'),
};

module.exports = config;
