'use strict';
// Dokumenten-Upload: Dateien werden verschlüsselt (AES-256-GCM) außerhalb des Web-Roots
// unter zufälligem Namen gespeichert und nur nach Berechtigungsprüfung ausgeliefert.
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDb } = require('../db');
const { requireEventAccess } = require('../auth');
const { audit } = require('../audit');
const { encryptBuffer, decryptBuffer, randomToken } = require('../crypto');

const router = express.Router();

const ALLOWED = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
};
const CATEGORIES = ['ablaufplan', 'vertrag', 'location', 'aufbauplan', 'tagesbeschreibung', 'rechnung', 'sonstiges'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(1).toLowerCase();
    const okExt = ALLOWED[file.mimetype];
    if (!okExt || !okExt.includes(ext)) return cb(Object.assign(new Error('Dateityp nicht erlaubt. Erlaubt: PDF, Bilder, Word, Excel, Text.'), { status: 400 }));
    cb(null, true);
  },
});

function sniffOk(buf, mime) {
  const h = buf.subarray(0, 12);
  if (mime === 'application/pdf') return h.subarray(0, 4).toString() === '%PDF';
  if (mime === 'image/png') return h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
  if (mime === 'image/jpeg') return h[0] === 0xff && h[1] === 0xd8;
  if (mime === 'image/webp') return h.subarray(0, 4).toString() === 'RIFF' && h.subarray(8, 12).toString() === 'WEBP';
  if (mime.includes('openxmlformats')) return h[0] === 0x50 && h[1] === 0x4b;
  if (mime === 'application/msword' || mime === 'application/vnd.ms-excel') return h[0] === 0xd0 && h[1] === 0xcf;
  if (mime.startsWith('text/')) return !buf.subarray(0, 512).includes(0);
  return true;
}

function visibleClause(user) {
  return user.role === 'customer' ? ' AND visible_to_customer = 1' : '';
}

router.get('/events/:eventId', requireEventAccess(), (req, res) => {
  const rows = getDb().prepare(`SELECT d.id, d.event_id, d.category, d.original_name, d.mime, d.size, d.description, d.visible_to_customer, d.created_at,
      d.uploaded_by, u.name AS uploaded_by_name, u.role AS uploaded_by_role
    FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.event_id = ?${visibleClause(req.user)} ORDER BY d.created_at DESC`).all(req.event.id);
  res.json({ documents: rows, categories: CATEGORIES, max_bytes: config.maxUploadBytes });
});

router.post('/events/:eventId', requireEventAccess(), (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Datei zu groß (max. ${Math.round(config.maxUploadBytes / 1048576)} MB).` });
      return res.status(err.status || 400).json({ error: err.message });
    }
    next();
  });
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei übermittelt.' });
  if (!sniffOk(req.file.buffer, req.file.mimetype)) return res.status(400).json({ error: 'Dateiinhalt passt nicht zum Dateityp.' });
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'sonstiges';
  if (req.user.role === 'customer' && ['vertrag', 'rechnung'].includes(category)) {
    return res.status(403).json({ error: 'Verträge und Rechnungen werden von Cosmos Events hinterlegt.' });
  }
  const description = String(req.body.description || '').trim().slice(0, 500) || null;
  const visible = req.user.role === 'customer' ? 1 : (req.body.visible_to_customer === 'false' || req.body.visible_to_customer === '0' ? 0 : 1);
  const storedName = `${randomToken(24)}.enc`;
  const original = path.basename(req.file.originalname).replace(/[\r\n"]/g, '_').slice(0, 200);
  fs.writeFileSync(path.join(config.uploadDir, storedName), encryptBuffer(req.file.buffer, storedName), { mode: 0o600 });
  const info = getDb().prepare(`INSERT INTO documents (event_id, uploaded_by, category, original_name, stored_name, mime, size, description, visible_to_customer)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(req.event.id, req.user.id, category, original, storedName, req.file.mimetype, req.file.size, description, visible);
  audit(req, 'document.uploaded', 'document', info.lastInsertRowid, { event_id: req.event.id, name: original, category });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.get('/events/:eventId/:id/download', requireEventAccess(), (req, res) => {
  const doc = getDb().prepare(`SELECT * FROM documents WHERE id = ? AND event_id = ?${visibleClause(req.user)}`).get(Number(req.params.id), req.event.id);
  if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  const file = path.join(config.uploadDir, doc.stored_name);
  if (!fs.existsSync(file)) return res.status(410).json({ error: 'Datei nicht mehr vorhanden' });
  let plain;
  try { plain = decryptBuffer(fs.readFileSync(file), doc.stored_name); } catch { return res.status(500).json({ error: 'Datei konnte nicht entschlüsselt werden' }); }
  audit(req, 'document.downloaded', 'document', doc.id, { event_id: req.event.id });
  const inline = req.query.inline === '1' && (doc.mime.startsWith('image/') || doc.mime === 'application/pdf');
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`);
  res.send(plain);
});

router.patch('/events/:eventId/:id', requireEventAccess(), (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND event_id = ?').get(Number(req.params.id), req.event.id);
  if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  if (req.user.role === 'customer' && doc.uploaded_by !== req.user.id) return res.status(403).json({ error: 'Nur eigene Dokumente können bearbeitet werden.' });
  const b = req.body || {};
  const category = CATEGORIES.includes(b.category) ? b.category : doc.category;
  const description = b.description !== undefined ? String(b.description).trim().slice(0, 500) || null : doc.description;
  const visible = req.user.role !== 'customer' && b.visible_to_customer !== undefined ? (b.visible_to_customer ? 1 : 0) : doc.visible_to_customer;
  db.prepare('UPDATE documents SET category = ?, description = ?, visible_to_customer = ? WHERE id = ?').run(category, description, visible, doc.id);
  res.json({ ok: true });
});

router.delete('/events/:eventId/:id', requireEventAccess(), (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND event_id = ?').get(Number(req.params.id), req.event.id);
  if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  if (req.user.role !== 'admin' && doc.uploaded_by !== req.user.id) return res.status(403).json({ error: 'Nur eigene Dokumente können gelöscht werden.' });
  try { fs.unlinkSync(path.join(config.uploadDir, doc.stored_name)); } catch { /* ignore */ }
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  audit(req, 'document.deleted', 'document', doc.id, { event_id: req.event.id, name: doc.original_name });
  res.json({ ok: true });
});

module.exports = router;
