'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { sessionMiddleware, requireAuth, requireRole } = require('./auth');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // Sicherheits-Header (CSP, HSTS, nosniff, frameguard, Referrer-Policy ...)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://i.scdn.co', 'https://*.scdn.co', 'https://*.spotifycdn.com'],
        mediaSrc: ["'self'", 'https://p.scdn.co', 'https://*.scdn.co'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    hsts: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }));

  // CSRF-Schutz: SameSite=Strict-Cookie + Origin-Prüfung für zustandsändernde Anfragen
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin') || (req.get('referer') ? new URL(req.get('referer')).origin : null);
    const host = req.get('host');
    const allowed = new Set(config.origins);
    if (host) { allowed.add(`https://${host}`); if (!config.isProd) allowed.add(`http://${host}`); }
    if (!origin || !allowed.has(origin)) {
      return res.status(403).json({ error: 'Ungültige Anfrage-Herkunft (CSRF-Schutz).', code: 'bad_origin' });
    }
    next();
  });

  app.use('/api', rateLimit({ skip: () => config.isTest, windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Zu viele Anfragen.', code: 'rate_limited' } }));
  app.use('/api', express.json({ limit: '1mb' }));
  app.use('/api', sessionMiddleware);
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const auth = require('./routes/auth.routes');
  app.use('/api/auth', auth.router);
  app.use('/api/account', requireAuth, require('./routes/account.routes'));
  app.use('/api/users', requireAuth, requireRole('admin'), require('./routes/users.routes'));
  app.use('/api/events', requireAuth, require('./routes/events.routes').router);
  app.use('/api/questionnaire', requireAuth, require('./routes/questionnaire.routes'));
  app.use('/api/music', requireAuth, require('./routes/music.routes'));
  app.use('/api/documents', requireAuth, require('./routes/documents.routes'));
  app.use('/api/schedule', requireAuth, require('./routes/schedule.routes'));
  app.use('/api/finance', requireAuth, require('./routes/finance.routes'));
  app.use('/api/admin', requireAuth, requireRole('admin'), require('./routes/admin.routes'));

  // Admin-Zugriff auf die Fragebogenübersicht zur Vollständigkeit; Meta-Endpunkt
  app.get('/api/meta', (req, res) => res.json({ name: 'Cosmos Events Dashboard', version: require('../package.json').version }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpunkt nicht gefunden' }));

  // Frontend (Single-Page-App)
  const pub = path.join(__dirname, '..', 'public');
  app.use(express.static(pub, { index: 'index.html', maxAge: config.isProd ? '1h' : 0, etag: true }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(pub, 'index.html')));

  // Fehlerbehandlung ohne Stacktrace-Leak
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültiges JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Anfrage zu groß' });
    console.error('[error]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Interner Serverfehler' });
  });

  return app;
}

module.exports = { createApp };
