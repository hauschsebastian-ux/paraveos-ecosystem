'use strict';
// Erst-Einrichtung: legt einen Admin an, falls noch keiner existiert.
const config = require('./config');
const { getDb } = require('./db');
const { hashPassword, randomPassword, passwordPolicy } = require('./crypto');

function ensureAdmin(logger = console) {
  const db = getDb();
  const existing = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND anonymized_at IS NULL").get().n;
  if (existing > 0) return null;
  let pw = config.adminPassword;
  let generated = false;
  if (!pw || passwordPolicy(pw)) {
    if (pw) logger.warn('[bootstrap] ADMIN_PASSWORD erfüllt die Passwortrichtlinie nicht – es wird ein zufälliges Passwort erzeugt.');
    pw = randomPassword(); generated = true;
  }
  db.prepare('INSERT INTO users (email, password_hash, role, name, must_change_password) VALUES (?,?,?,?,?)')
    .run(config.adminEmail.toLowerCase(), hashPassword(pw), 'admin', 'Cosmos Events Admin', generated ? 1 : 0);
  logger.warn('==========================================================');
  logger.warn(`[bootstrap] Admin-Konto angelegt: ${config.adminEmail}`);
  if (generated) logger.warn(`[bootstrap] Initialpasswort (einmalige Ausgabe): ${pw}`);
  logger.warn('[bootstrap] Bitte nach dem ersten Login Passwort ändern und 2FA einrichten.');
  logger.warn('==========================================================');
  return { email: config.adminEmail, password: pw };
}

module.exports = { ensureAdmin };
