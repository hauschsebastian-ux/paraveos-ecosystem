'use strict';
const express = require('express');
const { getDb } = require('../db');
const { audit } = require('../audit');
const backup = require('../backup');

const router = express.Router();

router.get('/audit', (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const rows = getDb().prepare(`SELECT a.*, u.email AS user_email, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT ?`).all(limit);
  res.json({ entries: rows });
});

router.get('/backups', (req, res) => {
  res.json({ backups: backup.listBackups(), last_backup_at: backup.lastBackupAt() });
});

router.post('/backups', async (req, res) => {
  try {
    const file = await backup.createBackup(`manuell durch ${req.user.email}`);
    audit(req, 'backup.manual', 'system', null, { file: require('path').basename(file) });
    res.status(201).json({ ok: true, file: require('path').basename(file) });
  } catch (e) {
    console.error('[backup]', e);
    res.status(500).json({ error: 'Backup fehlgeschlagen' });
  }
});

router.get('/stats', (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    events_total: db.prepare('SELECT COUNT(*) n FROM events').get().n,
    events_upcoming: db.prepare("SELECT COUNT(*) n FROM events WHERE event_date >= ? AND status NOT IN ('storniert','abgeschlossen')").get(today).n,
    events_by_status: db.prepare('SELECT status, COUNT(*) n FROM events GROUP BY status').all(),
    customers: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'customer' AND anonymized_at IS NULL").get().n,
    djs: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'dj' AND anonymized_at IS NULL").get().n,
    deletion_requests: db.prepare('SELECT COUNT(*) n FROM users WHERE deletion_requested_at IS NOT NULL AND anonymized_at IS NULL').get().n,
    unassigned: db.prepare("SELECT COUNT(*) n FROM events WHERE dj_id IS NULL AND status NOT IN ('storniert','abgeschlossen')").get().n,
    last_backup_at: backup.lastBackupAt(),
  });
});

module.exports = router;
