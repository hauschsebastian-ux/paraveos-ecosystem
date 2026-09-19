/* Admin-Bereich: Dashboard, Events (CRUD), Nutzerverwaltung, Finanzen, Audit & Backups */
(function () {
  'use strict';
  const { esc, qs, qsa } = CE;

  CE.views.adminHome = async function (main) {
    const [stats, events] = await Promise.all([CE.get('/admin/stats'), CE.loadEvents(true)]);
    const today = CE.todayIso();
    const upcoming = events.filter((e) => e.event_date >= today && !['abgeschlossen', 'storniert'].includes(e.status)).sort((a, b) => a.event_date.localeCompare(b.event_date));
    const due = events.filter((e) => e.final_meeting_due && !['abgeschlossen', 'storniert'].includes(e.status));
    main.innerHTML = `<div class="page-head"><div><h1>Dashboard</h1><div class="sub">Cosmos Events auf einen Blick.</div></div><a class="btn primary" href="#/events/new">+ Neues Event</a></div>
      <div class="grid cols-4 mb">
        <div class="card kpi"><div class="label">Anstehende Events</div><div class="value">${stats.events_upcoming}</div><div class="hint">${stats.events_total} gesamt</div></div>
        <div class="card kpi"><div class="label">Kunden / DJs</div><div class="value">${stats.customers} / ${stats.djs}</div></div>
        <div class="card kpi ${stats.unassigned ? 'warn' : ''}"><div class="label">Ohne DJ</div><div class="value">${stats.unassigned}</div><div class="hint">Events ohne Zuweisung</div></div>
        <div class="card kpi ${stats.deletion_requests ? 'warn' : ''}"><div class="label">Löschanträge</div><div class="value">${stats.deletion_requests}</div><div class="hint">DSGVO Art. 17</div></div>
      </div>
      ${due.length ? `<div class="alert warn"><strong>Finale Besprechung fällig:</strong> ${due.map((e) => `<a href="#/events/${e.id}?tab=timeline">${esc(e.title)}</a> (${e.progress} %)`).join(', ')}</div>` : ''}
      ${!stats.last_backup_at || Date.now() - new Date(stats.last_backup_at).getTime() > 2 * 86400000 ? `<div class="alert danger">Kein aktuelles Backup gefunden. <a href="#/audit">Jetzt prüfen →</a></div>` : ''}
      <div class="card"><div class="card-head"><h2>Anstehende Events</h2><a class="small" href="#/events">Alle →</a></div>${CE.eventTable(upcoming.slice(0, 10))}</div>`;
    CE.bindRows(main);
  };

  CE.views.adminEvents = async function (main, route) {
    const events = await CE.loadEvents(true);
    let q = '', status = '';
    const render = () => {
      const list = events.filter((e) => (!status || e.status === status) && (!q || `${e.title} ${e.customer_name} ${e.dj_name} ${e.location_name}`.toLowerCase().includes(q)));
      main.innerHTML = `<div class="page-head"><div><h1>Events</h1><div class="sub">${events.length} Events insgesamt</div></div><a class="btn primary" href="#/events/new">+ Neues Event</a></div>
        <div class="card"><div class="row mb"><input type="search" id="q" placeholder="Suchen (Event, Kunde, DJ, Location)" value="${esc(q)}" style="max-width:340px"><select id="st" style="width:auto"><option value="">Alle Status</option>${Object.entries(CE.STATUS).map(([k, [l]]) => `<option value="${k}" ${status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="table-wrap"><table><thead><tr><th>Event</th><th>Datum</th><th>Kunde</th><th>DJ</th><th>Status</th><th>Planung</th><th class="num">Buchungswert</th><th>Zahlung</th></tr></thead><tbody>${list.map((e) => `<tr class="clickable" data-href="#/events/${e.id}"><td><strong>${esc(e.title)}</strong><div class="small muted">${esc(e.location_name || '')}</div></td><td class="nowrap">${CE.fmtDate(e.event_date)}</td><td>${esc(e.customer_name || '–')}</td><td>${e.dj_name ? esc(e.dj_name) : '<span class="badge orange">offen</span>'}</td><td>${CE.statusBadge(e.status)}</td><td style="min-width:100px"><div class="progress-bar"><span style="width:${e.progress}%"></span></div><div class="small faint">${e.progress} %</div></td><td class="num">${CE.fmtEur(e.booking_value_cents)}</td><td><span class="badge ${CE.PAY[e.customer_payment_status][1]}">${CE.PAY[e.customer_payment_status][0]}</span></td></tr>`).join('') || '<tr><td colspan="8" class="center faint">Keine Treffer</td></tr>'}</tbody></table></div></div>`;
      qs('#q', main).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); render(); qs('#q', main).focus(); });
      qs('#st', main).addEventListener('change', (e) => { status = e.target.value; render(); });
      CE.bindRows(main);
    };
    render();
  };

  CE.views.adminEventForm = async function (main, route, ev = null) {
    const { users } = await CE.get('/users');
    const customers = users.filter((u) => u.role === 'customer' && !u.anonymized_at), djs = users.filter((u) => u.role === 'dj' && !u.anonymized_at && u.active);
    const v = (k, d = '') => esc(ev ? (ev[k] ?? d) : d);
    main.innerHTML = `<div class="page-head"><div><a href="#${ev ? '/events/' + ev.id : '/events'}" class="small">← Zurück</a><h1>${ev ? 'Event bearbeiten' : 'Neues Event'}</h1></div></div>
      <form id="evForm" class="grid" style="grid-template-columns:2fr 1fr;align-items:start">
        <div class="stack">
          <div class="card"><h2>Veranstaltung</h2><div class="form-grid">
            <div class="field full"><label>Titel *</label><input type="text" name="title" required value="${v('title')}" placeholder="z. B. Hochzeit Lena & Max"></div>
            <div class="field"><label>Art</label><select name="event_type">${['Hochzeit', 'Geburtstag', 'Firmenfeier', 'Abiball', 'Stadtfest', 'Sonstiges'].map((t) => `<option ${(ev ? ev.event_type : 'Hochzeit') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            <div class="field"><label>Status</label><select name="status">${Object.entries(CE.STATUS).map(([k, [l]]) => `<option value="${k}" ${(ev ? ev.status : 'gebucht') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="field"><label>Datum</label><input type="date" name="event_date" value="${v('event_date')}"></div>
            <div class="field"><label>Gäste</label><input type="number" name="guest_count" min="0" value="${v('guest_count')}"></div>
            <div class="field"><label>Beginn</label><input type="time" name="start_time" value="${v('start_time')}"></div>
            <div class="field"><label>Ende</label><input type="time" name="end_time" value="${v('end_time')}"></div>
            <div class="field"><label>Location</label><input type="text" name="location_name" value="${v('location_name')}"></div>
            <div class="field"><label>Adresse</label><input type="text" name="location_address" value="${v('location_address')}"></div>
          </div></div>
          <div class="card"><h2>Zuordnung & Vertrag</h2><div class="form-grid">
            <div class="field"><label>Kunde / Brautpaar</label><select name="customer_id"><option value="">– kein Kunde –</option>${customers.map((c) => `<option value="${c.id}" ${ev && ev.customer_id === c.id ? 'selected' : ''}>${esc(c.name)} (${esc(c.email)})</option>`).join('')}</select><div class="help">Kunden legst du unter „Kunden & DJs“ an.</div></div>
            <div class="field"><label>Zuständiger DJ</label><select name="dj_id"><option value="">– noch offen –</option>${djs.map((d) => `<option value="${d.id}" ${ev && ev.dj_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Vertragsnummer</label><input type="text" name="contract_number" value="${v('contract_number')}"></div>
            <div class="field"><label>Vertrag unterzeichnet am</label><input type="date" name="contract_signed_at" value="${v('contract_signed_at')}"></div>
            <div class="field full"><label>Hinweis für den Kunden (sichtbar)</label><textarea name="notes_customer">${v('notes_customer')}</textarea></div>
            <div class="field full"><label>Interne Notizen (nur Admin & DJ)</label><textarea name="notes_internal">${v('notes_internal')}</textarea></div>
          </div></div>
        </div>
        <div class="stack">
          <div class="card"><h2>Finanzen</h2>
            <div class="field"><label>Buchungswert (€)</label><input type="text" inputmode="decimal" name="booking_value" value="${ev ? CE.centsToEurInput(ev.booking_value_cents) : ''}" placeholder="0,00"></div>
            <div class="field"><label>Cosmos-Provision (%)</label><input type="number" step="0.5" min="0" max="100" name="commission_percent" value="${ev ? ev.commission_percent : 15}"></div>
            <div class="field"><label>Leihgebühren (€)</label><input type="text" inputmode="decimal" name="rental_fee" value="${ev ? CE.centsToEurInput(ev.rental_fee_cents) : ''}" placeholder="0,00"></div>
            <div class="field"><label>Zahlungsstatus Kunde</label><select name="customer_payment_status">${Object.entries(CE.PAY).map(([k, [l]]) => `<option value="${k}" ${(ev ? ev.customer_payment_status : 'offen') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="alert info small" id="feePreview"></div>
          </div>
          <button class="btn primary block" type="submit">${ev ? 'Änderungen speichern' : 'Event anlegen'}</button>
          ${ev ? '<button class="btn danger block" type="button" id="delEvent">Event löschen</button>' : ''}
        </div></form>`;
    const form = qs('#evForm', main);
    const preview = () => { const b = CE.eurToCents(form.booking_value.value), c = Math.round(b * (Number(form.commission_percent.value) || 0) / 100), r = CE.eurToCents(form.rental_fee.value); qs('#feePreview', main).innerHTML = `DJ-Gage: <strong>${CE.fmtEur(Math.max(0, b - c - r))}</strong><br><span class="faint">${CE.fmtEur(b)} − ${CE.fmtEur(c)} Provision − ${CE.fmtEur(r)} Leih</span>`; };
    ['booking_value', 'commission_percent', 'rental_fee'].forEach((n) => form[n].addEventListener('input', preview)); preview();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = CE.formData(form);
      d.booking_value_cents = CE.eurToCents(d.booking_value); d.rental_fee_cents = CE.eurToCents(d.rental_fee); delete d.booking_value; delete d.rental_fee;
      try {
        if (ev) { await CE.patch(`/events/${ev.id}`, d); CE.toast('Gespeichert', 'success'); CE.state.events = null; location.hash = `/events/${ev.id}`; }
        else { const r = await CE.post('/events', d); CE.toast('Event angelegt', 'success'); CE.state.events = null; location.hash = `/events/${r.id}`; }
      } catch (err) { CE.error(err); }
    });
    const del = qs('#delEvent', main);
    if (del) del.addEventListener('click', async () => { if (await CE.confirm(`Event „${ev.title}“ inklusive Fragebogen, Musik und Dokumenten endgültig löschen?`, { danger: true, ok: 'Endgültig löschen' })) { await CE.del(`/events/${ev.id}`); CE.state.events = null; location.hash = '/events'; } });
  };

  CE.views.adminUsers = async function (main, route) {
    let { users } = await CE.get('/users');
    let role = route.query.role || 'customer';
    const render = () => {
      const list = users.filter((u) => u.role === role);
      main.innerHTML = `<div class="page-head"><div><h1>Kunden & DJs</h1><div class="sub">Zugänge anlegen, Passwörter zurücksetzen, Konten verwalten.</div></div><button class="btn primary" id="newUser">+ Zugang anlegen</button></div>
        <div class="tabs">${[['customer', 'Kunden'], ['dj', 'DJs'], ['admin', 'Admins']].map(([k, l]) => `<button class="tab ${role === k ? 'active' : ''}" data-role="${k}">${l} <span class="badge gray">${users.filter((u) => u.role === k).length}</span></button>`).join('')}</div>
        <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>E-Mail</th><th>Telefon</th><th>Events</th><th>2FA</th><th>Status</th><th>Letzter Login</th><th></th></tr></thead><tbody>
          ${list.map((u) => `<tr><td><strong>${esc(u.name)}</strong>${u.deletion_requested_at ? '<div><span class="badge red">Löschantrag</span></div>' : ''}</td><td>${esc(u.email)}</td><td>${esc(u.phone || '–')}</td><td>${u.event_count}</td><td>${u.totp_enabled ? '<span class="badge green">aktiv</span>' : '<span class="badge gray">nein</span>'}</td><td>${u.anonymized_at ? '<span class="badge gray">anonymisiert</span>' : u.active ? '<span class="badge green">aktiv</span>' : '<span class="badge red">deaktiviert</span>'}</td><td class="small muted nowrap">${u.last_login_at ? CE.fmtDateTime(u.last_login_at) : '–'}</td>
            <td class="right nowrap">${u.anonymized_at ? '' : `<button class="btn sm ghost" data-edit="${u.id}">Bearbeiten</button><button class="btn sm ghost" data-menu="${u.id}">⋯</button>`}</td></tr>`).join('') || '<tr><td colspan="8" class="center faint">Keine Einträge</td></tr>'}</tbody></table></div></div>`;
      qsa('[data-role]', main).forEach((b) => b.addEventListener('click', () => { role = b.dataset.role; render(); }));
      qs('#newUser', main).addEventListener('click', () => userForm());
      qsa('[data-edit]', main).forEach((b) => b.addEventListener('click', () => userForm(users.find((u) => u.id === Number(b.dataset.edit)))));
      qsa('[data-menu]', main).forEach((b) => b.addEventListener('click', () => actions(users.find((u) => u.id === Number(b.dataset.menu)))));
    };
    const reload = async () => { ({ users } = await CE.get('/users')); render(); };
    const showPassword = (title, u, pw) => CE.modal(`<h2>${title}</h2><p>Bitte dieses Initialpasswort <strong>sicher</strong> an ${esc(u.name || u.email)} übermitteln (z. B. telefonisch). Es wird nur einmal angezeigt und muss beim ersten Login geändert werden.</p>
      <dl class="kv"><dt>E-Mail</dt><dd class="mono">${esc(u.email)}</dd><dt>Passwort</dt><dd><code class="mono" style="font-size:1.1rem">${esc(pw)}</code></dd></dl>
      <div class="actions"><button class="btn" id="cp">Kopieren</button><button class="btn primary" data-close>Fertig</button></div>`, { onMount(m) { m.querySelector('#cp').addEventListener('click', () => navigator.clipboard.writeText(`Login: ${u.email}\nPasswort: ${pw}`).then(() => CE.toast('Kopiert', 'success'))); } });
    const userForm = (u = null) => CE.modal(`<h2>${u ? 'Zugang bearbeiten' : 'Neuen Zugang anlegen'}</h2><form id="uf">
      <div class="form-grid"><div class="field"><label>Rolle</label><select name="role">${[['customer', 'Kunde / Brautpaar'], ['dj', 'DJ'], ['admin', 'Admin']].map(([k, l]) => `<option value="${k}" ${(u ? u.role : role) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Name *</label><input type="text" name="name" required value="${esc(u ? u.name : '')}" placeholder="z. B. Lena & Max Berger"></div>
      <div class="field"><label>E-Mail *</label><input type="email" name="email" required value="${esc(u ? u.email : '')}" ${u ? 'disabled' : ''}></div>
      <div class="field"><label>Telefon</label><input type="tel" name="phone" value="${esc(u ? u.phone || '' : '')}"></div>
      ${u ? `<div class="field full"><label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}><span>Konto aktiv</span></label></div>` : '<div class="field full"><div class="help">Es wird ein sicheres Initialpasswort erzeugt, das beim ersten Login geändert werden muss.</div></div>'}</div>
      <div class="actions"><button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">${u ? 'Speichern' : 'Anlegen'}</button></div></form>`, {
      onMount(m, close) {
        m.querySelector('#uf').addEventListener('submit', async (e) => {
          e.preventDefault(); const d = CE.formData(e.target);
          try {
            if (u) { await CE.patch(`/users/${u.id}`, d); close(); reload(); }
            else { const r = await CE.post('/users', d); close(); await reload(); showPassword('Zugang angelegt', { ...d }, r.initial_password); }
          } catch (err) { CE.error(err); }
        });
      },
    });
    const actions = (u) => CE.modal(`<h2>${esc(u.name)}</h2><div class="stack">
      <button class="btn" id="rp">Passwort zurücksetzen</button>
      <button class="btn" id="r2" ${u.totp_enabled ? '' : 'disabled'}>Zwei-Faktor-Authentifizierung zurücksetzen</button>
      ${u.role !== 'admin' ? `<button class="btn danger" id="an">Personenbezogene Daten anonymisieren (DSGVO)</button>` : ''}
      ${u.deletion_requested_at ? `<div class="alert warn small">Löschantrag vom ${CE.fmtDateTime(u.deletion_requested_at)}. Vor der Anonymisierung gesetzliche Aufbewahrungsfristen prüfen.</div>` : ''}
      </div><div class="actions"><button class="btn" data-close>Schließen</button></div>`, {
      onMount(m, close) {
        m.querySelector('#rp').addEventListener('click', async () => { if (await CE.confirm('Passwort zurücksetzen? Alle Sitzungen des Nutzers werden beendet.')) { const r = await CE.post(`/users/${u.id}/reset-password`); close(); showPassword('Passwort zurückgesetzt', u, r.initial_password); } });
        m.querySelector('#r2').addEventListener('click', async () => { if (await CE.confirm('2FA zurücksetzen? Der Nutzer muss sie danach neu einrichten.')) { await CE.post(`/users/${u.id}/reset-2fa`); close(); reload(); CE.toast('2FA zurückgesetzt', 'success'); } });
        const an = m.querySelector('#an'); if (an) an.addEventListener('click', async () => { if (await CE.confirm(`${u.name} unwiderruflich anonymisieren? Name, E-Mail, Telefon, Fragebogen, Musik und Dokumente werden gelöscht. Abrechnungsdaten bleiben pseudonymisiert erhalten.`, { danger: true, ok: 'Anonymisieren' })) { await CE.post(`/users/${u.id}/anonymize`); close(); reload(); } });
      },
    });
    render();
  };

  CE.views.adminFinance = async function (main, route) {
    const ov = await CE.get('/finance/overview');
    const djId = route.query.dj;
    main.innerHTML = `<div class="page-head"><div><h1>Finanzen</h1><div class="sub">Umsatz, Provision und Gagen über alle DJs.</div></div></div>
      <div class="grid cols-4 mb">
        <div class="card kpi"><div class="label">Gesamtumsatz</div><div class="value">${CE.fmtEur(ov.totals.booking)}</div><div class="hint">${ov.event_count} Events</div></div>
        <div class="card kpi accent"><div class="label">Cosmos-Provision</div><div class="value">${CE.fmtEur(ov.totals.commission)}</div><div class="hint">+ Leih ${CE.fmtEur(ov.totals.rental)}</div></div>
        <div class="card kpi"><div class="label">DJ-Gagen gesamt</div><div class="value">${CE.fmtEur(ov.totals.fees)}</div><div class="hint">ausgezahlt ${CE.fmtEur(ov.totals.paid)}</div></div>
        <div class="card kpi warn"><div class="label">Offene Auszahlungen</div><div class="value">${CE.fmtEur(ov.totals.open)}</div></div>
      </div>
      <div class="card mb"><h2>Je DJ</h2><div class="table-wrap"><table><thead><tr><th>DJ</th><th class="num">Events</th><th class="num">Umsatz</th><th class="num">Provision</th><th class="num">Gage</th><th class="num">Ausgezahlt</th><th class="num">Offen</th><th></th></tr></thead><tbody>
        ${ov.per_dj.map((r) => `<tr><td><strong>${esc(r.dj.name)}</strong></td><td class="num">${r.event_count}</td><td class="num">${CE.fmtEur(r.total_booking_cents)}</td><td class="num">${CE.fmtEur(r.total_commission_cents)}</td><td class="num">${CE.fmtEur(r.total_fee_cents)}</td><td class="num">${CE.fmtEur(r.paid_out_cents)}</td><td class="num" style="color:${r.open_cents ? 'var(--warn)' : 'inherit'}">${CE.fmtEur(r.open_cents)}</td><td class="right"><a class="btn sm" href="#/finance?dj=${r.dj.id}">Details</a></td></tr>`).join('') || '<tr><td colspan="8" class="center faint">Noch keine DJs</td></tr>'}</tbody></table></div></div>
      <div id="djBox"></div>`;
    if (djId) {
      const fin = await CE.get(`/finance/dj?dj_id=${encodeURIComponent(djId)}`);
      const dj = ov.per_dj.find((r) => String(r.dj.id) === String(djId));
      qs('#djBox', main).innerHTML = `<div class="card"><div class="card-head"><h2>${esc(dj ? dj.dj.name : 'DJ')} – Abrechnung je Event</h2><a class="btn sm" href="#/finance">Schließen</a></div>
        <div class="table-wrap"><table><thead><tr><th>Event</th><th>Datum</th><th>Status</th><th class="num">Buchungswert</th><th class="num">Provision</th><th class="num">Leih</th><th class="num">Gage</th><th class="num">Ausgezahlt</th><th class="num">Offen</th></tr></thead><tbody>
        ${fin.events.map((e) => `<tr class="clickable" data-href="#/events/${e.id}?tab=finance"><td>${esc(e.title)}</td><td class="nowrap">${CE.fmtDate(e.event_date)}</td><td>${CE.statusBadge(e.status)}</td><td class="num">${CE.fmtEur(e.booking_value_cents)}</td><td class="num">${CE.fmtEur(e.commission_cents)}</td><td class="num">${CE.fmtEur(e.rental_fee_cents)}</td><td class="num"><strong>${CE.fmtEur(e.dj_fee_cents)}</strong></td><td class="num">${CE.fmtEur(e.paid_out_cents)}</td><td class="num">${CE.fmtEur(e.open_cents)}</td></tr>`).join('')}</tbody></table></div></div>`;
      CE.bindRows(main);
    }
  };

  CE.views.adminAudit = async function (main) {
    const [audit, bk] = await Promise.all([CE.get('/admin/audit?limit=200'), CE.get('/admin/backups')]);
    main.innerHTML = `<div class="page-head"><div><h1>Sicherheit & Backups</h1><div class="sub">Protokoll sicherheitsrelevanter Aktionen und verschlüsselte Datensicherungen.</div></div></div>
      <div class="grid" style="grid-template-columns:1fr 2fr;align-items:start">
        <div class="card"><div class="card-head"><h2>Backups</h2><button class="btn sm primary" id="mkBackup">Jetzt sichern</button></div>
          <p class="small muted">Letztes Backup: <strong>${bk.last_backup_at ? CE.fmtDateTime(bk.last_backup_at) : 'noch keins'}</strong>. Backups werden täglich automatisch erstellt, AES-256-verschlüsselt und nach Ablauf der Aufbewahrungsfrist gelöscht.</p>
          ${bk.backups.length ? `<div class="table-wrap"><table><thead><tr><th>Datei</th><th class="num">Größe</th></tr></thead><tbody>${bk.backups.slice(0, 15).map((b) => `<tr><td class="mono small">${esc(b.file)}</td><td class="num small">${CE.bytes(b.size)}</td></tr>`).join('')}</tbody></table></div>` : ''}
          <p class="small faint mt">Wiederherstellung: <code>npm run restore -- &lt;datei&gt; ziel.sqlite</code></p></div>
        <div class="card"><h2>Audit-Log</h2><div class="table-wrap"><table><thead><tr><th>Zeit</th><th>Nutzer</th><th>Aktion</th><th>Details</th><th>IP</th></tr></thead><tbody>
          ${audit.entries.map((e) => `<tr><td class="small nowrap muted">${CE.fmtDateTime(e.created_at)}</td><td class="small">${esc(e.user_email || 'System')}</td><td><span class="badge ${e.action.includes('failed') || e.action.includes('locked') ? 'red' : e.action.startsWith('auth') ? 'blue' : 'gray'}">${esc(e.action)}</span></td><td class="small muted mono" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.details || '')}">${esc(e.entity ? e.entity + (e.entity_id ? ' #' + e.entity_id : '') : '')} ${esc(e.details || '')}</td><td class="small faint">${esc(e.ip || '')}</td></tr>`).join('')}</tbody></table></div></div>
      </div>`;
    qs('#mkBackup', main).addEventListener('click', async () => { try { const r = await CE.post('/admin/backups', {}); CE.toast(`Backup erstellt: ${r.file}`, 'success'); CE.render(); } catch (e) { CE.error(e); } });
  };
})();
