'use strict';

/* Centro Quiz: quiz dalle lezioni (rapidi o nuovi con l'AI), verifiche a tempo, domande aperte corrette
   dall'AI, storico dei risultati e ripasso degli errori. */
const QuizCenter = (() => {
  const { esc, $, $$ } = U;
  const H = () => App.h;
  let running = null;

  /* Salva il risultato e aggiorna la lista degli errori da ripassare */
  function record(res, { label = 'Quiz', subjectId = '', mode = 'rapido' } = {}) {
    const hist = Store.quizHistory.all();
    hist.unshift({
      id: U.uid(),
      date: new Date().toISOString(),
      label,
      subjectId,
      mode,
      total: res.total,
      points: Math.round(res.points * 10) / 10,
      pct: res.pct,
      voto: res.voto,
    });
    Store.quizHistory.save(hist.slice(0, 200));

    const key = (q) => q.question.trim().toLowerCase();
    const wrongKeys = new Set(res.wrong.map((r) => key(r.q)));
    const rightKeys = new Set(res.results.filter((r) => r.ok).map((r) => key(r.q)));
    let mistakes = Store.mistakes.all().filter((m) => !rightKeys.has(key(m)));
    const have = new Set(mistakes.map(key));
    res.wrong.forEach(({ q }) => {
      if (have.has(key(q)) || !wrongKeys.has(key(q))) return;
      const { type, question, options, correct, explanation, answer, topic } = q;
      mistakes.unshift({ type, question, options, correct, explanation, answer, topic, subjectId: q.subjectId || subjectId, addedAt: new Date().toISOString() });
    });
    Store.mistakes.save(mistakes.slice(0, 300));
  }

  const grader = (q, given) => Gemini.gradeOpenAnswer({ question: q.question, modelAnswer: q.answer, studentAnswer: given });

  function lessonMaterial(lessons) {
    let budget = 250000;
    const parts = [];
    for (const l of lessons) {
      const r = l.result;
      const chunk = [
        `### ${l.title} (${Store.subject(l.subjectId).name}, ${U.fmtDate(l.date)})`,
        r.summary,
        (r.keyConcepts || []).map((c) => `- ${c.term}: ${c.definition}`).join('\n'),
        (r.cleanTranscript || '').slice(0, 20000),
      ].join('\n');
      if (chunk.length > budget) break;
      parts.push(chunk);
      budget -= chunk.length;
    }
    return parts.join('\n\n');
  }

  async function page(_, params) {
    if (running) running.stop();
    running = null;
    const all = (await H().getLessons()).filter((l) => l.result);
    const hist = Store.quizHistory.all();
    const mistakes = Store.mistakes.all();
    const st = Store.settings();
    const cfg = {
      subject: params.subject || '',
      mode: params.mode || (st.quizCfg && st.quizCfg.mode) || 'rapido',
      n: 10,
      difficulty: 'media',
      format: 'misto',
      timed: false,
      minutes: 15,
      ...(st.quizCfg || {}),
    };
    if (params.mode) cfg.mode = params.mode;
    if (params.subject !== undefined) cfg.subject = params.subject;

    const avg = hist.length ? Math.round(hist.reduce((s, h) => s + h.pct, 0) / hist.length) : 0;
    const bySubject = {};
    hist.forEach((h) => {
      if (!h.subjectId) return;
      (bySubject[h.subjectId] = bySubject[h.subjectId] || []).push(h.pct);
    });

    const seg = (name, opts, cur) =>
      `<div class="segmented" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(cur) === String(v) ? 'active' : ''}">${l}</button>`).join('')}</div>`;

    H().view().innerHTML = `
      <h1 class="page-title">❓ Quiz e verifiche</h1>
      <div class="quiz-layout">
        <div id="qc-main">
          <form class="card" id="qc-form">
            <h3>Crea un quiz</h3>
            <div class="field"><span>Tipo</span>${seg(
              'mode',
              [
                ['rapido', '⚡ Rapido'],
                ['ai', '✨ Nuovo con AI'],
                ['errori', `🔁 I miei errori (${mistakes.length})`],
              ],
              cfg.mode
            )}
              <small class="muted" id="qc-mode-hint"></small></div>
            <label class="field" id="qc-subj-field"><span>Materia</span><select class="input" id="qc-subj"><option value="">📚 Tutte le materie</option>${Store.subjects()
              .map((s) => `<option value="${esc(s.id)}" ${cfg.subject === s.id ? 'selected' : ''}>${s.emoji} ${esc(s.name)}</option>`)
              .join('')}</select></label>
            <details class="field" id="qc-lessons-field"><summary><b>Lezioni incluse</b> <span class="muted small" id="qc-lcount"></span></summary><div id="qc-lessons" class="check-list"></div></details>
            <div class="field"><span>Numero di domande</span>${seg('n', [[5, '5'], [10, '10'], [15, '15'], [20, '20']], cfg.n)}</div>
            <div class="ai-only">
              <div class="field"><span>Difficoltà</span>${seg('difficulty', [['facile', '🙂 Facile'], ['media', '😐 Media'], ['difficile', '🔥 Difficile']], cfg.difficulty)}</div>
              <div class="field"><span>Formato</span>${seg('format', [['misto', '🎲 Misto'], ['multipla', '🔘 Multipla'], ['vf', '✓✗ Vero/Falso'], ['aperta', '✍️ Aperte']], cfg.format)}</div>
            </div>
            <div class="toggles">
              <label class="switch"><input type="checkbox" id="qc-timed" ${cfg.timed ? 'checked' : ''}><span class="slider"></span><span><b>⏱️ Verifica a tempo</b><small>Come in classe: quando scade il tempo il quiz si chiude</small></span></label>
            </div>
            <label class="field ${cfg.timed ? '' : 'hidden'}" id="qc-min-field"><span>Minuti</span><input type="number" class="input" id="qc-min" min="1" max="120" value="${cfg.minutes}"></label>
            <button class="btn btn-primary btn-xl" id="qc-start">▶ Inizia</button>
          </form>
        </div>
        <aside id="qc-side">
          <div class="card">
            <h3>📈 I tuoi risultati</h3>
            ${
              hist.length
                ? `<div class="stats stats-3">
                    <div class="stat"><b>${hist.length}</b><span>quiz fatti</span></div>
                    <div class="stat"><b>${avg}%</b><span>media</span></div>
                    <div class="stat"><b>${mistakes.length}</b><span>errori da rivedere</span></div>
                  </div>
                  ${Object.entries(bySubject)
                    .map(([id, arr]) => {
                      const s = Store.subject(id);
                      const a = Math.round(arr.reduce((x, y) => x + y, 0) / arr.length);
                      return `<div class="bar-row"><span>${s.emoji} ${esc(s.name)}</span><div class="bar"><div style="width:${a}%;--c:${a >= 60 ? 'var(--success)' : 'var(--danger)'}"></div></div><b>${a}%</b></div>`;
                    })
                    .join('')}
                  <h4 class="mt">Ultimi quiz</h4>
                  <div class="hist-list">${hist
                    .slice(0, 8)
                    .map(
                      (h) =>
                        `<div class="hist-row"><span>${esc(h.label)}<small class="muted"> · ${esc(U.fmtDate(h.date))}</small></span><b class="voto ${h.voto >= 6 ? 'ok' : 'ko'}">${String(h.voto).replace('.', ',')}</b></div>`
                    )
                    .join('')}</div>`
                : '<p class="muted">Fai il tuo primo quiz: qui vedrai medie, progressi ed errori da ripassare.</p>'
            }
          </div>
        </aside>
      </div>`;

    const form = $('#qc-form');
    const getSeg = (name) => form.querySelector(`[data-seg="${name}"] .active`).dataset.v;

    const lessonsFor = () => all.filter((l) => !cfg.subject || l.subjectId === cfg.subject);
    const renderLessons = () => {
      const list = lessonsFor();
      $('#qc-lessons').innerHTML = list.length
        ? list
            .map(
              (l) =>
                `<label class="check"><input type="checkbox" value="${esc(l.id)}" checked> ${Store.subject(l.subjectId).emoji} ${esc(l.title)} <small class="muted">${esc(U.fmtDate(l.date))} · ❓${(l.result.quiz || []).length}</small></label>`
            )
            .join('')
        : '<p class="muted small">Nessuna lezione elaborata per questa materia.</p>';
      updateCount();
    };
    const selectedLessons = () => {
      const ids = new Set($$('#qc-lessons input:checked').map((i) => i.value));
      return lessonsFor().filter((l) => ids.has(l.id));
    };
    const updateCount = () => ($('#qc-lcount').textContent = `(${selectedLessons().length} di ${lessonsFor().length})`);
    $('#qc-lessons').addEventListener('change', updateCount);

    const syncMode = () => {
      const m = getSeg('mode');
      cfg.mode = m;
      form.querySelector('.ai-only').classList.toggle('hidden', m !== 'ai');
      $('#qc-lessons-field').classList.toggle('hidden', m === 'errori');
      $('#qc-mode-hint').textContent =
        m === 'rapido'
          ? 'Usa le domande già create per le tue lezioni: parte subito e funziona anche offline.'
          : m === 'ai'
            ? "L'AI scrive domande nuove sulle lezioni scelte, anche aperte, e le corregge come un prof."
            : 'Ripassa le domande che hai sbagliato: quando rispondi giusto spariscono dalla lista.';
    };
    syncMode();
    renderLessons();

    form.addEventListener('click', (e) => {
      const b = e.target.closest('[data-seg] [data-v]');
      if (!b) return;
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      if (b.parentElement.dataset.seg === 'mode') syncMode();
    });
    $('#qc-subj').onchange = (e) => {
      cfg.subject = e.target.value;
      renderLessons();
    };
    $('#qc-timed').onchange = (e) => $('#qc-min-field').classList.toggle('hidden', !e.target.checked);

    form.onsubmit = async (e) => {
      e.preventDefault();
      Object.assign(cfg, {
        n: +getSeg('n'),
        difficulty: getSeg('difficulty'),
        format: getSeg('format'),
        timed: $('#qc-timed').checked,
        minutes: Math.max(1, Math.min(120, +$('#qc-min').value || 15)),
      });
      Store.saveSettings({ quizCfg: { ...cfg, subject: undefined } });
      const subjLabel = cfg.subject ? Store.subject(cfg.subject).name : 'Tutte le materie';
      let questions = [];
      let label = '';
      if (cfg.mode === 'errori') {
        questions = Store.mistakes.all().filter((m) => !cfg.subject || m.subjectId === cfg.subject);
        questions = UI.shuffle(questions).slice(0, cfg.n);
        label = `Errori · ${subjLabel}`;
        if (!questions.length) return U.toast('🎉 Nessun errore da ripassare!', 'success');
      } else {
        const ls = selectedLessons();
        if (!ls.length) return U.toast('Scegli almeno una lezione elaborata (registrala o carica un PDF)', 'error', 4000);
        if (cfg.mode === 'rapido') {
          ls.forEach((l) =>
            (l.result.quiz || []).forEach((q) => questions.push({ type: 'mc', ...q, topic: l.title, subjectId: l.subjectId }))
          );
          questions = UI.shuffle(questions).slice(0, cfg.n);
          label = `Rapido · ${ls.length === 1 ? ls[0].title : subjLabel}`;
          if (!questions.length) return U.toast('Queste lezioni non hanno domande: prova "Nuovo con AI"', 'error', 4000);
        } else {
          if (!Store.settings().apiKey) {
            U.toast('Serve la API key di Google (Impostazioni)', 'error');
            return H().go('#/settings');
          }
          const btn = $('#qc-start');
          btn.disabled = true;
          btn.textContent = '✨ L\'AI sta preparando la verifica…';
          try {
            questions = await Gemini.generateQuiz({ material: lessonMaterial(ls), n: cfg.n, difficulty: cfg.difficulty, format: cfg.format });
            const subj = ls.every((l) => l.subjectId === ls[0].subjectId) ? ls[0].subjectId : '';
            questions.forEach((q) => (q.subjectId = subj));
          } catch (err) {
            U.toast(err.message, 'error', 5000);
            btn.disabled = false;
            btn.textContent = '▶ Inizia';
            return;
          }
          label = `AI ${cfg.difficulty} · ${ls.length === 1 ? ls[0].title : subjLabel}`;
          if (!questions.length) return U.toast('L\'AI non ha creato domande, riprova', 'error');
        }
      }
      run(questions, { label, subjectId: cfg.subject, mode: cfg.mode, timeLimit: cfg.timed ? cfg.minutes * 60 : 0 });
    };
  }

  function run(questions, { label, subjectId, mode, timeLimit }) {
    const main = $('#qc-main');
    main.innerHTML = `
      <div class="card quiz-run">
        <div class="row between"><b>${esc(label)}</b><button class="btn btn-sm btn-ghost" id="qc-exit">✕ Esci</button></div>
        <div id="qc-quiz"></div>
      </div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    let done = false;
    running = UI.quiz($('#qc-quiz'), questions, {
      timeLimit,
      grader,
      onFinish: (res) => {
        done = true;
        record(res, { label, subjectId, mode });
        if (res.voto >= 8 && navigator.vibrate) navigator.vibrate([40, 60, 40]);
      },
    });
    H().onCleanup(() => running && running.stop());
    $('#qc-exit').onclick = async () => {
      if (!done && !(await U.confirm('Uscire dal quiz? Il risultato non verrà salvato.', { okLabel: 'Esci' }))) return;
      H().go('#/quiz');
    };
  }

  App.route('quiz', page);
  return { record, grader };
})();
