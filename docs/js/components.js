'use strict';

/* Componenti riutilizzabili: flashcard con ripetizione dilazionata, quiz, lettura ad alta voce. */
const UI = (() => {
  // Sistema Leitner: giorni di attesa per ogni "scatola"
  const INTERVALS = [0, 1, 3, 7, 14, 30];

  function gradeCard(card, ok) {
    const box = ok ? Math.min(5, (card.box || 0) + 1) : 0;
    card.box = box;
    card.due = U.addDays(U.todayStr(), INTERVALS[box]);
    card.seen = (card.seen || 0) + 1;
    return card;
  }

  const isDue = (card) => !card.due || card.due <= U.todayStr();

  function shuffle(a) {
    const arr = a.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* cards: [{q, a, box, due, ...}] — onGrade(card, ok) viene chiamato a ogni risposta */
  function flashDeck(el, cards, { onGrade, emptyText = 'Nessuna flashcard.' } = {}) {
    if (!cards.length) {
      el.innerHTML = `<div class="empty">${U.esc(emptyText)}</div>`;
      return;
    }
    let queue = shuffle(cards);
    let retried = new Set();
    let known = 0;
    let again = 0;
    let done = 0;
    const total = cards.length;

    function render() {
      if (!queue.length) {
        const pct = Math.round((known / Math.max(1, known + again)) * 100);
        el.innerHTML = `
          <div class="deck-end">
            <div class="big-emoji">${pct >= 80 ? '🏆' : pct >= 50 ? '💪' : '📚'}</div>
            <h3>Ripasso completato!</h3>
            <p>${known} sapute al primo colpo · ${again} da ripassare</p>
            <button class="btn btn-primary" data-act="restart">🔁 Ricomincia</button>
          </div>`;
        el.querySelector('[data-act=restart]').onclick = () => {
          queue = shuffle(cards);
          retried = new Set();
          known = again = done = 0;
          render();
        };
        return;
      }
      const c = queue[0];
      el.innerHTML = `
        <div class="deck">
          <div class="deck-progress"><div style="width:${(done / total) * 100}%"></div></div>
          <div class="deck-meta">${Math.min(done + 1, total)} / ${total}${c.source ? ` · ${U.esc(c.source)}` : ''}</div>
          <div class="flash" tabindex="0" role="button" aria-label="Gira la carta">
            <div class="flash-inner">
              <div class="flash-face flash-front"><span class="flash-tag">Domanda</span><div class="flash-text md">${U.md(c.q)}</div><span class="flash-hint">Tocca per girare</span></div>
              <div class="flash-face flash-back"><span class="flash-tag">Risposta</span><div class="flash-text md">${U.md(c.a)}</div></div>
            </div>
          </div>
          <div class="deck-actions hidden">
            <button class="btn btn-warn" data-g="0">🔁 Da ripassare</button>
            <button class="btn btn-success" data-g="1">✅ Lo so</button>
          </div>
        </div>`;
      U.renderMath(el);
      const flash = el.querySelector('.flash');
      const actions = el.querySelector('.deck-actions');
      const flip = () => {
        flash.classList.toggle('flipped');
        actions.classList.remove('hidden');
      };
      flash.onclick = flip;
      flash.onkeydown = (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          flip();
        }
      };
      actions.onclick = (e) => {
        const b = e.target.closest('[data-g]');
        if (!b) return;
        const ok = b.dataset.g === '1';
        const card = queue.shift();
        if (!retried.has(card)) {
          ok ? known++ : again++;
          onGrade && onGrade(card, ok);
          done++;
        }
        if (!ok && !retried.has(card)) {
          retried.add(card);
          queue.push(card); // la rivedi alla fine del giro
        }
        render();
      };
    }
    render();
  }

  /* questions: [{type?: 'mc'|'vf'|'open', question, options[], correct, explanation, answer?, topic?}]
     opts: { onFinish(result), timeLimit (secondi), grader(q, risposta) → {score, feedback}, title } */
  function quiz(el, questions, opts = {}) {
    if (!questions.length) {
      el.innerHTML = '<div class="empty">Nessuna domanda disponibile.</div>';
      return { stop() {} };
    }
    const { onFinish, timeLimit = 0, grader, shuffleQuestions = true } = opts;
    let order;
    let i;
    let points;
    let results;
    let timer = 0;
    let deadline = 0;
    let finished = false;

    function start() {
      order = shuffleQuestions ? shuffle(questions) : questions.slice();
      i = 0;
      points = 0;
      results = [];
      finished = false;
      clearInterval(timer);
      if (timeLimit) {
        deadline = Date.now() + timeLimit * 1000;
        timer = setInterval(tick, 500);
      }
      render();
    }

    function tick() {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      const t = el.querySelector('.quiz-timer');
      if (t) {
        t.textContent = `⏱️ ${U.fmtDuration(left)}`;
        t.classList.toggle('urgent', left <= 60);
      }
      if (!left && !finished) {
        // tempo scaduto: le domande rimaste contano come sbagliate
        for (let k = results.length; k < order.length; k++) results.push({ q: order[k], ok: false, given: '(tempo scaduto)', score: 0 });
        U.toast('⏰ Tempo scaduto!', 'error');
        finish();
      }
    }

    function finish() {
      finished = true;
      clearInterval(timer);
      const total = order.length;
      const pct = Math.round((points / total) * 100);
      const voto = Math.max(2, Math.round((points / total) * 10 * 2) / 2);
      const wrong = results.filter((r) => !r.ok);
      onFinish && onFinish({ total, points, pct, voto, results, wrong });
      el.innerHTML = `
        <div class="deck-end">
          <div class="big-emoji">${pct >= 90 ? '🌟' : pct >= 60 ? '👍' : '📖'}</div>
          <h3>${String(Math.round(points * 10) / 10).replace('.', ',')} / ${total} punti</h3>
          <p>Voto indicativo: <b class="voto ${voto >= 6 ? 'ok' : 'ko'}">${String(voto).replace('.', ',')}</b></p>
          ${
            wrong.length
              ? `<div class="wrong-list"><h4>Da rivedere (${wrong.length})</h4>${wrong
                  .map(
                    ({ q, given, feedback }) =>
                      `<div class="wrong-item"><div class="md">${U.md(q.question)}</div>
                       ${given ? `<div class="ko-answer">✗ ${U.esc(given)}</div>` : ''}
                       <div class="ok-answer">✅ ${U.esc(q.type === 'open' ? q.answer || '' : q.options[q.correct] || '')}</div>
                       ${feedback ? `<div class="muted md">${U.md(feedback)}</div>` : q.explanation ? `<div class="muted md">${U.md(q.explanation)}</div>` : ''}</div>`
                  )
                  .join('')}</div>`
              : ''
          }
          <button class="btn btn-primary" data-act="again">🔁 Rifai il quiz</button>
        </div>`;
      U.renderMath(el);
      el.querySelector('[data-act=again]').onclick = start;
    }

    function next() {
      i++;
      if (i >= order.length) finish();
      else render();
    }

    function feedbackBox(cls, head, body = '') {
      const fb = el.querySelector('.quiz-feedback');
      fb.classList.remove('hidden');
      fb.innerHTML = `<div class="${cls}">${head}</div>${body}<button class="btn btn-primary" data-act="next">${
        i + 1 < order.length ? 'Avanti →' : 'Vedi risultato'
      }</button>`;
      U.renderMath(fb);
      fb.querySelector('[data-act=next]').onclick = next;
    }

    function render() {
      const q = order[i];
      const isOpen = q.type === 'open';
      el.innerHTML = `
        <div class="quiz">
          <div class="deck-progress"><div style="width:${(i / order.length) * 100}%"></div></div>
          <div class="deck-meta">Domanda ${i + 1} di ${order.length} · Punti ${String(Math.round(points * 10) / 10).replace('.', ',')}${
            timeLimit ? ' · <span class="quiz-timer"></span>' : ''
          }</div>
          ${q.topic ? `<div class="quiz-topic">${U.esc(q.topic)}</div>` : ''}
          <div class="quiz-q md">${U.md(q.question)}</div>
          ${
            isOpen
              ? `<textarea class="input quiz-open" rows="5" placeholder="Scrivi qui la tua risposta…"></textarea>
                 <button class="btn btn-primary btn-block" data-act="grade">✅ Correggi la risposta</button>`
              : `<div class="quiz-opts ${q.type === 'vf' ? 'vf' : ''}">${q.options
                  .map(
                    (o, k) =>
                      `<button class="quiz-opt" data-k="${k}"><span class="quiz-letter">${q.type === 'vf' ? (k ? '✗' : '✓') : 'ABCDEF'[k] || k + 1}</span><span class="md">${U.md(o)}</span></button>`
                  )
                  .join('')}</div>`
          }
          <div class="quiz-feedback hidden"></div>
        </div>`;
      U.renderMath(el);
      if (timeLimit) tick();

      if (isOpen) {
        const ta = el.querySelector('.quiz-open');
        const btn = el.querySelector('[data-act=grade]');
        btn.onclick = async () => {
          const given = ta.value.trim();
          btn.disabled = true;
          ta.disabled = true;
          let score = 0;
          let feedback = '';
          if (grader && given) {
            btn.textContent = '⏳ Il prof AI sta correggendo…';
            try {
              ({ score, feedback } = await grader(q, given));
            } catch (e) {
              feedback = '⚠️ Correzione automatica non riuscita: ' + e.message;
              score = 0;
            }
          } else if (!given) feedback = 'Nessuna risposta.';
          if (finished || !el.isConnected) return;
          btn.remove();
          const ok = score >= 6;
          points += score / 10;
          results.push({ q, ok, given, score, feedback });
          feedbackBox(
            ok ? 'fb-ok' : score >= 5 ? 'fb-mid' : 'fb-ko',
            `${ok ? '✅' : score >= 5 ? '🟡' : '❌'} Voto: ${String(score).replace('.', ',')}/10`,
            `<div class="md">${U.md(feedback)}</div>${
              q.answer ? `<details class="model-answer"><summary>Risposta modello</summary><div class="md">${U.md(q.answer)}</div></details>` : ''
            }`
          );
        };
        return;
      }

      const optsEl = el.querySelector('.quiz-opts');
      optsEl.onclick = (e) => {
        const b = e.target.closest('[data-k]');
        if (!b || optsEl.classList.contains('answered')) return;
        optsEl.classList.add('answered');
        const k = +b.dataset.k;
        const ok = k === q.correct;
        if (ok) points++;
        results.push({ q, ok, given: q.options[k] });
        optsEl.querySelectorAll('.quiz-opt').forEach((x) => {
          const kk = +x.dataset.k;
          if (kk === q.correct) x.classList.add('correct');
          else if (kk === k) x.classList.add('wrong');
        });
        feedbackBox(ok ? 'fb-ok' : 'fb-ko', ok ? '✅ Esatto!' : '❌ Sbagliato', q.explanation ? `<div class="md">${U.md(q.explanation)}</div>` : '');
      };
    }

    start();
    return {
      stop() {
        finished = true;
        clearInterval(timer);
      },
    };
  }

  /* ---------- Lettura ad alta voce (sintesi vocale del browser) ---------- */
  const TTS = (() => {
    let speaking = false;
    let onEnd = null;
    const plain = (t) =>
      String(t || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/\$\$?([^$]+)\$\$?/g, '$1')
        .replace(/[#*_`>|]/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();

    function voice(lang) {
      const vs = speechSynthesis.getVoices();
      const l = lang.slice(0, 2);
      return (
        vs.find((v) => v.lang.replace('_', '-') === lang && /google|natural|neural|premium/i.test(v.name)) ||
        vs.find((v) => v.lang.replace('_', '-') === lang) ||
        vs.find((v) => v.lang.startsWith(l))
      );
    }

    function speak(text, { lang = 'it-IT', rate = 1, onDone } = {}) {
      if (!('speechSynthesis' in window)) {
        U.toast('Sintesi vocale non supportata da questo browser', 'error');
        return;
      }
      stop();
      const sentences = plain(text).match(/[^.!?;:]+[.!?;:]*\s*/g) || [];
      // Chrome interrompe gli enunciati lunghi: li dividiamo in pezzi da ~220 caratteri
      const chunks = [];
      let cur = '';
      for (const s of sentences) {
        if ((cur + s).length > 220 && cur) {
          chunks.push(cur);
          cur = s;
        } else cur += s;
      }
      if (cur.trim()) chunks.push(cur);
      if (!chunks.length) return;
      speaking = true;
      onEnd = onDone;
      const v = voice(lang);
      chunks.forEach((c, idx) => {
        const u = new SpeechSynthesisUtterance(c);
        u.lang = lang;
        u.rate = rate;
        if (v) u.voice = v;
        if (idx === chunks.length - 1)
          u.onend = () => {
            speaking = false;
            onEnd && onEnd();
          };
        speechSynthesis.speak(u);
      });
    }

    function stop() {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      if (speaking && onEnd) onEnd();
      speaking = false;
    }

    return {
      speak,
      stop,
      get speaking() {
        return speaking;
      },
    };
  })();

  return { flashDeck, quiz, gradeCard, isDue, shuffle, TTS, INTERVALS };
})();
