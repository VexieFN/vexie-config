'use strict';

/* Applicazione: router, viste e logica. */
const App = (() => {
  const { esc, $, $$ } = U;
  const view = () => $('#view');
  let cleanups = [];
  let lessonsCache = null;
  const jobs = new Map(); // lezioni in elaborazione: id -> { status, ctrl }
  let installPrompt = null;
  let lastLessonTab = 'schema';
  let lastLessonId = null;

  const onCleanup = (fn) => cleanups.push(fn);

  async function getLessons() {
    if (!lessonsCache) lessonsCache = await Store.lessons.all();
    return lessonsCache;
  }
  const invalidate = () => (lessonsCache = null);

  const effStatus = (l) => (l.status === 'processing' && !jobs.has(l.id) ? (l.result ? 'done' : 'recorded') : l.status);

  const subjectChip = (id, extra = '') => {
    const s = Store.subject(id);
    return `<span class="chip" style="--c:${s.color}" ${extra}>${s.emoji} ${esc(s.name)}</span>`;
  };

  const subjectOptions = (selected = '', { auto = false, none = true } = {}) =>
    (auto ? `<option value="">🤖 Riconosci automaticamente</option>` : none ? `<option value="">📝 Senza materia</option>` : '') +
    Store.subjects()
      .map((s) => `<option value="${esc(s.id)}" ${s.id === selected ? 'selected' : ''}>${s.emoji} ${esc(s.name)}</option>`)
      .join('');

  /* ======================= ROUTER ======================= */
  const routes = { home, record, lessons, lesson, chat, agenda, settings, review };

  async function router() {
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        /* ignora */
      }
    });
    cleanups = [];
    UI.TTS.stop();
    const hash = location.hash.replace(/^#\/?/, '') || 'home';
    const [path, query] = hash.split('?');
    const [name, arg] = path.split('/');
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    const fn = routes[name] || home;
    $$('.bottomnav a').forEach((a) => a.classList.toggle('active', a.dataset.route === (routes[name] ? name : 'home')));
    document.body.dataset.route = routes[name] ? name : 'home';
    updateRecPill();
    window.scrollTo(0, 0);
    try {
      await fn(decodeURIComponent(arg || ''), params);
    } catch (e) {
      console.error(e);
      view().innerHTML = `<div class="card error-card"><h3>Ops, qualcosa è andato storto</h3><p>${esc(e.message)}</p><a class="btn" href="#/home">Torna alla home</a></div>`;
    }
  }

  const go = (h) => {
    if (location.hash === h) router();
    else location.hash = h;
  };

  /* ======================= HOME ======================= */
  async function home() {
    const s = Store.settings();
    const all = await getLessons();
    const tasks = Store.tasks().filter((t) => !t.done);
    tasks.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    const due = dueCards(all).length;
    const hours = all.reduce((sum, l) => sum + (l.duration || 0), 0) / 3600;
    const draft = Recorder.state === 'idle' ? Store.draft.meta() : null;
    const h = new Date().getHours();
    const hello = h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
    const counts = {};
    all.forEach((l) => (counts[l.subjectId] = (counts[l.subjectId] || 0) + 1));

    view().innerHTML = `
      <section class="hero">
        <div>
          <p class="muted">${esc(U.fmtDate(new Date().toISOString(), { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
          <h1>${hello}${s.name ? `, ${esc(s.name)}` : ''} 👋</h1>
        </div>
      </section>

      ${
        !s.apiKey
          ? `<a href="#/settings" class="card banner banner-warn"><b>🔑 Configura la tua API key di Google</b><span>Serve per creare gli schemi e usare Prof AI. È gratis e ci vuole un minuto →</span></a>`
          : ''
      }
      ${
        draft
          ? `<div class="card banner banner-info"><b>💾 Registrazione interrotta trovata</b><span>${esc(U.fmtDateTime(draft.startedAtISO))} · ${U.fmtDuration(draft.duration)} registrati</span>
             <div class="row"><button class="btn btn-primary" id="draft-recover">Recupera</button><button class="btn btn-ghost" id="draft-del">Elimina</button></div></div>`
          : ''
      }
      ${
        Recorder.state !== 'idle'
          ? `<a href="#/record" class="card banner banner-rec"><b>🔴 Stai registrando una lezione</b><span>Tocca per tornare alla registrazione</span></a>`
          : `<a href="#/record" class="cta">
               <span class="cta-icon">🎙️</span>
               <span><b>Ascolta la lezione</b><small>Registra, filtra il casino e crea gli schemi</small></span>
             </a>`
      }

      <div class="stats">
        <a href="#/lessons" class="stat"><b>${all.length}</b><span>lezioni</span></a>
        <div class="stat">${
          hours < 1
            ? `<b>${Math.round(hours * 60)}</b><span>minuti ascoltati</span>`
            : `<b>${hours < 10 ? hours.toFixed(1).replace('.', ',') : Math.round(hours)}</b><span>ore ascoltate</span>`
        }</div>
        <a href="#/review" class="stat ${due ? 'stat-hot' : ''}"><b>${due}</b><span>flashcard oggi</span></a>
        <a href="#/agenda" class="stat"><b>${tasks.length}</b><span>compiti</span></a>
      </div>

      ${
        due
          ? `<a href="#/review" class="card banner banner-study"><b>🧠 Ripasso del giorno</b><span>${U.plural(due, 'flashcard ti aspetta', 'flashcard ti aspettano')}. Bastano 5 minuti!</span></a>`
          : ''
      }

      ${
        tasks.length
          ? `<section class="section">
              <div class="section-head"><h2>📅 In arrivo</h2><a href="#/agenda">Tutti</a></div>
              <div class="list" id="home-tasks">${tasks.slice(0, 4).map(taskRow).join('')}</div>
            </section>`
          : ''
      }

      <section class="section">
        <div class="section-head"><h2>📚 Materie</h2><a href="#/settings">Modifica</a></div>
        <div class="subject-grid">
          ${Store.subjects()
            .map(
              (sub) => `<a class="subject-card" href="#/lessons?subject=${encodeURIComponent(sub.id)}" style="--c:${sub.color}">
                <span class="subject-emoji">${sub.emoji}</span><b>${esc(sub.name)}</b><small>${U.plural(counts[sub.id] || 0, 'lezione', 'lezioni')}</small></a>`
            )
            .join('')}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>🕘 Ultime lezioni</h2>${all.length ? '<a href="#/lessons">Tutte</a>' : ''}</div>
        <div class="list">${all.length ? all.slice(0, 5).map(lessonRow).join('') : emptyLessons()}</div>
      </section>`;

    if ($('#home-tasks')) bindTaskRows($('#home-tasks'));
    const rec = $('#draft-recover');
    if (rec) rec.onclick = recoverDraft;
    const del = $('#draft-del');
    if (del)
      del.onclick = async () => {
        if (await U.confirm('La registrazione interrotta verrà eliminata definitivamente.', { okLabel: 'Elimina', danger: true })) {
          await Store.draft.clear();
          home();
        }
      };
  }

  const emptyLessons = () =>
    `<div class="empty"><div class="big-emoji">🎧</div><p>Nessuna lezione ancora.<br>Premi il microfono e lascia lavorare l'AI!</p></div>`;

  function lessonRow(l) {
    const s = Store.subject(l.subjectId);
    const st = effStatus(l);
    const badge =
      st === 'processing'
        ? '<span class="badge badge-info">⏳ Elaborazione…</span>'
        : st === 'error'
          ? '<span class="badge badge-danger">⚠️ Errore</span>'
          : st === 'recorded'
            ? '<span class="badge badge-warn">Da elaborare</span>'
            : l.result
              ? `<span class="badge">🧠 ${(l.result.flashcards || []).length} · ❓ ${(l.result.quiz || []).length}</span>`
              : '';
    const icon = { mic: '🎙️', file: '📁', photo: '📷', text: '📝' }[l.source] || '🎙️';
    return `<a class="lesson-row" href="#/lesson/${encodeURIComponent(l.id)}" style="--c:${s.color}">
      <span class="lesson-emoji">${s.emoji}</span>
      <span class="lesson-info">
        <b>${esc(l.title || 'Lezione senza titolo')}</b>
        <small>${esc(s.name)} · ${esc(U.fmtDate(l.date))}${l.duration ? ` · ${icon} ${U.fmtDuration(l.duration)}` : ` · ${icon}`}</small>
      </span>
      ${badge}
    </a>`;
  }

  async function recoverDraft() {
    const meta = Store.draft.meta();
    const blob = await Store.draft.blob();
    if (!meta) return;
    const l = newLesson({
      source: 'mic',
      subjectId: meta.subjectId || '',
      title: meta.title || '',
      date: meta.startedAtISO,
      duration: meta.duration,
      segments: meta.segments || [],
      bookmarks: meta.bookmarks || [],
      stats: meta.stats,
      hasAudio: !!(blob && blob.size),
      audioMime: meta.mime,
    });
    if (blob && blob.size) await Store.audio.put(l.id, blob);
    await saveLesson(l);
    await Store.draft.clear();
    U.toast('Registrazione recuperata!', 'success');
    go(`#/lesson/${l.id}`);
  }

  /* ======================= REGISTRAZIONE ======================= */
  function newLesson(data) {
    return {
      id: U.uid(),
      subjectId: '',
      title: '',
      date: new Date().toISOString(),
      duration: 0,
      segments: [],
      bookmarks: [],
      notes: '',
      status: 'recorded',
      source: 'mic',
      hasAudio: false,
      createdAt: new Date().toISOString(),
      ...data,
      transcript:
        data.transcript || (data.segments || []).map((s) => `[${U.fmtDuration(s.t)}] ${s.text}`).join('\n'),
    };
  }

  async function saveLesson(l) {
    await Store.lessons.put(l);
    invalidate();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return l;
  }

  async function record(_, params) {
    if (Recorder.state !== 'idle') return renderRecording();
    const s = Store.settings();
    const supported = Recorder.supported();
    view().innerHTML = `
      <section class="card">
        <h1 class="page-title">🎙️ Nuova lezione</h1>
        <label class="field"><span>Materia</span><select id="r-subject" class="input">${subjectOptions(params.subject || '', { auto: true })}</select></label>
        <label class="field"><span>Titolo <small class="muted">(facoltativo, lo trova l'AI)</small></span><input id="r-title" class="input" placeholder="Es. La Rivoluzione francese"></label>
        <div class="toggles">
          <label class="switch"><input type="checkbox" id="r-filter" ${s.voiceFilter ? 'checked' : ''}><span class="slider"></span><span><b>Filtro voce anti-casino</b><small>Riduce rumori, banchi, brusio di fondo</small></span></label>
          <label class="switch"><input type="checkbox" id="r-live" ${s.liveTranscript && Recorder.speechSupported() ? 'checked' : ''} ${Recorder.speechSupported() ? '' : 'disabled'}><span class="slider"></span><span><b>Trascrizione dal vivo</b><small>${Recorder.speechSupported() ? 'Vedi il testo mentre il prof parla' : 'Non supportata da questo browser (usa Chrome)'}</small></span></label>
        </div>
        ${
          supported
            ? `<button class="btn btn-primary btn-xl" id="r-start">🎙️ Inizia ad ascoltare</button>`
            : `<div class="banner banner-warn">Questo browser non supporta la registrazione audio. Usa Chrome, Edge o Safari aggiornati.</div>`
        }
        <p class="hint">💡 Metti il telefono sul banco con il microfono verso la cattedra. Lo schermo resta acceso durante la registrazione. Puoi usare le altre sezioni dell'app mentre registri.</p>
      </section>

      <section class="card">
        <h3>Oppure crea gli schemi da…</h3>
        <div class="source-grid">
          <button class="source-btn" id="r-file"><span>📁</span><b>File audio</b><small>Registrazione già fatta</small></button>
          <button class="source-btn" id="r-photo"><span>📷</span><b>Foto</b><small>Lavagna, libro, appunti</small></button>
          <button class="source-btn" id="r-text"><span>📝</span><b>Testo</b><small>Incolla appunti</small></button>
        </div>
        <input type="file" id="f-audio" accept="audio/*,video/mp4,video/webm,.m4a,.mp3,.wav,.ogg,.webm,.aac,.flac" hidden>
        <input type="file" id="f-photo" accept="image/*" multiple hidden>
      </section>`;

    const subj = () => $('#r-subject').value;
    const title = () => $('#r-title').value.trim();

    const start = $('#r-start');
    if (start)
      start.onclick = async () => {
        if (!Store.settings().consentShown) {
          const ok = await U.modal({
            title: '🤝 Prima di iniziare',
            body: `<p>Registrare le persone senza permesso può non essere consentito. <b>Chiedi sempre al professore</b> se puoi registrare la lezione per studiare.</p><p class="muted">L'audio resta sul tuo dispositivo e viene inviato solo a Google Gemini quando chiedi di creare gli schemi.</p>`,
            actions: [
              { label: 'Annulla', value: false },
              { label: 'Ho capito', value: true, primary: true },
            ],
          });
          if (!ok) return;
          Store.saveSettings({ consentShown: true });
        }
        start.disabled = true;
        start.textContent = 'Attivo il microfono…';
        try {
          await Recorder.start({
            filter: $('#r-filter').checked,
            live: $('#r-live').checked,
            lang: Store.settings().lang,
            subjectId: subj(),
            title: title(),
          });
          renderRecording();
        } catch (e) {
          console.error(e);
          start.disabled = false;
          start.textContent = '🎙️ Inizia ad ascoltare';
          U.toast(
            e.name === 'NotAllowedError'
              ? 'Permesso microfono negato. Abilitalo dalle impostazioni del browser.'
              : 'Impossibile avviare il microfono: ' + e.message,
            'error',
            5000
          );
        }
      };

    $('#r-file').onclick = () => $('#f-audio').click();
    $('#r-photo').onclick = () => $('#f-photo').click();
    $('#f-audio').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const duration = await mediaDuration(f);
      const l = newLesson({
        source: 'file',
        subjectId: subj(),
        title: title() || f.name.replace(/\.[^.]+$/, ''),
        duration,
        hasAudio: true,
        audioMime: f.type,
      });
      const blob = f.type ? f : new Blob([f], { type: guessMime(f.name) });
      await Store.audio.put(l.id, blob);
      await saveLesson(l);
      go(`#/lesson/${l.id}?process=1`);
    };
    $('#f-photo').onchange = async (e) => {
      const files = [...e.target.files].slice(0, 10);
      if (!files.length) return;
      U.toast('Preparo le foto…');
      const images = [];
      for (const f of files) {
        try {
          images.push(await U.imageToJpeg(f, 1600, 0.82));
        } catch (err) {
          U.toast(err.message, 'error');
        }
      }
      if (!images.length) return;
      const l = newLesson({ source: 'photo', subjectId: subj(), title: title(), images: images.map(({ mime, data }) => ({ mime, data })) });
      await saveLesson(l);
      go(`#/lesson/${l.id}?process=1`);
    };
    $('#r-text').onclick = async () => {
      const txt = await U.ask('📝 Incolla il testo o i tuoi appunti', { multiline: true, placeholder: 'Appunti, testo del libro, trascrizione…' });
      if (!txt) return;
      const l = newLesson({ source: 'text', subjectId: subj(), title: title(), inputText: txt });
      await saveLesson(l);
      go(`#/lesson/${l.id}?process=1`);
    };
  }

  function guessMime(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return (
      { mp3: 'audio/mp3', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm', mp4: 'audio/mp4' }[ext] ||
      'audio/mpeg'
    );
  }

  function mediaDuration(file) {
    return new Promise((resolve) => {
      const a = document.createElement('audio');
      const url = URL.createObjectURL(file);
      const done = (d) => {
        URL.revokeObjectURL(url);
        resolve(isFinite(d) ? d : 0);
      };
      a.preload = 'metadata';
      a.onloadedmetadata = () => done(a.duration);
      a.onerror = () => done(0);
      a.src = url;
      setTimeout(() => done(0), 5000);
    });
  }

  function renderRecording() {
    const meta = Recorder.meta;
    view().innerHTML = `
      <section class="rec-screen">
        <div class="rec-top">
          ${meta.subjectId ? subjectChip(meta.subjectId) : '<span class="chip">🤖 Materia automatica</span>'}
          <span id="rec-badge" class="rec-badge">● REC</span>
        </div>
        <div class="rec-timer" id="rec-timer">${U.fmtDuration(Recorder.elapsed)}</div>
        <canvas id="rec-canvas" class="rec-canvas"></canvas>
        <div class="rec-kind" id="rec-kind" data-kind="silence">🤫 Silenzio</div>
        <div class="rec-mix">
          <div class="mix-bar"><span class="mix-voice" id="mix-voice"></span><span class="mix-noise" id="mix-noise"></span></div>
          <small id="mix-label" class="muted">Spiegazione 0% · Rumore 0%</small>
        </div>
        <div class="rec-controls">
          <button class="round-btn" id="rec-pause" title="Pausa">⏸</button>
          <button class="round-btn round-star" id="rec-mark" title="Segna momento importante">⭐</button>
          <button class="round-btn round-stop" id="rec-stop" title="Termina">⏹</button>
        </div>
        <div class="rec-labels"><span>Pausa</span><span>Importante!</span><span>Termina</span></div>
        <form class="quicknote" id="rec-note-form">
          <input id="rec-note" class="input" placeholder="✏️ Appunto veloce (es. 'questo va nella verifica')" autocomplete="off">
          <button class="btn btn-primary">+</button>
        </form>
        <div id="rec-marks" class="marks"></div>
        <div class="card">
          <div class="section-head"><h3>📝 Trascrizione dal vivo</h3><span id="recog-status" class="muted small"></span></div>
          <div id="rec-transcript" class="transcript live"><p class="muted">${meta.live ? 'In ascolto…' : 'Trascrizione live disattivata: l\'AI ascolterà l\'audio alla fine.'}</p></div>
        </div>
      </section>`;

    const canvas = $('#rec-canvas');
    const g = canvas.getContext('2d');
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * devicePixelRatio;
      canvas.height = r.height * devicePixelRatio;
    };
    fit();
    window.addEventListener('resize', fit);
    onCleanup(() => window.removeEventListener('resize', fit));

    const KIND = { voice: '🗣️ Spiegazione', noise: '🔊 Rumore / brusio', silence: '🤫 Silenzio' };
    const COLORS = { voice: '#30a46c', noise: '#f76b15', silence: '#8b8d98' };
    let lastUi = 0;
    let shownKind = 'silence';
    let kindSince = 0;

    const offLevel = Recorder.on('level', ({ freq, kind, elapsed }) => {
      // forma d'onda a barre
      const W = canvas.width;
      const H = canvas.height;
      g.clearRect(0, 0, W, H);
      const bars = 48;
      const bw = W / bars;
      const paused = Recorder.state === 'paused';
      g.fillStyle = paused ? '#8b8d98' : COLORS[shownKind];
      for (let i = 0; i < bars; i++) {
        const idx = Math.floor(Math.pow(i / bars, 1.7) * (freq.length * 0.45)) + 2;
        const v = paused ? 0.04 : freq[idx] / 255;
        const bh = Math.max(3 * devicePixelRatio, v * H * 0.95);
        const x = i * bw + bw * 0.18;
        const y = (H - bh) / 2;
        const rw = bw * 0.64;
        g.beginPath();
        if (g.roundRect) g.roundRect(x, y, rw, bh, rw / 2);
        else g.rect(x, y, rw, bh);
        g.fill();
      }
      const now = performance.now();
      if (kind !== shownKind && now - kindSince > 600) {
        shownKind = kind;
        kindSince = now;
      }
      if (now - lastUi > 300) {
        lastUi = now;
        $('#rec-timer').textContent = U.fmtDuration(elapsed);
        const k = $('#rec-kind');
        k.dataset.kind = paused ? 'paused' : shownKind;
        k.textContent = paused ? '⏸ In pausa' : KIND[shownKind];
        const st = Recorder.stats;
        const tot = st.voice + st.noise + st.silence || 1;
        const pv = Math.round((st.voice / tot) * 100);
        const pn = Math.round((st.noise / tot) * 100);
        $('#mix-voice').style.width = pv + '%';
        $('#mix-noise').style.width = pn + '%';
        $('#mix-label').textContent = `Spiegazione ${pv}% · Rumore ${pn}% · Silenzio ${100 - pv - pn}% (stima)`;
      }
    });
    onCleanup(offLevel);

    const renderTranscript = () => {
      const box = $('#rec-transcript');
      if (!box) return;
      const segs = Recorder.segments;
      if (!segs.length && !Recorder.interim) return;
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      box.innerHTML =
        segs
          .slice(-200)
          .map((s) => `<p><span class="ts">${U.fmtDuration(s.t)}</span> ${esc(s.text)}</p>`)
          .join('') + (Recorder.interim ? `<p class="interim">${esc(Recorder.interim)}</p>` : '');
      if (nearBottom) box.scrollTop = box.scrollHeight;
    };
    renderTranscript();
    onCleanup(Recorder.on('transcript', renderTranscript));
    onCleanup(
      Recorder.on('recog', ({ status, error }) => {
        const el = $('#recog-status');
        if (!el) return;
        el.textContent = status === 'on' ? '● attiva' : status === 'unsupported' ? 'non supportata' : `non disponibile (${error})`;
      })
    );

    const renderMarks = () => {
      const box = $('#rec-marks');
      box.innerHTML = Recorder.bookmarks
        .map((b) => `<span class="mark">⭐ ${U.fmtDuration(b.t)}${b.label ? ` · ${esc(b.label)}` : ''}</span>`)
        .join('');
    };
    renderMarks();
    onCleanup(Recorder.on('bookmark', renderMarks));

    const syncState = () => {
      const p = Recorder.state === 'paused';
      $('#rec-pause').textContent = p ? '▶' : '⏸';
      $('#rec-pause').title = p ? 'Riprendi' : 'Pausa';
      $('.rec-labels span').textContent = p ? 'Riprendi' : 'Pausa';
      $('#rec-badge').classList.toggle('paused', p);
      $('#rec-badge').textContent = p ? '❚❚ PAUSA' : '● REC';
    };
    syncState();
    onCleanup(Recorder.on('state', syncState));

    $('#rec-pause').onclick = () => (Recorder.state === 'paused' ? Recorder.resume() : Recorder.pause());
    $('#rec-mark').onclick = () => {
      Recorder.addBookmark('');
      if (navigator.vibrate) navigator.vibrate(40);
      U.toast('⭐ Momento importante segnato');
    };
    $('#rec-note-form').onsubmit = (e) => {
      e.preventDefault();
      const v = $('#rec-note').value.trim();
      if (!v) return;
      Recorder.addBookmark(v);
      $('#rec-note').value = '';
    };
    $('#rec-stop').onclick = stopRecording;
  }

  async function stopRecording() {
    if (Recorder.elapsed > 5 && !(await U.confirm('Vuoi terminare la registrazione della lezione?', { okLabel: 'Termina', title: 'Fine lezione' }))) return;
    const res = await Recorder.stop();
    updateRecPill();
    if (!res) return;
    const l = newLesson({
      source: 'mic',
      subjectId: res.subjectId || '',
      title: res.title || '',
      date: res.startedAtISO,
      duration: res.duration,
      segments: res.segments,
      bookmarks: res.bookmarks,
      stats: res.stats,
      hasAudio: res.blob.size > 0,
      audioMime: res.mime,
    });
    if (res.blob.size) await Store.audio.put(l.id, res.blob);
    await saveLesson(l);
    await Store.draft.clear();
    const s = Store.settings();
    go(`#/lesson/${l.id}${s.autoProcess && s.apiKey ? '?process=1' : ''}`);
  }

  function updateRecPill() {
    const pill = $('#rec-pill');
    if (!pill) return;
    const show = Recorder.state !== 'idle' && document.body.dataset.route !== 'record';
    pill.classList.toggle('hidden', !show);
    pill.classList.toggle('paused', Recorder.state === 'paused');
  }

  /* ======================= ELABORAZIONE AI ======================= */
  function normalizeResult(r) {
    const arr = (x) => (Array.isArray(x) ? x : []);
    const today = U.todayStr();
    return {
      ...r,
      title: r.title || 'Lezione',
      summary: r.summary || '',
      cleanTranscript: r.cleanTranscript || '',
      mindmap: r.mindmap && r.mindmap.center ? r.mindmap : { center: r.title || 'Lezione', branches: [] },
      keyPoints: arr(r.keyPoints).filter(Boolean),
      keyConcepts: arr(r.keyConcepts).filter((c) => c && c.term),
      flashcards: arr(r.flashcards)
        .filter((c) => c && c.q && c.a)
        .map((c) => ({ q: c.q, a: c.a, box: 0, due: today })),
      quiz: arr(r.quiz)
        .filter((q) => q && q.question && Array.isArray(q.options) && q.options.length >= 2)
        .map((q) => ({ ...q, correct: Math.min(Math.max(0, q.correct | 0), q.options.length - 1) })),
      examQuestions: arr(r.examQuestions).filter(Boolean),
      tasks: arr(r.tasks).filter((t) => t && t.text),
    };
  }

  function matchSubject(name) {
    if (!name) return '';
    const n = name.toLowerCase().trim();
    const list = Store.subjects();
    const s =
      list.find((x) => x.name.toLowerCase() === n) ||
      list.find((x) => n.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(n));
    return s ? s.id : '';
  }

  function syncTasks(l) {
    const all = Store.tasks();
    const keep = all.filter((t) => !(t.lessonId === l.id && t.auto && !t.done));
    const existing = new Set(keep.filter((t) => t.lessonId === l.id).map((t) => t.text.toLowerCase()));
    const fresh = (l.result.tasks || [])
      .filter((t) => !existing.has(t.text.toLowerCase()))
      .map((t) => ({
        id: U.uid(),
        text: t.text,
        due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : '',
        type: ['compito', 'verifica', 'interrogazione', 'avviso'].includes(t.type) ? t.type : 'compito',
        subjectId: l.subjectId,
        lessonId: l.id,
        auto: true,
        done: false,
        createdAt: new Date().toISOString(),
      }));
    Store.saveTasks([...keep, ...fresh]);
    return fresh.length;
  }

  async function processLesson(id) {
    if (jobs.has(id)) return;
    if (!Store.settings().apiKey) {
      U.toast('Prima inserisci la API key di Google nelle Impostazioni', 'error', 4500);
      go('#/settings');
      return;
    }
    const l = await Store.lessons.get(id);
    if (!l) return;
    const job = { status: 'Avvio…', ctrl: new AbortController() };
    jobs.set(id, job);
    l.status = 'processing';
    await saveLesson(l);
    refreshLesson(id);
    const setStatus = (s) => {
      job.status = s;
      const el = $('#proc-status');
      if (el) el.textContent = s;
    };
    try {
      const blob = l.hasAudio ? await Store.audio.get(id) : null;
      const raw = await Gemini.analyzeLesson({
        audioBlob: blob,
        transcript: l.transcript,
        bookmarks: l.bookmarks,
        notesText: l.inputText,
        images: l.images,
        subjectName: l.subjectId ? Store.subject(l.subjectId).name : '',
        signal: job.ctrl.signal,
        onStatus: setStatus,
      });
      const fresh = (await Store.lessons.get(id)) || l;
      fresh.result = normalizeResult(raw);
      if (!fresh.title) fresh.title = fresh.result.title;
      if (!fresh.subjectId) fresh.subjectId = matchSubject(raw.suggestedSubject);
      fresh.status = 'done';
      fresh.error = '';
      fresh.processedAt = new Date().toISOString();
      await saveLesson(fresh);
      const nt = syncTasks(fresh);
      U.toast(`✨ Schemi pronti!${nt ? ` ${nt === 1 ? 'Aggiunto 1 impegno' : `Aggiunti ${nt} impegni`} in agenda.` : ''}`, 'success', 4500);
      notify('Schemi pronti! ✨', fresh.title);
    } catch (e) {
      console.error(e);
      const fresh = (await Store.lessons.get(id)) || l;
      if (e.name === 'AbortError') {
        fresh.status = fresh.result ? 'done' : 'recorded';
        U.toast('Elaborazione annullata');
      } else {
        fresh.status = fresh.result ? 'done' : 'error';
        fresh.error = e.message;
        U.toast(e.message, 'error', 6000);
      }
      await saveLesson(fresh);
    } finally {
      jobs.delete(id);
      invalidate();
      refreshLesson(id);
    }
  }

  function refreshLesson(id) {
    const r = document.body.dataset.route;
    if (location.hash.startsWith(`#/lesson/${id}`) || r === 'home' || r === 'lessons') router();
  }

  function notify(title, body) {
    try {
      if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: 'icons/icon-192.png' });
      }
    } catch (e) {
      /* ignora */
    }
  }

  /* ======================= DETTAGLIO LEZIONE ======================= */
  const TABS = [
    ['schema', '🗺️', 'Schema'],
    ['riassunto', '📄', 'Riassunto'],
    ['spiegazione', '🗣️', 'Spiegazione'],
    ['concetti', '🔑', 'Concetti'],
    ['flashcard', '🧠', 'Flashcard'],
    ['quiz', '❓', 'Quiz'],
    ['interroga', '🎓', 'Interrogazione'],
    ['note', '✏️', 'Note'],
  ];

  async function lesson(id, params) {
    const l = await Store.lessons.get(id);
    if (!l) {
      view().innerHTML = `<div class="empty"><div class="big-emoji">🤷</div><p>Lezione non trovata.</p><a class="btn" href="#/lessons">Vai alle lezioni</a></div>`;
      return;
    }
    if (params.process === '1') {
      history.replaceState(null, '', `#/lesson/${id}`);
      if (effStatus(l) === 'recorded' || effStatus(l) === 'error') {
        processLesson(id);
        return;
      }
    }
    const st = effStatus(l);
    const s = Store.subject(l.subjectId);
    const job = jobs.get(id);
    if (lastLessonId !== id) lastLessonTab = 'schema';
    lastLessonId = id;
    if (params.tab) lastLessonTab = params.tab;

    view().innerHTML = `
      <section class="lesson-head" style="--c:${s.color}">
        <div class="row between">
          <a href="#/lessons" class="icon-btn" aria-label="Indietro">←</a>
          <button class="icon-btn" id="l-menu" aria-label="Altre azioni">⋯</button>
        </div>
        <button class="chip chip-btn" id="l-subject" style="--c:${s.color}">${s.emoji} ${esc(s.name)} ▾</button>
        <h1 id="l-title" class="lesson-title" title="Tocca per rinominare">${esc(l.title || 'Lezione senza titolo')}</h1>
        <p class="muted">${esc(U.fmtDateTime(l.date))}${l.duration ? ` · ${U.fmtDuration(l.duration)}` : ''}${
          l.bookmarks && l.bookmarks.length ? ` · ⭐ ${l.bookmarks.length}` : ''
        }</p>
        ${l.hasAudio ? `<audio id="l-audio" controls preload="metadata" class="audio"></audio>` : ''}
      </section>
      <div id="l-body"></div>`;

    // audio
    if (l.hasAudio) {
      Store.audio.get(id).then((blob) => {
        const a = $('#l-audio');
        if (!a || !blob) return;
        const url = URL.createObjectURL(blob);
        a.src = url;
        onCleanup(() => URL.revokeObjectURL(url));
      });
    }

    $('#l-title').onclick = async () => {
      const t = await U.ask('Rinomina lezione', { value: l.title });
      if (t) {
        l.title = t;
        await saveLesson(l);
        $('#l-title').textContent = t;
      }
    };
    $('#l-subject').onclick = async () => {
      const v = await U.modal({
        title: 'Cambia materia',
        body: `<select class="input">${subjectOptions(l.subjectId)}</select>`,
        actions: [
          { label: 'Annulla', value: null },
          { label: 'Salva', primary: true, value: (w) => w.querySelector('select').value },
        ],
      });
      if (v === null) return;
      l.subjectId = v;
      await saveLesson(l);
      Store.saveTasks(Store.tasks().map((t) => (t.lessonId === l.id ? { ...t, subjectId: v } : t)));
      router();
    };
    $('#l-menu').onclick = () => lessonMenu(l);

    const body = $('#l-body');
    if (st === 'processing') {
      body.innerHTML = `
        <div class="card processing">
          <div class="brain">🧠</div>
          <h3>L'AI sta lavorando…</h3>
          <p id="proc-status" class="muted">${esc(job ? job.status : '')}</p>
          <div class="dots"><span></span><span></span><span></span></div>
          <p class="small muted">Separa la spiegazione dal casino della classe e crea schemi, riassunto, flashcard e quiz. Per una lezione di un'ora può servire 1-2 minuti. Puoi usare altre sezioni dell'app intanto.</p>
          <button class="btn btn-ghost" id="proc-cancel">Annulla</button>
        </div>
        ${transcriptBlock(l)}`;
      $('#proc-cancel').onclick = () => job && job.ctrl.abort();
      bindTranscript(body, l);
      return;
    }
    if (st !== 'done' || !l.result) {
      body.innerHTML = `
        ${st === 'error' ? `<div class="card error-card"><b>⚠️ Elaborazione non riuscita</b><p>${esc(l.error || 'Errore sconosciuto')}</p></div>` : ''}
        <div class="card center">
          <div class="big-emoji">✨</div>
          <h3>${st === 'error' ? 'Riprova' : 'Pronta per diventare uno schema'}</h3>
          <p class="muted">L'AI ascolta la lezione, scarta chiacchiere e rumori e crea schemi, riassunto, flashcard e quiz.</p>
          <button class="btn btn-primary btn-xl" id="l-process">✨ Crea schemi con l'AI</button>
        </div>
        ${transcriptBlock(l)}`;
      $('#l-process').onclick = () => {
        if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
        processLesson(id);
      };
      bindTranscript(body, l);
      return;
    }

    body.innerHTML = `
      <nav class="tabs" id="l-tabs">${TABS.map(
        ([k, ic, label]) => `<button class="tab ${k === lastLessonTab ? 'active' : ''}" data-tab="${k}">${ic} ${label}</button>`
      ).join('')}</nav>
      <div id="tab-content" class="tab-content"></div>`;
    const showTab = (k) => {
      if (!TABS.some((t) => t[0] === k)) k = 'schema';
      lastLessonTab = k;
      UI.TTS.stop();
      $$('#l-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === k));
      const active = $(`#l-tabs [data-tab="${k}"]`);
      if (active) active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      const host = $('#tab-content');
      const el = document.createElement('div');
      el.id = 'tab-content';
      el.className = 'tab-content';
      host.replaceWith(el);
      renderTab(k, l, el);
    };
    $('#l-tabs').onclick = (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) showTab(b.dataset.tab);
    };
    showTab(lastLessonTab);
  }

  function transcriptBlock(l) {
    const segs = l.segments || [];
    const marks = l.bookmarks || [];
    let html = '';
    if (marks.length) {
      html += `<div class="card"><h3>⭐ Momenti importanti</h3><div class="marks">${marks
        .map((b) => `<button class="mark" data-seek="${b.t}">⭐ ${U.fmtDuration(b.t)}${b.label ? ` · ${esc(b.label)}` : ''}</button>`)
        .join('')}</div></div>`;
    }
    if (segs.length) {
      html += `<details class="card"><summary><b>📝 Trascrizione dal vivo originale</b> <span class="muted small">(${segs.length} frasi, non filtrata)</span></summary>
        <div class="transcript">${segs.map((s) => `<p><button class="ts" data-seek="${s.t}">${U.fmtDuration(s.t)}</button> ${esc(s.text)}</p>`).join('')}</div></details>`;
    }
    if (l.inputText) html += `<details class="card"><summary><b>📝 Testo fornito</b></summary><div class="md">${U.md(l.inputText)}</div></details>`;
    if (l.images && l.images.length)
      html += `<div class="card"><h3>📷 Foto</h3><div class="photo-grid">${l.images
        .map((im) => `<img src="data:${im.mime};base64,${im.data}" alt="foto" loading="lazy">`)
        .join('')}</div></div>`;
    return html;
  }

  function bindTranscript(root, l) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-seek]');
      if (!b) return;
      const a = $('#l-audio');
      if (!a) return U.toast('Audio non disponibile');
      a.currentTime = Math.max(0, +b.dataset.seek - 2);
      a.play().catch(() => {});
    });
  }

  function renderTab(k, l, el) {
    const r = l.result;
    const s = Store.subject(l.subjectId);
    switch (k) {
      case 'schema': {
        el.innerHTML = `
          <div class="toolbar">
            <button class="btn btn-sm" data-a="view">📋 Vista elenco</button>
            <button class="btn btn-sm" data-a="expand">➕ Espandi</button>
            <button class="btn btn-sm" data-a="collapse">➖ Comprimi</button>
            <button class="btn btn-sm" data-a="png">🖼️ PNG</button>
            <button class="btn btn-sm" data-a="svg">⬇️ SVG</button>
          </div>
          <div id="mm" class="mm-container"></div>
          <div id="mm-detail" class="mm-detail hidden"></div>
          ${
            r.keyPoints.length
              ? `<div class="card"><h3>📌 Punti da ricordare</h3><ul class="checklist">${r.keyPoints.map((p) => `<li class="md">${U.md(p)}</li>`).join('')}</ul></div>`
              : ''
          }`;
        let ctrl = null;
        let outline = false;
        const mount = () => {
          const box = $('#mm');
          if (outline) {
            box.classList.add('as-outline');
            box.innerHTML = MindMap.outline(r.mindmap);
            ctrl = null;
          } else {
            box.classList.remove('as-outline');
            ctrl = MindMap.mount(box, r.mindmap, {
              onSelect: (n) => {
                const d = $('#mm-detail');
                if (!n) return d.classList.add('hidden');
                d.classList.remove('hidden');
                d.style.setProperty('--c', n.color);
                d.innerHTML = `<b>${esc(n.label)}</b>${n.note ? `<p>${esc(n.note)}</p>` : ''}${
                  n.children.length ? `<p class="muted small">→ ${n.children.map(esc).join(' · ')}</p>` : ''
                }<button class="btn btn-sm" data-a="ask" data-q="${esc(n.label)}">💬 Spiegamelo meglio</button>`;
              },
            });
          }
          U.renderMath(box);
        };
        mount();
        el.querySelector('.toolbar').onclick = async (e) => {
          const b = e.target.closest('[data-a]');
          if (!b) return;
          const a = b.dataset.a;
          if (a === 'view') {
            outline = !outline;
            b.textContent = outline ? '🗺️ Vista mappa' : '📋 Vista elenco';
            mount();
          } else if (a === 'expand') ctrl && ctrl.expandAll();
          else if (a === 'collapse') ctrl && ctrl.collapseAll();
          else if (a === 'svg') U.download(`schema-${U.slug(l.title)}.svg`, MindMap.toSVG(r.mindmap).svg, 'image/svg+xml');
          else if (a === 'png') {
            try {
              U.download(`schema-${U.slug(l.title)}.png`, await MindMap.toPNG(r.mindmap));
            } catch (err) {
              U.toast(err.message, 'error');
            }
          }
        };
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-a=ask]');
          if (b) goChat(`lesson:${l.id}`, `Spiegami meglio questo punto dello schema: "${b.dataset.q}"`, true);
        });
        const onTheme = () => ctrl && el.isConnected && ctrl.redraw();
        window.addEventListener('themechange', onTheme);
        onCleanup(() => window.removeEventListener('themechange', onTheme));
        break;
      }
      case 'riassunto': {
        el.innerHTML = `
          <div class="toolbar">
            <button class="btn btn-sm" data-a="tts">🔊 Ascolta</button>
            <button class="btn btn-sm" data-a="copy">📋 Copia</button>
            <button class="btn btn-sm" data-a="simpler">🧒 Spiegalo più semplice</button>
          </div>
          <article class="card md prose">${U.md(r.summary)}</article>`;
        U.renderMath(el);
        el.querySelector('.toolbar').onclick = (e) => {
          const b = e.target.closest('[data-a]');
          if (!b) return;
          if (b.dataset.a === 'tts') toggleTTS(b, r.summary);
          if (b.dataset.a === 'copy') copy(r.summary);
          if (b.dataset.a === 'simpler')
            goChat(`lesson:${l.id}`, 'Rispiegami tutta la lezione in modo semplicissimo, come se avessi 12 anni, con esempi della vita di tutti i giorni.', true);
        };
        break;
      }
      case 'spiegazione': {
        const pct = r.explanationPercent;
        const st = l.stats;
        const tot = st ? st.voice + st.noise + st.silence : 0;
        el.innerHTML = `
          <div class="card filter-card">
            <h3>🧹 Filtro anti-casino</h3>
            ${r.filteredNoise ? `<p>${esc(r.filteredNoise)}</p>` : ''}
            ${
              typeof pct === 'number'
                ? `<div class="mix-bar big"><span class="mix-voice" style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>
                   <p class="small muted">Secondo l'AI circa il <b>${pct}%</b> della lezione è stata spiegazione vera${
                     tot ? ` · Microfono: voce dominante ${Math.round((st.voice / tot) * 100)}%, rumore ${Math.round((st.noise / tot) * 100)}%` : ''
                   }</p>`
                : ''
            }
            <p class="small muted">${r.audioUsed ? '🎧 Analizzata dall\'audio originale' : '📝 Analizzata dalla trascrizione/testo'}${r.model ? ` · ${esc(r.model)}` : ''}</p>
          </div>
          <div class="toolbar"><button class="btn btn-sm" data-a="tts">🔊 Ascolta</button><button class="btn btn-sm" data-a="copy">📋 Copia</button></div>
          <article class="card md prose">${U.md(r.cleanTranscript)}</article>
          ${transcriptBlock(l)}`;
        U.renderMath(el);
        bindTranscript(el, l);
        el.querySelector('.toolbar').onclick = (e) => {
          const b = e.target.closest('[data-a]');
          if (!b) return;
          if (b.dataset.a === 'tts') toggleTTS(b, r.cleanTranscript);
          if (b.dataset.a === 'copy') copy(r.cleanTranscript);
        };
        break;
      }
      case 'concetti': {
        el.innerHTML = r.keyConcepts.length
          ? `<input class="input" id="c-search" placeholder="🔍 Filtra concetti…">
             <div class="concepts">${r.keyConcepts
               .map(
                 (c) =>
                   `<div class="concept" style="--c:${s.color}"><b class="md">${U.md(c.term)}</b><div class="md">${U.md(c.definition)}</div></div>`
               )
               .join('')}</div>`
          : '<div class="empty">Nessun concetto chiave.</div>';
        U.renderMath(el);
        const cs = $('#c-search');
        if (cs)
          cs.oninput = () => {
            const q = cs.value.toLowerCase();
            $$('.concept', el).forEach((c) => (c.style.display = c.textContent.toLowerCase().includes(q) ? '' : 'none'));
          };
        break;
      }
      case 'flashcard': {
        const box = l.result.flashcards;
        const dueN = box.filter(UI.isDue).length;
        el.innerHTML = `<p class="muted small center">📦 ${box.length} carte · ${dueN} da ripassare oggi · Le carte che sai torneranno tra qualche giorno (ripetizione dilazionata)</p><div id="deck"></div>`;
        UI.flashDeck($('#deck'), box, {
          onGrade: async (card, ok) => {
            UI.gradeCard(card, ok);
            await Store.lessons.put(l);
            invalidate();
          },
        });
        break;
      }
      case 'quiz':
        el.innerHTML = '<div id="quiz"></div>';
        UI.quiz($('#quiz'), r.quiz);
        break;
      case 'interroga': {
        el.innerHTML = `
          <div class="card center">
            <div class="big-emoji">🎓</div>
            <h3>Simula l'interrogazione</h3>
            <p class="muted">Prof AI ti fa le domande una alla volta, valuta le tue risposte e ti dà un voto.</p>
            <button class="btn btn-primary" data-a="sim">🎤 Interrogami!</button>
          </div>
          <div class="card"><h3>Domande probabili</h3>
            <ol class="exam-list">${r.examQuestions
              .map((q) => `<li><span class="md">${U.md(q)}</span> <button class="btn btn-sm btn-ghost" data-q="${esc(q)}">Rispondi →</button></li>`)
              .join('')}</ol>
          </div>`;
        U.renderMath(el);
        el.onclick = (e) => {
          if (e.target.closest('[data-a=sim]'))
            goChat(
              `lesson:${l.id}`,
              'Fammi da professore e interrogami su questa lezione. Fammi UNA domanda alla volta, aspetta la mia risposta, poi valutala (cosa va bene, cosa manca) e passa alla successiva. Dopo 5 domande dammi un voto in decimi con un commento.',
              true
            );
          const q = e.target.closest('[data-q]');
          if (q) goChat(`lesson:${l.id}`, `Domanda: "${q.dataset.q}"\nLa mia risposta: `, false);
        };
        break;
      }
      case 'note': {
        el.innerHTML = `
          <p class="muted small">I tuoi appunti personali su questa lezione (salvataggio automatico). Puoi anche salvare qui le risposte di Prof AI.</p>
          <textarea id="l-notes" class="input notes" rows="14" placeholder="Scrivi qui…">${esc(l.notes || '')}</textarea>
          <p class="small muted" id="notes-saved"></p>`;
        const ta = $('#l-notes');
        const save = U.debounce(async () => {
          const fresh = await Store.lessons.get(l.id);
          fresh.notes = ta.value;
          l.notes = ta.value;
          await Store.lessons.put(fresh);
          invalidate();
          const ns = $('#notes-saved');
          if (ns) ns.textContent = '✓ Salvato';
        }, 500);
        ta.oninput = save;
        break;
      }
    }
  }

  function toggleTTS(btn, text) {
    if (UI.TTS.speaking) {
      UI.TTS.stop();
      return;
    }
    btn.textContent = '⏹ Stop';
    UI.TTS.speak(text, { lang: 'it-IT', onDone: () => (btn.textContent = '🔊 Ascolta') });
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      U.toast('Copiato! 📋', 'success');
    } catch (e) {
      U.toast('Impossibile copiare', 'error');
    }
  }

  async function lessonMenu(l) {
    const v = await U.modal({
      title: 'Azioni',
      body: `<div class="menu-list">
        <button data-v="reprocess">✨ Rielabora con l'AI</button>
        <button data-v="chat">💬 Chiedi a Prof AI su questa lezione</button>
        <button data-v="md">⬇️ Esporta in Markdown</button>
        <button data-v="print">🖨️ Stampa / Salva PDF</button>
        <button data-v="share">📤 Condividi riassunto</button>
        ${l.hasAudio ? '<button data-v="audio">🎧 Scarica audio</button>' : ''}
        <button data-v="delete" class="danger">🗑️ Elimina lezione</button>
      </div>`,
      actions: [{ label: 'Chiudi', value: null }],
      onOpen: (w, close) =>
        w.querySelector('.menu-list').addEventListener('click', (e) => {
          const b = e.target.closest('[data-v]');
          if (b) close(b.dataset.v);
        }),
    });
    const choice = v;
    if (!choice) return;
    if (choice === 'reprocess') {
      if (l.result && !(await U.confirm('Gli schemi attuali (e i progressi delle flashcard) verranno sostituiti.', { okLabel: 'Rielabora' }))) return;
      processLesson(l.id);
    } else if (choice === 'chat') goChat(`lesson:${l.id}`);
    else if (choice === 'md') U.download(`${U.slug(l.title)}.md`, lessonMarkdown(l), 'text/markdown');
    else if (choice === 'print') printLesson(l);
    else if (choice === 'share') {
      const text = `${l.title}\n\n${(l.result && l.result.summary) || ''}`;
      if (navigator.share) navigator.share({ title: l.title, text }).catch(() => {});
      else copy(text);
    } else if (choice === 'audio') {
      const b = await Store.audio.get(l.id);
      if (b) U.download(`${U.slug(l.title)}.${(b.type.split('/')[1] || 'webm').split(';')[0]}`, b);
    } else if (choice === 'delete') {
      if (await U.confirm('La lezione, l\'audio e la chat collegata verranno eliminati.', { okLabel: 'Elimina', danger: true })) {
        await Store.lessons.del(l.id);
        Store.saveTasks(Store.tasks().filter((t) => !(t.lessonId === l.id && !t.done)));
        invalidate();
        U.toast('Lezione eliminata');
        go('#/lessons');
      }
    }
  }

  function lessonMarkdown(l) {
    const r = l.result || {};
    const s = Store.subject(l.subjectId);
    const out = [`# ${l.title}`, `*${s.name} · ${U.fmtDateTime(l.date)}*`, ''];
    if (r.summary) out.push('## Riassunto', r.summary, '');
    if (r.mindmap) out.push('## Schema', MindMap.toMarkdown(r.mindmap), '');
    if ((r.keyPoints || []).length) out.push('## Punti da ricordare', ...r.keyPoints.map((p) => `- ${p}`), '');
    if ((r.keyConcepts || []).length) out.push('## Concetti chiave', ...r.keyConcepts.map((c) => `- **${c.term}**: ${c.definition}`), '');
    if (r.cleanTranscript) out.push('## Spiegazione', r.cleanTranscript, '');
    if ((r.flashcards || []).length) out.push('## Flashcard', ...r.flashcards.map((c) => `- **D:** ${c.q}\n  **R:** ${c.a}`), '');
    if ((r.quiz || []).length)
      out.push(
        '## Quiz',
        ...r.quiz.map(
          (q, i) =>
            `${i + 1}. ${q.question}\n${q.options.map((o, k) => `   ${'ABCDEF'[k]}) ${o}${k === q.correct ? ' ✅' : ''}`).join('\n')}${q.explanation ? `\n   _${q.explanation}_` : ''}`
        ),
        ''
      );
    if ((r.examQuestions || []).length) out.push('## Domande per l\'interrogazione', ...r.examQuestions.map((q) => `- ${q}`), '');
    if (l.notes) out.push('## I miei appunti', l.notes, '');
    if (!l.result && l.transcript) out.push('## Trascrizione', l.transcript);
    return out.join('\n');
  }

  function printLesson(l) {
    const r = l.result;
    const s = Store.subject(l.subjectId);
    const area = $('#print-area');
    area.innerHTML = `
      <h1>${esc(l.title)}</h1>
      <p class="muted">${s.emoji} ${esc(s.name)} · ${esc(U.fmtDateTime(l.date))}</p>
      ${r ? `<div class="print-map">${MindMap.toSVG(r.mindmap).svg}</div>` : ''}
      ${r && r.keyPoints.length ? `<h2>Punti da ricordare</h2><ul>${r.keyPoints.map((p) => `<li>${U.md(p)}</li>`).join('')}</ul>` : ''}
      ${r ? `<h2>Riassunto</h2><div>${U.md(r.summary)}</div>` : ''}
      ${r && r.keyConcepts.length ? `<h2>Concetti chiave</h2><dl>${r.keyConcepts.map((c) => `<dt>${esc(c.term)}</dt><dd>${U.md(c.definition)}</dd>`).join('')}</dl>` : ''}
      ${r ? `<h2>Schema a elenco</h2>${MindMap.outline(r.mindmap)}` : ''}
      ${r ? `<h2>Spiegazione</h2><div>${U.md(r.cleanTranscript)}</div>` : ''}
      ${r && r.examQuestions.length ? `<h2>Domande per l'interrogazione</h2><ol>${r.examQuestions.map((q) => `<li>${U.md(q)}</li>`).join('')}</ol>` : ''}
      ${l.notes ? `<h2>I miei appunti</h2><div>${U.md(l.notes)}</div>` : ''}`;
    U.renderMath(area);
    setTimeout(() => window.print(), 150);
  }

  /* ======================= LISTA LEZIONI ======================= */
  async function lessons(_, params) {
    const all = await getLessons();
    let subject = params.subject || '';
    let q = params.q || '';
    const subs = Store.subjects();
    view().innerHTML = `
      <h1 class="page-title">📚 Lezioni</h1>
      <input id="l-search" class="input search" placeholder="🔍 Cerca argomenti, concetti, parole…" value="${esc(q)}">
      <div class="chips-row" id="l-chips">
        <button class="chip chip-btn ${!subject ? 'active' : ''}" data-s="">Tutte</button>
        ${subs.map((s) => `<button class="chip chip-btn ${subject === s.id ? 'active' : ''}" style="--c:${s.color}" data-s="${esc(s.id)}">${s.emoji} ${esc(s.name)}</button>`).join('')}
      </div>
      <div id="l-actions"></div>
      <div id="l-list" class="list"></div>`;

    const textOf = (l) =>
      [
        l.title,
        l.result && l.result.summary,
        l.result && l.result.cleanTranscript,
        l.result && (l.result.keyConcepts || []).map((c) => c.term + ' ' + c.definition).join(' '),
        l.transcript,
        l.notes,
      ]
        .filter(Boolean)
        .join(' \n ');

    const render = () => {
      const needle = q.toLowerCase().trim();
      const list = all.filter((l) => (!subject || l.subjectId === subject) && (!needle || textOf(l).toLowerCase().includes(needle)));
      $('#l-actions').innerHTML = subject
        ? `<div class="row wrap">
             <a class="btn btn-sm" href="#/chat?ctx=${encodeURIComponent('subject:' + subject)}">💬 Chiedi su tutta la materia</a>
             <a class="btn btn-sm" href="#/review?subject=${encodeURIComponent(subject)}&all=1">🧠 Ripassa la materia</a>
             <button class="btn btn-sm" id="l-guide">📘 Crea guida per la verifica</button>
           </div>`
        : '';
      const g = $('#l-guide');
      if (g)
        g.onclick = () =>
          goChat(
            `subject:${subject}`,
            'Preparami una guida completa per la verifica su tutto quello che abbiamo fatto in questa materia: argomenti principali, concetti chiave, collegamenti tra le lezioni, errori tipici da evitare e 10 domande di verifica con soluzioni.',
            true
          );
      $('#l-list').innerHTML = list.length
        ? list
            .map((l) => {
              let snippet = '';
              if (needle) {
                const t = textOf(l).replace(/[#*_`>|]+|-{2,}|\$/g, ' ');
                const i = t.toLowerCase().indexOf(needle);
                if (i >= 0) {
                  const part = t.slice(Math.max(0, i - 50), i + needle.length + 70).replace(/\s+/g, ' ');
                  snippet = `<div class="snippet">…${esc(part).replace(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), (m) => `<mark>${m}</mark>`)}…</div>`;
                }
              }
              return lessonRow(l).replace('</a>', `${snippet}</a>`);
            })
            .join('')
        : all.length
          ? '<div class="empty">Nessun risultato.</div>'
          : emptyLessons();
    };
    render();
    $('#l-search').oninput = U.debounce((e) => {
      q = e.target.value;
      render();
    }, 200);
    $('#l-chips').onclick = (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      subject = b.dataset.s;
      $$('#l-chips .chip').forEach((c) => c.classList.toggle('active', c === b));
      history.replaceState(null, '', `#/lessons${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`);
      render();
    };
  }

  /* ======================= RIPASSO (flashcard da tutte le lezioni) ======================= */
  function dueCards(all, { subject = '', includeAll = false } = {}) {
    const out = [];
    for (const l of all) {
      if (!l.result || (subject && l.subjectId !== subject)) continue;
      (l.result.flashcards || []).forEach((c, idx) => {
        if (includeAll || UI.isDue(c)) out.push({ card: c, lesson: l, idx });
      });
    }
    return out;
  }

  async function review(_, params) {
    const all = await getLessons();
    const subject = params.subject || '';
    const includeAll = params.all === '1';
    const items = dueCards(all, { subject, includeAll }).slice(0, 40);
    const sub = subject ? Store.subject(subject) : null;
    view().innerHTML = `
      <h1 class="page-title">🧠 Ripasso${sub ? ` · ${sub.emoji} ${esc(sub.name)}` : ' del giorno'}</h1>
      <p class="muted">${includeAll ? 'Tutte le flashcard' : 'Le flashcard in scadenza oggi'} dalle tue lezioni. Ripetizione dilazionata: quelle che sai tornano dopo 1, 3, 7, 14, 30 giorni.</p>
      <div id="deck"></div>
      ${!includeAll ? `<p class="center"><a href="#/review?all=1${subject ? `&subject=${encodeURIComponent(subject)}` : ''}" class="btn btn-ghost btn-sm">Ripassa comunque tutte le carte</a></p>` : ''}`;
    const cards = items.map(({ card, lesson }) => ({ q: card.q, a: card.a, source: `${Store.subject(lesson.subjectId).emoji} ${lesson.title}`, _ref: { card, lesson } }));
    UI.flashDeck($('#deck'), cards, {
      emptyText: all.some((l) => l.result) ? '🎉 Hai ripassato tutto per oggi! Torna domani.' : 'Ancora nessuna flashcard: registra ed elabora una lezione.',
      onGrade: async (c, ok) => {
        const { card, lesson } = c._ref;
        UI.gradeCard(card, ok);
        await Store.lessons.put(lesson);
        invalidate();
      },
    });
  }

  /* ======================= CHAT CON PROF AI ======================= */
  function goChat(ctx, q = '', send = false) {
    go(`#/chat?ctx=${encodeURIComponent(ctx)}${q ? `&q=${encodeURIComponent(q)}` : ''}${send ? '&send=1' : ''}`);
  }

  async function chatSystem(ctx) {
    const now = new Date();
    let sys = `Sei "Prof AI", un tutor scolastico italiano amichevole, paziente e preciso. Aiuti uno studente a capire e studiare.
- Spiega in modo chiaro con esempi concreti, adattandoti al livello dello studente.
- Usa markdown (titoletti, elenchi, **grassetto**, tabelle quando utili) e LaTeX tra $...$ per le formule.
- Per esercizi e compiti spiega il procedimento passo passo invece di dare solo il risultato.
- Se non sei sicuro di qualcosa dillo chiaramente. Risposte non troppo lunghe se non richiesto.
Oggi è ${now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;
    const [type, id] = ctx.split(':');
    if (type === 'lesson') {
      const l = await Store.lessons.get(id);
      if (l) {
        const r = l.result || {};
        sys += `\n\nCONTESTO: lo studente ti fa domande sulla lezione di ${Store.subject(l.subjectId).name} "${l.title}" del ${U.fmtDate(l.date)}. Basati soprattutto su questo materiale (ma puoi integrare con le tue conoscenze):\n`;
        if (r.summary) sys += `\n## Riassunto\n${r.summary}\n`;
        if ((r.keyConcepts || []).length) sys += `\n## Concetti\n${r.keyConcepts.map((c) => `- ${c.term}: ${c.definition}`).join('\n')}\n`;
        if (r.cleanTranscript) sys += `\n## Spiegazione del prof\n${r.cleanTranscript.slice(0, 60000)}\n`;
        else if (l.transcript) sys += `\n## Trascrizione (grezza)\n${l.transcript.slice(0, 60000)}\n`;
        if (l.inputText) sys += `\n## Testo fornito\n${l.inputText.slice(0, 30000)}\n`;
      }
    } else if (type === 'subject') {
      const s = Store.subject(id);
      const ls = (await getLessons()).filter((l) => l.subjectId === id && l.result).slice(0, 30);
      sys += `\n\nCONTESTO: materia ${s.name}. Ecco le lezioni fatte finora (dalla più recente):\n`;
      let budget = 120000;
      for (const l of ls) {
        const chunk = `\n### ${l.title} (${U.fmtDate(l.date)})\n${l.result.summary}\nConcetti: ${(l.result.keyConcepts || []).map((c) => c.term).join(', ')}\n`;
        if (chunk.length > budget) break;
        sys += chunk;
        budget -= chunk.length;
      }
      if (!ls.length) sys += '(nessuna lezione elaborata in questa materia)';
    }
    return sys;
  }

  async function chat(_, params) {
    let ctx = params.ctx || 'general';
    const all = await getLessons();
    const subs = Store.subjects();
    let msgs = await Store.chats.get(ctx);
    let pendingImage = null;
    let ctrl = null;

    const ctxLabel = (c) => {
      const [t, id] = c.split(':');
      if (t === 'lesson') {
        const l = all.find((x) => x.id === id);
        return l ? `📖 ${l.title || 'Lezione'}` : '📖 Lezione';
      }
      if (t === 'subject') {
        const s = Store.subject(id);
        return `${s.emoji} Tutta ${s.name}`;
      }
      return '💬 Domande libere';
    };
    const ctxOptions = [
      'general',
      ...subs.filter((s) => all.some((l) => l.subjectId === s.id && l.result)).map((s) => 'subject:' + s.id),
      ...all.filter((l) => l.result).slice(0, 20).map((l) => 'lesson:' + l.id),
    ];
    if (!ctxOptions.includes(ctx)) ctxOptions.splice(1, 0, ctx);

    view().innerHTML = `
      <section class="chat">
        <div class="chat-head">
          <select id="chat-ctx" class="input">${ctxOptions.map((c) => `<option value="${esc(c)}" ${c === ctx ? 'selected' : ''}>${esc(ctxLabel(c))}</option>`).join('')}</select>
          <button class="icon-btn" id="chat-clear" title="Nuova chat">🗑️</button>
        </div>
        <div id="chat-msgs" class="chat-msgs"></div>
        <div id="chat-preview" class="chat-preview hidden"></div>
        <form class="chat-input" id="chat-form">
          <button type="button" class="icon-btn" id="chat-img" title="Foto (esercizio, lavagna…)">📷</button>
          <button type="button" class="icon-btn" id="chat-mic" title="Detta">🎤</button>
          <textarea id="chat-text" rows="1" placeholder="Chiedi qualsiasi cosa a Prof AI…"></textarea>
          <button class="send-btn" id="chat-send" title="Invia">➤</button>
          <input type="file" id="chat-file" accept="image/*" hidden>
        </form>
      </section>`;

    const box = $('#chat-msgs');
    const ta = $('#chat-text');

    const suggestions = () => {
      if (ctx.startsWith('lesson:'))
        return ['Spiegami la parte più difficile', 'Fammi 5 domande per verificare se ho capito', 'Fammi uno schema riassuntivo a punti', 'Collegala con altri argomenti'];
      if (ctx.startsWith('subject:'))
        return ['Riassumi tutto il programma fatto finora', 'Quali argomenti potrebbero uscire in verifica?', 'Fammi una verifica simulata', 'Trova i collegamenti tra le lezioni'];
      return ['Spiegami il teorema di Pitagora', 'Aiutami a fare un tema', 'Correggi questo esercizio (manda una foto 📷)', 'Dammi un metodo di studio efficace'];
    };

    const bubble = (m, i) => {
      if (m.role === 'user')
        return `<div class="msg msg-user">${m.image ? `<img src="${m.image.url || `data:${m.image.mime};base64,${m.image.data}`}" class="msg-img" alt="">` : ''}<div>${esc(m.text).replace(/\n/g, '<br>')}</div></div>`;
      return `<div class="msg msg-bot ${m.error ? 'msg-error' : ''}" data-i="${i}">
        <div class="msg-avatar">🎓</div>
        <div class="msg-body"><div class="md">${m.text ? U.md(m.text) : '<div class="dots"><span></span><span></span><span></span></div>'}</div>
        ${m.text && !m.error ? `<div class="msg-actions"><button data-m="tts">🔊</button><button data-m="copy">📋</button>${ctx.startsWith('lesson:') ? '<button data-m="save">📌 Salva negli appunti</button>' : ''}</div>` : ''}
        </div></div>`;
    };

    const render = () => {
      if (!msgs.length) {
        box.innerHTML = `
          <div class="chat-empty">
            <div class="big-emoji">🎓</div>
            <h3>Ciao! Sono Prof AI</h3>
            <p class="muted">${ctx === 'general' ? 'Chiedimi qualsiasi cosa: spiegazioni, esercizi, temi, traduzioni…' : `Ho letto ${esc(ctxLabel(ctx))}. Chiedimi quello che vuoi!`}</p>
            <div class="suggestions">${suggestions().map((s) => `<button class="chip chip-btn" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
          </div>`;
      } else box.innerHTML = msgs.map(bubble).join('');
      U.renderMath(box);
      box.scrollTop = box.scrollHeight;
    };
    render();

    const autoGrow = () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
    };
    ta.oninput = autoGrow;
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
        e.preventDefault();
        $('#chat-form').requestSubmit();
      }
    };

    $('#chat-ctx').onchange = (e) => go(`#/chat?ctx=${encodeURIComponent(e.target.value)}`);
    $('#chat-clear').onclick = async () => {
      if (!msgs.length) return;
      if (await U.confirm('Cancellare questa conversazione?', { okLabel: 'Cancella', danger: true })) {
        msgs = [];
        await Store.chats.del(ctx);
        render();
      }
    };

    $('#chat-img').onclick = () => $('#chat-file').click();
    $('#chat-file').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        pendingImage = await U.imageToJpeg(f, 1280, 0.8);
        const p = $('#chat-preview');
        p.classList.remove('hidden');
        p.innerHTML = `<img src="${pendingImage.url}" alt=""><button class="icon-btn" id="chat-img-x">✕</button>`;
        $('#chat-img-x').onclick = () => {
          pendingImage = null;
          p.classList.add('hidden');
          p.innerHTML = '';
        };
        if (!ta.value) ta.value = 'Aiutami con questo: ';
        ta.focus();
      } catch (err) {
        U.toast(err.message, 'error');
      }
      e.target.value = '';
    };

    // Dettatura vocale della domanda
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micBtn = $('#chat-mic');
    if (!SR) micBtn.classList.add('hidden');
    let dict = null;
    micBtn.onclick = () => {
      if (Recorder.state !== 'idle') return U.toast('Il microfono è occupato dalla registrazione della lezione');
      if (dict) {
        dict.stop();
        return;
      }
      dict = new SR();
      dict.lang = Store.settings().lang;
      dict.interimResults = true;
      const base = ta.value ? ta.value + ' ' : '';
      dict.onresult = (e) => {
        ta.value = base + [...e.results].map((r) => r[0].transcript).join('');
        autoGrow();
      };
      dict.onend = () => {
        dict = null;
        micBtn.classList.remove('active');
      };
      dict.onerror = () => U.toast('Dettatura non disponibile', 'error');
      micBtn.classList.add('active');
      dict.start();
    };
    onCleanup(() => dict && dict.abort());

    box.addEventListener('click', async (e) => {
      const sug = e.target.closest('[data-sug]');
      if (sug) {
        ta.value = sug.dataset.sug;
        if (!/foto/.test(sug.dataset.sug)) $('#chat-form').requestSubmit();
        else ta.focus();
        return;
      }
      const act = e.target.closest('[data-m]');
      if (!act) return;
      const m = msgs[+act.closest('[data-i]').dataset.i];
      if (act.dataset.m === 'copy') copy(m.text);
      if (act.dataset.m === 'tts') {
        if (UI.TTS.speaking) UI.TTS.stop();
        else UI.TTS.speak(m.text);
      }
      if (act.dataset.m === 'save') {
        const l = await Store.lessons.get(ctx.split(':')[1]);
        if (!l) return;
        l.notes = (l.notes ? l.notes + '\n\n' : '') + `--- Prof AI (${U.fmtDate(new Date().toISOString())}) ---\n${m.text}`;
        await saveLesson(l);
        U.toast('📌 Salvato negli appunti della lezione', 'success');
      }
    });

    const setBusy = (busy) => {
      const b = $('#chat-send');
      if (!b) return;
      b.textContent = busy ? '■' : '➤';
      b.title = busy ? 'Ferma' : 'Invia';
      b.classList.toggle('busy', busy);
    };

    async function send(text) {
      if (!text && !pendingImage) return;
      if (!Store.settings().apiKey) {
        U.toast('Inserisci la API key di Google nelle Impostazioni', 'error', 4000);
        return go('#/settings');
      }
      const userMsg = { role: 'user', text: text || 'Cosa vedi in questa immagine?' };
      if (pendingImage) userMsg.image = { mime: pendingImage.mime, data: pendingImage.data };
      pendingImage = null;
      $('#chat-preview').classList.add('hidden');
      $('#chat-preview').innerHTML = '';
      msgs.push(userMsg);
      const bot = { role: 'model', text: '' };
      msgs.push(bot);
      render();
      const botEl = box.lastElementChild.querySelector('.md');
      const contents = msgs
        .slice(0, -1)
        .filter((m) => !m.error)
        .slice(-24)
        .map((m) => ({
          role: m.role,
          parts: [...(m.image ? [{ inlineData: { mimeType: m.image.mime, data: m.image.data } }] : []), { text: m.text || '…' }],
        }));
      ctrl = new AbortController();
      setBusy(true);
      let raf = 0;
      try {
        const system = await chatSystem(ctx);
        await Gemini.stream({ contents, system, temperature: 0.7, signal: ctrl.signal }, (full) => {
          bot.text = full;
          if (!raf)
            raf = requestAnimationFrame(() => {
              raf = 0;
              if (!botEl.isConnected) return;
              const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
              botEl.innerHTML = U.md(bot.text);
              if (stick) box.scrollTop = box.scrollHeight;
            });
        });
      } catch (e) {
        if (e.name === 'AbortError') bot.text = (bot.text || '') + '\n\n_(risposta interrotta)_';
        else {
          bot.text = '⚠️ ' + e.message;
          bot.error = true;
        }
      } finally {
        cancelAnimationFrame(raf);
        ctrl = null;
        setBusy(false);
        await Store.chats.put(ctx, msgs);
        if (box.isConnected) render();
      }
    }

    $('#chat-form').onsubmit = (e) => {
      e.preventDefault();
      if (ctrl) {
        ctrl.abort();
        return;
      }
      const t = ta.value.trim();
      ta.value = '';
      autoGrow();
      send(t);
    };
    onCleanup(() => ctrl && ctrl.abort());

    if (params.q) {
      if (params.send === '1') {
        history.replaceState(null, '', `#/chat?ctx=${encodeURIComponent(ctx)}`);
        send(params.q);
      } else {
        ta.value = params.q;
        autoGrow();
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
  }

  /* ======================= AGENDA ======================= */
  const TYPE_ICON = { compito: '📝', verifica: '📋', interrogazione: '🗣️', avviso: '📢' };

  function taskRow(t) {
    const s = Store.subject(t.subjectId);
    const n = U.daysUntil(t.due);
    const cls = t.done ? 'done' : n !== null && n < 0 ? 'overdue' : n !== null && n <= 1 ? 'soon' : '';
    return `<div class="task ${cls}" data-id="${esc(t.id)}">
      <label class="task-check"><input type="checkbox" ${t.done ? 'checked' : ''}><span></span></label>
      <div class="task-main">
        <div class="task-text">${TYPE_ICON[t.type] || '📝'} ${esc(t.text)}</div>
        <div class="task-meta"><span class="dot" style="--c:${s.color}"></span>${esc(s.name)} · <span class="due">${esc(U.fmtDue(t.due))}</span>${
          t.lessonId ? ` · <a href="#/lesson/${encodeURIComponent(t.lessonId)}">lezione</a>` : ''
        }${t.auto ? ' · <span title="Trovato dall\'AI nella lezione">🤖</span>' : ''}</div>
      </div>
      <button class="icon-btn task-del" title="Elimina">✕</button>
    </div>`;
  }

  function bindTaskRows(root, after) {
    root.addEventListener('change', (e) => {
      const row = e.target.closest('.task');
      if (!row || e.target.type !== 'checkbox') return;
      const list = Store.tasks();
      const t = list.find((x) => x.id === row.dataset.id);
      if (!t) return;
      t.done = e.target.checked;
      t.doneAt = t.done ? new Date().toISOString() : null;
      Store.saveTasks(list);
      row.classList.toggle('done', t.done);
      if (t.done) {
        if (navigator.vibrate) navigator.vibrate(30);
        U.toast(['Grande! 💪', 'Fatto! ✅', 'Uno in meno! 🎉', 'Bravo/a! ⭐'][Math.floor(Math.random() * 4)], 'success', 1500);
      }
      after && setTimeout(after, 400);
    });
    root.addEventListener('click', async (e) => {
      const del = e.target.closest('.task-del');
      if (!del) return;
      const id = del.closest('.task').dataset.id;
      Store.saveTasks(Store.tasks().filter((t) => t.id !== id));
      del.closest('.task').remove();
      after && after();
    });
  }

  function agenda() {
    view().innerHTML = `
      <div class="row between"><h1 class="page-title">📅 Agenda</h1><button class="btn btn-sm" id="ics">📆 Esporta calendario</button></div>
      <form class="card" id="task-form">
        <input id="t-text" class="input" placeholder="Es. Esercizi pag. 54 n. 3-7" required>
        <div class="grid-3">
          <select id="t-type" class="input">${Object.entries(TYPE_ICON).map(([k, ic]) => `<option value="${k}">${ic} ${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select>
          <select id="t-subj" class="input">${subjectOptions('')}</select>
          <input id="t-due" class="input" type="date" value="${U.addDays(U.todayStr(), 1)}">
        </div>
        <button class="btn btn-primary">➕ Aggiungi</button>
        <p class="hint">🤖 I compiti e le verifiche annunciati in classe vengono aggiunti in automatico quando l'AI elabora una lezione.</p>
      </form>
      <div id="t-list"></div>`;

    const render = () => {
      const all = Store.tasks();
      const open = all.filter((t) => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
      const groups = [
        ['⚠️ Scaduti', open.filter((t) => t.due && U.daysUntil(t.due) < 0)],
        ['🔥 Oggi e domani', open.filter((t) => t.due && U.daysUntil(t.due) >= 0 && U.daysUntil(t.due) <= 1)],
        ['📆 Prossimi 7 giorni', open.filter((t) => t.due && U.daysUntil(t.due) > 1 && U.daysUntil(t.due) <= 7)],
        ['🗓️ Più avanti', open.filter((t) => t.due && U.daysUntil(t.due) > 7)],
        ['📌 Senza data', open.filter((t) => !t.due)],
      ];
      const done = all.filter((t) => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
      $('#t-list').innerHTML =
        (open.length
          ? groups
              .filter(([, l]) => l.length)
              .map(([title, l]) => `<section class="section"><h2>${title}</h2><div class="list">${l.map(taskRow).join('')}</div></section>`)
              .join('')
          : '<div class="empty"><div class="big-emoji">🏖️</div><p>Niente da fare! Goditi il tempo libero.</p></div>') +
        (done.length
          ? `<details class="section"><summary><b>✅ Completati (${done.length})</b></summary><div class="list">${done.slice(0, 50).map(taskRow).join('')}</div></details>`
          : '');
    };
    render();
    bindTaskRows($('#t-list'), render);

    $('#task-form').onsubmit = (e) => {
      e.preventDefault();
      const text = $('#t-text').value.trim();
      if (!text) return;
      Store.saveTasks([
        ...Store.tasks(),
        { id: U.uid(), text, type: $('#t-type').value, subjectId: $('#t-subj').value, due: $('#t-due').value, done: false, createdAt: new Date().toISOString() },
      ]);
      $('#t-text').value = '';
      render();
      U.toast('Aggiunto!', 'success', 1200);
    };

    $('#ics').onclick = () => {
      const list = Store.tasks().filter((t) => !t.done && t.due);
      if (!list.length) return U.toast('Nessun compito con data da esportare');
      const icsEsc = (s) => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
      const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const ev = list.map((t) => {
        const d = t.due.replace(/-/g, '');
        const d2 = U.addDays(t.due, 1).replace(/-/g, '');
        const s = Store.subject(t.subjectId);
        return [
          'BEGIN:VEVENT',
          `UID:${t.id}@scuola-ai`,
          `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${d}`,
          `DTEND;VALUE=DATE:${d2}`,
          `SUMMARY:${icsEsc(`${TYPE_ICON[t.type] || ''} ${s.name}: ${t.text}`)}`,
          'BEGIN:VALARM',
          'TRIGGER:-PT15H',
          'ACTION:DISPLAY',
          `DESCRIPTION:${icsEsc(t.text)}`,
          'END:VALARM',
          'END:VEVENT',
        ].join('\r\n');
      });
      U.download(
        'scuola-ai-agenda.ics',
        ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Scuola AI//IT', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n'),
        'text/calendar'
      );
    };
  }

  /* ======================= IMPOSTAZIONI ======================= */
  function settings() {
    const s = Store.settings();
    const models = s.modelsCache || [];
    const modelOpts = [['auto', '🤖 Automatico (consigliato)'], ...models.map((m) => [m.id, m.label + ' · ' + m.id])];
    if (s.model !== 'auto' && !models.some((m) => m.id === s.model)) modelOpts.push([s.model, s.model]);

    view().innerHTML = `
      <h1 class="page-title">⚙️ Impostazioni</h1>
      ${installPrompt ? '<button class="btn btn-primary btn-block" id="install">📲 Installa l\'app sul telefono</button>' : ''}

      <section class="card">
        <h3>👤 Profilo</h3>
        <label class="field"><span>Come ti chiami?</span><input id="s-name" class="input" value="${esc(s.name)}" placeholder="Il tuo nome"></label>
      </section>

      <section class="card">
        <h3>🔑 Google Gemini AI</h3>
        <p class="small muted">Crea una API key gratuita su <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> (accedi con Google → "Create API key") e incollala qui. Resta salvata solo su questo dispositivo.</p>
        <label class="field"><span>API key</span>
          <div class="row"><input id="s-key" class="input" type="password" value="${esc(s.apiKey)}" placeholder="AIza…" autocomplete="off" spellcheck="false"><button class="icon-btn" id="s-key-eye" type="button">👁️</button></div>
        </label>
        <div class="row wrap"><button class="btn btn-primary" id="s-test">✅ Salva e verifica</button><span id="s-test-res" class="small"></span></div>
        <label class="field"><span>Modello AI</span><select id="s-model" class="input">${modelOpts
          .map(([v, lbl]) => `<option value="${esc(v)}" ${v === s.model ? 'selected' : ''}>${esc(lbl)}</option>`)
          .join('')}</select></label>
        <label class="field"><span>Dettaglio degli schemi</span><select id="s-detail" class="input">
          ${[['sintetico', '⚡ Sintetico'], ['normale', '📘 Normale'], ['dettagliato', '📚 Dettagliato']].map(([v, l]) => `<option value="${v}" ${s.detail === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      </section>

      <section class="card">
        <h3>🎙️ Registrazione</h3>
        <label class="field"><span>Lingua della lezione</span><select id="s-lang" class="input">
          ${[['it-IT', '🇮🇹 Italiano'], ['en-GB', '🇬🇧 Inglese (UK)'], ['en-US', '🇺🇸 Inglese (US)'], ['fr-FR', '🇫🇷 Francese'], ['es-ES', '🇪🇸 Spagnolo'], ['de-DE', '🇩🇪 Tedesco']]
            .map(([v, l]) => `<option value="${v}" ${s.lang === v ? 'selected' : ''}>${l}</option>`)
            .join('')}
        </select></label>
        <div class="toggles">
          <label class="switch"><input type="checkbox" id="s-filter" ${s.voiceFilter ? 'checked' : ''}><span class="slider"></span><span><b>Filtro voce anti-casino</b><small>Attivo di default</small></span></label>
          <label class="switch"><input type="checkbox" id="s-live" ${s.liveTranscript ? 'checked' : ''}><span class="slider"></span><span><b>Trascrizione dal vivo</b><small>Su alcuni Android può interferire con la registrazione: disattivala se hai problemi</small></span></label>
          <label class="switch"><input type="checkbox" id="s-auto" ${s.autoProcess ? 'checked' : ''}><span class="slider"></span><span><b>Crea schemi in automatico</b><small>Appena finisci di registrare</small></span></label>
        </div>
      </section>

      <section class="card">
        <h3>🎨 Aspetto</h3>
        <div class="segmented" id="s-theme">
          ${[['auto', '🌓 Auto'], ['light', '☀️ Chiaro'], ['dark', '🌙 Scuro']].map(([v, l]) => `<button class="${s.theme === v ? 'active' : ''}" data-v="${v}">${l}</button>`).join('')}
        </div>
      </section>

      <section class="card">
        <div class="section-head"><h3>📚 Materie</h3><button class="btn btn-sm" id="sub-add">➕ Aggiungi</button></div>
        <div id="sub-list" class="list"></div>
      </section>

      <section class="card">
        <h3>💾 Dati e backup</h3>
        <p class="small muted" id="s-storage">Tutto è salvato solo su questo dispositivo.</p>
        <div class="row wrap">
          <button class="btn" id="b-export">⬇️ Backup</button>
          <button class="btn" id="b-export-audio">⬇️ Backup con audio</button>
          <button class="btn" id="b-import">⬆️ Ripristina</button>
          <input type="file" id="b-file" accept=".json,application/json" hidden>
        </div>
        <button class="btn btn-danger btn-block" id="b-wipe">🗑️ Cancella tutti i dati</button>
      </section>

      <section class="card small muted">
        <h3>ℹ️ Info</h3>
        <p><b>Scuola AI</b> registra la lezione, separa la voce del prof dal casino della classe e crea schemi, riassunti, flashcard e quiz con Google Gemini.</p>
        <p>🔒 Privacy: lezioni e audio restano sul tuo dispositivo. Vengono inviati a Google solo quando chiedi di elaborarli o fai domande a Prof AI. Chiedi sempre il permesso prima di registrare.</p>
      </section>`;

    const save = (patch) => Store.saveSettings(patch);
    $('#s-name').onchange = (e) => save({ name: e.target.value.trim() });
    $('#s-key-eye').onclick = () => {
      const i = $('#s-key');
      i.type = i.type === 'password' ? 'text' : 'password';
    };
    $('#s-key').onchange = (e) => {
      save({ apiKey: e.target.value.trim() });
      Gemini.resetModelCache();
    };
    $('#s-test').onclick = async () => {
      const key = $('#s-key').value.trim();
      const res = $('#s-test-res');
      if (!key) return (res.textContent = 'Inserisci prima la key');
      save({ apiKey: key });
      Gemini.resetModelCache();
      res.textContent = '⏳ Verifico…';
      res.className = 'small';
      try {
        const models = await Gemini.testKey(key);
        save({ modelsCache: models });
        const best = Gemini.pickBest(models.map((m) => m.id));
        res.textContent = `✅ Funziona! ${models.length} modelli disponibili (auto: ${best})`;
        res.className = 'small ok';
        const sel = $('#s-model');
        const cur = Store.settings().model;
        sel.innerHTML = [['auto', '🤖 Automatico (consigliato)'], ...models.map((m) => [m.id, m.label + ' · ' + m.id])]
          .map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`)
          .join('');
      } catch (e) {
        res.textContent = '❌ ' + e.message;
        res.className = 'small ko';
      }
    };
    $('#s-model').onchange = (e) => {
      save({ model: e.target.value });
      Gemini.resetModelCache();
    };
    $('#s-detail').onchange = (e) => save({ detail: e.target.value });
    $('#s-lang').onchange = (e) => save({ lang: e.target.value });
    $('#s-filter').onchange = (e) => save({ voiceFilter: e.target.checked });
    $('#s-live').onchange = (e) => save({ liveTranscript: e.target.checked });
    $('#s-auto').onchange = (e) => save({ autoProcess: e.target.checked });
    $('#s-theme').onclick = (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      save({ theme: b.dataset.v });
      $$('#s-theme button').forEach((x) => x.classList.toggle('active', x === b));
      applyTheme();
    };
    const inst = $('#install');
    if (inst)
      inst.onclick = async () => {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        inst.remove();
      };

    // Materie
    const renderSubs = () => {
      $('#sub-list').innerHTML = Store.subjects()
        .map(
          (s) => `<div class="sub-row" data-id="${esc(s.id)}" style="--c:${s.color}">
            <span class="subject-emoji">${s.emoji}</span><b>${esc(s.name)}</b>
            <button class="icon-btn" data-a="edit">✏️</button><button class="icon-btn" data-a="del">🗑️</button></div>`
        )
        .join('');
    };
    renderSubs();
    const editSubject = async (sub) => {
      const v = await U.modal({
        title: sub ? 'Modifica materia' : 'Nuova materia',
        body: `<label class="field"><span>Nome</span><input class="input" id="m-name" value="${esc(sub ? sub.name : '')}" placeholder="Es. Latino"></label>
          <div class="grid-2"><label class="field"><span>Emoji</span><input class="input" id="m-emoji" value="${esc(sub ? sub.emoji : '📘')}" maxlength="4"></label>
          <label class="field"><span>Colore</span><input class="input color" type="color" id="m-color" value="${esc(sub ? sub.color : '#3e63dd')}"></label></div>`,
        actions: [
          { label: 'Annulla', value: null },
          {
            label: 'Salva',
            primary: true,
            value: (w) => ({ name: w.querySelector('#m-name').value.trim(), emoji: w.querySelector('#m-emoji').value.trim() || '📘', color: w.querySelector('#m-color').value }),
          },
        ],
      });
      if (!v || !v.name) return;
      const list = Store.subjects();
      if (sub) Object.assign(list.find((x) => x.id === sub.id), v);
      else {
        let id = U.slug(v.name);
        while (list.some((x) => x.id === id)) id += '-2';
        list.push({ id, ...v });
      }
      Store.saveSubjects(list);
      renderSubs();
    };
    $('#sub-add').onclick = () => editSubject(null);
    $('#sub-list').onclick = async (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const id = b.closest('[data-id]').dataset.id;
      const sub = Store.subjects().find((x) => x.id === id);
      if (b.dataset.a === 'edit') editSubject(sub);
      else if (await U.confirm(`Eliminare la materia "${sub.name}"? Le lezioni non verranno cancellate.`, { okLabel: 'Elimina', danger: true })) {
        Store.saveSubjects(Store.subjects().filter((x) => x.id !== id));
        renderSubs();
      }
    };

    // Backup
    if (navigator.storage && navigator.storage.estimate)
      navigator.storage.estimate().then(({ usage }) => {
        const el = $('#s-storage');
        if (el) el.textContent = `Tutto è salvato solo su questo dispositivo · spazio usato: ${(usage / 1048576).toFixed(1)} MB`;
      });
    const doExport = async (withAudio) => {
      U.toast('Preparo il backup…');
      const data = await Store.exportAll(withAudio);
      U.download(`scuola-ai-backup-${U.todayStr()}.json`, JSON.stringify(data), 'application/json');
    };
    $('#b-export').onclick = () => doExport(false);
    $('#b-export-audio').onclick = () => doExport(true);
    $('#b-import').onclick = () => $('#b-file').click();
    $('#b-file').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const n = await Store.importAll(JSON.parse(await f.text()));
        invalidate();
        U.toast(`Ripristinate ${n} lezioni!`, 'success');
        renderSubs();
      } catch (err) {
        U.toast(err.message, 'error');
      }
    };
    $('#b-wipe').onclick = async () => {
      if (!(await U.confirm('Verranno cancellate TUTTE le lezioni, l\'audio, l\'agenda e le impostazioni. Non si può annullare.', { okLabel: 'Cancella tutto', danger: true })))
        return;
      await Store.wipe();
      invalidate();
      U.toast('Dati cancellati');
      applyTheme();
      go('#/home');
    };
  }

  /* ======================= TEMA, AVVIO ======================= */
  function applyTheme() {
    const t = Store.settings().theme;
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = dark ? '#111113' : '#f6f7fb';
    window.dispatchEvent(new Event('themechange'));
  }

  function init() {
    applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    window.addEventListener('hashchange', router);

    // pill "REC" nell'header quando si registra e si naviga altrove
    let lastPill = 0;
    Recorder.on('level', ({ elapsed }) => {
      const now = performance.now();
      if (now - lastPill < 500) return;
      lastPill = now;
      const pill = $('#rec-pill span');
      if (pill) pill.textContent = U.fmtDuration(elapsed);
    });
    Recorder.on('state', updateRecPill);

    window.addEventListener('beforeunload', (e) => {
      if (Recorder.state !== 'idle' || jobs.size) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      installPrompt = e;
    });

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    router();
  }

  return { init, processLesson, go };
})();

document.addEventListener('DOMContentLoaded', App.init);
