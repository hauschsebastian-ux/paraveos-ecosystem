'use strict';
const express = require('express');
const { getDb } = require('../db');
const config = require('../config');
const { requireRole, requireEventAccess } = require('../auth');
const { audit } = require('../audit');
const { computeProgress } = require('../progress');
const { financeForEvent } = require('../finance');

const router = express.Router();

const STATUSES = ['anfrage', 'gebucht', 'planung', 'final', 'abgeschlossen', 'storniert'];

const LIST_SQL = `
  SELECT e.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
         d.name AS dj_name, d.email AS dj_email, d.phone AS dj_phone
    FROM events e
    LEFT JOIN users c ON c.id = e.customer_id
    LEFT JOIN users d ON d.id = e.dj_id`;

function viewFor(ev, user, withProgress = true) {
  const out = { ...ev };
  if (user.role === 'customer') {
    delete out.notes_internal; delete out.booking_value_cents; delete out.commission_percent;
    delete out.rental_fee_cents; delete out.customer_payment_status; delete out.dj_email;
  } else if (user.role === 'dj') {
    out.finance = financeForEvent(ev);
  } else {
    out.finance = financeForEvent(ev);
  }
  if (withProgress) {
    const p = computeProgress(ev.id);
    out.progress = p ? p.percent : 0;
    out.final_meeting_due = p ? p.final_meeting_due : false;
  }
  return out;
}

router.get('/', (req, res) => {
  const db = getDb();
  let rows;
  if (req.user.role === 'admin') rows = db.prepare(`${LIST_SQL} ORDER BY e.event_date IS NULL, e.event_date`).all();
  else if (req.user.role === 'dj') rows = db.prepare(`${LIST_SQL} WHERE e.dj_id = ? ORDER BY e.event_date IS NULL, e.event_date`).all(req.user.id);
  else rows = db.prepare(`${LIST_SQL} WHERE e.customer_id = ? ORDER BY e.event_date IS NULL, e.event_date`).all(req.user.id);
  res.json({ events: rows.map((e) => viewFor(e, req.user)) });
});

router.get('/:eventId', requireEventAccess(), (req, res) => {
  const ev = getDb().prepare(`${LIST_SQL} WHERE e.id = ?`).get(req.event.id);
  const view = viewFor(ev, req.user, false);
  view.progress_detail = computeProgress(ev.id);
  view.progress = view.progress_detail.percent;
  const db = getDb();
  view.appointments = db.prepare('SELECT * FROM appointments WHERE event_id = ? ORDER BY scheduled_at IS NULL, scheduled_at').all(ev.id);
  view.tasks = db.prepare('SELECT * FROM tasks WHERE event_id = ? ORDER BY done_at IS NOT NULL, due_date IS NULL, due_date').all(ev.id);
  view.document_count = db.prepare('SELECT COUNT(*) AS n FROM documents WHERE event_id = ?' + (req.user.role === 'customer' ? ' AND visible_to_customer = 1' : '')).get(ev.id).n;
  res.json({ event: view });
});

function parseEventBody(body, existing) {
  const b = body || {};
  const str = (k, max = 300) => (b[k] !== undefined ? (b[k] === null ? null : String(b[k]).trim().slice(0, max) || null) : existing[k]);
  const out = {
    title: str('title', 200),
    event_type: str('event_type', 60) || 'Hochzeit',
    status: b.status !== undefined ? b.status : existing.status,
    event_date: str('event_date', 10),
    start_time: str('start_time', 5),
    end_time: str('end_time', 5),
    customer_id: b.customer_id !== undefined ? (b.customer_id ? Number(b.customer_id) : null) : existing.customer_id,
    dj_id: b.dj_id !== undefined ? (b.dj_id ? Number(b.dj_id) : null) : existing.dj_id,
    location_name: str('location_name', 200),
    location_address: str('location_address', 400),
    guest_count: b.guest_count !== undefined ? (b.guest_count === '' || b.guest_count === null ? null : Number(b.guest_count)) : existing.guest_count,
    contract_number: str('contract_number', 60),
    contract_signed_at: str('contract_signed_at', 10),
    notes_internal: str('notes_internal', 5000),
    notes_customer: str('notes_customer', 5000),
    booking_value_cents: b.booking_value_cents !== undefined ? Math.round(Number(b.booking_value_cents) || 0) : existing.booking_value_cents,
    commission_percent: b.commission_percent !== undefined ? Number(b.commission_percent) : existing.commission_percent,
    rental_fee_cents: b.rental_fee_cents !== undefined ? Math.round(Number(b.rental_fee_cents) || 0) : existing.rental_fee_cents,
    customer_payment_status: b.customer_payment_status !== undefined ? b.customer_payment_status : existing.customer_payment_status,
  };
  if (!out.title) return { error: 'Titel erforderlich.' };
  if (!STATUSES.includes(out.status)) return { error: 'Ungültiger Status.' };
  if (out.event_date && !/^\d{4}-\d{2}-\d{2}$/.test(out.event_date)) return { error: 'Datum im Format JJJJ-MM-TT.' };
  for (const k of ['start_time', 'end_time']) if (out[k] && !/^\d{2}:\d{2}$/.test(out[k])) return { error: 'Uhrzeit im Format HH:MM.' };
  if (out.guest_count !== null && (!Number.isInteger(out.guest_count) || out.guest_count < 0)) return { error: 'Gästezahl ungültig.' };
  if (!(out.commission_percent >= 0 && out.commission_percent <= 100)) return { error: 'Provision muss zwischen 0 und 100 % liegen.' };
  if (out.booking_value_cents < 0 || out.rental_fee_cents < 0) return { error: 'Beträge dürfen nicht negativ sein.' };
  if (!['offen', 'anzahlung', 'bezahlt'].includes(out.customer_payment_status)) return { error: 'Ungültiger Zahlungsstatus.' };
  const db = getDb();
  if (out.customer_id && !db.prepare("SELECT id FROM users WHERE id = ? AND role = 'customer'").get(out.customer_id)) return { error: 'Kunde nicht gefunden.' };
  if (out.dj_id && !db.prepare("SELECT id FROM users WHERE id = ? AND role = 'dj'").get(out.dj_id)) return { error: 'DJ nicht gefunden.' };
  return { data: out };
}

const EMPTY = {
  title: null, event_type: 'Hochzeit', status: 'gebucht', event_date: null, start_time: null, end_time: null,
  customer_id: null, dj_id: null, location_name: null, location_address: null, guest_count: null,
  contract_number: null, contract_signed_at: null, notes_internal: null, notes_customer: null,
  booking_value_cents: 0, commission_percent: config.defaultCommissionPercent, rental_fee_cents: 0, customer_payment_status: 'offen',
};

router.post('/', requireRole('admin'), (req, res) => {
  const parsed = parseEventBody(req.body, EMPTY);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const d = parsed.data;
  const db = getDb();
  const info = db.prepare(`INSERT INTO events (title, event_type, status, event_date, start_time, end_time, customer_id, dj_id,
      location_name, location_address, guest_count, contract_number, contract_signed_at, notes_internal, notes_customer,
      booking_value_cents, commission_percent, rental_fee_cents, customer_payment_status)
    VALUES (@title, @event_type, @status, @event_date, @start_time, @end_time, @customer_id, @dj_id, @location_name, @location_address,
      @guest_count, @contract_number, @contract_signed_at, @notes_internal, @notes_customer, @booking_value_cents, @commission_percent,
      @rental_fee_cents, @customer_payment_status)`).run(d);
  const id = info.lastInsertRowid;
  db.prepare('INSERT INTO questionnaire_responses (event_id) VALUES (?)').run(id);
  // Standard-Termine und Aufgaben anlegen
  db.prepare("INSERT INTO appointments (event_id, kind, title, created_by) VALUES (?, 'update_call', 'Update-Gespräch', ?)").run(id, req.user.id);
  db.prepare("INSERT INTO appointments (event_id, kind, title, notes, created_by) VALUES (?, 'final_meeting', 'Finale Besprechung', 'Empfohlen bei ca. 80 % Planungsfortschritt.', ?)").run(id, req.user.id);
  const dueQ = d.event_date ? shiftDate(d.event_date, -60) : null;
  const dueM = d.event_date ? shiftDate(d.event_date, -21) : null;
  db.prepare("INSERT INTO tasks (event_id, title, due_date, assignee_role, created_by) VALUES (?,?,?,?,?)").run(id, 'Fragebogen ausfüllen', dueQ, 'customer', req.user.id);
  db.prepare("INSERT INTO tasks (event_id, title, due_date, assignee_role, created_by) VALUES (?,?,?,?,?)").run(id, 'Musikwünsche & Must-Plays eintragen', dueM, 'customer', req.user.id);
  db.prepare("INSERT INTO tasks (event_id, title, due_date, assignee_role, created_by) VALUES (?,?,?,?,?)").run(id, 'Ablaufplan hochladen', dueM, 'customer', req.user.id);
  audit(req, 'event.created', 'event', id, { title: d.title });
  res.status(201).json({ id });
});

function shiftDate(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

router.patch('/:eventId', requireEventAccess(), (req, res) => {
  const db = getDb();
  let allowed;
  if (req.user.role === 'admin') allowed = null; // alles
  else if (req.user.role === 'dj') allowed = ['status', 'notes_internal', 'start_time', 'end_time'];
  else allowed = ['notes_customer', 'guest_count'];
  let body = req.body || {};
  if (allowed) {
    body = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    if (req.user.role === 'dj' && body.status && !['planung', 'final', 'abgeschlossen'].includes(body.status)) {
      return res.status(403).json({ error: 'DJs können den Status nur auf Planung, Final oder Abgeschlossen setzen.' });
    }
  }
  const parsed = parseEventBody(body, req.event);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const d = { ...parsed.data, id: req.event.id };
  db.prepare(`UPDATE events SET title=@title, event_type=@event_type, status=@status, event_date=@event_date, start_time=@start_time,
      end_time=@end_time, customer_id=@customer_id, dj_id=@dj_id, location_name=@location_name, location_address=@location_address,
      guest_count=@guest_count, contract_number=@contract_number, contract_signed_at=@contract_signed_at, notes_internal=@notes_internal,
      notes_customer=@notes_customer, booking_value_cents=@booking_value_cents, commission_percent=@commission_percent,
      rental_fee_cents=@rental_fee_cents, customer_payment_status=@customer_payment_status, updated_at=datetime('now') WHERE id=@id`).run(d);
  audit(req, 'event.updated', 'event', req.event.id, { fields: Object.keys(body) });
  res.json({ ok: true });
});

router.delete('/:eventId', requireRole('admin'), requireEventAccess(), (req, res) => {
  const db = getDb();
  const fs = require('fs'); const path = require('path');
  for (const d of db.prepare('SELECT stored_name FROM documents WHERE event_id = ?').all(req.event.id)) {
    try { fs.unlinkSync(path.join(config.uploadDir, d.stored_name)); } catch { /* ignore */ }
  }
  db.prepare('DELETE FROM events WHERE id = ?').run(req.event.id);
  audit(req, 'event.deleted', 'event', req.event.id);
  res.json({ ok: true });
});

router.get('/:eventId/progress', requireEventAccess(), (req, res) => {
  res.json({ progress: computeProgress(req.event.id) });
});

module.exports = { router, STATUSES };
