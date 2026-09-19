/* Login, 2FA-Abfrage, erzwungene 2FA-Einrichtung, erzwungener Passwortwechsel */
(function () {
  'use strict';
  const { esc, qs } = CE;

  const brand = `<div class="brand"><div class="logo"></div><div><strong>Cosmos Events</strong><span>Member-Dashboard</span></div></div>`;

  CE.views.login = function (root) {
    root.innerHTML = `<div class="auth"><div class="card">${brand}
      <h1 class="center" style="font-size:1.25rem">Anmelden</h1>
      <p class="muted center small">Für Brautpaare, Kunden, DJs und das Cosmos-Team.</p>
      <form id="loginForm" autocomplete="on">
        <div class="field"><label>E-Mail</label><input type="email" name="email" required autocomplete="username" autofocus></div>
        <div class="field"><label>Passwort</label><input type="password" name="password" required autocomplete="current-password"></div>
        <div class="err mb" id="loginErr"></div>
        <button class="btn primary block" type="submit">Anmelden</button>
      </form>
      <form id="totpForm" class="hidden">
        <p>Bitte gib den 6-stelligen Code aus deiner Authenticator-App ein.</p>
        <div class="field"><label>Code</label><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" required></div>
        <p class="small faint">Kein Zugriff auf die App? Gib einen deiner Wiederherstellungscodes ein.</p>
        <div class="err mb" id="totpErr"></div>
        <button class="btn primary block" type="submit">Bestätigen</button>
        <button class="btn ghost block mt" type="button" id="backToLogin">Zurück</button>
      </form>
      <p class="small faint center mt">Verschlüsselte Verbindung · Zwei-Faktor-Schutz · DSGVO-konform</p>
    </div></div>`;
    const lf = qs('#loginForm'), tf = qs('#totpForm');
    lf.addEventListener('submit', async (e) => {
      e.preventDefault();
      qs('#loginErr').textContent = '';
      const btn = lf.querySelector('button'); btn.disabled = true;
      try {
        const r = await CE.post('/auth/login', CE.formData(lf), { quiet: true });
        if (r.requires_2fa) { lf.classList.add('hidden'); tf.classList.remove('hidden'); tf.code.focus(); }
        else await CE.afterLogin();
      } catch (err) { qs('#loginErr').textContent = err.message; }
      finally { btn.disabled = false; }
    });
    tf.addEventListener('submit', async (e) => {
      e.preventDefault();
      qs('#totpErr').textContent = '';
      try { await CE.post('/auth/2fa', { code: tf.code.value }, { quiet: true }); await CE.afterLogin(); }
      catch (err) { qs('#totpErr').textContent = err.message; }
    });
    qs('#backToLogin').addEventListener('click', async () => { await CE.post('/auth/logout', {}, { quiet: true }).catch(() => {}); CE.views.login(root); });
  };

  CE.afterLogin = async function () {
    const me = await CE.get('/auth/me');
    CE.state.user = me.user; CE.state.caps = me.capabilities; CE.state.events = null;
    if (me.user.totp_setup_required) return CE.navigate('/setup-2fa');
    if (me.user.must_change_password) return CE.navigate('/change-password');
    CE.navigate('/');
  };

  // Erzwungene 2FA-Einrichtung (Admin/DJ) – auch als Komponente im Konto nutzbar
  CE.render2faSetup = async function (container, { forced = false, onDone } = {}) {
    container.innerHTML = '<div class="spinner"></div>';
    let setup;
    try { setup = await CE.post('/account/2fa/setup', {}); } catch (e) { container.innerHTML = `<div class="alert danger">${esc(e.message)}</div>`; return; }
    container.innerHTML = `
      ${forced ? '<div class="alert warn">Für deine Rolle ist die Zwei-Faktor-Authentifizierung verpflichtend. Bitte richte sie jetzt ein.</div>' : ''}
      <ol class="small muted" style="padding-left:1.2rem">
        <li>Installiere eine Authenticator-App (z. B. Google Authenticator, Microsoft Authenticator, Aegis, 1Password).</li>
        <li>Scanne den QR-Code oder gib den Schlüssel manuell ein.</li>
        <li>Bestätige mit dem angezeigten 6-stelligen Code.</li>
      </ol>
      <div class="row" style="align-items:flex-start">
        <div class="qr"><img src="${setup.qr}" alt="QR-Code" width="200" height="200"></div>
        <div class="grow"><div class="field"><label>Schlüssel (manuell)</label><code class="mono" style="word-break:break-all">${esc(setup.secret)}</code></div>
          <form id="enableForm"><div class="field"><label>Code aus der App</label><input type="text" name="code" inputmode="numeric" placeholder="123456" required autocomplete="one-time-code"></div>
          <div class="err mb" id="enableErr"></div><button class="btn primary" type="submit">2FA aktivieren</button></form></div>
      </div>`;
    qs('#enableForm', container).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await CE.post('/account/2fa/enable', { code: e.target.code.value });
        container.innerHTML = `<div class="alert success">Zwei-Faktor-Authentifizierung ist aktiv.</div>
          <h3>Wiederherstellungscodes</h3>
          <p class="small muted">Bewahre diese Codes sicher auf (z. B. Passwort-Manager). Jeder Code funktioniert genau einmal, falls du keinen Zugriff auf deine App hast. Sie werden <strong>nicht erneut angezeigt</strong>.</p>
          <div class="recovery mb">${r.recovery_codes.map((c) => `<code>${esc(c)}</code>`).join('')}</div>
          <div class="row"><button class="btn" id="copyCodes">Codes kopieren</button><button class="btn primary" id="doneCodes">Ich habe die Codes gesichert</button></div>`;
        qs('#copyCodes', container).addEventListener('click', () => navigator.clipboard.writeText(r.recovery_codes.join('\n')).then(() => CE.toast('Kopiert', 'success')));
        qs('#doneCodes', container).addEventListener('click', async () => {
          const me = await CE.get('/auth/me'); CE.state.user = me.user;
          if (onDone) onDone(); else CE.navigate('/');
        });
      } catch (err) { qs('#enableErr', container).textContent = err.message; }
    });
  };

  CE.views.setup2fa = function (root) {
    root.innerHTML = `<div class="auth"><div class="card" style="max-width:640px">${brand}<h2>Zwei-Faktor-Authentifizierung einrichten</h2><div id="setupBox"></div>
      <p class="mt small"><a href="#" id="logoutLink">Abmelden</a></p></div></div>`;
    CE.render2faSetup(qs('#setupBox'), { forced: true });
    qs('#logoutLink').addEventListener('click', async (e) => { e.preventDefault(); await CE.logout(); });
  };

  CE.views.changePassword = function (root) {
    root.innerHTML = `<div class="auth"><div class="card">${brand}<h2>Neues Passwort festlegen</h2>
      <div class="alert info small">Du hast ein Initialpasswort erhalten. Bitte lege jetzt ein eigenes, sicheres Passwort fest (mind. 12 Zeichen, Groß-/Kleinbuchstaben und Ziffer).</div>
      <form id="pwForm">
        <div class="field"><label>Aktuelles Passwort</label><input type="password" name="current_password" required autocomplete="current-password"></div>
        <div class="field"><label>Neues Passwort</label><input type="password" name="new_password" required minlength="12" autocomplete="new-password"></div>
        <div class="field"><label>Neues Passwort wiederholen</label><input type="password" name="repeat" required autocomplete="new-password"></div>
        <div class="err mb" id="pwErr"></div>
        <button class="btn primary block" type="submit">Passwort speichern</button>
      </form><p class="mt small"><a href="#" id="logoutLink">Abmelden</a></p></div></div>`;
    qs('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = CE.formData(e.target);
      if (d.new_password !== d.repeat) { qs('#pwErr').textContent = 'Die Passwörter stimmen nicht überein.'; return; }
      try { await CE.post('/account/password', d); CE.toast('Passwort geändert', 'success'); await CE.afterLogin(); }
      catch (err) { qs('#pwErr').textContent = err.message; }
    });
    qs('#logoutLink').addEventListener('click', async (e) => { e.preventDefault(); await CE.logout(); });
  };

  CE.logout = async function () {
    await CE.post('/auth/logout', {}, { quiet: true }).catch(() => {});
    CE.state.user = null; CE.state.events = null;
    CE.navigate('/login');
  };
})();
