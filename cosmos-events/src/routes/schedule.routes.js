'use strict';
// Termine (Update-Gespräch, finale Besprechung, ...) und Aufgaben eines Events.
const express = require('express');
const { getDb } = require('../db');
const { requireEventAccess } = require('../auth');
const { audit } = require('../audit');

const router = express.Router();
const KINDS = ['update_call', 'final_meeting', 'site_visit', 'other'];
const KIND_TITLES = { update_call: 'Update-Gespräch', final_meeting: 'Finale Besprechung', site_visit: 'Location-Besichtigung', other: 'Termin' };

function isoDateTime(v) {
  if (!v) return null;
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 16) : undefined;
}

// Gesamt-Timeline eines Events (Termine + Aufgaben + Eventtag)
router.get('/events/:eventId/timeline', requireEventAccess(), (req, res) => {
  const db = getDb();
  const apps = db.prepare('SELECT * FROM appointments WHERE event_id = ? ORDER BY scheduled_at IS NULL, scheduled_at').all(req.event.id);
  const tasks = db.prepare('SELECT * FROM tasks WHERE event_id = ? ORDER BY done_at IS NOT NULL, due_date IS NULL, due_date').all(req.event.id);
  const items = [
    ...apps.map((a) => ({ type: 'appointment', id: a.id, kind: a.kind, title: a.title, at: a.scheduled_at, status: a.status, location: a.location, notes: a.notes, duration_min: a.duration_min })),
    ...tasks.map((t) => ({ type: 'task', id: t.id, title: t.title, at: t.due_date, status: t.done_at ? 'erledigt' : 'offen', assignee_role: t.assignee_role })),
  ];
  if (req.event.event_date) items.push({ type: 'event_day', id: 0, title: req.event.title, at: req.event.event_date + (req.event.start_time ? 'T' + req.event.start_time : ''), status: req.event.status });
  items.sort((a, b) => (a.at || '9999').localeCompare(b.at || '9999'));
  res.json({ items, appointments: apps, tasks, kinds: KIND_TITLES });
});

// Übergreifender Kalender: alle Events und Termine des Nutzers
router.get('/calendar', (req, res) => {
  const db = getDb();
  let where = '1=1'; const params = [];
  if (req.user.role === 'dj') { where = 'e.dj_id = ?'; params.push(req.user.id); }
  if (req.user.role === 'customer') { where = 'e.customer_id = ?'; params.push(req.user.id); }
  const events = db.prepare(`SELECT e.id, e.title, e.event_date, e.start_time, e.end_time, e.status, e.location_name, c.name AS customer_name, d.name AS dj_name
    FROM events e LEFT JOIN users c ON c.id = e.customer_id LEFT JOIN users d ON d.id = e.dj_id WHERE ${where} AND e.event_date IS NOT NULL`).all(...params);
  const apps = db.prepare(`SELECT a.id, a.event_id, a.kind, a.title, a.scheduled_at, a.status, e.title AS event_title
    FROM appointments a JOIN events e ON e.id = a.event_id WHERE ${where} AND a.scheduled_at IS NOT NULL AND a.status != 'abgesagt'`).all(...params);
  const tasks = db.prepare(`SELECT t.id, t.event_id, t.title, t.due_date, t.done_at, t.assignee_role, e.title AS event_title
    FROM tasks t JOIN events e ON e.id = t.event_id WHERE ${where} AND t.due_date IS NOT NULL`).all(...params);
  res.json({ events, appointments: apps, tasks });
});

router.post('/events/:eventId/appointments', requireEventAccess(), (req, res) => {
  const b = req.body || {};
  const kind = KINDS.includes(b.kind) ? b.kind : 'other';
  const at = isoDateTime(b.scheduled_at);
  if (at === undefined) return res.status(400).json({ error: 'Ungültiges Datum/Uhrzeit.' });
  const title = String(b.title || KIND_TITLES[kind]).trim().slice(0, 200);
  const info = getDb().prepare(`INSERT INTO appointments (event_id, kind, title, scheduled_at, duration_min, location, notes, created_by) VALUES (?,?,?,?,?,?,?,?)`)
    .run(req.event.id, kind, title, at, Math.min(600, Math.max(5, Number(b.duration_min) || 60)), String(b.location || '').slice(0, 300) || null, String(b.notes || '').slice(0, 2000) || null, req.user.id);
  audit(req, 'appointment.created', 'appointment', info.lastInsertRowid, { event_id: req.event.id, kind });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/events/:eventId/appointments/:id', requireEventAccess(), (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM appointments WHERE id = ? AND event_id = ?').get(Number(req.params.id), req.event.id);
  if (!a) return res.status(404).json({ error: 'Termin nicht gefunden' });
  const b = req.body || {};
  const at = b.scheduled_at !== undefined ? isoDateTime(b.scheduled_at) : a.scheduled_at;
  if (at === undefined) return res.status(400).json({ error: 'Ungültiges Datum/Uhrzeit.' });
  const status = b.status !== undefined ? b.status : a.status;
  if (!['geplant', 'erledigt', 'abgesagt'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status.' });
  if (req.user.role === 'customer' && status === 'erledigt' && a.status !== 'erledigt') {
    return res.status(403).json({ error: 'Termine werden vom DJ oder von Cosmos Events als erledigt markiert.' });
  }
  db.prepare(`UPDATE appointments SET title = ?, scheduled_at = ?, duration_min = ?, location = ?, notes = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(b.title !== undefined ? String(b.title).trim().slice(0, 200) || a.title : a.title, at,
      b.duration_min !== undefined ? Math.min(600, Math.max(5, Number(b.duration_min) || 60)) : a.duration_min,
      b.location !== undefined ? String(b.location).slice(0, 300) || null : a.location,
      b.notes !== undefined ? String(b.notes).slice(0, 2000) || null : a.notes, status, a.id);
  audit(req, 'appointment.updated', 'appointment', a.id, { status });
  res.json({ ok: true });
});

router.delete('/events/:eventId/appointments/:id', requireEventAccess(), (req, res) => {
  if (req.user.role === 'customer') return res.status(403).json({ error: 'Termine können nur von Cosmos Events oder dem DJ gelöscht werden.' });
  const info = getDb().prepare('DELETE FROM appointments WHERE id = ? AND event_id = ?').run(Number(req.params.id), req.event.id);
  if (!info.changes) return res.status(404).json({ error: 'Termin nicht gefunden' });
  res.json({ ok: true });
});

router.post('/events/:eventId/tasks', requireEventAccess(), (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: 'Titel erforderlich.' });
  const due = b.due_date ? String(b.due_date).slice(0, 10) : null;
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ error: 'Ungültiges Datum.' });
  const role = ['customer', 'dj', 'admin'].includes(b.assignee_role) ? b.assignee_role : req.user.role;
  const info = getDb().prepare('INSERT INTO tasks (event_id, title, due_date, assignee_role, created_by) VALUES (?,?,?,?,?)').run(req.event.id, title, due, role, req.user.id);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/events/:eventId/tasks/:id', requireEventAccess(), (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM tasks WHERE id = ? AND event_id = ?').get(Number(req.params.id), req.event.id);
  if (!t) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
  const b = req.body || {};
  const done = b.done !== undefined ? (b.done ? (t.done_at || new Date().toISOString()) : null) : t.done_at;
  const due = b.due_date !== undefined ? (b.due_date ? String(b.due_date).slice(0, 10) : null) : t.due_date;
  db.prepare('UPDATE tasks SET title = ?, due_date = ?, done_at = ? WHERE id = ?')
    .run(b.title !== undefined ? String(b.title).trim().slice(0, 200) || t.title : t.title, due, done, t.id);
  res.json({ ok: true });
});

router.delete('/events/:eventId/tasks/:id', requireEventAccess(), (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM tasks WHERE id = ? AND event_id = ?').get(Number(req.params.id), req.event.id);
  if (!t) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
  if (req.user.role === 'customer' && t.created_by !== req.user.id) return res.status(403).json({ error: 'Nur eigene Aufgaben können gelöscht werden.' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

module.exports = router;
