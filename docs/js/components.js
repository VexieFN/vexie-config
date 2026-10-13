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

  /* questions: [{question, options[], correct, explanation}] */
  function quiz(el, questions) {
    if (!questions.length) {
      el.innerHTML = '<div class="empty">Nessuna domanda disponibile.</div>';
      return;
    }
    let order = shuffle(questions);
    let i = 0;
    let score = 0;
    let wrong = [];

    function render() {
      if (i >= order.length) {
        const pct = Math.round((score / order.length) * 100);
        const voto = Math.max(2, Math.round((score / order.length) * 10 * 2) / 2);
        el.innerHTML = `
          <div class="deck-end">
            <div class="big-emoji">${pct >= 90 ? '🌟' : pct >= 60 ? '👍' : '📖'}</div>
            <h3>${score} / ${order.length} corrette</h3>
            <p>Voto indicativo: <b>${String(voto).replace('.', ',')}</b></p>
            ${
              wrong.length
                ? `<div class="wrong-list"><h4>Da rivedere</h4>${wrong
                    .map(
                      (q) =>
                        `<div class="wrong-item"><div class="md">${U.md(q.question)}</div><div class="ok-answer">✅ ${U.esc(q.options[q.correct] || '')}</div>${q.explanation ? `<div class="muted md">${U.md(q.explanation)}</div>` : ''}</div>`
                    )
                    .join('')}</div>`
                : ''
            }
            <button class="btn btn-primary" data-act="again">🔁 Rifai il quiz</button>
          </div>`;
        U.renderMath(el);
        el.querySelector('[data-act=again]').onclick = () => {
          order = shuffle(questions);
          i = score = 0;
          wrong = [];
          render();
        };
        return;
      }
      const q = order[i];
      el.innerHTML = `
        <div class="quiz">
          <div class="deck-progress"><div style="width:${(i / order.length) * 100}%"></div></div>
          <div class="deck-meta">Domanda ${i + 1} di ${order.length} · Punteggio ${score}</div>
          <div class="quiz-q md">${U.md(q.question)}</div>
          <div class="quiz-opts">${q.options
            .map((o, k) => `<button class="quiz-opt" data-k="${k}"><span class="quiz-letter">${'ABCDEF'[k] || k + 1}</span><span class="md">${U.md(o)}</span></button>`)
            .join('')}</div>
          <div class="quiz-feedback hidden"></div>
        </div>`;
      U.renderMath(el);
      const opts = el.querySelector('.quiz-opts');
      opts.onclick = (e) => {
        const b = e.target.closest('[data-k]');
        if (!b || opts.classList.contains('answered')) return;
        opts.classList.add('answered');
        const k = +b.dataset.k;
        const ok = k === q.correct;
        if (ok) score++;
        else wrong.push(q);
        opts.querySelectorAll('.quiz-opt').forEach((x) => {
          const kk = +x.dataset.k;
          if (kk === q.correct) x.classList.add('correct');
          else if (kk === k) x.classList.add('wrong');
        });
        const fb = el.querySelector('.quiz-feedback');
        fb.classList.remove('hidden');
        fb.innerHTML = `<div class="${ok ? 'fb-ok' : 'fb-ko'}">${ok ? '✅ Esatto!' : '❌ Sbagliato'}</div>${
          q.explanation ? `<div class="md">${U.md(q.explanation)}</div>` : ''
        }<button class="btn btn-primary" data-act="next">${i + 1 < order.length ? 'Avanti →' : 'Vedi risultato'}</button>`;
        U.renderMath(fb);
        fb.querySelector('[data-act=next]').onclick = () => {
          i++;
          render();
        };
      };
    }
    render();
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
