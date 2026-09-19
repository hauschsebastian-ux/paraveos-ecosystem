/* Konto & Sicherheit: Profil, Passwort, 2FA, Sitzungen, Datenschutz */
(function () {
  'use strict';
  const { esc, qs } = CE;

  CE.views.account = async function (main) {
    const [{ user: u }, { sessions }] = await Promise.all([CE.get('/account'), CE.get('/account/sessions')]);
    main.innerHTML = `<div class="page-head"><div><h1>Konto & Sicherheit</h1><div class="sub">${esc(u.email)} · ${CE.ROLE[u.role]}</div></div></div>
      <div class="grid cols-2" style="align-items:start">
        <div class="stack">
          <div class="card"><h2>Profil</h2><form id="pf"><div class="field"><label>Name</label><input type="text" name="name" value="${esc(u.name)}" required></div><div class="field"><label>Telefon</label><input type="tel" name="phone" value="${esc(u.phone || '')}"></div><button class="btn">Speichern</button></form></div>
          <div class="card"><h2>Passwort ändern</h2><form id="pwf"><div class="field"><label>Aktuelles Passwort</label><input type="password" name="current_password" required autocomplete="current-password"></div><div class="field"><label>Neues Passwort</label><input type="password" name="new_password" required minlength="12" autocomplete="new-password"><div class="help">Mind. 12 Zeichen, Groß-/Kleinbuchstaben und Ziffer.</div></div><button class="btn">Passwort ändern</button></form></div>
          <div class="card"><h2>Aktive Sitzungen</h2>${sessions.map((s) => `<div class="list-item"><div><strong>${s.current ? 'Diese Sitzung' : 'Sitzung'}</strong><div class="small muted">${esc(s.ip || '')} · ${esc((s.user_agent || '').slice(0, 60))}</div><div class="small faint">zuletzt aktiv ${CE.fmtDateTime(s.last_seen_at)}</div></div>${s.current ? '<span class="badge green">aktuell</span>' : ''}</div>`).join('')}
            ${sessions.length > 1 ? '<button class="btn sm mt" id="revoke">Alle anderen Sitzungen beenden</button>' : ''}</div>
        </div>
        <div class="stack">
          <div class="card"><div class="card-head"><h2>Zwei-Faktor-Authentifizierung</h2>${u.totp_enabled ? '<span class="badge green">aktiv</span>' : '<span class="badge orange">nicht aktiv</span>'}</div>
            <div id="tfaBox">${u.totp_enabled ? `<p class="small muted">Dein Konto ist zusätzlich durch einen Einmalcode geschützt.</p>${u.totp_setup_required || ['admin', 'dj'].includes(u.role) ? '<p class="small faint">Für deine Rolle ist 2FA verpflichtend.</p>' : `<form id="dis" class="inline-form"><div class="field"><label>Passwort</label><input type="password" name="password" required></div><div class="field"><label>Code</label><input type="text" name="code" required inputmode="numeric"></div><button class="btn danger">2FA deaktivieren</button></form>`}` : `<p class="small muted">Schütze dein Konto mit einem zweiten Faktor (Authenticator-App). Empfohlen für alle Nutzer.</p><button class="btn primary" id="startTfa">2FA einrichten</button>`}</div></div>
          <div class="card"><h2>Datenschutz (DSGVO)</h2>
            <p class="small muted">Du hast das Recht auf Auskunft (Art. 15), Datenübertragbarkeit (Art. 20) und Löschung (Art. 17). Deine Daten werden verschlüsselt übertragen und gespeichert und ausschließlich zur Planung und Abwicklung deines Events verarbeitet.</p>
            <div class="row"><a class="btn" href="/api/account/export">Datenauskunft herunterladen</a>
            ${u.role !== 'admin' ? (u.deletion_requested_at ? `<button class="btn" id="withdraw">Löschantrag zurückziehen</button>` : `<button class="btn danger" id="delReq">Löschung beantragen</button>`) : ''}</div>
            ${u.deletion_requested_at ? `<div class="alert warn small mt">Löschantrag gestellt am ${CE.fmtDateTime(u.deletion_requested_at)}. Cosmos Events prüft gesetzliche Aufbewahrungsfristen und anonymisiert deine Daten anschließend.</div>` : ''}
          </div>
        </div></div>`;
    qs('#pf', main).addEventListener('submit', async (e) => { e.preventDefault(); try { await CE.patch('/account/profile', CE.formData(e.target)); CE.state.user = null; CE.toast('Profil gespeichert', 'success'); CE.render(); } catch (err) { CE.error(err); } });
    qs('#pwf', main).addEventListener('submit', async (e) => { e.preventDefault(); try { await CE.post('/account/password', CE.formData(e.target)); CE.toast('Passwort geändert. Andere Sitzungen wurden beendet.', 'success'); e.target.reset(); } catch (err) { CE.error(err); } });
    const rv = qs('#revoke', main); if (rv) rv.addEventListener('click', async () => { await CE.post('/account/sessions/revoke-others', {}); CE.toast('Andere Sitzungen beendet', 'success'); CE.render(); });
    const st = qs('#startTfa', main); if (st) st.addEventListener('click', () => CE.render2faSetup(qs('#tfaBox', main), { onDone: () => CE.render() }));
    const dis = qs('#dis', main); if (dis) dis.addEventListener('submit', async (e) => { e.preventDefault(); try { await CE.post('/account/2fa/disable', CE.formData(e.target)); CE.toast('2FA deaktiviert'); CE.render(); } catch (err) { CE.error(err); } });
    const dr = qs('#delReq', main); if (dr) dr.addEventListener('click', async () => { if (await CE.confirm('Löschung deiner personenbezogenen Daten beantragen? Cosmos Events meldet sich bei dir.', { danger: true, ok: 'Beantragen' })) { await CE.post('/account/deletion-request', {}); CE.render(); } });
    const wd = qs('#withdraw', main); if (wd) wd.addEventListener('click', async () => { await CE.del('/account/deletion-request'); CE.render(); });
  };
})();
