'use strict';
// Demo-Daten für lokale Entwicklung: npm run seed
// Legt Admin, zwei DJs und drei Kunden mit Events an (Passwort für alle: siehe Ausgabe).
const { getDb } = require('./db');
const { hashPassword } = require('./crypto');
const { getDataKey } = require('./crypto');

const DEMO_PASSWORD = 'CosmosDemo2026!';

function seed({ log = console.log } = {}) {
  const db = getDb();
  getDataKey();
  const hash = hashPassword(DEMO_PASSWORD);
  const upsertUser = db.prepare(`INSERT INTO users (email, password_hash, role, name, phone) VALUES (?,?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET name = excluded.name RETURNING id`);
  const admin = upsertUser.get('admin@cosmos-events.de', hash, 'admin', 'Sebastian (Cosmos Events)', '+49 170 0000000').id;
  const dj1 = upsertUser.get('dj.nova@cosmos-events.de', hash, 'dj', 'DJ Nova', '+49 171 1111111').id;
  const dj2 = upsertUser.get('dj.orbit@cosmos-events.de', hash, 'dj', 'DJ Orbit', '+49 172 2222222').id;
  const c1 = upsertUser.get('lena.max@example.com', hash, 'customer', 'Lena & Max Berger', '+49 173 3333333').id;
  const c2 = upsertUser.get('sara.tom@example.com', hash, 'customer', 'Sara & Tom Weber', '+49 174 4444444').id;
  const c3 = upsertUser.get('firma.mueller@example.com', hash, 'customer', 'Müller GmbH (Sommerfest)', '+49 175 5555555').id;

  if (db.prepare('SELECT COUNT(*) n FROM events').get().n > 0) { log('Events existieren bereits – Seed übersprungen.'); return; }

  const y = new Date().getFullYear();
  const ins = db.prepare(`INSERT INTO events (title, event_type, status, event_date, start_time, end_time, customer_id, dj_id, location_name, location_address,
    guest_count, contract_number, contract_signed_at, booking_value_cents, commission_percent, rental_fee_cents, customer_payment_status, notes_internal, notes_customer)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const e1 = ins.run('Hochzeit Lena & Max', 'Hochzeit', 'planung', `${y}-10-24`, '18:00', '03:00', c1, dj1, 'Gut Sonnenhof', 'Sonnenhofweg 3, 82319 Starnberg', 110, `CE-${y}-014`, `${y}-02-11`, 249000, 15, 15000, 'anzahlung', 'Anfahrt ca. 45 min. Lichtpaket gebucht.', 'Wir freuen uns riesig auf euren Tag!').lastInsertRowid;
  const e2 = ins.run('Hochzeit Sara & Tom', 'Hochzeit', 'gebucht', `${y + 1}-05-16`, '17:00', '02:00', c2, dj2, 'Alte Brauerei Loft', 'Brauereistraße 12, 80339 München', 80, `CE-${y}-031`, `${y}-06-02`, 199000, 15, 0, 'offen', null, null).lastInsertRowid;
  const e3 = ins.run('Sommerfest Müller GmbH', 'Firmenfeier', 'abgeschlossen', `${y}-07-12`, '16:00', '00:00', c3, dj1, 'Firmengelände Müller', 'Industriestraße 8, 85748 Garching', 250, `CE-${y}-009`, `${y}-01-20`, 320000, 15, 40000, 'bezahlt', null, null).lastInsertRowid;
  const e4 = ins.run('Geburtstag 40 – Privatfeier', 'Geburtstag', 'gebucht', `${y}-11-08`, '19:00', '02:00', null, dj2, 'Weinhaus am See', 'Seestraße 1, 82211 Herrsching', 60, null, null, 120000, 15, 0, 'offen', 'Kunde noch ohne Login.', null).lastInsertRowid;

  const qr = db.prepare('INSERT INTO questionnaire_responses (event_id, data, current_step, submitted_at) VALUES (?,?,?,?)');
  qr.run(e1, JSON.stringify({ couple_names: 'Lena & Max', guest_count: 110, age_range: 'Bunt gemischt', motto: 'Boho', languages: ['Deutsch', 'Englisch'],
    venue_contact: 'Frau Huber, 08151 123456', indoor_outdoor: 'Beides', power: 'Ja', setup_time: '14:00', dinner_time: '19:00', party_start: '21:30', party_end: '03:00',
    dj_ceremony: 'Ja', first_dance: 'Ja', first_dance_style: 'Langsamer Walzer', genres: ['Charts / Pop', 'House / Deep House', '90er'], guest_wishes: 'Ja, aber DJ entscheidet', mic_talk: 'Nur das Nötigste' }), 4, null);
  qr.run(e2, JSON.stringify({ couple_names: 'Sara & Tom', guest_count: 80 }), 0, null);
  qr.run(e3, JSON.stringify({ couple_names: 'Müller GmbH', guest_count: 250, age_range: 'Überwiegend 30–50', venue_contact: 'Herr Müller', indoor_outdoor: 'Draußen', power: 'Ja', setup_time: '12:00',
    dinner_time: '18:00', party_start: '20:00', party_end: '00:00', dj_ceremony: 'Nein', first_dance: 'Nein', genres: ['Charts / Pop', '80er', 'Schlager / Party'], guest_wishes: 'Ja, gerne', mic_talk: 'Ja, aktiv', emergency_contact: 'Herr Müller, 0170 999', privacy_consent: true }), 5, `${y}-06-01T10:00:00.000Z`);
  qr.run(e4, '{}', 0, null);

  const mw = db.prepare('INSERT INTO music_wishes (event_id, category, program_slot, title, artist, note, created_by) VALUES (?,?,?,?,?,?,?)');
  const songs1 = [
    ['programm', 'Einzug', 'A Thousand Years', 'Christina Perri', null],
    ['programm', 'Eröffnungstanz', 'Perfect', 'Ed Sheeran', 'Walzer-Version'],
    ['mustplay', null, 'Dancing Queen', 'ABBA', null], ['mustplay', null, 'Mr. Brightside', 'The Killers', null],
    ['mustplay', null, 'Blinding Lights', 'The Weeknd', null], ['mustplay', null, 'September', 'Earth, Wind & Fire', null],
    ['wunsch', null, 'Levels', 'Avicii', null], ['wunsch', null, 'Freed from Desire', 'Gala', 'Für die Fußballer'],
    ['nogo', null, 'Atemlos durch die Nacht', 'Helene Fischer', 'Bitte gar nicht'], ['nogo', null, 'Layla', 'DJ Robin & Schürze', null],
  ];
  for (const s of songs1) mw.run(e1, s[0], s[1], s[2], s[3], s[4], c1);
  for (const s of [['mustplay', null, 'Uptown Funk', 'Bruno Mars', null], ['mustplay', null, 'Ein Kompliment', 'Sportfreunde Stiller', null], ['programm', 'Letzter Song', 'Angels', 'Robbie Williams', null]]) mw.run(e3, s[0], s[1], s[2], s[3], s[4], c3);

  const ap = db.prepare('INSERT INTO appointments (event_id, kind, title, scheduled_at, status, location, notes, created_by) VALUES (?,?,?,?,?,?,?,?)');
  ap.run(e1, 'update_call', 'Update-Gespräch', `${y}-08-20T18:30`, 'erledigt', 'Telefon', 'Ablauf grob besprochen, Lichtpaket ergänzt.', admin);
  ap.run(e1, 'final_meeting', 'Finale Besprechung', `${y}-10-10T18:00`, 'geplant', 'Video-Call', 'Empfohlen bei ca. 80 % Planungsfortschritt.', admin);
  ap.run(e1, 'site_visit', 'Location-Besichtigung', `${y}-09-14T15:00`, 'erledigt', 'Gut Sonnenhof', null, dj1);
  ap.run(e2, 'update_call', 'Update-Gespräch', null, 'geplant', null, null, admin);
  ap.run(e2, 'final_meeting', 'Finale Besprechung', null, 'geplant', null, 'Empfohlen bei ca. 80 % Planungsfortschritt.', admin);
  ap.run(e3, 'update_call', 'Update-Gespräch', `${y}-05-05T17:00`, 'erledigt', 'Telefon', null, admin);
  ap.run(e3, 'final_meeting', 'Finale Besprechung', `${y}-06-28T17:00`, 'erledigt', 'Vor Ort', null, admin);
  ap.run(e4, 'update_call', 'Update-Gespräch', null, 'geplant', null, null, admin);
  ap.run(e4, 'final_meeting', 'Finale Besprechung', null, 'geplant', null, null, admin);

  const tk = db.prepare('INSERT INTO tasks (event_id, title, due_date, assignee_role, done_at, created_by) VALUES (?,?,?,?,?,?)');
  tk.run(e1, 'Fragebogen ausfüllen', `${y}-08-25`, 'customer', null, admin);
  tk.run(e1, 'Musikwünsche & Must-Plays eintragen', `${y}-10-03`, 'customer', null, admin);
  tk.run(e1, 'Ablaufplan hochladen', `${y}-10-03`, 'customer', null, admin);
  tk.run(e1, 'Technik-Check mit Location', `${y}-10-15`, 'dj', null, admin);
  tk.run(e2, 'Fragebogen ausfüllen', `${y + 1}-03-17`, 'customer', null, admin);
  tk.run(e2, 'Musikwünsche & Must-Plays eintragen', `${y + 1}-04-25`, 'customer', null, admin);
  tk.run(e3, 'Fragebogen ausfüllen', `${y}-05-13`, 'customer', `${y}-05-10T09:00:00.000Z`, admin);

  const po = db.prepare('INSERT INTO payouts (event_id, dj_id, amount_cents, paid_at, note, created_by) VALUES (?,?,?,?,?,?)');
  po.run(e3, dj1, 232000, `${y}-07-20`, 'Gage Sommerfest', admin);
  po.run(e1, dj1, 100000, `${y}-03-01`, 'Abschlag', admin);

  log(`Demo-Daten angelegt. Passwort für alle Demo-Konten: ${DEMO_PASSWORD}`);
  log('Admin: admin@cosmos-events.de | DJ: dj.nova@cosmos-events.de, dj.orbit@cosmos-events.de | Kunde: lena.max@example.com, sara.tom@example.com, firma.mueller@example.com');
}

if (require.main === module) seed();
module.exports = { seed, DEMO_PASSWORD };
