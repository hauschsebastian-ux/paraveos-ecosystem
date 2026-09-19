'use strict';
// Planungsfortschritt (0–100 %) und Meilensteine eines Events.
const { getDb } = require('./db');
const { completion } = require('./questionnaire');

// Gewichtung der Meilensteine – Summe 100.
const WEIGHTS = { questionnaire: 35, music: 20, update_call: 15, final_meeting: 20, completed: 10 };
const FINAL_MEETING_THRESHOLD = 80; // ab hier wird die finale Besprechung empfohlen

function fmtDe(iso) {
  if (!iso) return '';
  const [d, t] = String(iso).split('T');
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}${t ? ' ' + t.slice(0, 5) + ' Uhr' : ''}`;
}

const PROGRAM_SLOTS = ['Einzug', 'Eröffnungstanz', 'Tortenanschnitt', 'Brautstraußwurf', 'Letzter Song'];

function computeProgress(eventId) {
  const db = getDb();
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!ev) return null;
  const qr = db.prepare('SELECT * FROM questionnaire_responses WHERE event_id = ?').get(eventId);
  const data = qr ? JSON.parse(qr.data || '{}') : {};
  const q = completion(data);

  const music = db.prepare(
    `SELECT category, COUNT(*) AS n FROM music_wishes WHERE event_id = ? GROUP BY category`
  ).all(eventId).reduce((acc, r) => { acc[r.category] = r.n; return acc; }, {});
  const mustplays = music.mustplay || 0;
  const wishes = music.wunsch || 0;
  const programme = music.programm || 0;
  // Musikplanung gilt als vollständig ab 10 Must-Plays/Wünschen und 2 Programm-Songs.
  const musicPercent = Math.min(100, Math.round(
    Math.min(1, (mustplays + wishes) / 10) * 70 + Math.min(1, programme / 2) * 30
  ));

  const apps = db.prepare('SELECT kind, status, scheduled_at FROM appointments WHERE event_id = ?').all(eventId);
  const updateCall = apps.find((a) => a.kind === 'update_call' && a.status !== 'abgesagt');
  const finalMeeting = apps.find((a) => a.kind === 'final_meeting' && a.status !== 'abgesagt');
  const updateDone = !!(updateCall && updateCall.status === 'erledigt');
  const finalDone = !!(finalMeeting && finalMeeting.status === 'erledigt');
  // Teilpunkte gibt es erst, wenn ein Termin tatsächlich datiert ist.
  const updateScheduled = !!(updateCall && updateCall.scheduled_at);
  const finalScheduled = !!(finalMeeting && finalMeeting.scheduled_at);
  const completed = ev.status === 'abgeschlossen';

  const parts = {
    questionnaire: (q.percent / 100) * WEIGHTS.questionnaire,
    music: (musicPercent / 100) * WEIGHTS.music,
    update_call: updateDone ? WEIGHTS.update_call : (updateScheduled ? WEIGHTS.update_call * 0.4 : 0),
    final_meeting: finalDone ? WEIGHTS.final_meeting : (finalScheduled ? WEIGHTS.final_meeting * 0.4 : 0),
    completed: completed ? WEIGHTS.completed : 0,
  };
  let percent = Math.round(Object.values(parts).reduce((a, b) => a + b, 0));
  if (completed) percent = 100;
  percent = Math.max(0, Math.min(100, percent));

  const preFinalPercent = Math.round(parts.questionnaire + parts.music + parts.update_call
    + (finalScheduled ? WEIGHTS.final_meeting * 0.4 : 0));

  const milestones = [
    { id: 'questionnaire', title: 'Fragebogen', percent: q.percent,
      state: q.percent === 100 ? 'done' : q.percent > 0 ? 'active' : 'open',
      detail: `${q.answered} von ${q.required} Pflichtangaben` },
    { id: 'music', title: 'Musikplanung', percent: musicPercent,
      state: musicPercent === 100 ? 'done' : musicPercent > 0 ? 'active' : 'open',
      detail: `${mustplays} Must-Plays · ${wishes} Wünsche · ${music.nogo || 0} No-Gos · ${programme} Programm-Songs` },
    { id: 'update_call', title: 'Update-Gespräch', percent: updateDone ? 100 : updateScheduled ? 40 : 0,
      state: updateDone ? 'done' : updateScheduled ? 'active' : 'open',
      detail: updateDone ? 'Erledigt' : updateCall && updateCall.scheduled_at ? `Geplant: ${fmtDe(updateCall.scheduled_at)}` : 'Noch nicht geplant',
      scheduled_at: updateCall ? updateCall.scheduled_at : null },
    { id: 'final_meeting', title: 'Finale Besprechung', percent: finalDone ? 100 : finalScheduled ? 40 : 0,
      state: finalDone ? 'done' : finalScheduled ? 'active' : 'open',
      detail: finalDone ? 'Erledigt' : finalMeeting && finalMeeting.scheduled_at ? `Geplant: ${fmtDe(finalMeeting.scheduled_at)}` : `Empfohlen ab ${FINAL_MEETING_THRESHOLD} % Planungsfortschritt`,
      scheduled_at: finalMeeting ? finalMeeting.scheduled_at : null },
    { id: 'completed', title: 'Event abgeschlossen', percent: completed ? 100 : 0,
      state: completed ? 'done' : 'open', detail: completed ? 'Danke für euer Vertrauen!' : ev.event_date ? `Event am ${fmtDe(ev.event_date)}` : 'Termin offen' },
  ];

  const recommendations = [];
  if (q.percent < 100) recommendations.push({ id: 'questionnaire', text: 'Fragebogen vervollständigen', route: 'questionnaire' });
  if (musicPercent < 100) recommendations.push({ id: 'music', text: 'Musikwünsche, Must-Plays und Programm-Songs ergänzen', route: 'music' });
  if (!updateScheduled && !updateDone && q.percent >= 30) recommendations.push({ id: 'update_call', text: 'Update-Gespräch vereinbaren', route: 'timeline' });
  if (!finalScheduled && !finalDone && preFinalPercent >= FINAL_MEETING_THRESHOLD * 0.75) {
    recommendations.push({ id: 'final_meeting', text: 'Finale Besprechung vereinbaren (empfohlen ab ca. 80 %)', route: 'timeline' });
  }

  return {
    percent, milestones, recommendations, weights: WEIGHTS,
    final_meeting_threshold: FINAL_MEETING_THRESHOLD,
    final_meeting_due: !finalScheduled && !finalDone && percent >= FINAL_MEETING_THRESHOLD - WEIGHTS.final_meeting,
    questionnaire: q, music: { mustplays, wishes, nogos: music.nogo || 0, programme, percent: musicPercent },
  };
}

module.exports = { computeProgress, PROGRAM_SLOTS, WEIGHTS, FINAL_MEETING_THRESHOLD };
