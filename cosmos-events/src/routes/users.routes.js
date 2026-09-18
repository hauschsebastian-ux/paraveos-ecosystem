'use strict';
// Nutzerverwaltung (nur Admin): DJs und Kunden anlegen, Passwörter zurücksetzen, deaktivieren, anonymisieren.
const express = require('express');
const { getDb } = require('../db');
const crypto = require('../crypto');
const { destroyAllSessions, USER_COLUMNS } = require('../auth');
const { audit } = require('../audit');

const router = express.Router();

router.get('/', (req, res) => {
  const role = req.query.role;
  const db = getDb();
  const rows = role
    ? db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE role = ? ORDER BY name`).all(role)
    : db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY role, name`).all();
  const counts = db.prepare(`SELECT customer_id, dj_id FROM events`).all();
  res.json({ users: rows.map((u) => ({
    ...u, active: !!u.active, totp_enabled: !!u.totp_enabled,
    event_count: counts.filter((c) => c.customer_id === u.id || c.dj_id === u.id).length,
  })) });
});

router.post('/', (req, res) => {
  const { email, name, phone, role, password } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
  if (!['admin', 'dj', 'customer'].includes(role)) return res.status(400).json({ error: 'Ungültige Rolle.' });
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'Name erforderlich.' });
  const db = getDb();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(em)) return res.status(409).json({ error: 'E-Mail ist bereits vergeben.' });
  let pw = password ? String(password) : crypto.randomPassword();
  const policy = crypto.passwordPolicy(pw);
  if (policy) return res.status(400).json({ error: policy });
  const info = db.prepare(
    'INSERT INTO users (email, password_hash, role, name, phone, must_change_password) VALUES (?,?,?,?,?,1)'
  ).run(em, crypto.hashPassword(pw), role, String(name).trim(), phone ? String(phone).trim() : null);
  audit(req, 'user.created', 'user', info.lastInsertRowid, { role, email: em });
  // Das Initialpasswort wird genau einmal zurückgegeben und muss beim ersten Login geändert werden.
  res.status(201).json({ id: info.lastInsertRowid, initial_password: pw });
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Nutzer nicht gefunden' });
  const { name, phone, active, role } = req.body || {};
  const newName = name !== undefined ? String(name).trim().slice(0, 120) : u.name;
  const newPhone = phone !== undefined ? (String(phone).trim().slice(0, 40) || null) : u.phone;
  let newActive = active !== undefined ? (active ? 1 : 0) : u.active;
  let newRole = role !== undefined ? role : u.role;
  if (!['admin', 'dj', 'customer'].includes(newRole)) return res.status(400).json({ error: 'Ungültige Rolle.' });
  if (u.id === req.user.id && (newActive === 0 || newRole !== 'admin')) {
    return res.status(400).json({ error: 'Das eigene Admin-Konto kann nicht deaktiviert oder herabgestuft werden.' });
  }
  db.prepare("UPDATE users SET name = ?, phone = ?, active = ?, role = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newName, newPhone, newActive, newRole, u.id);
  if (!newActive) destroyAllSessions(u.id);
  audit(req, 'user.updated', 'user', u.id, { active: !!newActive, role: newRole });
  res.json({ ok: true });
});

router.post('/:id/reset-password', (req, res) => {
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Nutzer nicht gefunden' });
  const pw = crypto.randomPassword();
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?")
    .run(crypto.hashPassword(pw), u.id);
  destroyAllSessions(u.id);
  audit(req, 'user.password_reset', 'user', u.id);
  res.json({ ok: true, initial_password: pw });
});

router.post('/:id/reset-2fa', (req, res) => {
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Nutzer nicht gefunden' });
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL WHERE id = ?').run(u.id);
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(u.id);
  destroyAllSessions(u.id);
  audit(req, 'user.2fa_reset', 'user', u.id);
  res.json({ ok: true });
});

// Anonymisierung (DSGVO Art. 17): personenbezogene Daten werden unwiderruflich entfernt,
// Event- und Abrechnungsdaten bleiben pseudonymisiert erhalten (Aufbewahrungspflichten).
router.post('/:id/anonymize', (req, res) => {
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Nutzer nicht gefunden' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'Das eigene Konto kann nicht anonymisiert werden.' });
  if (u.role === 'admin') return res.status(400).json({ error: 'Admin-Konten bitte zuerst herabstufen.' });
  const fs = require('fs');
  const path = require('path');
  const config = require('../config');
  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET email = ?, name = 'Gelöschter Nutzer', phone = NULL, password_hash = 'anonymized',
      active = 0, totp_enabled = 0, totp_secret_enc = NULL, anonymized_at = datetime('now'), deletion_requested_at = NULL WHERE id = ?`)
      .run(`anonym-${u.id}@invalid.local`, u.id);
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    if (u.role === 'customer') {
      const events = db.prepare('SELECT id FROM events WHERE customer_id = ?').all(u.id);
      for (const ev of events) {
        db.prepare('DELETE FROM questionnaire_responses WHERE event_id = ?').run(ev.id);
        db.prepare('DELETE FROM music_wishes WHERE event_id = ?').run(ev.id);
        const docs = db.prepare('SELECT stored_name FROM documents WHERE event_id = ?').all(ev.id);
        for (const d of docs) { try { fs.unlinkSync(path.join(config.uploadDir, d.stored_name)); } catch { /* ignore */ } }
        db.prepare('DELETE FROM documents WHERE event_id = ?').run(ev.id);
        db.prepare("UPDATE events SET notes_customer = NULL, notes_internal = NULL, location_address = NULL, updated_at = datetime('now') WHERE id = ?").run(ev.id);
      }
    }
  });
  tx();
  audit(req, 'user.anonymized', 'user', u.id, { role: u.role });
  res.json({ ok: true });
});

module.exports = router;
