'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../db');
const { verifyPassword, DUMMY_HASH, verifyTotp, decryptString, sha256 } = require('../crypto');
const { createSession, destroySession, requiresTotpSetup } = require('../auth');
const { audit } = require('../audit');
const { computeCapabilities } = require('../capabilities');

const router = express.Router();

const config = require('../config');
const loginLimiter = rateLimit({
  skip: () => config.isTest,
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.', code: 'rate_limited' },
});

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

router.post('/login', loginLimiter, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const generic = () => res.status(401).json({ error: 'E-Mail oder Passwort ist falsch.' });

  if (!user || user.anonymized_at) { verifyPassword(password, DUMMY_HASH); audit(req, 'auth.login_failed', 'user', null, { email }); return generic(); }
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    audit(req, 'auth.login_locked', 'user', user.id, null, user.id);
    return res.status(423).json({ error: `Konto vorübergehend gesperrt. Bitte in ${LOCK_MINUTES} Minuten erneut versuchen.` });
  }
  if (!verifyPassword(password, user.password_hash)) {
    const failed = user.failed_attempts + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, user.id);
    audit(req, 'auth.login_failed', 'user', user.id, { locked: !!lock }, user.id);
    return generic();
  }
  if (!user.active) return res.status(403).json({ error: 'Dieses Konto ist deaktiviert.' });

  db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(user.id);
  const pending = user.totp_enabled === 1;
  createSession(res, req, user, pending);
  audit(req, pending ? 'auth.password_ok_2fa_pending' : 'auth.login', 'user', user.id, null, user.id);
  if (pending) return res.json({ requires_2fa: true });
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  res.json({ ok: true, user: publicUser({ ...user, totp_enabled: false }) });
});

const totpLimiter = rateLimit({ skip: () => config.isTest, windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Zu viele Versuche.', code: 'rate_limited' } });

router.post('/2fa', totpLimiter, (req, res) => {
  if (!req.user || !req.sessionPending2fa) return res.status(401).json({ error: 'Keine ausstehende Anmeldung' });
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const code = String(req.body?.code || '').trim();
  let ok = false;
  if (/^\d{6}$/.test(code)) {
    ok = verifyTotp(decryptString(user.totp_secret_enc), code);
  } else if (/^[0-9a-f]{5}-[0-9a-f]{5}$/i.test(code)) {
    const rc = db.prepare('SELECT id FROM recovery_codes WHERE user_id = ? AND used_at IS NULL AND code_hash = ?').get(user.id, sha256(code.toLowerCase()));
    if (rc) { db.prepare("UPDATE recovery_codes SET used_at = datetime('now') WHERE id = ?").run(rc.id); ok = true; audit(req, 'auth.recovery_code_used', 'user', user.id); }
  }
  if (!ok) { audit(req, 'auth.2fa_failed', 'user', user.id); return res.status(401).json({ error: 'Der Code ist ungültig.' }); }
  // Sitzung erneuern (Session-Fixation vermeiden)
  destroySession(req, res);
  createSession(res, req, user, false);
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  audit(req, 'auth.login', 'user', user.id, { with_2fa: true });
  res.json({ ok: true, user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  if (req.user) audit(req, 'auth.logout', 'user', req.user.id);
  destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet', code: 'unauthenticated' });
  if (req.sessionPending2fa) return res.status(401).json({ error: '2FA ausstehend', code: 'pending_2fa', requires_2fa: true });
  res.json({ user: publicUser(req.user), capabilities: computeCapabilities(req.user) });
});

function publicUser(u) {
  return {
    id: u.id, email: u.email, role: u.role, name: u.name, phone: u.phone,
    totp_enabled: !!u.totp_enabled, must_change_password: !!u.must_change_password,
    totp_setup_required: requiresTotpSetup({ role: u.role, totp_enabled: !!u.totp_enabled }),
    last_login_at: u.last_login_at, deletion_requested_at: u.deletion_requested_at || null,
  };
}

module.exports = { router, publicUser };
