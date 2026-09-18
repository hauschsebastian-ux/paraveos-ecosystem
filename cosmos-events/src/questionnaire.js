'use strict';
// Fragebogen-Schema. Der finale Fragebogen wird separat geliefert und kann als
// JSON-Datei (config/questionnaire.json) hinterlegt werden – ohne Codeänderung.
const fs = require('fs');
const config = require('./config');

const DEFAULT_SCHEMA = {
  version: 1,
  title: 'Eventplanung',
  sections: [
    {
      id: 'basics', title: 'Eckdaten', icon: '📋',
      description: 'Die wichtigsten Rahmendaten eures Tages.',
      fields: [
        { id: 'couple_names', label: 'Namen des Brautpaars / der Gastgeber', type: 'text', required: true },
        { id: 'guest_count', label: 'Erwartete Gästezahl', type: 'number', required: true, min: 1, max: 5000 },
        { id: 'age_range', label: 'Altersstruktur der Gäste', type: 'select', required: true,
          options: ['Überwiegend 18–30', 'Überwiegend 30–50', 'Überwiegend 50+', 'Bunt gemischt'] },
        { id: 'motto', label: 'Motto / Stil der Feier', type: 'text', required: false, help: 'z. B. Boho, Vintage, Elegant, Festival' },
        { id: 'languages', label: 'Sprachen der Gäste', type: 'multiselect', required: false,
          options: ['Deutsch', 'Englisch', 'Türkisch', 'Italienisch', 'Spanisch', 'Polnisch', 'Andere'] },
      ],
    },
    {
      id: 'location', title: 'Location & Technik', icon: '📍',
      description: 'Damit wir Aufbau und Technik perfekt planen können.',
      fields: [
        { id: 'venue_contact', label: 'Ansprechpartner der Location (Name, Telefon)', type: 'text', required: true },
        { id: 'indoor_outdoor', label: 'Findet die Party drinnen oder draußen statt?', type: 'radio', required: true,
          options: ['Drinnen', 'Draußen', 'Beides'] },
        { id: 'power', label: 'Stromanschluss in der Nähe der DJ-Fläche vorhanden?', type: 'radio', required: true,
          options: ['Ja', 'Nein', 'Unbekannt'] },
        { id: 'setup_time', label: 'Ab wann kann aufgebaut werden?', type: 'time', required: true },
        { id: 'noise_limit', label: 'Gibt es Lautstärke- oder Sperrzeitauflagen?', type: 'textarea', required: false },
        { id: 'venue_tech', label: 'Vorhandene Technik in der Location', type: 'multiselect', required: false,
          options: ['PA-Anlage', 'Lichttechnik', 'Beamer/Leinwand', 'Mikrofone', 'Nichts davon'] },
      ],
    },
    {
      id: 'schedule', title: 'Ablauf', icon: '🕒',
      description: 'Der grobe Zeitplan des Tages.',
      fields: [
        { id: 'ceremony_time', label: 'Beginn Trauung / Empfang', type: 'time', required: false },
        { id: 'dinner_time', label: 'Beginn Essen', type: 'time', required: true },
        { id: 'party_start', label: 'Partystart', type: 'time', required: true },
        { id: 'party_end', label: 'Geplantes Ende', type: 'time', required: true },
        { id: 'dj_ceremony', label: 'Soll der DJ auch die Trauung / den Empfang beschallen?', type: 'radio', required: true,
          options: ['Ja', 'Nein', 'Noch offen'] },
        { id: 'program_items', label: 'Programmpunkte (Reden, Spiele, Überraschungen)', type: 'textarea', required: false,
          help: 'Bitte mit ungefährer Uhrzeit.' },
      ],
    },
    {
      id: 'moments', title: 'Besondere Momente', icon: '✨',
      description: 'Die Highlights, die Musik brauchen.',
      fields: [
        { id: 'first_dance', label: 'Gibt es einen Eröffnungstanz?', type: 'radio', required: true, options: ['Ja', 'Nein'] },
        { id: 'first_dance_style', label: 'Tanzstil / Choreografie', type: 'text', required: false, showIf: { field: 'first_dance', equals: 'Ja' } },
        { id: 'bouquet', label: 'Brautstraußwurf', type: 'radio', required: false, options: ['Ja', 'Nein'] },
        { id: 'cake', label: 'Anschnitt der Hochzeitstorte (Uhrzeit)', type: 'time', required: false },
        { id: 'special_requests', label: 'Weitere besondere Momente', type: 'textarea', required: false },
      ],
    },
    {
      id: 'music_taste', title: 'Musikgeschmack', icon: '🎧',
      description: 'Die konkreten Songs wählt ihr im Bereich „Musik“ aus – hier geht es um die Richtung.',
      fields: [
        { id: 'genres', label: 'Welche Genres dürfen auf keinen Fall fehlen?', type: 'multiselect', required: true,
          options: ['Charts / Pop', 'House / Deep House', 'Hip-Hop / R&B', '80er', '90er', '2000er', 'Rock', 'Schlager / Party', 'Latin / Reggaeton', 'Techno', 'Soul / Funk', 'Indie'] },
        { id: 'genres_avoid', label: 'Welche Genres bitte nicht?', type: 'multiselect', required: false,
          options: ['Charts / Pop', 'House / Deep House', 'Hip-Hop / R&B', '80er', '90er', '2000er', 'Rock', 'Schlager / Party', 'Latin / Reggaeton', 'Techno', 'Soul / Funk', 'Indie'] },
        { id: 'guest_wishes', label: 'Dürfen Gäste Musikwünsche äußern?', type: 'radio', required: true,
          options: ['Ja, gerne', 'Ja, aber DJ entscheidet', 'Nein'] },
        { id: 'mic_talk', label: 'Soll der DJ moderieren / Ansagen machen?', type: 'radio', required: true,
          options: ['Ja, aktiv', 'Nur das Nötigste', 'Nein'] },
        { id: 'dinner_music', label: 'Musikstil während des Essens', type: 'text', required: false },
      ],
    },
    {
      id: 'final', title: 'Abschluss', icon: '✅',
      description: 'Letzte Hinweise und Freigabe.',
      fields: [
        { id: 'emergency_contact', label: 'Notfallkontakt am Eventtag (Name, Telefon)', type: 'text', required: true,
          help: 'Eine Person, die am Tag selbst erreichbar ist, wenn ihr es nicht seid.' },
        { id: 'catering_dj', label: 'Verpflegung für den DJ vorgesehen?', type: 'radio', required: false, options: ['Ja', 'Nein'] },
        { id: 'anything_else', label: 'Gibt es sonst noch etwas, das wir wissen sollten?', type: 'textarea', required: false },
        { id: 'privacy_consent', label: 'Ich bin damit einverstanden, dass die Angaben zur Planung meines Events verarbeitet und an den zuständigen DJ weitergegeben werden.', type: 'boolean', required: true },
      ],
    },
  ],
};

let cached = null;
function getSchema() {
  if (cached) return cached;
  if (fs.existsSync(config.questionnaireFile)) {
    try {
      cached = JSON.parse(fs.readFileSync(config.questionnaireFile, 'utf8'));
      if (!Array.isArray(cached.sections)) throw new Error('sections fehlt');
      return cached;
    } catch (e) {
      console.error(`[questionnaire] ${config.questionnaireFile} ungültig, nutze Standard: ${e.message}`);
    }
  }
  cached = DEFAULT_SCHEMA;
  return cached;
}

function isVisible(field, data) {
  if (!field.showIf) return true;
  const v = data[field.showIf.field];
  if (Array.isArray(v)) return v.includes(field.showIf.equals);
  return v === field.showIf.equals;
}

function isAnswered(field, value) {
  if (value === undefined || value === null) return false;
  if (field.type === 'boolean') return value === true;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim() !== '';
}

// Validiert und bereinigt Antworten anhand des Schemas. Unbekannte Felder werden verworfen.
function sanitizeAnswers(input) {
  const schema = getSchema();
  const out = {};
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const section of schema.sections) {
    for (const f of section.fields) {
      if (!(f.id in src)) continue;
      let v = src[f.id];
      switch (f.type) {
        case 'boolean': v = v === true || v === 'true'; break;
        case 'number':
          if (v === '' || v === null) { v = null; break; }
          v = Number(v);
          if (!Number.isFinite(v)) { errors[f.id] = 'Bitte eine Zahl eingeben.'; continue; }
          if (f.min !== undefined && v < f.min) { errors[f.id] = `Mindestens ${f.min}.`; continue; }
          if (f.max !== undefined && v > f.max) { errors[f.id] = `Höchstens ${f.max}.`; continue; }
          break;
        case 'multiselect':
          if (!Array.isArray(v)) v = v ? [v] : [];
          v = v.map(String).filter((x) => !f.options || f.options.includes(x)).slice(0, 50);
          break;
        case 'select': case 'radio':
          v = v === null || v === '' ? '' : String(v);
          if (v && f.options && !f.options.includes(v)) { errors[f.id] = 'Ungültige Auswahl.'; continue; }
          break;
        case 'time':
          v = String(v ?? '');
          if (v && !/^\d{2}:\d{2}$/.test(v)) { errors[f.id] = 'Format HH:MM.'; continue; }
          break;
        case 'date':
          v = String(v ?? '');
          if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { errors[f.id] = 'Format JJJJ-MM-TT.'; continue; }
          break;
        default:
          v = String(v ?? '').slice(0, f.type === 'textarea' ? 5000 : 500);
      }
      out[f.id] = v;
    }
  }
  return { answers: out, errors };
}

// Fortschritt in Prozent: beantwortete Pflichtfelder / sichtbare Pflichtfelder.
function completion(data) {
  const schema = getSchema();
  let required = 0, answered = 0;
  const sections = schema.sections.map((s) => {
    let sReq = 0, sAns = 0;
    for (const f of s.fields) {
      if (!f.required || !isVisible(f, data)) continue;
      sReq++; required++;
      if (isAnswered(f, data[f.id])) { sAns++; answered++; }
    }
    return { id: s.id, title: s.title, required: sReq, answered: sAns, complete: sReq === sAns };
  });
  return { percent: required === 0 ? 100 : Math.round((answered / required) * 100), required, answered, sections };
}

module.exports = { getSchema, sanitizeAnswers, completion, isVisible, isAnswered };
