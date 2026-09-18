'use strict';
// Sitzungen, Authentifizierung und rollenbasierte Zugriffskontrolle.
const config = require('./config');
const { getDb, nowIso } = require('./db');
const { randomToken, sha256 } = require('./crypto');

const SESSION_MS = config.sessionHours * 3600 * 1000;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token, maxAgeMs) {
  const parts = [
    `${config.cookieName}=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'SameSite=Strict',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (config.cookieSecure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${config.cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (config.cookieSecure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function createSession(res, req, user, pending2fa) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + (pending2fa ? 10 * 60 * 1000 : SESSION_MS));
  getDb().prepare(
    'INSERT INTO sessions (user_id, token_hash, pending_2fa, ip, user_agent, expires_at) VALUES (?,?,?,?,?,?)'
  ).run(user.id, sha256(token), pending2fa ? 1 : 0, req.ip, String(req.get('user-agent') || '').slice(0, 300), expires.toISOString());
  setSessionCookie(res, token, expires.getTime() - Date.now());
  return token;
}

function destroySession(req, res) {
  if (req.sessionId) getDb().prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
  clearSessionCookie(res);
}

function destroyAllSessions(userId, exceptSessionId = null) {
  if (exceptSessionId) {
    getDb().prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptSessionId);
  } else {
    getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

const USER_COLUMNS = 'id, email, role, name, phone, active, totp_enabled, must_change_password, last_login_at, created_at, deletion_requested_at, anonymized_at';

// Lädt die Sitzung (falls vorhanden) und hängt req.user an.
function sessionMiddleware(req, res, next) {
  req.user = null;
  req.sessionId = null;
  req.sessionPending2fa = false;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[config.cookieName];
  if (!token) return next();
  const db = getDb();
  const row = db.prepare(
    `SELECT s.id AS session_id, s.pending_2fa, s.expires_at, s.last_seen_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  ).get(sha256(token));
  if (!row) { clearSessionCookie(res); return next(); }
  if (new Date(row.expires_at).getTime() < Date.now() || !row.active || row.anonymized_at) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    clearSessionCookie(res);
    return next();
  }
  req.sessionId = row.session_id;
  req.sessionPending2fa = row.pending_2fa === 1;
  req.user = {
    id: row.id, email: row.email, role: row.role, name: row.name, phone: row.phone,
    active: row.active === 1, totp_enabled: row.totp_enabled === 1,
    must_change_password: row.must_change_password === 1,
    last_login_at: row.last_login_at, created_at: row.created_at,
    deletion_requested_at: row.deletion_requested_at,
  };
  // Aktivität selten aktualisieren (max. einmal pro Minute)
  if (Date.now() - new Date(row.last_seen_at + 'Z').getTime() > 60_000) {
    db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?").run(row.session_id);
  }
  next();
}

function requiresTotpSetup(user) {
  return config.require2faRoles.includes(user.role) && !user.totp_enabled;
}

const ALWAYS_ALLOWED = ['/api/auth/me', '/api/auth/logout'];
function requireAuth(req, res, next) {
  if (!req.user || req.sessionPending2fa) {
    return res.status(401).json({ error: 'Nicht angemeldet', code: 'unauthenticated' });
  }
  const p = (req.baseUrl || '') + req.path;
  const allowed = ALWAYS_ALLOWED.includes(p);
  if (requiresTotpSetup(req.user) && !allowed && !p.startsWith('/api/account/2fa')) {
    return res.status(403).json({ error: 'Zwei-Faktor-Authentifizierung muss eingerichtet werden.', code: 'totp_setup_required' });
  }
  if (req.user.must_change_password && !allowed && !p.startsWith('/api/account/password') && !p.startsWith('/api/account/2fa')) {
    return res.status(403).json({ error: 'Bitte zuerst das Passwort ändern.', code: 'password_change_required' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Keine Berechtigung', code: 'forbidden' });
    }
    next();
  };
}

// Lädt ein Event und prüft, ob der angemeldete Nutzer darauf zugreifen darf.
function loadEventForUser(eventId, user) {
  const id = Number(eventId);
  if (!Number.isInteger(id)) return null;
  const ev = getDb().prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev) return null;
  if (user.role === 'admin') return ev;
  if (user.role === 'dj' && ev.dj_id === user.id) return ev;
  if (user.role === 'customer' && ev.customer_id === user.id) return ev;
  return undefined; // existiert, aber kein Zugriff
}

function requireEventAccess(param = 'eventId') {
  return (req, res, next) => {
    const ev = loadEventForUser(req.params[param], req.user);
    if (ev === null) return res.status(404).json({ error: 'Event nicht gefunden' });
    if (ev === undefined) return res.status(403).json({ error: 'Kein Zugriff auf dieses Event', code: 'forbidden' });
    req.event = ev;
    next();
  };
}

function cleanupSessions() {
  getDb().prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowIso());
}

module.exports = {
  sessionMiddleware, requireAuth, requireRole, requireEventAccess, loadEventForUser,
  createSession, destroySession, destroyAllSessions, cleanupSessions, requiresTotpSetup, USER_COLUMNS,
};
