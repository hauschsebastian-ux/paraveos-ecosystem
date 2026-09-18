'use strict';
// Eigenes Konto: Passwort, 2FA, Datenauskunft/-export (DSGVO Art. 15/20), Löschantrag (Art. 17).
const express = require('express');
const QRCode = require('qrcode');
const { getDb } = require('../db');
const crypto = require('../crypto');
const { destroyAllSessions } = require('../auth');
const { audit } = require('../audit');
const { publicUser } = require('./auth.routes');

const router = express.Router();

router.post('/password', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const { current_password, new_password } = req.body || {};
  if (!crypto.verifyPassword(String(current_password || ''), user.password_hash)) {
    audit(req, 'account.password_change_failed', 'user', user.id);
    return res.status(400).json({ error: 'Das aktuelle Passwort ist falsch.' });
  }
  const policy = crypto.passwordPolicy(new_password);
  if (policy) return res.status(400).json({ error: policy });
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?")
    .run(crypto.hashPassword(new_password), user.id);
  destroyAllSessions(user.id, req.sessionId);
  audit(req, 'account.password_changed', 'user', user.id);
  res.json({ ok: true });
});

router.patch('/profile', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 120);
  const phone = String(req.body?.phone || '').trim().slice(0, 40);
  if (name.length < 2) return res.status(400).json({ error: 'Bitte einen Namen angeben.' });
  getDb().prepare("UPDATE users SET name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?").run(name, phone || null, req.user.id);
  audit(req, 'account.profile_updated', 'user', req.user.id);
  res.json({ ok: true });
});

// 2FA einrichten: Schritt 1 – Secret erzeugen (noch nicht aktiv)
router.post('/2fa/setup', async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.totp_enabled) return res.status(400).json({ error: '2FA ist bereits aktiv.' });
  const secret = crypto.generateTotpSecret();
  db.prepare('UPDATE users SET totp_secret_enc = ? WHERE id = ?').run(crypto.encryptString(secret), user.id);
  const uri = crypto.totpUri(secret, user.email);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  res.json({ secret, uri, qr });
});

// Schritt 2 – Code bestätigen, 2FA aktivieren, Wiederherstellungscodes ausgeben
router.post('/2fa/enable', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.totp_enabled) return res.status(400).json({ error: '2FA ist bereits aktiv.' });
  if (!user.totp_secret_enc) return res.status(400).json({ error: 'Bitte zuerst die Einrichtung starten.' });
  if (!crypto.verifyTotp(crypto.decryptString(user.totp_secret_enc), req.body?.code)) {
    return res.status(400).json({ error: 'Der Code ist ungültig. Bitte erneut versuchen.' });
  }
  const codes = crypto.generateRecoveryCodes();
  const tx = db.transaction(() => {
    db.prepare("UPDATE users SET totp_enabled = 1, updated_at = datetime('now') WHERE id = ?").run(user.id);
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
    const ins = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?,?)');
    for (const c of codes) ins.run(user.id, crypto.sha256(c));
  });
  tx();
  audit(req, 'account.2fa_enabled', 'user', user.id);
  res.json({ ok: true, recovery_codes: codes });
});

router.post('/2fa/disable', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const { password, code } = req.body || {};
  if (!crypto.verifyPassword(String(password || ''), user.password_hash)) return res.status(400).json({ error: 'Passwort falsch.' });
  if (!user.totp_enabled || !crypto.verifyTotp(crypto.decryptString(user.totp_secret_enc), code)) {
    return res.status(400).json({ error: 'Der Code ist ungültig.' });
  }
  const cfg = require('../config');
  if (cfg.require2faRoles.includes(user.role)) {
    return res.status(400).json({ error: 'Für deine Rolle ist 2FA verpflichtend und kann nicht deaktiviert werden.' });
  }
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL WHERE id = ?').run(user.id);
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
  audit(req, 'account.2fa_disabled', 'user', user.id);
  res.json({ ok: true });
});

router.get('/sessions', (req, res) => {
  const rows = getDb().prepare('SELECT id, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND pending_2fa = 0 ORDER BY last_seen_at DESC').all(req.user.id);
  res.json({ sessions: rows.map((r) => ({ ...r, current: r.id === req.sessionId })) });
});

router.post('/sessions/revoke-others', (req, res) => {
  destroyAllSessions(req.user.id, req.sessionId);
  audit(req, 'account.sessions_revoked', 'user', req.user.id);
  res.json({ ok: true });
});

// Datenauskunft / Datenübertragbarkeit: alle personenbezogenen Daten als JSON
router.get('/export', (req, res) => {
  const db = getDb();
  const uid = req.user.id;
  const user = db.prepare('SELECT id, email, role, name, phone, created_at, last_login_at FROM users WHERE id = ?').get(uid);
  const col = req.user.role === 'dj' ? 'dj_id' : 'customer_id';
  const events = req.user.role === 'admin' ? [] : db.prepare(`SELECT * FROM events WHERE ${col} = ?`).all(uid);
  const eventIds = events.map((e) => e.id);
  const inList = eventIds.length ? `(${eventIds.map(() => '?').join(',')})` : '(NULL)';
  const pick = (sql) => (eventIds.length ? db.prepare(sql).all(...eventIds) : []);
  const payload = {
    exported_at: new Date().toISOString(),
    hinweis: 'Datenauskunft gemäß Art. 15 und Art. 20 DSGVO – Cosmos Events Dashboard',
    user,
    events: events.map((e) => (req.user.role === 'customer' ? stripInternal(e) : e)),
    questionnaire: pick(`SELECT * FROM questionnaire_responses WHERE event_id IN ${inList}`).map((q) => ({ ...q, data: JSON.parse(q.data) })),
    music_wishes: pick(`SELECT * FROM music_wishes WHERE event_id IN ${inList}`),
    documents: pick(`SELECT id, event_id, category, original_name, mime, size, description, created_at FROM documents WHERE event_id IN ${inList}`),
    appointments: pick(`SELECT * FROM appointments WHERE event_id IN ${inList}`),
    tasks: pick(`SELECT * FROM tasks WHERE event_id IN ${inList}`),
    payouts: req.user.role === 'dj' ? db.prepare('SELECT * FROM payouts WHERE dj_id = ?').all(uid) : [],
    audit_log: db.prepare('SELECT action, entity, entity_id, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 500').all(uid),
  };
  audit(req, 'account.data_exported', 'user', uid);
  res.setHeader('Content-Disposition', `attachment; filename="cosmos-events-datenauskunft-${uid}.json"`);
  res.json(payload);
});

function stripInternal(e) {
  const { notes_internal, booking_value_cents, commission_percent, rental_fee_cents, ...rest } = e;
  return rest;
}

// Löschantrag (Art. 17). Die eigentliche Anonymisierung führt der Admin nach Ablauf
// gesetzlicher Aufbewahrungsfristen (z. B. Vertrags- und Rechnungsdaten) durch.
router.post('/deletion-request', (req, res) => {
  if (req.user.role === 'admin') return res.status(400).json({ error: 'Admin-Konten können nur von einem anderen Admin gelöscht werden.' });
  getDb().prepare("UPDATE users SET deletion_requested_at = datetime('now') WHERE id = ?").run(req.user.id);
  audit(req, 'account.deletion_requested', 'user', req.user.id);
  res.json({ ok: true });
});

router.delete('/deletion-request', (req, res) => {
  getDb().prepare('UPDATE users SET deletion_requested_at = NULL WHERE id = ?').run(req.user.id);
  audit(req, 'account.deletion_request_withdrawn', 'user', req.user.id);
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  const u = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(u) });
});

module.exports = router;
