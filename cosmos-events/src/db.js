'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

let db = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','dj','customer')),
  name TEXT NOT NULL,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  totp_secret_enc TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  deletion_requested_at TEXT,
  anonymized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  pending_2fa INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'Hochzeit',
  status TEXT NOT NULL DEFAULT 'gebucht'
    CHECK (status IN ('anfrage','gebucht','planung','final','abgeschlossen','storniert')),
  event_date TEXT,
  start_time TEXT,
  end_time TEXT,
  customer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dj_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  location_name TEXT,
  location_address TEXT,
  guest_count INTEGER,
  contract_number TEXT,
  contract_signed_at TEXT,
  notes_internal TEXT,
  notes_customer TEXT,
  booking_value_cents INTEGER NOT NULL DEFAULT 0,
  commission_percent REAL NOT NULL DEFAULT 15,
  rental_fee_cents INTEGER NOT NULL DEFAULT 0,
  customer_payment_status TEXT NOT NULL DEFAULT 'offen'
    CHECK (customer_payment_status IN ('offen','anzahlung','bezahlt')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_customer ON events(customer_id);
CREATE INDEX IF NOT EXISTS idx_events_dj ON events(dj_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);

CREATE TABLE IF NOT EXISTS questionnaire_responses (
  event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  current_step INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS music_wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('wunsch','mustplay','nogo','programm')),
  program_slot TEXT,
  spotify_id TEXT,
  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  image_url TEXT,
  preview_url TEXT,
  duration_ms INTEGER,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_music_event ON music_wishes(event_id);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'sonstiges',
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  description TEXT,
  visible_to_customer INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_event ON documents(event_id);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('update_call','final_meeting','site_visit','other')),
  title TEXT NOT NULL,
  scheduled_at TEXT,
  duration_min INTEGER NOT NULL DEFAULT 60,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'geplant' CHECK (status IN ('geplant','erledigt','abgesagt')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appointments_event ON appointments(event_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT,
  assignee_role TEXT NOT NULL DEFAULT 'customer' CHECK (assignee_role IN ('customer','dj','admin')),
  done_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_event ON tasks(event_id);

CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  dj_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payouts_dj ON payouts(dj_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.uploadDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  db = new Database(config.dbFile);
  db.exec(SCHEMA);
  try { fs.chmodSync(config.dbFile, 0o600); } catch { /* z.B. Windows */ }
  return db;
}

function closeDb() {
  if (db) { db.close(); db = null; }
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { getDb, closeDb, nowIso };
