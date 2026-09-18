'use strict';
const express = require('express');
const { getDb } = require('../db');
const { requireEventAccess } = require('../auth');
const { audit } = require('../audit');
const { getSchema, sanitizeAnswers, completion } = require('../questionnaire');

const router = express.Router({ mergeParams: true });

router.get('/schema', (req, res) => res.json({ schema: getSchema() }));

router.get('/:eventId', requireEventAccess(), (req, res) => {
  const row = getDb().prepare('SELECT * FROM questionnaire_responses WHERE event_id = ?').get(req.event.id);
  const data = row ? JSON.parse(row.data) : {};
  res.json({
    schema: getSchema(), data, current_step: row ? row.current_step : 0,
    submitted_at: row ? row.submitted_at : null, updated_at: row ? row.updated_at : null,
    completion: completion(data),
  });
});

// Teil-Speichern jederzeit möglich; nur übergebene Felder werden aktualisiert.
router.put('/:eventId', requireEventAccess(), (req, res) => {
  if (req.user.role === 'dj') return res.status(403).json({ error: 'DJs können den Fragebogen nur lesen.' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM questionnaire_responses WHERE event_id = ?').get(req.event.id);
  const current = row ? JSON.parse(row.data) : {};
  const { answers, errors } = sanitizeAnswers(req.body?.data);
  const merged = { ...current, ...answers };
  const step = Number.isInteger(req.body?.current_step) ? Math.max(0, req.body.current_step) : (row ? row.current_step : 0);
  const comp = completion(merged);
  let submitted = row ? row.submitted_at : null;
  if (req.body?.submit === true) {
    if (comp.percent < 100) return res.status(400).json({ error: 'Bitte zuerst alle Pflichtfelder ausfüllen.', completion: comp, errors });
    submitted = new Date().toISOString();
  }
  db.prepare(`INSERT INTO questionnaire_responses (event_id, data, current_step, submitted_at, updated_at) VALUES (?,?,?,?,datetime('now'))
    ON CONFLICT(event_id) DO UPDATE SET data = excluded.data, current_step = excluded.current_step, submitted_at = excluded.submitted_at, updated_at = datetime('now')`)
    .run(req.event.id, JSON.stringify(merged), step, submitted);
  if (req.body?.submit === true) audit(req, 'questionnaire.submitted', 'event', req.event.id);
  res.json({ ok: true, data: merged, completion: comp, errors, submitted_at: submitted });
});

module.exports = router;
