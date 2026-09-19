/* Cosmos Events – Kernfunktionen: API, Router, Rendering-Helfer */
(function () {
  'use strict';
  const CE = (window.CE = { views: {}, state: { user: null, caps: {}, events: null } });

  // ---------- Hilfsfunktionen ----------
  CE.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  CE.qs = (sel, root = document) => root.querySelector(sel);
  CE.qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  CE.fmtEur = (cents) => (Number(cents || 0) / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  CE.fmtDate = (iso) => {
    if (!iso) return '–';
    const d = new Date(String(iso).length <= 10 ? iso + 'T12:00:00' : iso);
    return isNaN(d) ? String(iso) : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  CE.fmtDateLong = (iso) => {
    if (!iso) return '–';
    const d = new Date(String(iso).length <= 10 ? iso + 'T12:00:00' : iso);
    return isNaN(d) ? String(iso) : d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  CE.fmtDateTime = (iso) => {
    if (!iso) return '–';
    const d = new Date(iso.length === 16 ? iso : iso.replace(' ', 'T') + (iso.endsWith('Z') || iso.includes('+') ? '' : 'Z'));
    return isNaN(d) ? String(iso) : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  CE.daysUntil = (iso) => {
    if (!iso) return null;
    const d = new Date(iso.slice(0, 10) + 'T12:00:00');
    return Math.round((d - new Date()) / 86400000);
  };
  CE.todayIso = () => new Date().toISOString().slice(0, 10);
  CE.bytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  CE.STATUS = {
    anfrage: ['Anfrage', 'gray'], gebucht: ['Gebucht', 'blue'], planung: ['In Planung', 'gold'],
    final: ['Final', 'violet'], abgeschlossen: ['Abgeschlossen', 'green'], storniert: ['Storniert', 'red'],
  };
  CE.statusBadge = (s) => { const [l, c] = CE.STATUS[s] || [s, 'gray']; return `<span class="badge ${c}">${CE.esc(l)}</span>`; };
  CE.ROLE = { admin: 'Admin', dj: 'DJ', customer: 'Kunde' };
  CE.CATEGORY = { ablaufplan: 'Ablaufplan', vertrag: 'Vertrag', location: 'Location / Bilder', aufbauplan: 'Aufbauplan', tagesbeschreibung: 'Tagesbeschreibung', rechnung: 'Rechnung', sonstiges: 'Sonstiges' };
  CE.APPT = { update_call: 'Update-Gespräch', final_meeting: 'Finale Besprechung', site_visit: 'Location-Besichtigung', other: 'Termin' };
  CE.PAY = { offen: ['Offen', 'orange'], anzahlung: ['Anzahlung erhalten', 'blue'], bezahlt: ['Bezahlt', 'green'] };

  // ---------- API ----------
  class ApiError extends Error { constructor(status, body) { super(body?.error || `Fehler ${status}`); this.status = status; this.body = body || {}; this.code = body?.code; } }
  CE.ApiError = ApiError;
  CE.api = async function (method, url, body, opts = {}) {
    const headers = {};
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch('/api' + url, { method, headers, body: payload, credentials: 'same-origin' });
    if (opts.raw) return res;
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { error: text }; }
    if (!res.ok) {
      const err = new ApiError(res.status, json);
      if (res.status === 401 && !opts.quiet) { CE.state.user = null; if (err.code !== 'pending_2fa') CE.navigate('/login'); }
      if (res.status === 403 && err.code === 'totp_setup_required') CE.navigate('/setup-2fa');
      if (res.status === 403 && err.code === 'password_change_required') CE.navigate('/change-password');
      throw err;
    }
    return json;
  };
  CE.get = (u, o) => CE.api('GET', u, undefined, o);
  CE.post = (u, b, o) => CE.api('POST', u, b, o);
  CE.put = (u, b, o) => CE.api('PUT', u, b, o);
  CE.patch = (u, b, o) => CE.api('PATCH', u, b, o);
  CE.del = (u, o) => CE.api('DELETE', u, undefined, o);

  // ---------- UI-Helfer ----------
  CE.toast = function (msg, type = 'info', ms = 3500) {
    const el = document.createElement('div');
    el.className = `toast ${type}`; el.textContent = msg;
    CE.qs('#toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  };
  CE.error = (e) => { console.error(e); CE.toast(e?.message || 'Unbekannter Fehler', 'error', 5000); };

  CE.modal = function (html, { onMount } = {}) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => bg.remove();
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    bg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    document.body.appendChild(bg);
    const first = bg.querySelector('input, select, textarea, button');
    if (first) first.focus();
    if (onMount) onMount(bg.firstElementChild, close);
    return close;
  };
  CE.confirm = (text, { danger = false, ok = 'Bestätigen' } = {}) => new Promise((resolve) => {
    CE.modal(`<h2>Bist du sicher?</h2><p>${CE.esc(text)}</p><div class="actions"><button class="btn" data-close>Abbrechen</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${CE.esc(ok)}</button></div>`, {
      onMount(m, close) {
        m.querySelector('[data-ok]').addEventListener('click', () => { close(); resolve(true); });
        m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(false)));
      },
    });
  });
  CE.formData = (form) => {
    const out = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
      else out[el.name] = el.value;
    }
    return out;
  };
  // Akzeptiert "2490", "2490,50", "2.490,50" und "2490.50"
  CE.eurToCents = (v) => {
    let s = String(v ?? '').trim().replace(/[€\s]/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    return Math.round(parseFloat(s) * 100) || 0;
  };
  CE.centsToEurInput = (c) => (Number(c || 0) / 100).toFixed(2).replace('.', ',');
  CE.debounce = (fn, ms = 600) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  CE.ring = (percent, size = 150) => {
    const r = (size - 14) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, percent)) / 100);
    return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="12"/><circle class="bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="12" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg><div class="val"><strong>${percent}%</strong><span>geplant</span></div></div>`;
  };
  CE.milestones = (ms) => `<div class="milestones">${ms.map((m, i) => `<div class="milestone ${m.state}"><div class="dot">${m.state === 'done' ? '✓' : i + 1}</div><div class="t">${CE.esc(m.title)}</div><div class="d">${CE.esc(m.detail || '')}</div></div>`).join('')}</div>`;
  CE.empty = (icon, text) => `<div class="empty"><div class="big">${icon}</div>${CE.esc(text)}</div>`;

  // ---------- Router ----------
  CE.navigate = (path) => { if (location.hash !== '#' + path) location.hash = path; else CE.render(); };
  CE.route = () => {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, query = ''] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    return { path, parts, query: Object.fromEntries(new URLSearchParams(query)) };
  };
  CE.hash = (path, q) => '#' + path + (q ? '?' + new URLSearchParams(q).toString() : '');
})();
