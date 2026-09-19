/* Wiederverwendbare Event-Bereiche: Übersicht, Fragebogen, Musik, Dokumente, Termine, Finanzen, Kalender */
(function () {
  'use strict';
  const { esc, qs, qsa } = CE;
  const S = (CE.sections = {});

  // ---------- Fortschritt ----------
  S.progress = function (container, ev, detail) {
    const p = detail || ev.progress_detail;
    container.innerHTML = `<div class="row" style="align-items:center;gap:1.5rem">
      ${CE.ring(p.percent)}
      <div class="grow"><h2 style="margin-bottom:.25rem">Planungsfortschritt</h2>
        <p class="muted small">Fragebogen ${p.weights.questionnaire} % · Musik ${p.weights.music} % · Update-Gespräch ${p.weights.update_call} % · Finale Besprechung ${p.weights.final_meeting} % · Event ${p.weights.completed} %</p>
        ${p.final_meeting_due ? `<div class="alert warn small" style="margin:.5rem 0">Ihr seid fast am Ziel: Ab ca. ${p.final_meeting_threshold} % empfehlen wir die finale Besprechung. Bitte einen Termin vereinbaren.</div>` : ''}
        ${p.recommendations.length ? `<div class="small"><strong>Nächste Schritte:</strong><ul style="margin:.25rem 0 0;padding-left:1.2rem">${p.recommendations.map((r) => `<li>${esc(r.text)}</li>`).join('')}</ul></div>` : '<div class="small" style="color:var(--success)">Alles erledigt – wir freuen uns auf euer Event! 🎉</div>'}
      </div></div>
      <div class="mt">${CE.milestones(p.milestones)}</div>`;
  };

  // ---------- Stammdaten ----------
  S.overview = function (container, ev, role) {
    const days = CE.daysUntil(ev.event_date);
    const rows = [
      ['Event', esc(ev.title)], ['Art', esc(ev.event_type)], ['Status', CE.statusBadge(ev.status)],
      ['Datum', `${CE.fmtDateLong(ev.event_date)}${days !== null && days >= 0 && ev.status !== 'abgeschlossen' ? ` <span class="badge gold">in ${days} Tagen</span>` : ''}`],
      ['Uhrzeit', esc([ev.start_time, ev.end_time].filter(Boolean).join(' – ') || '–')],
      ['Gäste', esc(ev.guest_count ?? '–')],
      ['Location', `${esc(ev.location_name || '–')}${ev.location_address ? `<br><span class="muted small">${esc(ev.location_address)}</span>` : ''}`],
      ['DJ', ev.dj_name ? `${esc(ev.dj_name)}${role !== 'customer' && ev.dj_phone ? ` · <span class="muted">${esc(ev.dj_phone)}</span>` : ''}` : '<span class="muted">wird noch zugewiesen</span>'],
    ];
    if (role !== 'customer') rows.push(['Kunde', `${esc(ev.customer_name || '–')}${ev.customer_email ? `<br><span class="muted small">${esc(ev.customer_email)}${ev.customer_phone ? ' · ' + esc(ev.customer_phone) : ''}</span>` : ''}`]);
    rows.push(['Vertrag', `${esc(ev.contract_number || '–')}${ev.contract_signed_at ? ` <span class="muted small">(unterzeichnet ${CE.fmtDate(ev.contract_signed_at)})</span>` : ''}`]);
    if (role === 'customer' && ev.notes_customer) rows.push(['Hinweis von Cosmos Events', esc(ev.notes_customer)]);
    if (role !== 'customer' && ev.notes_internal) rows.push(['Interne Notizen', esc(ev.notes_internal)]);
    container.innerHTML = `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  };

  // ---------- Fragebogen ----------
  S.questionnaire = async function (container, ev, { readonly = false } = {}) {
    const q = await CE.get(`/questionnaire/${ev.id}`);
    const schema = q.schema; let data = q.data; let step = Math.min(q.current_step || 0, schema.sections.length - 1);
    let completion = q.completion;
    const dirty = {};
    const save = CE.debounce(async (extra = {}) => {
      if (readonly) return;
      const payload = { data: { ...dirty }, current_step: step, ...extra };
      Object.keys(dirty).forEach((k) => delete dirty[k]);
      try {
        const r = await CE.put(`/questionnaire/${ev.id}`, payload);
        data = r.data; completion = r.completion;
        qs('#qSaved', container).textContent = 'Gespeichert ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        updateHeader();
        for (const [k, msg] of Object.entries(r.errors || {})) { const el = qs(`[data-err="${k}"]`, container); if (el) el.textContent = msg; }
      } catch (e) { CE.error(e); }
    }, 500);

    const visible = (f) => { if (!f.showIf) return true; const v = data[f.showIf.field]; return Array.isArray(v) ? v.includes(f.showIf.equals) : v === f.showIf.equals; };
    const field = (f) => {
      const v = data[f.id]; const dis = readonly ? 'disabled' : '';
      let input = '';
      switch (f.type) {
        case 'textarea': input = `<textarea name="${f.id}" ${dis}>${esc(v || '')}</textarea>`; break;
        case 'number': input = `<input type="number" name="${f.id}" value="${esc(v ?? '')}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${dis}>`; break;
        case 'date': input = `<input type="date" name="${f.id}" value="${esc(v || '')}" ${dis}>`; break;
        case 'time': input = `<input type="time" name="${f.id}" value="${esc(v || '')}" ${dis}>`; break;
        case 'select': input = `<select name="${f.id}" ${dis}><option value="">Bitte wählen …</option>${(f.options || []).map((o) => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
        case 'radio': input = `<div class="choices">${(f.options || []).map((o) => `<label class="choice ${v === o ? 'on' : ''}"><input type="radio" name="${f.id}" value="${esc(o)}" ${v === o ? 'checked' : ''} ${dis}>${esc(o)}</label>`).join('')}</div>`; break;
        case 'multiselect': input = `<div class="choices">${(f.options || []).map((o) => `<label class="choice ${(v || []).includes(o) ? 'on' : ''}"><input type="checkbox" name="${f.id}" value="${esc(o)}" ${(v || []).includes(o) ? 'checked' : ''} ${dis}>${esc(o)}</label>`).join('')}</div>`; break;
        case 'boolean': input = `<label class="check"><input type="checkbox" name="${f.id}" ${v === true ? 'checked' : ''} ${dis}><span>${esc(f.label)}</span></label>`; break;
        default: input = `<input type="text" name="${f.id}" value="${esc(v || '')}" ${dis}>`;
      }
      return `<div class="field" data-field="${f.id}" ${visible(f) ? '' : 'style="display:none"'}>${f.type !== 'boolean' ? `<label>${esc(f.label)}${f.required ? ' <span style="color:var(--accent)">*</span>' : ''}</label>` : ''}${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}${input}<div class="err" data-err="${f.id}"></div></div>`;
    };

    const render = () => {
      const sec = schema.sections[step];
      container.innerHTML = `
        <div class="card-head"><div><h2>${esc(schema.title || 'Fragebogen')}</h2><div class="small muted" id="qHead"></div></div><div class="small faint" id="qSaved">${q.updated_at ? 'Zuletzt gespeichert ' + CE.fmtDateTime(q.updated_at) : ''}</div></div>
        <div class="progress-bar mb"><span id="qBar" style="width:${completion.percent}%"></span></div>
        <div class="stepper">${schema.sections.map((s, i) => { const c = completion.sections.find((x) => x.id === s.id); return `<button type="button" class="step ${i === step ? 'current' : ''} ${c && c.complete && c.required > 0 ? 'complete' : ''}" data-step="${i}"><span class="n">${c && c.complete && c.required > 0 ? '✓' : i + 1}</span>${esc(s.title)}</button>`; }).join('')}</div>
        <h3>${sec.icon || ''} ${esc(sec.title)}</h3>
        ${sec.description ? `<p class="muted small">${esc(sec.description)}</p>` : ''}
        ${readonly ? '<div class="alert info small">Nur-Lese-Ansicht: Der Fragebogen wird vom Kunden ausgefüllt.</div>' : ''}
        <form id="qForm" autocomplete="off">${sec.fields.map(field).join('')}</form>
        <div class="row between mt">
          <button class="btn" id="qPrev" ${step === 0 ? 'disabled' : ''}>← Zurück</button>
          <div class="row">
            ${!readonly && step === schema.sections.length - 1 ? `<button class="btn primary" id="qSubmit" ${completion.percent < 100 ? 'disabled title="Bitte zuerst alle Pflichtfelder ausfüllen"' : ''}>${q.submitted_at ? 'Erneut absenden' : 'Fragebogen absenden'}</button>` : ''}
            ${step < schema.sections.length - 1 ? `<button class="btn primary" id="qNext">Weiter →</button>` : ''}
          </div></div>
        ${q.submitted_at ? `<p class="small faint mt">Abgesendet am ${CE.fmtDateTime(q.submitted_at)}. Änderungen sind weiterhin möglich.</p>` : ''}`;
      updateHeader();
      const form = qs('#qForm', container);
      form.addEventListener('input', onChange);
      form.addEventListener('change', onChange);
      qsa('[data-step]', container).forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.step))));
      qs('#qPrev', container).addEventListener('click', () => go(step - 1));
      const nx = qs('#qNext', container); if (nx) nx.addEventListener('click', () => go(step + 1));
      const sb = qs('#qSubmit', container); if (sb) sb.addEventListener('click', async () => {
        try { const r = await CE.put(`/questionnaire/${ev.id}`, { submit: true, current_step: step }); q.submitted_at = r.submitted_at; completion = r.completion; CE.toast('Fragebogen abgesendet – vielen Dank!', 'success'); render(); }
        catch (e) { CE.error(e); }
      });
    };
    const updateHeader = () => {
      const h = qs('#qHead', container); if (h) h.textContent = `${completion.answered} von ${completion.required} Pflichtangaben · ${completion.percent} %`;
      const b = qs('#qBar', container); if (b) b.style.width = completion.percent + '%';
      qsa('.step', container).forEach((el, i) => { const c = completion.sections.find((x) => x.id === schema.sections[i].id); const done = c && c.complete && c.required > 0; el.classList.toggle('complete', !!done); el.querySelector('.n').textContent = done ? '✓' : i + 1; });
      const sb = qs('#qSubmit', container); if (sb) sb.disabled = completion.percent < 100;
    };
    const onChange = (e) => {
      if (readonly) return;
      const el = e.target; const f = schema.sections[step].fields.find((x) => x.id === el.name); if (!f) return;
      let v;
      if (f.type === 'multiselect') v = qsa(`input[name="${f.id}"]:checked`, container).map((i) => i.value);
      else if (f.type === 'boolean') v = el.checked;
      else if (f.type === 'radio') v = el.value;
      else v = el.value;
      data[f.id] = v; dirty[f.id] = v;
      if (f.type === 'radio' || f.type === 'multiselect') qsa(`input[name="${f.id}"]`, container).forEach((i) => i.closest('.choice').classList.toggle('on', i.checked));
      // Sichtbarkeit abhängiger Felder aktualisieren
      qsa('[data-field]', container).forEach((box) => { const ff = schema.sections[step].fields.find((x) => x.id === box.dataset.field); box.style.display = visible(ff) ? '' : 'none'; });
      qs(`[data-err="${f.id}"]`, container).textContent = '';
      // lokal Fortschritt schätzen bis Server antwortet
      save();
    };
    const go = (n) => { step = Math.max(0, Math.min(schema.sections.length - 1, n)); if (!readonly) { dirty.__step = true; delete dirty.__step; save({}); } render(); };
    render();
  };

  // ---------- Musik ----------
  S.music = async function (container, ev, { readonly = false } = {}) {
    let { wishes, program_slots, spotify } = await CE.get(`/music/events/${ev.id}`);
    const CATS = [['mustplay', 'Must-Plays', '🔥', 'Diese Songs müssen laufen.'], ['wunsch', 'Musikwünsche', '💫', 'Songs, die euch gefallen – der DJ entscheidet passend zur Stimmung.'], ['nogo', 'No-Gos', '🚫', 'Bitte auf keinen Fall spielen.'], ['programm', 'Programmpunkte', '🎬', 'Songs für besondere Momente (Einzug, Eröffnungstanz, …).']];
    let cat = 'mustplay';
    const cover = (t) => t.image_url ? `<img class="cover" src="${esc(t.image_url)}" alt="">` : `<div class="cover">🎵</div>`;
    const track = (w) => `<div class="track">${cover(w)}<div class="info"><strong>${w.program_slot ? `<span class="badge violet" style="margin-right:.4rem">${esc(w.program_slot)}</span>` : ''}${esc(w.title)}</strong><span>${esc(w.artist || 'Unbekannter Interpret')}${w.album ? ' · ' + esc(w.album) : ''}${w.note ? ' · <em>' + esc(w.note) + '</em>' : ''}</span></div>
      <div class="actions">${w.spotify_id ? `<a class="btn sm ghost" target="_blank" rel="noopener" href="https://open.spotify.com/track/${esc(w.spotify_id)}">Spotify ↗</a>` : ''}${w.preview_url ? `<button class="btn sm ghost" data-preview="${esc(w.preview_url)}">▶</button>` : ''}${readonly ? '' : `<button class="btn sm ghost" data-note="${w.id}">✎</button><button class="btn sm ghost" data-del="${w.id}" title="Entfernen">✕</button>`}</div></div>`;
    const render = () => {
      const list = wishes.filter((w) => w.category === cat);
      const c = CATS.find((x) => x[0] === cat);
      container.innerHTML = `
        <div class="card-head"><div><h2>Musikplanung</h2><div class="small muted">${wishes.filter((w) => w.category === 'mustplay').length} Must-Plays · ${wishes.filter((w) => w.category === 'wunsch').length} Wünsche · ${wishes.filter((w) => w.category === 'nogo').length} No-Gos · ${wishes.filter((w) => w.category === 'programm').length} Programm-Songs</div></div>
          <a class="btn sm" href="/api/music/events/${ev.id}/export.txt">Liste exportieren</a></div>
        <div class="tabs">${CATS.map(([k, l, i]) => `<button class="tab ${k === cat ? 'active' : ''}" data-cat="${k}">${i} ${l} <span class="badge gray">${wishes.filter((w) => w.category === k).length}</span></button>`).join('')}</div>
        <p class="muted small">${c[3]}</p>
        ${readonly ? '' : `<div class="card pad-sm mb" style="box-shadow:none">
          <div class="row" style="align-items:flex-end">
            <div class="field grow" style="margin:0"><label>${spotify ? 'Song suchen (Titel, Interpret oder Spotify-Link)' : 'Song manuell eintragen'}</label>
              ${spotify ? `<input type="search" id="mSearch" placeholder="z. B. Dancing Queen ABBA">` : `<div class="row"><input type="text" id="mTitle" placeholder="Titel" class="grow"><input type="text" id="mArtist" placeholder="Interpret" class="grow"></div>`}</div>
            ${cat === 'programm' ? `<div class="field" style="margin:0;min-width:180px"><label>Programmpunkt</label><select id="mSlot">${program_slots.map((s) => `<option>${esc(s)}</option>`).join('')}<option value="__custom">Eigener Programmpunkt …</option></select></div>` : ''}
            ${spotify ? '' : `<button class="btn primary" id="mAdd">Hinzufügen</button>`}
          </div>
          ${spotify ? '' : '<div class="small faint mt">Tipp: Sobald Spotify verbunden ist, könnt ihr hier direkt suchen und Songs mit Cover übernehmen.</div>'}
          <div id="mResults"></div></div>`}
        <div id="mList">${list.length ? list.map(track).join('') : CE.empty(c[2], `Noch keine Einträge unter „${c[1]}“.`)}</div>
        <audio id="mAudio"></audio>`;
      qsa('[data-cat]', container).forEach((b) => b.addEventListener('click', () => { cat = b.dataset.cat; render(); }));
      bind();
    };
    const slotValue = () => {
      const sel = qs('#mSlot', container); if (!sel) return null;
      if (sel.value === '__custom') return prompt('Programmpunkt (z. B. Ringtausch):') || null;
      return sel.value;
    };
    const add = async (t) => {
      const slot = slotValue(); if (cat === 'programm' && !slot) return;
      try { await CE.post(`/music/events/${ev.id}`, { ...t, category: cat, program_slot: slot }); await reload(); CE.toast('Song hinzugefügt', 'success'); }
      catch (e) { CE.error(e); }
    };
    const reload = async () => { wishes = (await CE.get(`/music/events/${ev.id}`)).wishes; render(); };
    const bind = () => {
      const s = qs('#mSearch', container);
      if (s) {
        const doSearch = CE.debounce(async () => {
          const q = s.value.trim(); const box = qs('#mResults', container);
          if (q.length < 2) { box.innerHTML = ''; return; }
          box.innerHTML = '<div class="spinner"></div>';
          try {
            const r = await CE.get(`/music/spotify/search?q=${encodeURIComponent(q)}`);
            box.innerHTML = r.tracks.length ? r.tracks.map((t, i) => `<div class="track">${cover(t)}<div class="info"><strong>${esc(t.title)}</strong><span>${esc(t.artist)}${t.album ? ' · ' + esc(t.album) : ''}</span></div><div class="actions">${t.preview_url ? `<button class="btn sm ghost" data-preview="${esc(t.preview_url)}">▶</button>` : ''}<button class="btn sm primary" data-add="${i}">+ Hinzufügen</button></div></div>`).join('') : '<p class="small faint mt">Keine Treffer.</p>';
            qsa('[data-add]', box).forEach((b) => b.addEventListener('click', () => add(r.tracks[Number(b.dataset.add)])));
            bindPreview(box);
          } catch (e) { box.innerHTML = `<p class="small" style="color:var(--danger)">${esc(e.message)}</p>`; }
        }, 400);
        s.addEventListener('input', doSearch);
      }
      const addBtn = qs('#mAdd', container);
      if (addBtn) addBtn.addEventListener('click', () => {
        const title = qs('#mTitle', container).value.trim(); const artist = qs('#mArtist', container).value.trim();
        if (!title) { CE.toast('Bitte einen Titel angeben', 'error'); return; }
        add({ title, artist });
      });
      qsa('[data-del]', container).forEach((b) => b.addEventListener('click', async () => { if (await CE.confirm('Song aus der Liste entfernen?', { danger: true, ok: 'Entfernen' })) { await CE.del(`/music/events/${ev.id}/${b.dataset.del}`); reload(); } }));
      qsa('[data-note]', container).forEach((b) => b.addEventListener('click', () => {
        const w = wishes.find((x) => x.id === Number(b.dataset.note));
        CE.modal(`<h2>Eintrag bearbeiten</h2><form id="nf"><div class="field"><label>Kategorie</label><select name="category">${CATS.map(([k, l]) => `<option value="${k}" ${w.category === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Programmpunkt (nur bei Programmpunkten)</label><input type="text" name="program_slot" value="${esc(w.program_slot || '')}" list="slots"><datalist id="slots">${program_slots.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
          <div class="field"><label>Notiz</label><input type="text" name="note" value="${esc(w.note || '')}" placeholder="z. B. nur die Radio-Version"></div>
          <div class="actions"><button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">Speichern</button></div></form>`, {
          onMount(m, close) { m.querySelector('#nf').addEventListener('submit', async (e) => { e.preventDefault(); try { await CE.patch(`/music/events/${ev.id}/${w.id}`, CE.formData(e.target)); close(); reload(); } catch (err) { CE.error(err); } }); },
        });
      }));
      bindPreview(container);
    };
    const bindPreview = (root) => qsa('[data-preview]', root).forEach((b) => b.addEventListener('click', () => {
      const a = qs('#mAudio', container); if (a.src === b.dataset.preview && !a.paused) { a.pause(); b.textContent = '▶'; return; }
      a.src = b.dataset.preview; a.play(); qsa('[data-preview]', container).forEach((x) => (x.textContent = '▶')); b.textContent = '⏸'; a.onended = () => (b.textContent = '▶');
    }));
    render();
  };

  // ---------- Dokumente ----------
  S.documents = async function (container, ev, role) {
    let { documents, categories, max_bytes } = await CE.get(`/documents/events/${ev.id}`);
    const icon = (m) => (m === 'application/pdf' ? '📄' : m.startsWith('image/') ? '🖼️' : m.includes('sheet') || m.includes('excel') || m.includes('csv') ? '📊' : '📝');
    const allowedCats = categories.filter((c) => role !== 'customer' || !['vertrag', 'rechnung'].includes(c));
    const render = () => {
      container.innerHTML = `<div class="card-head"><h2>Dokumente</h2><span class="small muted">${documents.length} Datei${documents.length === 1 ? '' : 'en'}</span></div>
        <p class="muted small">Ablaufpläne, Beschreibungen des Tages, Bilder der Location, Aufbaupläne und weitere Unterlagen. Alle Dateien werden verschlüsselt gespeichert.</p>
        <form id="upForm" class="card pad-sm mb" style="box-shadow:none">
          <div class="dropzone" id="drop">📎 Datei hierher ziehen oder <u>auswählen</u> (PDF, Bilder, Word, Excel · max. ${Math.round(max_bytes / 1048576)} MB)<input type="file" name="file" class="hidden" id="fileInput" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt,.csv"></div>
          <div id="fileName" class="small mt muted"></div>
          <div class="inline-form mt">
            <div class="field"><label>Kategorie</label><select name="category">${allowedCats.map((c) => `<option value="${c}">${CE.CATEGORY[c] || c}</option>`).join('')}</select></div>
            <div class="field" style="flex:2"><label>Beschreibung (optional)</label><input type="text" name="description" maxlength="500" placeholder="z. B. Ablaufplan Stand 12.10."></div>
            ${role !== 'customer' ? `<div class="field" style="flex:0"><label>&nbsp;</label><label class="check"><input type="checkbox" name="visible_to_customer" checked><span class="small">Für Kunde sichtbar</span></label></div>` : ''}
            <button class="btn primary" type="submit" id="upBtn" disabled>Hochladen</button>
          </div></form>
        <div>${documents.length ? documents.map((d) => `<div class="doc"><div class="ico">${icon(d.mime)}</div><div class="info"><strong>${esc(d.original_name)}</strong><span class="small muted"><span class="badge gray">${CE.CATEGORY[d.category] || d.category}</span> ${CE.bytes(d.size)} · ${CE.fmtDateTime(d.created_at)} · von ${esc(d.uploaded_by_name || 'unbekannt')}${d.uploaded_by_role ? ` (${CE.ROLE[d.uploaded_by_role]})` : ''}${d.visible_to_customer ? '' : ' · <span class="badge orange">intern</span>'}${d.description ? `<br>${esc(d.description)}` : ''}</span></div>
          <div class="row nowrap">${d.mime.startsWith('image/') || d.mime === 'application/pdf' ? `<a class="btn sm ghost" href="/api/documents/events/${ev.id}/${d.id}/download?inline=1" target="_blank" rel="noopener">Ansehen</a>` : ''}<a class="btn sm" href="/api/documents/events/${ev.id}/${d.id}/download">Download</a>${role === 'admin' || d.uploaded_by === CE.state.user.id ? `<button class="btn sm ghost" data-del="${d.id}" title="Löschen">✕</button>` : ''}</div></div>`).join('') : CE.empty('📂', 'Noch keine Dokumente hochgeladen.')}</div>`;
      const drop = qs('#drop', container), input = qs('#fileInput', container), form = qs('#upForm', container);
      const show = () => { const f = input.files[0]; qs('#fileName', container).textContent = f ? `${f.name} (${CE.bytes(f.size)})` : ''; qs('#upBtn', container).disabled = !f; };
      drop.addEventListener('click', () => input.click());
      input.addEventListener('change', show);
      ['dragenter', 'dragover'].forEach((ev2) => drop.addEventListener(ev2, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev2) => drop.addEventListener(ev2, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; show(); } });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(); fd.append('file', input.files[0]); fd.append('category', form.category.value); fd.append('description', form.description.value);
        if (form.visible_to_customer) fd.append('visible_to_customer', form.visible_to_customer.checked ? 'true' : 'false');
        qs('#upBtn', container).disabled = true;
        try { await CE.post(`/documents/events/${ev.id}`, fd); CE.toast('Datei hochgeladen', 'success'); await reload(); } catch (err) { CE.error(err); qs('#upBtn', container).disabled = false; }
      });
      qsa('[data-del]', container).forEach((b) => b.addEventListener('click', async () => { if (await CE.confirm('Dokument endgültig löschen?', { danger: true, ok: 'Löschen' })) { try { await CE.del(`/documents/events/${ev.id}/${b.dataset.del}`); reload(); } catch (err) { CE.error(err); } } }));
    };
    const reload = async () => { documents = (await CE.get(`/documents/events/${ev.id}`)).documents; render(); };
    render();
  };

  // ---------- Termine & Aufgaben ----------
  S.timeline = async function (container, ev, role) {
    let tl = await CE.get(`/schedule/events/${ev.id}/timeline`);
    const canManage = role !== 'customer';
    const render = () => {
      const items = tl.items;
      container.innerHTML = `<div class="card-head"><h2>Termine & Aufgaben</h2><div class="row">${canManage || true ? `<button class="btn sm" id="addAppt">+ Termin</button>` : ''}<button class="btn sm" id="addTask">+ Aufgabe</button></div></div>
        <p class="muted small">Update-Gespräch während der Planung, finale Besprechung bei ca. 80 % Fortschritt, dazu alle Aufgaben bis zum großen Tag.</p>
        <div class="timeline">${items.length ? items.map((it) => {
          const cls = it.type === 'event_day' ? 'event' : it.status === 'erledigt' ? 'done' : it.status === 'abgesagt' ? 'cancel' : '';
          const when = it.at ? (it.at.length > 10 ? CE.fmtDateTime(it.at) : CE.fmtDate(it.at)) : 'Termin offen';
          const days = it.at ? CE.daysUntil(it.at) : null;
          let badge = '';
          if (it.type === 'event_day') badge = '<span class="badge gold">Eventtag</span>';
          else if (it.status === 'erledigt') badge = '<span class="badge green">erledigt</span>';
          else if (it.status === 'abgesagt') badge = '<span class="badge red">abgesagt</span>';
          else if (days !== null && days < 0) badge = '<span class="badge red">überfällig</span>';
          else if (days !== null && days <= 7) badge = `<span class="badge orange">in ${days} Tag${days === 1 ? '' : 'en'}</span>`;
          else if (!it.at) badge = '<span class="badge orange">noch zu terminieren</span>';
          const actions = it.type === 'appointment'
            ? `<button class="btn sm ghost" data-edit-appt="${it.id}">Bearbeiten</button>${canManage && it.status !== 'erledigt' ? `<button class="btn sm ghost" data-done-appt="${it.id}">✓ Erledigt</button>` : ''}`
            : it.type === 'task' ? `<label class="check small"><input type="checkbox" data-task="${it.id}" ${it.status === 'erledigt' ? 'checked' : ''}><span>erledigt</span></label>${canManage ? `<button class="btn sm ghost" data-del-task="${it.id}">✕</button>` : ''}` : '';
          return `<div class="tl-item ${cls}"><div class="when">${when} ${badge}</div><div class="row between"><div><div class="what">${it.type === 'task' ? '☐ ' : it.type === 'appointment' ? '📞 ' : '🎉 '}${esc(it.title)}</div>
            <div class="meta">${it.type === 'appointment' ? [it.location, it.duration_min ? it.duration_min + ' Min.' : null, it.notes].filter(Boolean).map(esc).join(' · ') : it.type === 'task' ? `Zuständig: ${CE.ROLE[it.assignee_role] || it.assignee_role}` : CE.STATUS[it.status]?.[0] || ''}</div></div><div class="row nowrap">${actions}</div></div></div>`;
        }).join('') : CE.empty('📅', 'Noch keine Termine oder Aufgaben.')}</div>`;
      qs('#addAppt', container).addEventListener('click', () => apptForm());
      qs('#addTask', container).addEventListener('click', () => taskForm());
      qsa('[data-edit-appt]', container).forEach((b) => b.addEventListener('click', () => apptForm(tl.appointments.find((a) => a.id === Number(b.dataset.editAppt)))));
      qsa('[data-done-appt]', container).forEach((b) => b.addEventListener('click', async () => { await CE.patch(`/schedule/events/${ev.id}/appointments/${b.dataset.doneAppt}`, { status: 'erledigt' }); reload(); }));
      qsa('[data-task]', container).forEach((c) => c.addEventListener('change', async () => { await CE.patch(`/schedule/events/${ev.id}/tasks/${c.dataset.task}`, { done: c.checked }); reload(); }));
      qsa('[data-del-task]', container).forEach((b) => b.addEventListener('click', async () => { if (await CE.confirm('Aufgabe löschen?', { danger: true, ok: 'Löschen' })) { await CE.del(`/schedule/events/${ev.id}/tasks/${b.dataset.delTask}`); reload(); } }));
    };
    const apptForm = (a = null) => {
      CE.modal(`<h2>${a ? 'Termin bearbeiten' : 'Neuer Termin'}</h2><form id="af">
        <div class="field"><label>Art</label><select name="kind" ${a ? 'disabled' : ''}>${Object.entries(CE.APPT).map(([k, l]) => `<option value="${k}" ${a && a.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Titel</label><input type="text" name="title" value="${esc(a ? a.title : '')}" placeholder="optional"></div>
        <div class="form-grid"><div class="field"><label>Datum & Uhrzeit</label><input type="datetime-local" name="scheduled_at" value="${esc(a && a.scheduled_at ? a.scheduled_at : '')}"></div>
        <div class="field"><label>Dauer (Min.)</label><input type="number" name="duration_min" value="${a ? a.duration_min : 60}" min="5" max="600"></div></div>
        <div class="field"><label>Ort / Link</label><input type="text" name="location" value="${esc(a ? a.location || '' : '')}" placeholder="Telefon, Video-Call, vor Ort …"></div>
        <div class="field"><label>Notizen</label><textarea name="notes">${esc(a ? a.notes || '' : '')}</textarea></div>
        ${a && canManage ? `<div class="field"><label>Status</label><select name="status">${['geplant', 'erledigt', 'abgesagt'].map((s) => `<option ${a.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>` : ''}
        <div class="actions">${a && canManage ? `<button type="button" class="btn danger" id="delAppt">Löschen</button>` : ''}<button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">Speichern</button></div></form>`, {
        onMount(m, close) {
          m.querySelector('#af').addEventListener('submit', async (e) => {
            e.preventDefault(); const d = CE.formData(e.target); if (!d.title) delete d.title; if (!d.scheduled_at) d.scheduled_at = null;
            try { if (a) await CE.patch(`/schedule/events/${ev.id}/appointments/${a.id}`, d); else await CE.post(`/schedule/events/${ev.id}/appointments`, d); close(); reload(); } catch (err) { CE.error(err); }
          });
          const del = m.querySelector('#delAppt'); if (del) del.addEventListener('click', async () => { if (await CE.confirm('Termin löschen?', { danger: true, ok: 'Löschen' })) { await CE.del(`/schedule/events/${ev.id}/appointments/${a.id}`); close(); reload(); } });
        },
      });
    };
    const taskForm = () => CE.modal(`<h2>Neue Aufgabe</h2><form id="tf"><div class="field"><label>Aufgabe</label><input type="text" name="title" required placeholder="z. B. Sitzplan an DJ schicken"></div>
      <div class="form-grid"><div class="field"><label>Fällig am</label><input type="date" name="due_date"></div><div class="field"><label>Zuständig</label><select name="assignee_role">${['customer', 'dj', 'admin'].filter((r) => canManage || r === 'customer').map((r) => `<option value="${r}">${CE.ROLE[r]}</option>`).join('')}</select></div></div>
      <div class="actions"><button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">Anlegen</button></div></form>`, {
      onMount(m, close) { m.querySelector('#tf').addEventListener('submit', async (e) => { e.preventDefault(); try { await CE.post(`/schedule/events/${ev.id}/tasks`, CE.formData(e.target)); close(); reload(); } catch (err) { CE.error(err); } }); },
    });
    const reload = async () => { tl = await CE.get(`/schedule/events/${ev.id}/timeline`); render(); if (CE.onEventChanged) CE.onEventChanged(); };
    render();
  };

  // ---------- Finanzen eines Events (DJ/Admin) ----------
  S.finance = async function (container, ev, role) {
    let { payouts, finance: f } = await CE.get(`/finance/events/${ev.id}/payouts`);
    const render = () => {
      container.innerHTML = `<div class="card-head"><h2>Gage & Abrechnung</h2>${CE.PAY[f.customer_payment_status] ? `<span class="badge ${CE.PAY[f.customer_payment_status][1]}">Kunde: ${CE.PAY[f.customer_payment_status][0]}</span>` : ''}</div>
        <div class="grid cols-4 mb">
          <div class="card kpi"><div class="label">Buchungswert</div><div class="value">${CE.fmtEur(f.booking_value_cents)}</div></div>
          <div class="card kpi"><div class="label">Cosmos-Provision (${f.commission_percent} %)</div><div class="value">− ${CE.fmtEur(f.commission_cents)}</div></div>
          <div class="card kpi"><div class="label">Leihgebühren</div><div class="value">− ${CE.fmtEur(f.rental_fee_cents)}</div></div>
          <div class="card kpi accent"><div class="label">DJ-Gage</div><div class="value">${CE.fmtEur(f.dj_fee_cents)}</div><div class="hint">ausgezahlt ${CE.fmtEur(f.paid_out_cents)} · offen ${CE.fmtEur(f.open_cents)}</div></div>
        </div>
        <div class="card-head"><h3>Auszahlungen</h3>${role === 'admin' ? '<button class="btn sm" id="addPayout">+ Auszahlung erfassen</button>' : ''}</div>
        ${payouts.length ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Notiz</th><th class="num">Betrag</th>${role === 'admin' ? '<th></th>' : ''}</tr></thead><tbody>${payouts.map((p) => `<tr><td>${CE.fmtDate(p.paid_at)}</td><td class="muted">${esc(p.note || '')}</td><td class="num">${CE.fmtEur(p.amount_cents)}</td>${role === 'admin' ? `<td class="right"><button class="btn sm ghost" data-del="${p.id}">✕</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="small faint">Noch keine Auszahlungen erfasst.</p>'}`;
      const add = qs('#addPayout', container);
      if (add) add.addEventListener('click', () => CE.modal(`<h2>Auszahlung erfassen</h2><form id="pf"><div class="form-grid"><div class="field"><label>Betrag (€)</label><input type="text" name="amount" inputmode="decimal" required placeholder="${CE.centsToEurInput(f.open_cents)}"></div><div class="field"><label>Datum</label><input type="date" name="paid_at" value="${CE.todayIso()}"></div></div><div class="field"><label>Notiz</label><input type="text" name="note" placeholder="z. B. Restzahlung"></div><div class="actions"><button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">Speichern</button></div></form>`, {
        onMount(m, close) { m.querySelector('#pf').addEventListener('submit', async (e) => { e.preventDefault(); const d = CE.formData(e.target); try { await CE.post(`/finance/events/${ev.id}/payouts`, { amount_cents: CE.eurToCents(d.amount), paid_at: d.paid_at, note: d.note }); close(); reload(); } catch (err) { CE.error(err); } }); },
      }));
      qsa('[data-del]', container).forEach((b) => b.addEventListener('click', async () => { if (await CE.confirm('Auszahlung löschen?', { danger: true, ok: 'Löschen' })) { await CE.del(`/finance/events/${ev.id}/payouts/${b.dataset.del}`); reload(); } }));
    };
    const reload = async () => { ({ payouts, finance: f } = await CE.get(`/finance/events/${ev.id}/payouts`)); render(); };
    render();
  };

  // ---------- Kalender (Monatsansicht) ----------
  S.calendar = async function (container, { link = (eventId, tab) => `#/events/${eventId}${tab ? '?tab=' + tab : ''}` } = {}) {
    const data = await CE.get('/schedule/calendar');
    let cur = new Date(); cur.setDate(1);
    const render = () => {
      const y = cur.getFullYear(), m = cur.getMonth();
      const first = new Date(y, m, 1); const startDow = (first.getDay() + 6) % 7;
      const daysIn = new Date(y, m + 1, 0).getDate(); const prevDays = new Date(y, m, 0).getDate();
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const dayNum = i - startDow + 1;
        let d, other = false;
        if (dayNum < 1) { d = new Date(y, m - 1, prevDays + dayNum); other = true; } else if (dayNum > daysIn) { d = new Date(y, m + 1, dayNum - daysIn); other = true; } else d = new Date(y, m, dayNum);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const chips = [
          ...data.events.filter((e) => e.event_date === iso).map((e) => `<a class="chip" href="${link(e.id)}" title="${esc(e.title)}">🎉 ${esc(e.title)}</a>`),
          ...data.appointments.filter((a) => a.scheduled_at.slice(0, 10) === iso).map((a) => `<a class="chip appt ${a.status === 'erledigt' ? 'done' : ''}" href="${link(a.event_id, 'timeline')}" title="${esc(a.event_title)}">${a.scheduled_at.slice(11, 16)} ${esc(a.title)}</a>`),
          ...data.tasks.filter((t) => t.due_date === iso).map((t) => `<a class="chip task ${t.done_at ? 'done' : ''}" href="${link(t.event_id, 'timeline')}" title="${esc(t.event_title)}">☐ ${esc(t.title)}</a>`),
        ];
        cells.push(`<div class="day ${other ? 'other' : ''} ${iso === CE.todayIso() ? 'today' : ''}"><div class="n">${d.getDate()}</div>${chips.join('')}</div>`);
      }
      container.innerHTML = `<div class="cal-head"><button class="btn sm" id="calPrev">←</button><h2 style="margin:0">${first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</h2><div class="row"><button class="btn sm" id="calToday">Heute</button><button class="btn sm" id="calNext">→</button></div></div>
        <div class="cal">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>
        <p class="small faint mt"><span class="chip" style="display:inline">🎉 Event</span> <span class="chip appt" style="display:inline">Termin</span> <span class="chip task" style="display:inline">Aufgabe</span></p>`;
      qs('#calPrev', container).addEventListener('click', () => { cur.setMonth(cur.getMonth() - 1); render(); });
      qs('#calNext', container).addEventListener('click', () => { cur.setMonth(cur.getMonth() + 1); render(); });
      qs('#calToday', container).addEventListener('click', () => { cur = new Date(); cur.setDate(1); render(); });
    };
    render();
  };

  // ---------- Event-Detailseite mit Tabs (DJ/Admin) ----------
  CE.views.eventDetail = async function (main, route) {
    const id = Number(route.parts[1]);
    const role = CE.state.user.role;
    let { event: ev } = await CE.get(`/events/${id}`);
    const tabs = [['overview', 'Übersicht'], ['questionnaire', 'Fragebogen'], ['music', 'Musik'], ['documents', 'Dokumente'], ['timeline', 'Termine & Aufgaben'], ['finance', 'Gage']];
    let tab = route.query.tab && tabs.some(([k]) => k === route.query.tab) ? route.query.tab : 'overview';
    main.innerHTML = `<div class="page-head"><div><a href="#/events" class="small">← Alle Events</a><h1>${esc(ev.title)} ${CE.statusBadge(ev.status)}</h1><div class="sub">${CE.fmtDateLong(ev.event_date)}${ev.location_name ? ' · ' + esc(ev.location_name) : ''}${ev.customer_name ? ' · ' + esc(ev.customer_name) : ''}</div></div>
      <div class="row">${role === 'admin' ? `<a class="btn" href="#/events/${ev.id}/edit">Bearbeiten</a>` : ''}${role === 'dj' ? `<button class="btn" id="djStatus">Status ändern</button>` : ''}</div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="card" id="tabBox"></div>`;
    if (route.parts[2] === 'edit' && role === 'admin') return CE.views.adminEventForm(main, route, ev);
    const box = qs('#tabBox', main);
    const show = async () => {
      qsa('[data-tab]', main).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      history.replaceState(null, '', CE.hash(`/events/${id}`, { tab }));
      box.innerHTML = '<div class="spinner"></div>';
      if (tab === 'overview') {
        box.innerHTML = `<div id="prog"></div><hr style="border:0;border-top:1px solid var(--border);margin:1.25rem 0"><div class="grid cols-2"><div><h3>Stammdaten</h3><div id="ov"></div></div><div><h3>Nächste Termine</h3><div id="next"></div></div></div>`;
        S.progress(qs('#prog', box), ev); S.overview(qs('#ov', box), ev, role);
        const next = ev.appointments.filter((a) => a.status === 'geplant');
        qs('#next', box).innerHTML = next.length ? next.map((a) => `<div class="list-item"><div><strong>${esc(a.title)}</strong><div class="small muted">${a.scheduled_at ? CE.fmtDateTime(a.scheduled_at) : 'noch nicht terminiert'}${a.location ? ' · ' + esc(a.location) : ''}</div></div><button class="btn sm ghost" data-goto="timeline">→</button></div>`).join('') : '<p class="small faint">Keine offenen Termine.</p>';
        qsa('[data-goto]', box).forEach((b) => b.addEventListener('click', () => { tab = 'timeline'; show(); }));
      } else if (tab === 'questionnaire') await S.questionnaire(box, ev, { readonly: role === 'dj' });
      else if (tab === 'music') await S.music(box, ev, { readonly: false });
      else if (tab === 'documents') await S.documents(box, ev, role);
      else if (tab === 'timeline') await S.timeline(box, ev, role);
      else if (tab === 'finance') await S.finance(box, ev, role);
    };
    CE.onEventChanged = async () => { ({ event: ev } = await CE.get(`/events/${id}`)); CE.state.events = null; };
    qsa('[data-tab]', main).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; show(); }));
    const st = qs('#djStatus', main);
    if (st) st.addEventListener('click', () => CE.modal(`<h2>Status ändern</h2><form id="sf"><div class="field"><label>Status</label><select name="status">${['planung', 'final', 'abgeschlossen'].map((s) => `<option value="${s}" ${ev.status === s ? 'selected' : ''}>${CE.STATUS[s][0]}</option>`).join('')}</select></div><div class="field"><label>Interne Notiz</label><textarea name="notes_internal">${esc(ev.notes_internal || '')}</textarea></div><div class="actions"><button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">Speichern</button></div></form>`, {
      onMount(m, close) { m.querySelector('#sf').addEventListener('submit', async (e) => { e.preventDefault(); try { await CE.patch(`/events/${id}`, CE.formData(e.target)); close(); CE.state.events = null; CE.render(); } catch (err) { CE.error(err); } }); },
    }));
    show();
  };

  CE.views.calendar = async function (main) {
    main.innerHTML = `<div class="page-head"><div><h1>Kalender</h1><div class="sub">Alle Events, Termine und Aufgaben im Überblick.</div></div></div><div class="card" id="cal"></div>`;
    await S.calendar(qs('#cal', main));
  };
})();
