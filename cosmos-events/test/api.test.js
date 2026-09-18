'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, client, getDb, DEMO_PASSWORD } = require('./helpers');
const crypto = require('../src/crypto');

before(async () => { await start(); });
after(async () => { await stop(); });

test('Krypto: Passwort-Hashing, AES-GCM und TOTP', () => {
  const h = crypto.hashPassword('Sehr-Sicher-1234');
  assert.ok(crypto.verifyPassword('Sehr-Sicher-1234', h));
  assert.ok(!crypto.verifyPassword('falsch', h));
  const enc = crypto.encryptString('geheim äöü');
  assert.equal(crypto.decryptString(enc), 'geheim äöü');
  const secret = crypto.generateTotpSecret();
  assert.ok(crypto.verifyTotp(secret, crypto.totpCode(secret)));
  assert.ok(!crypto.verifyTotp(secret, '000000') || crypto.totpCode(secret) === '000000');
  assert.ok(crypto.passwordPolicy('kurz'));
  assert.equal(crypto.passwordPolicy('LangesPasswort2026'), null);
});

test('Login: falsches Passwort, korrektes Passwort, /me', async () => {
  const c = client();
  let r = await c.login('lena.max@example.com', 'falsch');
  assert.equal(r.status, 401);
  r = await c.get('/api/auth/me');
  assert.equal(r.status, 401);
  r = await c.login('lena.max@example.com');
  assert.equal(r.status, 200);
  assert.equal(r.json.user.role, 'customer');
  r = await c.get('/api/auth/me');
  assert.equal(r.status, 200);
  assert.equal(r.json.user.email, 'lena.max@example.com');
});

test('CSRF: zustandsändernde Anfrage ohne gültigen Origin wird abgelehnt', async () => {
  const c = client();
  const r = await c.post('/api/auth/login', { email: 'x@y.de', password: 'x' }, { headers: { Origin: 'https://boese-seite.example' } });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'bad_origin');
});

test('Rollen: Kunde sieht nur eigenes Event, DJ nur zugewiesene, Admin alles', async () => {
  const cust = client(); await cust.login('lena.max@example.com');
  const dj = client(); await dj.login('dj.orbit@cosmos-events.de');
  const admin = client(); await admin.login('admin@cosmos-events.de');

  const ce = (await cust.get('/api/events')).json.events;
  assert.equal(ce.length, 1);
  assert.equal(ce[0].title, 'Hochzeit Lena & Max');
  assert.equal(ce[0].booking_value_cents, undefined, 'Kunde sieht keine Finanzdaten');
  assert.equal(ce[0].notes_internal, undefined, 'Kunde sieht keine internen Notizen');

  const de = (await dj.get('/api/events')).json.events;
  assert.deepEqual(de.map((e) => e.title).sort(), ['Geburtstag 40 – Privatfeier', 'Hochzeit Sara & Tom']);
  assert.ok(de[0].finance, 'DJ sieht Gagenberechnung');

  const ae = (await admin.get('/api/events')).json.events;
  assert.equal(ae.length, 4);

  // Fremdzugriff
  const foreignId = ce[0].id;
  assert.equal((await dj.get(`/api/events/${foreignId}`)).status, 403);
  assert.equal((await dj.get(`/api/questionnaire/${foreignId}`)).status, 403);
  assert.equal((await dj.get(`/api/documents/events/${foreignId}`)).status, 403);
  const saraEvent = de.find((e) => e.title === 'Hochzeit Sara & Tom').id;
  assert.equal((await cust.get(`/api/events/${saraEvent}`)).status, 403);
  assert.equal((await cust.get('/api/users')).status, 403);
  assert.equal((await dj.get('/api/admin/audit')).status, 403);
  assert.equal((await cust.get('/api/finance/dj')).status, 403);
  assert.equal((await cust.post('/api/events', { title: 'Hack' })).status, 403);
});

test('Fragebogen: speichern, fortsetzen, Fortschritt, Validierung, Abgabe', async () => {
  const cust = client(); await cust.login('sara.tom@example.com');
  const ev = (await cust.get('/api/events')).json.events[0];
  let r = await cust.get(`/api/questionnaire/${ev.id}`);
  assert.equal(r.status, 200);
  assert.ok(r.json.schema.sections.length >= 3);
  const before = r.json.completion.percent;

  r = await cust.put(`/api/questionnaire/${ev.id}`, { data: { age_range: 'Bunt gemischt', guest_count: 'abc', unbekannt: 'x' }, current_step: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.age_range, 'Bunt gemischt');
  assert.ok(r.json.errors.guest_count, 'ungültige Zahl wird gemeldet');
  assert.equal(r.json.data.unbekannt, undefined, 'unbekannte Felder werden verworfen');
  assert.ok(r.json.completion.percent > before);

  r = await cust.get(`/api/questionnaire/${ev.id}`);
  assert.equal(r.json.current_step, 1);
  assert.equal(r.json.data.couple_names, 'Sara & Tom', 'vorhandene Antworten bleiben erhalten');

  r = await cust.put(`/api/questionnaire/${ev.id}`, { submit: true });
  assert.equal(r.status, 400, 'Abgabe ohne alle Pflichtfelder scheitert');

  // DJ darf lesen, aber nicht schreiben
  const dj = client(); await dj.login('dj.orbit@cosmos-events.de');
  assert.equal((await dj.get(`/api/questionnaire/${ev.id}`)).status, 200);
  assert.equal((await dj.put(`/api/questionnaire/${ev.id}`, { data: { motto: 'x' } })).status, 403);
});

test('Fortschritt & Meilensteine: 0–100 %, finale Besprechung, Abschluss', async () => {
  const admin = client(); await admin.login('admin@cosmos-events.de');
  const events = (await admin.get('/api/events')).json.events;
  const done = events.find((e) => e.title === 'Sommerfest Müller GmbH');
  const fresh = events.find((e) => e.title === 'Geburtstag 40 – Privatfeier');
  const planning = events.find((e) => e.title === 'Hochzeit Lena & Max');
  assert.equal(done.progress, 100);
  assert.equal(fresh.progress, 0);
  assert.ok(planning.progress > 30 && planning.progress < 100);
  const p = (await admin.get(`/api/events/${planning.id}/progress`)).json.progress;
  assert.deepEqual(p.milestones.map((m) => m.id), ['questionnaire', 'music', 'update_call', 'final_meeting', 'completed']);
  assert.equal(p.milestones.find((m) => m.id === 'update_call').state, 'done');
  assert.equal(p.final_meeting_threshold, 80);
});

test('Musik: Kategorien, Programmpunkte, Export, Spotify nicht konfiguriert', async () => {
  const cust = client(); await cust.login('lena.max@example.com');
  const ev = (await cust.get('/api/events')).json.events[0];
  let r = await cust.post(`/api/music/events/${ev.id}`, { category: 'mustplay', title: 'Shut Up and Dance', artist: 'Walk the Moon', image_url: 'https://evil.example/x.png' });
  assert.equal(r.status, 201);
  r = await cust.post(`/api/music/events/${ev.id}`, { category: 'programm', title: 'X' });
  assert.equal(r.status, 400, 'Programmpunkt erforderlich');
  r = await cust.post(`/api/music/events/${ev.id}`, { category: 'programm', program_slot: 'Tortenanschnitt', title: 'Sugar', artist: 'Maroon 5' });
  assert.equal(r.status, 201);
  const list = (await cust.get(`/api/music/events/${ev.id}`)).json;
  assert.equal(list.spotify, false);
  assert.ok(list.program_slots.includes('Eröffnungstanz'));
  const added = list.wishes.find((w) => w.title === 'Shut Up and Dance');
  assert.equal(added.image_url, null, 'fremde Bild-URLs werden verworfen');
  r = await cust.get(`/api/music/events/${ev.id}/export.txt`);
  assert.equal(r.status, 200);
  assert.match(r.text, /MUST PLAYS/);
  r = await cust.get('/api/music/spotify/search?q=abba');
  assert.equal(r.status, 503);
  assert.equal(r.json.code, 'spotify_not_configured');
  assert.equal((await cust.del(`/api/music/events/${ev.id}/${added.id}`)).status, 200);
});

test('Dokumente: Upload verschlüsselt, Download nur mit Berechtigung, Typprüfung', async () => {
  const cust = client(); await cust.login('lena.max@example.com');
  const ev = (await cust.get('/api/events')).json.events[0];
  const pdf = Buffer.from('%PDF-1.4\n%Testdokument Ablaufplan\n%%EOF');
  let fd = new FormData();
  fd.append('category', 'ablaufplan');
  fd.append('description', 'Ablauf v1');
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'ablauf.pdf');
  let r = await cust.post(`/api/documents/events/${ev.id}`, fd);
  assert.equal(r.status, 201, r.text);
  const docId = r.json.id;

  // Verschlüsselt auf Platte?
  const fs = require('fs'); const path = require('path'); const config = require('../src/config');
  const stored = getDb().prepare('SELECT stored_name FROM documents WHERE id = ?').get(docId).stored_name;
  const raw = fs.readFileSync(path.join(config.uploadDir, stored));
  assert.ok(!raw.includes('Testdokument'), 'Datei liegt nicht im Klartext');
  assert.equal(raw.subarray(0, 4).toString(), 'CEV1');

  r = await cust.get(`/api/documents/events/${ev.id}/${docId}/download`);
  assert.equal(r.status, 200);
  assert.equal(r.text, pdf.toString());
  assert.match(r.headers.get('content-disposition'), /attachment/);

  // gefälschter Typ
  fd = new FormData();
  fd.append('file', new Blob([Buffer.from('MZ\x90\x00 nicht wirklich ein pdf')], { type: 'application/pdf' }), 'virus.pdf');
  r = await cust.post(`/api/documents/events/${ev.id}`, fd);
  assert.equal(r.status, 400);
  fd = new FormData();
  fd.append('file', new Blob([Buffer.from('x')], { type: 'application/x-msdownload' }), 'tool.exe');
  r = await cust.post(`/api/documents/events/${ev.id}`, fd);
  assert.equal(r.status, 400);

  // Fremder DJ hat keinen Zugriff, zugewiesener DJ schon
  const other = client(); await other.login('dj.orbit@cosmos-events.de');
  assert.equal((await other.get(`/api/documents/events/${ev.id}/${docId}/download`)).status, 403);
  const dj = client(); await dj.login('dj.nova@cosmos-events.de');
  assert.equal((await dj.get(`/api/documents/events/${ev.id}/${docId}/download`)).status, 200);
  // DJ-Upload nur intern sichtbar
  fd = new FormData();
  fd.append('category', 'aufbauplan'); fd.append('visible_to_customer', 'false');
  fd.append('file', new Blob([Buffer.from('Aufbau intern')], { type: 'text/plain' }), 'aufbau.txt');
  r = await dj.post(`/api/documents/events/${ev.id}`, fd);
  assert.equal(r.status, 201);
  const custDocs = (await cust.get(`/api/documents/events/${ev.id}`)).json.documents;
  assert.ok(!custDocs.some((d) => d.original_name === 'aufbau.txt'));
  const djDocs = (await dj.get(`/api/documents/events/${ev.id}`)).json.documents;
  assert.ok(djDocs.some((d) => d.original_name === 'aufbau.txt'));
});

test('Termine & Aufgaben: Timeline, Kalender, Rechte', async () => {
  const cust = client(); await cust.login('lena.max@example.com');
  const dj = client(); await dj.login('dj.nova@cosmos-events.de');
  const ev = (await cust.get('/api/events')).json.events[0];
  let r = await cust.get(`/api/schedule/events/${ev.id}/timeline`);
  assert.equal(r.status, 200);
  assert.ok(r.json.items.some((i) => i.type === 'event_day'));
  const finalMeeting = r.json.appointments.find((a) => a.kind === 'final_meeting');
  // Kunde darf nicht als erledigt markieren
  assert.equal((await cust.patch(`/api/schedule/events/${ev.id}/appointments/${finalMeeting.id}`, { status: 'erledigt' })).status, 403);
  assert.equal((await dj.patch(`/api/schedule/events/${ev.id}/appointments/${finalMeeting.id}`, { status: 'erledigt' })).status, 200);
  const p = (await dj.get(`/api/events/${ev.id}/progress`)).json.progress;
  assert.equal(p.milestones.find((m) => m.id === 'final_meeting').state, 'done');
  r = await cust.post(`/api/schedule/events/${ev.id}/tasks`, { title: 'Sitzplan finalisieren', due_date: '2030-01-01' });
  assert.equal(r.status, 201);
  assert.equal((await cust.patch(`/api/schedule/events/${ev.id}/tasks/${r.json.id}`, { done: true })).status, 200);
  r = await dj.get('/api/schedule/calendar');
  assert.equal(r.status, 200);
  assert.equal(r.json.events.length, 2);
});

test('Finanzen: Gagenberechnung und Kennzahlen für DJ', async () => {
  const dj = client(); await dj.login('dj.nova@cosmos-events.de');
  const r = await dj.get('/api/finance/dj');
  assert.equal(r.status, 200);
  const k = r.json.kpis;
  assert.equal(k.event_count, 2);
  assert.equal(k.total_booking_cents, 249000 + 320000);
  // Sommerfest: 3200 − 15 % (480) − 400 Leih = 2320 → ausgezahlt 2320; Hochzeit: 2490 − 373,5 − 150 = 1966,5 → 1966 (gerundet), ausgezahlt 1000
  const fest = r.json.events.find((e) => e.title === 'Sommerfest Müller GmbH');
  assert.equal(fest.commission_cents, 48000);
  assert.equal(fest.dj_fee_cents, 232000);
  assert.equal(fest.open_cents, 0);
  const hz = r.json.events.find((e) => e.title === 'Hochzeit Lena & Max');
  assert.equal(hz.dj_fee_cents, 249000 - 37350 - 15000);
  assert.equal(hz.open_cents, hz.dj_fee_cents - 100000);
  assert.equal(k.paid_out_cents, 332000);
  assert.equal(k.open_cents, hz.open_cents);
  // DJ darf keine Auszahlung anlegen
  assert.equal((await dj.post(`/api/finance/events/${hz.id}/payouts`, { amount_cents: 100 })).status, 403);
  const admin = client(); await admin.login('admin@cosmos-events.de');
  assert.equal((await admin.post(`/api/finance/events/${hz.id}/payouts`, { amount_cents: 50000, paid_at: '2026-01-01' })).status, 201);
  const after = (await dj.get('/api/finance/dj')).json.kpis;
  assert.equal(after.paid_out_cents, 382000);
  assert.equal((await admin.get('/api/finance/overview')).status, 200);
});

test('Admin: Nutzer anlegen, Passwort-Erstwechsel erzwungen, Event anlegen, Anonymisierung', async () => {
  const admin = client(); await admin.login('admin@cosmos-events.de');
  let r = await admin.post('/api/users', { email: 'neu@example.com', name: 'Neue Kundin', role: 'customer' });
  assert.equal(r.status, 201);
  const pw = r.json.initial_password;
  const nu = client();
  r = await nu.login('neu@example.com', pw);
  assert.equal(r.status, 200);
  assert.equal(r.json.user.must_change_password, true);
  r = await nu.get('/api/events');
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'password_change_required');
  r = await nu.post('/api/account/password', { current_password: pw, new_password: 'MeinNeuesPasswort2026' });
  assert.equal(r.status, 200);
  assert.equal((await nu.get('/api/events')).status, 200);

  r = await admin.post('/api/events', { title: 'Testevent', event_date: '2030-06-01', customer_id: (await admin.get('/api/users?role=customer')).json.users.find((u) => u.email === 'neu@example.com').id, booking_value_cents: 100000 });
  assert.equal(r.status, 201);
  const evId = r.json.id;
  const detail = (await admin.get(`/api/events/${evId}`)).json.event;
  assert.equal(detail.appointments.length, 2, 'Update-Gespräch und finale Besprechung werden angelegt');
  assert.equal(detail.tasks.length, 3);
  assert.equal((await nu.get('/api/events')).json.events.length, 1);

  // Datenexport
  r = await nu.get('/api/account/export');
  assert.equal(r.status, 200);
  assert.equal(r.json.user.email, 'neu@example.com');
  assert.equal(r.json.events[0].booking_value_cents, undefined);

  // Löschantrag & Anonymisierung
  assert.equal((await nu.post('/api/account/deletion-request')).status, 200);
  const uid = r.json.user.id;
  assert.equal((await admin.post(`/api/users/${uid}/anonymize`)).status, 200);
  assert.equal((await nu.get('/api/auth/me')).status, 401, 'Sitzung nach Anonymisierung ungültig');
  const row = getDb().prepare('SELECT email, name FROM users WHERE id = ?').get(uid);
  assert.equal(row.name, 'Gelöschter Nutzer');
  assert.ok(row.email.startsWith('anonym-'));
  assert.equal((await admin.login('admin@cosmos-events.de')).status, 200);
  assert.ok((await admin.get('/api/admin/audit')).json.entries.some((e) => e.action === 'user.anonymized'));
});

test('2FA: Einrichtung, Login mit Code, Wiederherstellungscode, Pflicht für Admin', async () => {
  const config = require('../src/config');
  config.require2faRoles = ['admin'];
  const admin = client(); await admin.login('admin@cosmos-events.de');
  let r = await admin.get('/api/events');
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'totp_setup_required', 'Admin ohne 2FA wird zur Einrichtung gezwungen');
  r = await admin.post('/api/account/2fa/setup');
  assert.equal(r.status, 200);
  assert.ok(r.json.qr.startsWith('data:image/png'));
  const secret = r.json.secret;
  r = await admin.post('/api/account/2fa/enable', { code: '123456' });
  assert.equal(r.status, 400);
  r = await admin.post('/api/account/2fa/enable', { code: crypto.totpCode(secret) });
  assert.equal(r.status, 200);
  assert.equal(r.json.recovery_codes.length, 8);
  const recovery = r.json.recovery_codes[0];
  assert.equal((await admin.get('/api/events')).status, 200);

  const c2 = client();
  r = await c2.login('admin@cosmos-events.de');
  assert.equal(r.status, 200);
  assert.equal(r.json.requires_2fa, true);
  assert.equal((await c2.get('/api/events')).status, 401, 'ohne 2FA kein Zugriff');
  assert.equal((await c2.post('/api/auth/2fa', { code: '000000' })).status, 401);
  r = await c2.post('/api/auth/2fa', { code: crypto.totpCode(secret) });
  assert.equal(r.status, 200);
  assert.equal((await c2.get('/api/events')).status, 200);

  const c3 = client();
  await c3.login('admin@cosmos-events.de');
  assert.equal((await c3.post('/api/auth/2fa', { code: recovery })).status, 200);
  const c4 = client();
  await c4.login('admin@cosmos-events.de');
  assert.equal((await c4.post('/api/auth/2fa', { code: recovery })).status, 401, 'Wiederherstellungscode nur einmal nutzbar');
  // Für Admin nicht deaktivierbar
  r = await c2.post('/api/account/2fa/disable', { password: DEMO_PASSWORD, code: crypto.totpCode(secret) });
  assert.equal(r.status, 400);
});

test('Brute-Force: Konto wird nach zu vielen Fehlversuchen gesperrt', async () => {
  // Rate-Limit pro IP würde vorher greifen (10/15min) – daher direkt die Kontosperre prüfen.
  const db = getDb();
  db.prepare('UPDATE users SET failed_attempts = 7 WHERE email = ?').run('sara.tom@example.com');
  const c = client();
  let r = await c.login('sara.tom@example.com', 'falsch');
  assert.equal(r.status, 401);
  r = await c.login('sara.tom@example.com');
  assert.equal(r.status, 423, 'gesperrt trotz korrektem Passwort');
  db.prepare('UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE email = ?').run('sara.tom@example.com');
  assert.equal((await c.login('sara.tom@example.com')).status, 200);
});

test('Backup: verschlüsselt erstellen und wiederherstellen', async () => {
  const backup = require('../src/backup');
  const fs = require('fs'); const path = require('path'); const os = require('os');
  const file = await backup.createBackup('test');
  assert.ok(fs.existsSync(file));
  assert.equal(fs.readFileSync(file).subarray(0, 4).toString(), 'CEV1');
  const dest = path.join(os.tmpdir(), `restore-${Date.now()}.sqlite`);
  await backup.restoreBackup(path.basename(file), dest);
  const Database = require('better-sqlite3');
  const d = new Database(dest, { readonly: true });
  assert.ok(d.prepare('SELECT COUNT(*) n FROM events').get().n >= 4);
  d.close(); fs.unlinkSync(dest);
  assert.ok(backup.listBackups().length >= 1);
});
