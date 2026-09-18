#!/usr/bin/env node
'use strict';
// Backup entschlüsseln: node scripts/restore.js <backup-datei> <ziel.sqlite>
// Danach den Server stoppen, data/cosmos.sqlite durch die Zieldatei ersetzen und neu starten.
const { restoreBackup } = require('../src/backup');
const [file, dest] = process.argv.slice(2);
if (!file || !dest) { console.error('Nutzung: node scripts/restore.js <backup-datei> <ziel.sqlite>'); process.exit(1); }
restoreBackup(file, dest).then((d) => { console.log('Wiederhergestellt nach', d); process.exit(0); })
  .catch((e) => { console.error('Fehler:', e.message); process.exit(1); });
