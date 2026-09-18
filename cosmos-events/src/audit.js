'use strict';
const { getDb } = require('./db');

function audit(req, action, entity = null, entityId = null, details = null) {
  try {
    getDb().prepare(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?)'
    ).run(
      req && req.user ? req.user.id : null,
      action,
      entity,
      entityId,
      details ? JSON.stringify(details).slice(0, 2000) : null,
      req ? req.ip : null
    );
  } catch (e) {
    console.error('[audit] Fehler:', e.message);
  }
}

module.exports = { audit };
