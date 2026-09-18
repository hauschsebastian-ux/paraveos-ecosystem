'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../db');
const { requireEventAccess } = require('../auth');
const { audit } = require('../audit');
const spotify = require('../spotify');
const { PROGRAM_SLOTS } = require('../progress');

const router = express.Router();
const CATEGORIES = ['wunsch', 'mustplay', 'nogo', 'programm'];

const config = require('../config');
const searchLimiter = rateLimit({ skip: () => config.isTest, windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });

router.get('/spotify/search', searchLimiter, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q.length < 2) return res.json({ tracks: [] });
  try {
    const id = spotify.parseTrackId(q);
    const tracks = id ? [await spotify.getTrack(id)] : await spotify.searchTracks(q, 10);
    res.json({ tracks });
  } catch (e) {
    if (e.code === 'spotify_not_configured') return res.status(503).json({ error: 'Spotify ist nicht konfiguriert. Songs können manuell eingetragen werden.', code: e.code });
    console.error('[spotify]', e.message);
    res.status(502).json({ error: 'Spotify ist gerade nicht erreichbar.' });
  }
});

router.get('/events/:eventId', requireEventAccess(), (req, res) => {
  const rows = getDb().prepare(`SELECT m.*, u.name AS created_by_name FROM music_wishes m LEFT JOIN users u ON u.id = m.created_by
    WHERE m.event_id = ? ORDER BY m.category, m.program_slot, m.created_at`).all(req.event.id);
  res.json({ wishes: rows, program_slots: PROGRAM_SLOTS, spotify: spotify.isConfigured() });
});

router.post('/events/:eventId', requireEventAccess(), (req, res) => {
  const b = req.body || {};
  if (!CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'Ungültige Kategorie.' });
  const title = String(b.title || '').trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: 'Titel erforderlich.' });
  const slot = b.category === 'programm' ? String(b.program_slot || '').trim().slice(0, 80) : null;
  if (b.category === 'programm' && !slot) return res.status(400).json({ error: 'Bitte einen Programmpunkt angeben.' });
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS n FROM music_wishes WHERE event_id = ?').get(req.event.id).n;
  if (count >= 500) return res.status(400).json({ error: 'Maximal 500 Einträge pro Event.' });
  const str = (v, m) => (v ? String(v).slice(0, m) : null);
  const info = db.prepare(`INSERT INTO music_wishes (event_id, category, program_slot, spotify_id, title, artist, album, image_url, preview_url, duration_ms, note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    req.event.id, b.category, slot, str(b.spotify_id, 40), title, str(b.artist, 200), str(b.album, 200),
    safeUrl(b.image_url), safeUrl(b.preview_url), b.duration_ms ? Number(b.duration_ms) : null, str(b.note, 500), req.user.id);
  res.status(201).json({ id: info.lastInsertRowid });
});

function safeUrl(u) {
  if (!u) return null;
  const s = String(u).slice(0, 500);
  return /^https:\/\/([a-z0-9-]+\.)*(scdn\.co|spotifycdn\.com|spotify\.com)\//i.test(s) ? s : null;
}

router.patch('/events/:eventId/:id', requireEventAccess(), (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM music_wishes WHERE id = ? AND event_id = ?').get(Number(req.params.id), req.event.id);
  if (!row) return res.status(404).json({ error: 'Eintrag nicht gefunden' });
  const b = req.body || {};
  const category = b.category !== undefined ? b.category : row.category;
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Ungültige Kategorie.' });
  const slot = category === 'programm' ? String(b.program_slot ?? row.program_slot ?? '').trim().slice(0, 80) || null : null;
  const note = b.note !== undefined ? String(b.note || '').slice(0, 500) || null : row.note;
  db.prepare('UPDATE music_wishes SET category = ?, program_slot = ?, note = ? WHERE id = ?').run(category, slot, note, row.id);
  res.json({ ok: true });
});

router.delete('/events/:eventId/:id', requireEventAccess(), (req, res) => {
  const info = getDb().prepare('DELETE FROM music_wishes WHERE id = ? AND event_id = ?').run(Number(req.params.id), req.event.id);
  if (!info.changes) return res.status(404).json({ error: 'Eintrag nicht gefunden' });
  res.json({ ok: true });
});

// Export der Musikliste (z. B. für den DJ) als Text
router.get('/events/:eventId/export.txt', requireEventAccess(), (req, res) => {
  const rows = getDb().prepare('SELECT * FROM music_wishes WHERE event_id = ? ORDER BY category, program_slot, created_at').all(req.event.id);
  const label = { mustplay: 'MUST PLAYS', wunsch: 'MUSIKWÜNSCHE', nogo: 'NO GOS', programm: 'PROGRAMMPUNKTE' };
  let out = `Musikliste – ${req.event.title}\n\n`;
  for (const cat of ['programm', 'mustplay', 'wunsch', 'nogo']) {
    const list = rows.filter((r) => r.category === cat);
    if (!list.length) continue;
    out += `== ${label[cat]} ==\n`;
    for (const r of list) out += `${r.program_slot ? `[${r.program_slot}] ` : ''}${r.artist ? r.artist + ' – ' : ''}${r.title}${r.note ? `  (${r.note})` : ''}${r.spotify_id ? `  https://open.spotify.com/track/${r.spotify_id}` : ''}\n`;
    out += '\n';
  }
  audit(req, 'music.exported', 'event', req.event.id);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="musikliste-event-${req.event.id}.txt"`);
  res.send(out);
});

module.exports = router;
