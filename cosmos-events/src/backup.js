'use strict';
// Verschlüsselte, regelmäßige Backups der SQLite-Datenbank (Online-Backup-API).
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getDb } = require('./db');
const { encryptFile, decryptFile } = require('./crypto');

function stamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function createBackup(reason = 'manuell') {
  const db = getDb();
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const tmp = path.join(config.backupDir, `.tmp-${process.pid}-${Date.now()}.sqlite`);
  const target = path.join(config.backupDir, `cosmos-${stamp()}.sqlite.enc`);
  try {
    await db.backup(tmp);
    await encryptFile(tmp, target);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('last_backup_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(new Date().toISOString());
  db.prepare('INSERT INTO audit_log (action, entity, details) VALUES (?,?,?)').run('backup.created', 'system', JSON.stringify({ file: path.basename(target), reason }));
  pruneBackups();
  return target;
}

function listBackups() {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs.readdirSync(config.backupDir)
    .filter((f) => f.endsWith('.sqlite.enc'))
    .map((f) => {
      const st = fs.statSync(path.join(config.backupDir, f));
      return { file: f, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function pruneBackups() {
  const cutoff = Date.now() - config.backupRetentionDays * 86400 * 1000;
  for (const b of listBackups()) {
    if (new Date(b.created_at).getTime() < cutoff) {
      fs.unlinkSync(path.join(config.backupDir, b.file));
    }
  }
}

async function restoreBackup(file, destination) {
  const src = path.join(config.backupDir, path.basename(file));
  if (!fs.existsSync(src)) throw new Error('Backup nicht gefunden');
  return decryptFile(src, destination);
}

function lastBackupAt() {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'last_backup_at'").get();
  return row ? row.value : null;
}

let timer = null;
function scheduleBackups(logger = console) {
  if (timer) clearInterval(timer);
  const check = async () => {
    try {
      const last = lastBackupAt();
      const ageH = last ? (Date.now() - new Date(last).getTime()) / 3600000 : Infinity;
      const hour = new Date().getHours();
      if (ageH >= 24 || (hour === config.backupHour && ageH >= 20)) {
        const f = await createBackup('automatisch');
        logger.log(`[backup] Backup erstellt: ${path.basename(f)}`);
      }
    } catch (e) {
      logger.error('[backup] Fehler:', e.message);
    }
  };
  check();
  timer = setInterval(check, 15 * 60 * 1000);
  timer.unref();
}

module.exports = { createBackup, listBackups, pruneBackups, restoreBackup, lastBackupAt, scheduleBackups };
