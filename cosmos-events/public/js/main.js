/* App-Shell, Navigation und Routing */
(function () {
  'use strict';
  const { esc, qs } = CE;

  const NAV = {
    customer: [
      { path: '/', icon: '🏠', label: 'Übersicht' },
      { path: '/questionnaire', icon: '📝', label: 'Fragebogen' },
      { path: '/music', icon: '🎵', label: 'Musik' },
      { path: '/timeline', icon: '📅', label: 'Termine & Aufgaben' },
      { path: '/documents', icon: '📎', label: 'Dokumente' },
      { path: '/event', icon: '💍', label: 'Mein Event' },
      { section: 'Konto' },
      { path: '/account', icon: '👤', label: 'Konto & Sicherheit' },
    ],
    dj: [
      { path: '/', icon: '🏠', label: 'Dashboard' },
      { path: '/events', icon: '🎧', label: 'Meine Events' },
      { path: '/calendar', icon: '📅', label: 'Kalender' },
      { path: '/finance', icon: '💶', label: 'Umsatz & Gage' },
      { section: 'Konto' },
      { path: '/account', icon: '👤', label: 'Konto & Sicherheit' },
    ],
    admin: [
      { path: '/', icon: '🏠', label: 'Dashboard' },
      { path: '/events', icon: '🎉', label: 'Events' },
      { path: '/calendar', icon: '📅', label: 'Kalender' },
      { path: '/users', icon: '👥', label: 'Kunden & DJs' },
      { path: '/finance', icon: '💶', label: 'Finanzen' },
      { section: 'System' },
      { path: '/audit', icon: '🛡️', label: 'Sicherheit & Backups' },
      { path: '/account', icon: '👤', label: 'Konto & Sicherheit' },
    ],
  };

  function shell(activePath) {
    const u = CE.state.user;
    const items = NAV[u.role].map((n) => n.section
      ? `<div class="section">${esc(n.section)}</div>`
      : `<a href="#${n.path}" class="${activePath === n.path || (n.path !== '/' && activePath.startsWith(n.path)) ? 'active' : ''}"><span class="ico">${n.icon}</span>${esc(n.label)}</a>`).join('');
    return `<div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><div class="logo"></div><div><strong>Cosmos Events</strong><span>${esc(CE.ROLE[u.role])}-Bereich</span></div></div>
        <nav class="nav">${items}</nav>
        <div class="user"><strong>${esc(u.name)}</strong><span>${esc(u.email)}</span><div class="mt"><button class="btn sm block" id="logoutBtn">Abmelden</button></div></div>
      </aside>
      <div>
        <div class="topbar"><button class="btn icon" id="menuBtn" aria-label="Menü">☰</button><strong>Cosmos Events</strong><span class="small muted">${esc(u.name)}</span></div>
        <main class="main" id="main"><div class="spinner"></div></main>
      </div></div>`;
  }

  // Routen je Rolle: Pfad-Präfix → View-Funktion(main, route)
  const ROUTES = {
    customer: [
      ['/questionnaire', 'customerQuestionnaire'], ['/music', 'customerMusic'], ['/timeline', 'customerTimeline'],
      ['/documents', 'customerDocuments'], ['/event', 'customerEvent'], ['/account', 'account'], ['/', 'customerHome'],
    ],
    dj: [
      ['/events/', 'eventDetail'], ['/events', 'djEvents'], ['/calendar', 'calendar'], ['/finance', 'djFinance'], ['/account', 'account'], ['/', 'djHome'],
    ],
    admin: [
      ['/events/new', 'adminEventForm'], ['/events/', 'eventDetail'], ['/events', 'adminEvents'], ['/calendar', 'calendar'],
      ['/users', 'adminUsers'], ['/finance', 'adminFinance'], ['/audit', 'adminAudit'], ['/account', 'account'], ['/', 'adminHome'],
    ],
  };

  let lastShellRole = null;
  CE.render = async function () {
    const root = qs('#app');
    const route = CE.route();
    if (!CE.state.user) {
      try {
        const me = await CE.get('/auth/me', { quiet: true });
        CE.state.user = me.user; CE.state.caps = me.capabilities;
      } catch (e) {
        lastShellRole = null;
        if (e.code === 'pending_2fa') { await CE.post('/auth/logout', {}, { quiet: true }).catch(() => {}); }
        return CE.views.login(root);
      }
    }
    const u = CE.state.user;
    if (route.path === '/login') return CE.navigate('/');
    if (u.totp_setup_required) { lastShellRole = null; return CE.views.setup2fa(root); }
    if (u.must_change_password) { lastShellRole = null; return CE.views.changePassword(root); }
    if (route.path === '/setup-2fa' || route.path === '/change-password') return CE.navigate('/');

    if (lastShellRole !== u.role || !qs('#main')) {
      root.innerHTML = shell(route.path);
      lastShellRole = u.role;
      qs('#logoutBtn').addEventListener('click', CE.logout);
      qs('#menuBtn').addEventListener('click', () => qs('#sidebar').classList.toggle('open'));
      qs('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) qs('#sidebar').classList.remove('open'); });
    } else {
      CE.qsa('.nav a').forEach((a) => {
        const p = a.getAttribute('href').slice(1);
        a.classList.toggle('active', route.path === p || (p !== '/' && route.path.startsWith(p)));
      });
    }
    const main = qs('#main');
    const match = ROUTES[u.role].find(([prefix]) => route.path === prefix || route.path.startsWith(prefix));
    const view = match && CE.views[match[1]];
    main.innerHTML = '<div class="spinner"></div>';
    window.scrollTo(0, 0);
    try {
      if (!view) main.innerHTML = CE.empty('🛰️', 'Seite nicht gefunden.');
      else await view(main, route);
    } catch (e) {
      if (e.status === 401) return;
      console.error(e);
      main.innerHTML = `<div class="alert danger">${esc(e.message || 'Fehler beim Laden')}</div>`;
    }
  };

  // Events des Nutzers (gecacht)
  CE.loadEvents = async function (force = false) {
    if (!CE.state.events || force) CE.state.events = (await CE.get('/events')).events;
    return CE.state.events;
  };

  window.addEventListener('hashchange', CE.render);
  CE.render();
})();
