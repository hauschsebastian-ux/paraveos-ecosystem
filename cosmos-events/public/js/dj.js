/* DJ-Bereich: Dashboard, Eventliste + Kalender, Umsatz & Gage */
(function () {
  'use strict';
  const { esc, qs, qsa } = CE;
  const S = CE.sections;

  function eventRow(e) {
    return `<tr class="clickable" data-href="#/events/${e.id}"><td><strong>${esc(e.title)}</strong><div class="small muted">${esc(e.event_type)}</div></td><td class="nowrap">${CE.fmtDate(e.event_date)}<div class="small muted">${esc([e.start_time, e.end_time].filter(Boolean).join('–'))}</div></td><td>${esc(e.customer_name || '–')}</td><td>${esc(e.location_name || '–')}</td><td>${CE.statusBadge(e.status)}</td><td style="min-width:110px"><div class="progress-bar"><span style="width:${e.progress}%"></span></div><div class="small faint">${e.progress} %</div></td>${e.finance ? `<td class="num">${CE.fmtEur(e.finance.dj_fee_cents)}</td>` : ''}</tr>`;
  }
  CE.eventTable = function (events, { finance = true } = {}) {
    if (!events.length) return CE.empty('🎧', 'Keine Events in dieser Ansicht.');
    return `<div class="table-wrap"><table><thead><tr><th>Event</th><th>Datum</th><th>Kunde</th><th>Location</th><th>Status</th><th>Planung</th>${finance ? '<th class="num">DJ-Gage</th>' : ''}</tr></thead><tbody>${events.map((e) => eventRow(finance ? e : { ...e, finance: null })).join('')}</tbody></table></div>`;
  };
  CE.bindRows = (root) => qsa('tr[data-href]', root).forEach((tr) => tr.addEventListener('click', () => (location.hash = tr.dataset.href)));

  CE.views.djHome = async function (main) {
    const [events, fin] = await Promise.all([CE.loadEvents(true), CE.get('/finance/dj')]);
    const today = CE.todayIso();
    const upcoming = events.filter((e) => e.event_date >= today && !['abgeschlossen', 'storniert'].includes(e.status)).sort((a, b) => a.event_date.localeCompare(b.event_date));
    const next = upcoming[0];
    const k = fin.kpis;
    main.innerHTML = `<div class="page-head"><div><h1>Hallo ${esc(CE.state.user.name)} 🎧</h1><div class="sub">${upcoming.length} anstehende Events · ${k.completed_count} abgeschlossen</div></div><a class="btn" href="#/calendar">Kalender öffnen</a></div>
      <div class="grid cols-4 mb">
        <div class="card kpi"><div class="label">Events gesamt</div><div class="value">${k.event_count}</div><div class="hint">${k.upcoming_count} offen</div></div>
        <div class="card kpi"><div class="label">Gesamtumsatz (Buchungswert)</div><div class="value">${CE.fmtEur(k.total_booking_cents)}</div></div>
        <div class="card kpi accent"><div class="label">Meine Gage gesamt</div><div class="value">${CE.fmtEur(k.total_fee_cents)}</div><div class="hint">ausgezahlt ${CE.fmtEur(k.paid_out_cents)}</div></div>
        <div class="card kpi warn"><div class="label">Offene Beträge</div><div class="value">${CE.fmtEur(k.open_cents)}</div><div class="hint">davon fällig (abgeschlossen): ${CE.fmtEur(k.open_completed_cents)}</div></div>
      </div>
      ${next ? `<div class="card mb"><div class="row between"><div><div class="small faint" style="text-transform:uppercase;letter-spacing:.06em">Nächstes Event · in ${CE.daysUntil(next.event_date)} Tagen</div><h2 style="margin:.2rem 0">${esc(next.title)}</h2><div class="muted">${CE.fmtDateLong(next.event_date)} · ${esc([next.start_time, next.end_time].filter(Boolean).join('–'))} · ${esc(next.location_name || '')}${next.customer_name ? ' · ' + esc(next.customer_name) : ''}</div></div>
        <div class="row">${CE.ring(next.progress, 96)}<a class="btn primary" href="#/events/${next.id}">Zum Event</a></div></div></div>` : ''}
      <div class="card"><div class="card-head"><h2>Anstehende Events</h2><a class="small" href="#/events">Alle Events →</a></div>${CE.eventTable(upcoming.slice(0, 8))}</div>`;
    CE.bindRows(main);
  };

  CE.views.djEvents = async function (main, route) {
    const events = await CE.loadEvents(true);
    let view = route.query.view || 'list'; let filter = 'upcoming';
    const render = () => {
      const today = CE.todayIso();
      const list = events.filter((e) => filter === 'all' ? true : filter === 'upcoming' ? (e.event_date >= today || !e.event_date) && !['abgeschlossen', 'storniert'].includes(e.status) : ['abgeschlossen', 'storniert'].includes(e.status) || e.event_date < today);
      main.innerHTML = `<div class="page-head"><div><h1>Meine Events</h1><div class="sub">Alle über Cosmos Events gebuchten Veranstaltungen.</div></div>
        <div class="row"><div class="tabs" style="margin:0;border:0">${[['upcoming', 'Anstehend'], ['past', 'Vergangen'], ['all', 'Alle']].map(([k, l]) => `<button class="tab ${filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
        <button class="btn sm ${view === 'list' ? 'primary' : ''}" data-view="list">☰ Liste</button><button class="btn sm ${view === 'calendar' ? 'primary' : ''}" data-view="calendar">📅 Kalender</button></div></div>
        <div class="card" id="box">${view === 'list' ? CE.eventTable(list) : ''}</div>`;
      qsa('[data-filter]', main).forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; render(); }));
      qsa('[data-view]', main).forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; render(); }));
      if (view === 'calendar') S.calendar(qs('#box', main)); else CE.bindRows(main);
    };
    render();
  };

  CE.views.djFinance = async function (main, route) {
    const year = route.query.year || '';
    const fin = await CE.get(`/finance/dj${year ? '?year=' + year : ''}`);
    const k = fin.kpis;
    main.innerHTML = `<div class="page-head"><div><h1>Umsatz & Gage</h1><div class="sub">Buchungswert, Cosmos-Provision, Leihgebühren und deine resultierende Gage je Event.</div></div>
      <select id="yearSel" style="width:auto"><option value="">Alle Jahre</option>${fin.years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
      <div class="grid cols-4 mb">
        <div class="card kpi"><div class="label">Anzahl Events</div><div class="value">${k.event_count}</div><div class="hint">${k.completed_count} abgeschlossen · ${k.upcoming_count} offen</div></div>
        <div class="card kpi"><div class="label">Gesamtumsatz</div><div class="value">${CE.fmtEur(k.total_booking_cents)}</div><div class="hint">Provision ${CE.fmtEur(k.total_commission_cents)} · Leih ${CE.fmtEur(k.total_rental_cents)}</div></div>
        <div class="card kpi accent"><div class="label">Gage gesamt</div><div class="value">${CE.fmtEur(k.total_fee_cents)}</div><div class="hint">bereits ausgezahlt ${CE.fmtEur(k.paid_out_cents)}</div></div>
        <div class="card kpi warn"><div class="label">Offene Beträge</div><div class="value">${CE.fmtEur(k.open_cents)}</div><div class="hint">fällig nach Abschluss: ${CE.fmtEur(k.open_completed_cents)}</div></div>
      </div>
      <div class="card"><h2>Abrechnung je Event</h2>
        ${fin.events.length ? `<div class="table-wrap"><table><thead><tr><th>Event</th><th>Datum</th><th>Status</th><th class="num">Buchungswert</th><th class="num">Provision</th><th class="num">Leihgebühr</th><th class="num">DJ-Gage</th><th class="num">Ausgezahlt</th><th class="num">Offen</th></tr></thead>
          <tbody>${fin.events.map((e) => `<tr class="clickable" data-href="#/events/${e.id}?tab=finance"><td><strong>${esc(e.title)}</strong><div class="small muted">${esc(e.customer_name || '')}</div></td><td class="nowrap">${CE.fmtDate(e.event_date)}</td><td>${CE.statusBadge(e.status)}</td><td class="num">${CE.fmtEur(e.booking_value_cents)}</td><td class="num muted">− ${CE.fmtEur(e.commission_cents)} <span class="small faint">(${e.commission_percent} %)</span></td><td class="num muted">− ${CE.fmtEur(e.rental_fee_cents)}</td><td class="num"><strong>${CE.fmtEur(e.dj_fee_cents)}</strong></td><td class="num" style="color:var(--success)">${CE.fmtEur(e.paid_out_cents)}</td><td class="num" style="color:${e.open_cents ? 'var(--warn)' : 'inherit'}">${CE.fmtEur(e.open_cents)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th colspan="3">Summe</th><th class="num">${CE.fmtEur(k.total_booking_cents)}</th><th class="num">− ${CE.fmtEur(k.total_commission_cents)}</th><th class="num">− ${CE.fmtEur(k.total_rental_cents)}</th><th class="num">${CE.fmtEur(k.total_fee_cents)}</th><th class="num">${CE.fmtEur(k.paid_out_cents)}</th><th class="num">${CE.fmtEur(k.open_cents)}</th></tr></tfoot></table></div>` : CE.empty('💶', 'Noch keine Events in diesem Zeitraum.')}
        <p class="small faint mt">DJ-Gage = Buchungswert − Cosmos-Provision − Leihgebühren. Offen = Gage − bereits ausgezahlt.</p></div>`;
    qs('#yearSel', main).addEventListener('change', (e) => (location.hash = CE.hash('/finance', e.target.value ? { year: e.target.value } : null)));
    CE.bindRows(main);
  };
})();
