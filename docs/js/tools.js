'use strict';

/* Strumenti per la scuola: registro voti con media, orario settimanale, timer di studio (Pomodoro),
   sezione PDF → schemi e menu "Altro". */
const Tools = (() => {
  const { esc, $, $$ } = U;
  const H = () => App.h;
  const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

  /* ======================= VOTI ======================= */
  function parseGrade(raw) {
    const s = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(',', '.')
      .replace(/\s+/g, ' ');
    let m;
    let v = NaN;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/))) v = (+m[1] + +m[2]) / 2; // 6/7
    else if ((m = s.match(/^(\d+)\s*(½|e mezzo|mezzo)$/))) v = +m[1] + 0.5; // 6½
    else if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(\+\+|\+|--|-)?$/))) v = +m[1] + ({ '+': 0.25, '++': 0.5, '-': -0.25, '--': -0.5 }[m[2]] || 0);
    return v >= 0 && v <= 10 ? Math.round(v * 100) / 100 : NaN;
  }

  const gradeClass = (v) => (v >= 7 ? 'g-good' : v >= 6 ? 'g-ok' : v >= 5 ? 'g-warn' : 'g-bad');
  const fmtAvg = (v) => (isNaN(v) ? '–' : (Math.round(v * 100) / 100).toFixed(2).replace('.', ','));

  function average(list) {
    const W = list.reduce((s, g) => s + g.weight, 0);
    return W ? list.reduce((s, g) => s + g.value * g.weight, 0) / W : NaN;
  }

  function sparkline(list) {
    if (list.length < 2) return '';
    const pts = list.slice(-12);
    const w = 120;
    const h = 32;
    const step = w / (pts.length - 1);
    const y = (v) => h - 2 - ((v - 2) / 8) * (h - 4);
    const d = pts.map((g, i) => `${(i * step).toFixed(1)},${y(g.value).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <line x1="0" x2="${w}" y1="${y(6)}" y2="${y(6)}" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="3 3"/>
      <polyline points="${d}" fill="none" stroke="var(--c)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function grades() {
    const render = () => {
      const all = Store.grades.all().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const bySubj = {};
      all.forEach((g) => (bySubj[g.subjectId] = bySubj[g.subjectId] || []).push(g));
      const subjAvgs = Object.values(bySubj).map(average);
      const general = subjAvgs.length ? subjAvgs.reduce((a, b) => a + b, 0) / subjAvgs.length : NaN;
      const insuff = Object.entries(bySubj).filter(([, l]) => average(l) < 6);

      H().view().innerHTML = `
        <h1 class="page-title">📊 Voti e media</h1>
        <div class="grades-layout">
          <div>
            <div class="card avg-hero ${gradeClass(general)}">
              <div><span class="muted">Media generale</span><b class="avg-big">${fmtAvg(general)}</b><small class="muted">${U.plural(all.length, 'voto', 'voti')} in ${U.plural(Object.keys(bySubj).length, 'materia', 'materie')}</small></div>
              <div class="avg-msg">${
                isNaN(general)
                  ? 'Aggiungi il tuo primo voto 👇'
                  : insuff.length
                    ? `⚠️ Insufficiente in: ${insuff.map(([id]) => Store.subject(id).name).join(', ')}`
                    : general >= 8
                      ? '🌟 Ottimo lavoro!'
                      : '👍 Tutto sufficiente, continua così!'
              }</div>
            </div>
            <form class="card" id="g-form">
              <h3>➕ Nuovo voto</h3>
              <div class="grid-3">
                <select class="input" id="g-subj">${H().subjectOptions(H().currentSubject() || '', { none: false })}</select>
                <input class="input" id="g-val" placeholder="Voto (es. 7+, 6½, 6/7)" autocomplete="off" required>
                <input class="input" id="g-date" type="date" value="${U.todayStr()}">
              </div>
              <div class="grid-3">
                <select class="input" id="g-type"><option value="scritto">📝 Scritto</option><option value="orale">🗣️ Orale</option><option value="pratico">🔧 Pratico</option></select>
                <select class="input" id="g-weight"><option value="100">Peso 100%</option><option value="50">Peso 50%</option><option value="25">Peso 25%</option><option value="200">Peso 200%</option></select>
                <input class="input" id="g-note" placeholder="Argomento (facoltativo)">
              </div>
              <button class="btn btn-primary">Aggiungi voto</button>
              <small class="muted" id="g-preview"></small>
            </form>
            <div class="subject-avgs">${
              Object.keys(bySubj).length
                ? Object.entries(bySubj)
                    .sort((a, b) => Store.subject(a[0]).name.localeCompare(Store.subject(b[0]).name))
                    .map(([id, list]) => {
                      const s = Store.subject(id);
                      const a = average(list);
                      return `<div class="card subj-avg" style="--c:${s.color}">
                        <div class="row between"><b>${s.emoji} ${esc(s.name)}</b><span class="avg-pill ${gradeClass(a)}">${fmtAvg(a)}</span></div>
                        ${sparkline(list)}
                        <div class="grade-chips">${list
                          .map(
                            (g) =>
                              `<button class="grade-chip ${gradeClass(g.value)}" data-id="${g.id}" title="${esc(`${U.fmtDate(g.date)} · ${g.type} · peso ${g.weight}%${g.note ? ' · ' + g.note : ''}`)}">${esc(g.label)}${g.weight !== 100 ? `<sup>${g.weight}%</sup>` : ''}</button>`
                          )
                          .join('')}</div>
                      </div>`;
                    })
                    .join('')
                : ''
            }</div>
          </div>
          <aside>
            <div class="card" id="g-calc">
              <h3>🎯 Che voto mi serve?</h3>
              <label class="field"><span>Materia</span><select class="input" id="c-subj">${Object.keys(bySubj)
                .map((id) => `<option value="${esc(id)}">${Store.subject(id).emoji} ${esc(Store.subject(id).name)}</option>`)
                .join('') || '<option value="">Nessun voto</option>'}</select></label>
              <div class="grid-2">
                <label class="field"><span>Media che vuoi</span><input class="input" id="c-target" type="number" min="1" max="10" step="0.5" value="6"></label>
                <label class="field"><span>Peso prossima</span><select class="input" id="c-weight"><option value="100">100%</option><option value="50">50%</option><option value="200">200%</option></select></label>
              </div>
              <div id="c-res" class="calc-res"></div>
            </div>
            <p class="small muted">💡 Puoi scrivere i voti come a scuola: <b>7+</b> (7,25), <b>6-</b> (5,75), <b>6½</b>, <b>6/7</b> (6,5). Tocca un voto per eliminarlo.</p>
          </aside>
        </div>`;

      $('#g-val').oninput = (e) => {
        const v = parseGrade(e.target.value);
        $('#g-preview').textContent = e.target.value ? (isNaN(v) ? '❓ Voto non valido' : `= ${String(v).replace('.', ',')}`) : '';
      };
      $('#g-form').onsubmit = (e) => {
        e.preventDefault();
        const label = $('#g-val').value.trim();
        const value = parseGrade(label);
        if (isNaN(value)) return U.toast('Voto non valido (usa numeri da 0 a 10)', 'error');
        if (!$('#g-subj').value) return U.toast('Scegli una materia', 'error');
        Store.grades.save([
          ...Store.grades.all(),
          {
            id: U.uid(),
            subjectId: $('#g-subj').value,
            label,
            value,
            date: $('#g-date').value || U.todayStr(),
            type: $('#g-type').value,
            weight: +$('#g-weight').value,
            note: $('#g-note').value.trim(),
          },
        ]);
        U.toast(value >= 6 ? 'Voto aggiunto! 🎉' : 'Voto aggiunto. Il prossimo andrà meglio 💪', 'success');
        render();
      };
      H().view().querySelector('.subject-avgs').onclick = async (e) => {
        const b = e.target.closest('[data-id]');
        if (!b) return;
        if (await U.confirm(`Eliminare il voto ${b.textContent}?`, { okLabel: 'Elimina', danger: true })) {
          Store.grades.save(Store.grades.all().filter((g) => g.id !== b.dataset.id));
          render();
        }
      };
      const calc = () => {
        const id = $('#c-subj').value;
        const list = bySubj[id];
        const res = $('#c-res');
        if (!list) return (res.innerHTML = '<p class="muted">Aggiungi dei voti per usare il calcolatore.</p>');
        const target = +$('#c-target').value || 6;
        const w = +$('#c-weight').value;
        const W = list.reduce((s, g) => s + g.weight, 0);
        const S = list.reduce((s, g) => s + g.value * g.weight, 0);
        const need = (target * (W + w) - S) / w;
        res.innerHTML =
          need > 10
            ? `<b class="ko">😬 Servirebbe ${String(Math.round(need * 4) / 4).replace('.', ',')}</b><p class="small muted">Con una sola verifica non basta: ne serviranno altre.</p>`
            : need <= 3
              ? `<b class="ok">😎 Sei tranquillo/a</b><p class="small muted">Anche con un voto basso resteresti sopra ${String(target).replace('.', ',')}.</p>`
              : `<span class="muted">Ti serve almeno</span><b class="need ${gradeClass(need)}">${String(Math.ceil(need * 4) / 4).replace('.', ',')}</b><p class="small muted">Media attuale ${fmtAvg(S / W)} → ${String(target).replace('.', ',')}</p>`;
      };
      ['#c-subj', '#c-target', '#c-weight'].forEach((s) => ($(s).oninput = calc));
      calc();
    };
    render();
  }

  /* ======================= ORARIO ======================= */
  const toMin = (t) => {
    const [h, m] = String(t || '0:0').split(':').map(Number);
    return h * 60 + (m || 0);
  };

  function currentSlot(date = new Date()) {
    const tt = Store.timetable.get();
    const day = date.getDay(); // 0 domenica
    if (day === 0 || day > tt.days) return null;
    const now = date.getHours() * 60 + date.getMinutes();
    const idx = tt.slots.findIndex(([a, b]) => now >= toMin(a) - 5 && now < toMin(b));
    if (idx < 0) return null;
    return { day, idx, subjectId: tt.cells[`${day}-${idx}`] || '', next: tt.cells[`${day}-${idx + 1}`] || '' };
  }

  const currentSubject = () => {
    const s = currentSlot();
    return s ? s.subjectId : '';
  };

  function timetable() {
    const render = () => {
      const tt = Store.timetable.get();
      const cur = currentSlot();
      const today = new Date().getDay();
      H().view().innerHTML = `
        <div class="row between wrap"><h1 class="page-title">🗓️ Orario</h1>
          <div class="row wrap">
            <button class="btn btn-sm" id="tt-sat">${tt.days === 6 ? '➖ Togli sabato' : '➕ Aggiungi sabato'}</button>
            <button class="btn btn-sm" id="tt-add">➕ Ora</button>
            <button class="btn btn-sm" id="tt-rem" ${tt.slots.length <= 1 ? 'disabled' : ''}>➖ Ora</button>
          </div>
        </div>
        <p class="muted small">Tocca una casella per scegliere la materia, tocca l'orario per cambiarlo. Quando registri una lezione, l'app sceglie da sola la materia dell'ora in corso.</p>
        <div class="tt-wrap">
          <table class="timetable">
            <thead><tr><th></th>${DAYS.slice(0, tt.days)
              .map((d, i) => `<th class="${today === i + 1 ? 'today' : ''}">${d}</th>`)
              .join('')}</tr></thead>
            <tbody>${tt.slots
              .map(
                ([a, b], idx) => `<tr>
                  <th class="tt-time" data-slot="${idx}"><b>${idx + 1}ª</b><small>${a}–${b}</small></th>
                  ${DAYS.slice(0, tt.days)
                    .map((_, di) => {
                      const id = tt.cells[`${di + 1}-${idx}`];
                      const s = id ? Store.subject(id) : null;
                      const now = cur && cur.day === di + 1 && cur.idx === idx;
                      return `<td class="tt-cell ${now ? 'now' : ''}" data-cell="${di + 1}-${idx}" ${s ? `style="--c:${s.color}"` : ''}>${
                        s ? `<span class="tt-subj"><span>${s.emoji}</span>${esc(s.name)}</span>` : '<span class="tt-empty">+</span>'
                      }</td>`;
                    })
                    .join('')}
                </tr>`
              )
              .join('')}</tbody>
          </table>
        </div>`;

      const save = (fn) => {
        const t = Store.timetable.get();
        fn(t);
        Store.timetable.save(t);
        render();
      };
      $('#tt-sat').onclick = () => save((t) => (t.days = t.days === 6 ? 5 : 6));
      $('#tt-add').onclick = () =>
        save((t) => {
          const last = t.slots[t.slots.length - 1] || ['07:00', '08:00'];
          const start = toMin(last[1]);
          const f = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          t.slots.push([f(start), f(start + 60)]);
        });
      $('#tt-rem').onclick = () => save((t) => t.slots.pop());
      H().view().querySelector('.timetable').onclick = async (e) => {
        const cell = e.target.closest('[data-cell]');
        const time = e.target.closest('[data-slot]');
        if (cell) {
          const [d, i] = cell.dataset.cell.split('-');
          const v = await U.modal({
            title: `${DAYS[d - 1]} · ${+i + 1}ª ora`,
            body: `<select class="input">${H().subjectOptions(Store.timetable.get().cells[cell.dataset.cell] || '', { none: false }).replace(
              /^/,
              '<option value="">— Nessuna lezione —</option>'
            )}</select>`,
            actions: [
              { label: 'Annulla', value: null },
              { label: 'Salva', primary: true, value: (w) => w.querySelector('select').value },
            ],
          });
          if (v === null) return;
          save((t) => {
            if (v) t.cells[cell.dataset.cell] = v;
            else delete t.cells[cell.dataset.cell];
          });
        } else if (time) {
          const idx = +time.dataset.slot;
          const [a, b] = Store.timetable.get().slots[idx];
          const v = await U.modal({
            title: `${idx + 1}ª ora`,
            body: `<div class="grid-2"><label class="field"><span>Inizio</span><input class="input" type="time" id="t-a" value="${a}"></label><label class="field"><span>Fine</span><input class="input" type="time" id="t-b" value="${b}"></label></div>`,
            actions: [
              { label: 'Annulla', value: null },
              { label: 'Salva', primary: true, value: (w) => [w.querySelector('#t-a').value, w.querySelector('#t-b').value] },
            ],
          });
          if (v && v[0] && v[1]) save((t) => (t.slots[idx] = v));
        }
      };
    };
    render();
  }

  /* ======================= TIMER DI STUDIO (POMODORO) ======================= */
  const MODES = {
    focus: { label: '📚 Studio', min: 25 },
    short: { label: '☕ Pausa', min: 5 },
    long: { label: '🌴 Pausa lunga', min: 15 },
  };
  const T = { mode: 'focus', total: 25 * 60, left: 25 * 60, endAt: 0, running: false, interval: 0 };

  function studyLog() {
    const d = Store.settings().studyLog || {};
    return d.date === U.todayStr() ? d : { date: U.todayStr(), sessions: 0, minutes: 0 };
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach((t) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.25, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.22);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch (e) {
      /* audio non disponibile */
    }
  }

  function timerTick() {
    if (!T.running) return;
    T.left = Math.max(0, Math.round((T.endAt - Date.now()) / 1000));
    updateTimerUI();
    if (T.left <= 0) {
      T.running = false;
      clearInterval(T.interval);
      beep();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      if (T.mode === 'focus') {
        const log = studyLog();
        log.sessions++;
        log.minutes += Math.round(T.total / 60);
        Store.saveSettings({ studyLog: log });
        U.toast('🎉 Sessione di studio completata! Ora fai una pausa', 'success', 5000);
        notifyTimer('Sessione completata! 🎉', 'Ora fai una pausa.');
        setMode(log.sessions % 4 === 0 ? 'long' : 'short');
      } else {
        U.toast('⏰ Pausa finita: si torna a studiare!', 'info', 5000);
        notifyTimer('Pausa finita ⏰', 'Si torna a studiare!');
        setMode('focus');
      }
      updateTimerUI(true);
    }
  }

  function notifyTimer(title, body) {
    try {
      if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted')
        new Notification(title, { body, icon: 'icons/icon-192.png' });
    } catch (e) {
      /* ignora */
    }
  }

  function setMode(mode, minutes) {
    T.mode = mode;
    T.total = (minutes || (Store.settings().timerMin || {})[mode] || MODES[mode].min) * 60;
    T.left = T.total;
    T.running = false;
    clearInterval(T.interval);
  }

  function startTimer() {
    if (T.running) return;
    T.endAt = Date.now() + T.left * 1000;
    T.running = true;
    clearInterval(T.interval);
    T.interval = setInterval(timerTick, 500);
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    updateTimerUI(true);
  }

  function pauseTimer() {
    if (!T.running) return;
    T.left = Math.max(0, Math.round((T.endAt - Date.now()) / 1000));
    T.running = false;
    clearInterval(T.interval);
    updateTimerUI(true);
  }

  function updateTimerUI(full) {
    const pill = $('#timer-pill');
    if (pill) {
      pill.classList.toggle('hidden', !T.running || document.body.dataset.route === 'timer');
      pill.querySelector('span').textContent = U.fmtDuration(T.left);
    }
    const ring = $('#tm-ring');
    if (!ring) return;
    const r = 120;
    const c = 2 * Math.PI * r;
    ring.style.strokeDasharray = c;
    ring.style.strokeDashoffset = c * (1 - T.left / T.total);
    $('#tm-time').textContent = U.fmtDuration(T.left);
    if (full) timer();
  }

  function timer() {
    const log = studyLog();
    const custom = Store.settings().timerMin || {};
    H().view().innerHTML = `
      <h1 class="page-title">⏱️ Timer di studio</h1>
      <div class="timer-layout">
        <div class="card center timer-card">
          <div class="segmented" id="tm-modes">${Object.entries(MODES)
            .map(([k, m]) => `<button data-m="${k}" class="${T.mode === k ? 'active' : ''}">${m.label}</button>`)
            .join('')}</div>
          <div class="timer-ring">
            <svg viewBox="0 0 280 280"><circle cx="140" cy="140" r="120" class="ring-bg"/><circle cx="140" cy="140" r="120" class="ring-fg ${T.mode}" id="tm-ring"/></svg>
            <div class="timer-center"><b id="tm-time">${U.fmtDuration(T.left)}</b><small class="muted">${MODES[T.mode].label}</small></div>
          </div>
          <div class="row timer-btns">
            ${T.running ? '<button class="btn btn-xl" id="tm-pause">⏸ Pausa</button>' : `<button class="btn btn-primary btn-xl" id="tm-start">▶ ${T.left < T.total ? 'Riprendi' : 'Inizia'}</button>`}
            <button class="btn btn-xl btn-ghost" id="tm-reset" title="Ricomincia">↺</button>
          </div>
        </div>
        <div>
          <div class="card">
            <h3>🔥 Oggi</h3>
            <div class="stats stats-2"><div class="stat"><b>${log.sessions}</b><span>sessioni</span></div><div class="stat"><b>${log.minutes}</b><span>minuti di studio</span></div></div>
          </div>
          <div class="card" id="tm-dur">
            <h3>⚙️ Durate (minuti)</h3>
            <div class="grid-3">${Object.entries(MODES)
              .map(([k, m]) => `<label class="field"><span>${m.label}</span><input class="input" type="number" min="1" max="120" data-dur="${k}" value="${custom[k] || m.min}"></label>`)
              .join('')}</div>
            <p class="small muted">Metodo Pomodoro: 25 minuti di studio concentrato, 5 di pausa, e ogni 4 sessioni una pausa lunga. Il timer continua anche se cambi sezione.</p>
          </div>
        </div>
      </div>`;
    updateTimerUI();
    $('#tm-modes').onclick = async (e) => {
      const b = e.target.closest('[data-m]');
      if (!b || b.dataset.m === T.mode) return;
      if (T.running && !(await U.confirm('Interrompere il timer in corso?', { okLabel: 'Interrompi' }))) return;
      setMode(b.dataset.m);
      timer();
    };
    const st = $('#tm-start');
    if (st) st.onclick = startTimer;
    const pa = $('#tm-pause');
    if (pa) pa.onclick = pauseTimer;
    $('#tm-reset').onclick = () => {
      setMode(T.mode);
      timer();
      updateTimerUI();
    };
    $('#tm-dur').addEventListener('change', (e) => {
      const i = e.target.closest('[data-dur]');
      if (!i) return;
      const tm = { ...(Store.settings().timerMin || {}), [i.dataset.dur]: Math.max(1, Math.min(120, +i.value || MODES[i.dataset.dur].min)) };
      Store.saveSettings({ timerMin: tm });
      if (!T.running && i.dataset.dur === T.mode) {
        setMode(T.mode);
        timer();
      }
    });
  }

  /* ======================= PDF → SCHEMI ======================= */
  async function pdf() {
    const lessons = (await H().getLessons()).filter((l) => l.source === 'pdf');
    H().view().innerHTML = `
      <h1 class="page-title">📄 Da PDF a schemi</h1>
      <div class="pdf-layout">
        <div class="card">
          <label class="dropzone" id="pdf-drop">
            <input type="file" id="pdf-file" accept="application/pdf,.pdf" hidden>
            <span class="big-emoji">📄</span>
            <b>Trascina qui un PDF o tocca per sceglierlo</b>
            <small class="muted">Libro, dispensa, slide del prof, appunti scansionati · max 50 MB</small>
          </label>
          <div id="pdf-chosen" class="pdf-chosen hidden"></div>
          <div class="grid-2">
            <label class="field"><span>Materia</span><select class="input" id="pdf-subj">${H().subjectOptions('', { auto: true })}</select></label>
            <label class="field"><span>Pagine <small class="muted">(facoltativo)</small></span><input class="input" id="pdf-pages" placeholder="Es. 12-30"></label>
          </div>
          <label class="field"><span>Titolo <small class="muted">(facoltativo)</small></span><input class="input" id="pdf-title" placeholder="Lo trova l'AI"></label>
          <button class="btn btn-primary btn-xl" id="pdf-go" disabled>✨ Crea schemi dal PDF</button>
          <p class="hint">L'AI legge il PDF (anche immagini, tabelle e formule) e crea schema, riassunto, concetti, flashcard e quiz. Per libri interi indica le pagine del capitolo che ti serve.</p>
        </div>
        <section>
          <h2>📚 I tuoi PDF</h2>
          <div class="list">${lessons.length ? lessons.map(H().lessonRow).join('') : '<div class="empty"><p>Nessun PDF ancora.</p></div>'}</div>
        </section>
      </div>`;
    let file = null;
    const choose = (f) => {
      if (!f) return;
      if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return U.toast('Scegli un file PDF', 'error');
      if (f.size > 48 * 1024 * 1024) return U.toast('PDF troppo grande (max 50 MB)', 'error');
      file = f;
      $('#pdf-chosen').classList.remove('hidden');
      $('#pdf-chosen').innerHTML = `📄 <b>${esc(f.name)}</b> <span class="muted">${(f.size / 1048576).toFixed(1)} MB</span>`;
      $('#pdf-go').disabled = false;
      if (!$('#pdf-title').value) $('#pdf-title').placeholder = f.name.replace(/\.pdf$/i, '');
    };
    $('#pdf-file').onchange = (e) => choose(e.target.files[0]);
    const drop = $('#pdf-drop');
    ['dragenter', 'dragover'].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('over');
      })
    );
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      choose(e.dataTransfer.files[0]);
    });
    $('#pdf-go').onclick = async () => {
      if (!file) return;
      const pages = $('#pdf-pages').value.trim();
      const l = H().newLesson({
        source: 'pdf',
        subjectId: $('#pdf-subj').value,
        title: $('#pdf-title').value.trim(),
        fileName: file.name,
        pages,
        hasPdf: true,
      });
      await Store.files.put(l.id, file.type ? file : new Blob([file], { type: 'application/pdf' }));
      await H().saveLesson(l);
      H().go(`#/lesson/${l.id}?process=1`);
    };
  }

  /* ======================= MENU "ALTRO" ======================= */
  const TOOLS = [
    ['#/pdf', '📄', 'PDF → Schemi', 'Carica un PDF e ottieni schemi e quiz'],
    ['#/quiz', '❓', 'Quiz', 'Verifiche dalle tue lezioni'],
    ['#/notes', '✍️', 'Quaderno', 'Appunti a mano e scritti'],
    ['#/chat', '💬', 'Prof AI', 'Chiedi qualsiasi cosa'],
    ['#/review', '🧠', 'Ripasso', 'Flashcard del giorno'],
    ['#/agenda', '📅', 'Agenda', 'Compiti e verifiche'],
    ['#/timetable', '🗓️', 'Orario', 'Il tuo orario settimanale'],
    ['#/grades', '📊', 'Voti', 'Media e voto che ti serve'],
    ['#/timer', '⏱️', 'Timer studio', 'Metodo Pomodoro'],
    ['#/lessons', '📚', 'Lezioni', 'Tutte le lezioni'],
    ['#/settings', '⚙️', 'Impostazioni', 'API key, materie, backup'],
  ];

  const toolGrid = (list = TOOLS) =>
    `<div class="tool-grid">${list
      .map(([href, ic, name, desc]) => `<a class="tool-tile" href="${href}"><span class="tool-ic">${ic}</span><b>${name}</b><small>${desc}</small></a>`)
      .join('')}</div>`;

  function menu() {
    H().view().innerHTML = `<h1 class="page-title">🧰 Strumenti</h1>${toolGrid()}`;
  }

  App.route('grades', grades);
  App.route('timetable', timetable);
  App.route('timer', timer);
  App.route('pdf', pdf);
  App.route('menu', menu);

  return { parseGrade, average, currentSlot, currentSubject, toolGrid, TOOLS, timerState: T, updateTimerUI };
})();
