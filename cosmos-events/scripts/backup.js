#!/usr/bin/env node
'use strict';
// Manuelles Backup: node scripts/backup.js
const { createBackup } = require('../src/backup');
createBackup('cli').then((f) => { console.log('Backup erstellt:', f); process.exit(0); })
  .catch((e) => { console.error('Backup fehlgeschlagen:', e.message); process.exit(1); });
