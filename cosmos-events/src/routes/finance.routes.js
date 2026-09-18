'use strict';
const express = require('express');
const { getDb } = require('../db');
const { requireRole, requireEventAccess } = require('../auth');
const { audit } = require('../audit');
const { summaryForDj, financeForEvent } = require('../finance');

const router = express.Router();

// DJ: eigene Umsatz-/Gagenübersicht. Admin: Übersicht eines beliebigen DJs (?dj_id=)
router.get('/dj', requireRole('dj', 'admin'), (req, res) => {
  const djId = req.user.role === 'dj' ? req.user.id : Number(req.query.dj_id);
  if (!djId) return res.status(400).json({ error: 'dj_id erforderlich' });
  const year = req.query.year ? String(req.query.year).slice(0, 4) : null;
  res.json(summaryForDj(djId, year));
});

// Admin: Gesamtübersicht über alle DJs
router.get('/overview', requireRole('admin'), (req, res) => {
  const db = getDb();
  const djs = db.prepare("SELECT id, name FROM users WHERE role = 'dj' AND anonymized_at IS NULL ORDER BY name").all();
  const perDj = djs.map((d) => ({ dj: d, ...summaryForDj(d.id).kpis }));
  const events = db.prepare("SELECT * FROM events WHERE status != 'storniert'").all();
  const totals = events.reduce((acc, e) => {
    const f = financeForEvent(e);
    acc.booking += f.booking_value_cents; acc.commission += f.commission_cents; acc.rental += f.rental_fee_cents;
    acc.fees += f.dj_fee_cents; acc.paid += f.paid_out_cents; acc.open += f.open_cents; return acc;
  }, { booking: 0, commission: 0, rental: 0, fees: 0, paid: 0, open: 0 });
  res.json({ per_dj: perDj, totals, event_count: events.length });
});

router.get('/events/:eventId/payouts', requireEventAccess(), (req, res) => {
  if (req.user.role === 'customer') return res.status(403).json({ error: 'Kein Zugriff' });
  const rows = getDb().prepare('SELECT p.*, u.name AS created_by_name FROM payouts p LEFT JOIN users u ON u.id = p.created_by WHERE p.event_id = ? ORDER BY p.paid_at DESC').all(req.event.id);
  res.json({ payouts: rows, finance: financeForEvent(req.event) });
});

router.post('/events/:eventId/payouts', requireRole('admin'), requireEventAccess(), (req, res) => {
  const b = req.body || {};
  const amount = Math.round(Number(b.amount_cents));
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Betrag ungültig.' });
  if (!req.event.dj_id) return res.status(400).json({ error: 'Dem Event ist kein DJ zugewiesen.' });
  const paidAt = b.paid_at && /^\d{4}-\d{2}-\d{2}$/.test(b.paid_at) ? b.paid_at : new Date().toISOString().slice(0, 10);
  const info = getDb().prepare('INSERT INTO payouts (event_id, dj_id, amount_cents, paid_at, note, created_by) VALUES (?,?,?,?,?,?)')
    .run(req.event.id, req.event.dj_id, amount, paidAt, String(b.note || '').slice(0, 300) || null, req.user.id);
  audit(req, 'payout.created', 'payout', info.lastInsertRowid, { event_id: req.event.id, amount_cents: amount });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/events/:eventId/payouts/:id', requireRole('admin'), requireEventAccess(), (req, res) => {
  const info = getDb().prepare('DELETE FROM payouts WHERE id = ? AND event_id = ?').run(Number(req.params.id), req.event.id);
  if (!info.changes) return res.status(404).json({ error: 'Auszahlung nicht gefunden' });
  audit(req, 'payout.deleted', 'payout', Number(req.params.id), { event_id: req.event.id });
  res.json({ ok: true });
});

module.exports = router;
