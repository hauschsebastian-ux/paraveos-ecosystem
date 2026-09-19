/* Kundenbereich: ein Event, Fragebogen, Musik, Termine, Dokumente */
(function () {
  'use strict';
  const { esc, qs, qsa } = CE;
  const S = CE.sections;

  // Kunden haben in der Regel genau ein Event; bei mehreren kann gewechselt werden.
  async function currentEvent(main) {
    const events = await CE.loadEvents();
    if (!events.length) {
      main.innerHTML = `<div class="page-head"><div><h1>Willkommen, ${esc(CE.state.user.name)}</h1></div></div><div class="card">${CE.empty('🛰️', 'Dir ist noch kein Event zugeordnet. Cosmos Events schaltet dein Event in Kürze frei.')}</div>`;
      return null;
    }
    const wanted = Number(sessionStorage.getItem('ce_event')) || events[0].id;
    const ev = events.find((e) => e.id === wanted) || events[0];
    const { event } = await CE.get(`/events/${ev.id}`);
    return { event, events };
  }
  function switcher(events, current) {
    if (events.length < 2) return '';
    return `<select id="evSwitch" style="width:auto">${events.map((e) => `<option value="${e.id}" ${e.id === current.id ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select>`;
  }
  function bindSwitch(main) {
    const s = qs('#evSwitch', main); if (s) s.addEventListener('change', () => { sessionStorage.setItem('ce_event', s.value); CE.render(); });
  }
  function head(main, ev, events, title, sub, extra = '') {
    main.innerHTML = `<div class="page-head"><div><h1>${title}</h1><div class="sub">${sub}</div></div><div class="row">${switcher(events, ev)}${extra}</div></div>`;
    bindSwitch(main);
  }

  CE.views.customerHome = async function (main) {
    const r = await currentEvent(main); if (!r) return;
    const { event: ev, events } = r;
    const days = CE.daysUntil(ev.event_date);
    head(main, ev, events, `Hallo ${esc(CE.state.user.name.split(' ')[0])} 👋`, `${esc(ev.title)} · ${CE.fmtDateLong(ev.event_date)}${days !== null && days >= 0 && ev.status !== 'abgeschlossen' ? ` · <strong style="color:var(--accent-strong)">noch ${days} Tage</strong>` : ''}`);
    const next = ev.appointments.filter((a) => a.status === 'geplant');
    const openTasks = ev.tasks.filter((t) => !t.done_at && t.assignee_role === 'customer');
    main.insertAdjacentHTML('beforeend', `
      <div class="card mb" id="prog"></div>
      <div class="grid cols-3">
        <div class="card"><div class="card-head"><h3>Nächste Schritte</h3><a class="small" href="#/timeline">Alle →</a></div>
          ${openTasks.length ? openTasks.slice(0, 5).map((t) => `<div class="list-item"><span>☐ ${esc(t.title)}</span><span class="small faint nowrap">${t.due_date ? 'bis ' + CE.fmtDate(t.due_date) : ''}</span></div>`).join('') : '<p class="small faint">Keine offenen Aufgaben – super!</p>'}</div>
        <div class="card"><div class="card-head"><h3>Termine</h3><a class="small" href="#/timeline">Planen →</a></div>
          ${next.length ? next.map((a) => `<div class="list-item"><div><strong>${esc(a.title)}</strong><div class="small muted">${a.scheduled_at ? CE.fmtDateTime(a.scheduled_at) + (a.location ? ' · ' + esc(a.location) : '') : 'noch nicht terminiert'}</div></div></div>`).join('') : '<p class="small faint">Keine offenen Termine.</p>'}</div>
        <div class="card"><div class="card-head"><h3>Euer DJ</h3></div>
          ${ev.dj_name ? `<div class="row"><div class="doc .ico" style="font-size:2rem">🎧</div><div><strong>${esc(ev.dj_name)}</strong><div class="small muted">Euer Ansprechpartner für den Sound des Abends.</div></div></div>` : '<p class="small faint">Euer DJ wird in Kürze zugewiesen.</p>'}
          <div class="mt small muted"><strong>Location:</strong> ${esc(ev.location_name || '–')}${ev.location_address ? `<br>${esc(ev.location_address)}` : ''}</div>
          ${ev.notes_customer ? `<div class="alert info small mt" style="margin-bottom:0">${esc(ev.notes_customer)}</div>` : ''}</div>
      </div>
      <div class="grid cols-4 mt">
        <a class="card kpi" href="#/questionnaire" style="text-decoration:none;color:inherit"><div class="label">📝 Fragebogen</div><div class="value">${ev.progress_detail.questionnaire.percent} %</div><div class="hint">${ev.progress_detail.questionnaire.answered}/${ev.progress_detail.questionnaire.required} Pflichtangaben</div></a>
        <a class="card kpi" href="#/music" style="text-decoration:none;color:inherit"><div class="label">🎵 Musik</div><div class="value">${ev.progress_detail.music.mustplays + ev.progress_detail.music.wishes}</div><div class="hint">Songs · ${ev.progress_detail.music.programme} Programmpunkte</div></a>
        <a class="card kpi" href="#/documents" style="text-decoration:none;color:inherit"><div class="label">📎 Dokumente</div><div class="value">${ev.document_count}</div><div class="hint">hochgeladen</div></a>
        <a class="card kpi" href="#/event" style="text-decoration:none;color:inherit"><div class="label">💍 Status</div><div class="value" style="font-size:1.1rem;margin-top:.5rem">${CE.statusBadge(ev.status)}</div></a>
      </div>`);
    S.progress(qs('#prog', main), ev);
  };

  CE.views.customerQuestionnaire = async function (main) {
    const r = await currentEvent(main); if (!r) return;
    head(main, r.event, r.events, 'Fragebogen', 'Schritt für Schritt durch eure Eventplanung. Alles wird automatisch gespeichert – ihr könnt jederzeit weitermachen.');
    main.insertAdjacentHTML('beforeend', '<div class="card" id="q"></div>');
    await S.questionnaire(qs('#q', main), r.event);
  };

  CE.views.customerMusic = async function (main) {
    const r = await currentEvent(main); if (!r) return;
    head(main, r.event, r.events, 'Musik', 'Musikwünsche, Must-Plays, No-Gos und Songs für besondere Programmpunkte.');
    main.insertAdjacentHTML('beforeend', '<div class="card" id="m"></div>');
    await S.music(qs('#m', main), r.event);
  };

  CE.views.customerTimeline = async function (main) {
    const r = await currentEvent(main); if (!r) return;
    head(main, r.event, r.events, 'Termine & Aufgaben', 'Update-Gespräch, finale Besprechung und alle Aufgaben bis zum großen Tag.');
    main.insertAdjacentHTML('beforeend', '<div class="card mb" id="t"></div><div class="card" id="cal"></div>');
    CE.onEventChanged = null;
    await S.timeline(qs('#t', main), r.event, 'customer');
    await S.calendar(qs('#cal', main), { link: () => '#/timeline' });
  };

  CE.views.customerDocuments = async function (main) {
    const r = await currentEvent(main); if (!r) return;
    head(main, r.event, r.events, 'Dokumente', 'Ablaufpläne, Bilder der Location, Aufbaupläne und weitere Unterlagen.');
    main.insertAdjacentHTML('beforeend', '<div class="card" id="d"></div>');
    await S.documents(qs('#d', main), r.event, 'customer');
  };

  CE.views.customerEvent = async function (main) {
    const r = await currentEvent(main); if (!r) return;
    const ev = r.event;
    head(main, ev, r.events, esc(ev.title), `${CE.fmtDateLong(ev.event_date)} · ${CE.STATUS[ev.status]?.[0] || ev.status}`);
    main.insertAdjacentHTML('beforeend', `<div class="grid cols-2"><div class="card"><h2>Eventdaten</h2><div id="ov"></div></div>
      <div class="card"><h2>Angaben ergänzen</h2><form id="ef"><div class="field"><label>Erwartete Gästezahl</label><input type="number" name="guest_count" min="0" value="${esc(ev.guest_count ?? '')}"></div>
        <div class="field"><label>Nachricht / Hinweise an Cosmos Events</label><textarea name="notes_customer" placeholder="Was sollen wir unbedingt wissen?">${esc(ev.notes_customer || '')}</textarea></div>
        <button class="btn primary">Speichern</button></form>
        <hr style="border:0;border-top:1px solid var(--border);margin:1.25rem 0">
        <h3>Eure Daten</h3><p class="small muted">Ihr könnt jederzeit eine vollständige Auskunft über eure gespeicherten Daten herunterladen.</p><a class="btn sm" href="/api/account/export">Datenauskunft (JSON)</a></div></div>`);
    S.overview(qs('#ov', main), ev, 'customer');
    qs('#ef', main).addEventListener('submit', async (e) => { e.preventDefault(); try { await CE.patch(`/events/${ev.id}`, CE.formData(e.target)); CE.state.events = null; CE.toast('Gespeichert', 'success'); } catch (err) { CE.error(err); } });
  };
})();
