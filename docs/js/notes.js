'use strict';

/* Quaderno digitale: appunti con pagine scritte a mano (penna/stilo/dito) e pagine di testo. */
(() => {
  const { esc, $, $$ } = U;
  const H = () => App.h;

  const COLORS = ['#1c2024', '#3e63dd', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6'];
  const HL_COLORS = ['#ffd60a', '#7ce38b', '#7cc8ff', '#ff9ecf'];
  const SIZES = [
    [2, 'Sottile'],
    [4, 'Media'],
    [8, 'Spessa'],
  ];

  /* ---------- Sanificazione HTML delle pagine di testo ---------- */
  const ALLOWED = new Set('B STRONG I EM U S STRIKE H3 H4 UL OL LI MARK BR P DIV SPAN CODE PRE BLOCKQUOTE TABLE THEAD TBODY TR TH TD HR SUB SUP FONT'.split(' '));
  const DROP = new Set('SCRIPT STYLE IFRAME OBJECT EMBED LINK META SVG MATH TEMPLATE'.split(' '));
  const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;

  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<div id="root">${html || ''}</div>`, 'text/html');
    const root = doc.getElementById('root');
    const clean = (node) => {
      [...node.childNodes].forEach((ch) => {
        if (ch.nodeType === 3) return;
        if (ch.nodeType !== 1 || DROP.has(ch.tagName)) {
          ch.remove();
          return;
        }
        clean(ch);
        if (!ALLOWED.has(ch.tagName)) {
          ch.replaceWith(...ch.childNodes);
          return;
        }
        const bg = ch.style && ch.style.backgroundColor;
        const fg = ch.style && ch.style.color;
        const fontColor = ch.tagName === 'FONT' ? ch.getAttribute('color') : null;
        [...ch.attributes].forEach((a) => ch.removeAttribute(a.name));
        const style = [];
        if (bg && SAFE_COLOR.test(bg.replace(/\s/g, ''))) style.push(`background-color:${bg}`);
        if (fg && SAFE_COLOR.test(fg.replace(/\s/g, ''))) style.push(`color:${fg}`);
        if (style.length) ch.setAttribute('style', style.join(';'));
        if (fontColor && SAFE_COLOR.test(fontColor)) ch.setAttribute('color', fontColor);
      });
    };
    clean(root);
    return root.innerHTML;
  }

  const textOf = (html) => {
    const d = document.createElement('div');
    d.innerHTML = sanitize(html).replace(/<\/(p|div|li|h3|h4|tr)>/gi, '$&\n').replace(/<br\s*\/?>/gi, '\n');
    return d.textContent.replace(/\n{3,}/g, '\n\n').trim();
  };

  const noteText = (note) =>
    note.pages
      .filter((p) => p.type === 'text')
      .map((p) => textOf(p.html))
      .filter(Boolean)
      .join('\n\n');

  const inkPages = (note) => note.pages.filter((p) => p.type === 'ink' && !Ink.isEmpty(p));

  function newPage(type, bg = 'lines') {
    return type === 'ink' ? { id: U.uid(), type: 'ink', bg, strokes: [] } : { id: U.uid(), type: 'text', html: '' };
  }

  async function createNote({ title = '', subjectId = '', lessonId = '', type = 'ink', bg = 'lines' } = {}) {
    const note = {
      id: U.uid(),
      title: title || `Appunti del ${U.fmtDate(new Date().toISOString(), { day: 'numeric', month: 'long' })}`,
      subjectId,
      lessonId,
      createdAt: new Date().toISOString(),
      pages: [newPage(type, bg)],
    };
    await Store.notes.put(note);
    return note;
  }

  async function newNoteDialog(defaults = {}) {
    const subjOpts = H().subjectOptions(defaults.subjectId || H().currentSubject() || '');
    const v = await U.modal({
      title: '✍️ Nuovi appunti',
      body: `
        <label class="field"><span>Titolo</span><input class="input" id="n-title" placeholder="Es. Equazioni – esercizi"></label>
        <label class="field"><span>Materia</span><select class="input" id="n-subj">${subjOpts}</select></label>
        <div class="field"><span>Prima pagina</span>
          <div class="segmented" id="n-type"><button data-v="ink" class="active">✍️ A mano</button><button data-v="text">⌨️ Testo</button></div></div>
        <div class="field" id="n-bg-field"><span>Sfondo</span>
          <div class="segmented" id="n-bg">${Object.entries(Ink.BACKGROUNDS)
            .map(([k, l]) => `<button data-v="${k}" class="${k === 'lines' ? 'active' : ''}">${l}</button>`)
            .join('')}</div></div>`,
      actions: [
        { label: 'Annulla', value: null },
        {
          label: 'Crea',
          primary: true,
          value: (w) => ({
            title: w.querySelector('#n-title').value.trim(),
            subjectId: w.querySelector('#n-subj').value,
            type: w.querySelector('#n-type .active').dataset.v,
            bg: w.querySelector('#n-bg .active').dataset.v,
          }),
        },
      ],
      onOpen: (w) => {
        w.querySelectorAll('.segmented').forEach((seg) =>
          seg.addEventListener('click', (e) => {
            const b = e.target.closest('[data-v]');
            if (!b) return;
            seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
            if (seg.id === 'n-type') w.querySelector('#n-bg-field').classList.toggle('hidden', b.dataset.v !== 'ink');
          })
        );
      },
    });
    if (!v) return null;
    return createNote({ ...defaults, ...v });
  }

  /* ======================= ELENCO ======================= */
  async function notesList(_, params) {
    const all = await Store.notes.all();
    let subject = params.subject || '';
    let q = '';
    H().view().innerHTML = `
      <div class="row between"><h1 class="page-title">✍️ Quaderno</h1><button class="btn btn-primary" id="n-new">➕ Nuovi appunti</button></div>
      <p class="muted small">Scrivi con la penna (o con il dito) e con la tastiera. L'AI può trasformare la tua scrittura in testo e i tuoi appunti in schemi e quiz.</p>
      <input id="n-search" class="input search" placeholder="🔍 Cerca negli appunti…">
      <div class="chips-row" id="n-chips">
        <button class="chip chip-btn ${!subject ? 'active' : ''}" data-s="">Tutti</button>
        ${Store.subjects()
          .map((s) => `<button class="chip chip-btn ${subject === s.id ? 'active' : ''}" style="--c:${s.color}" data-s="${esc(s.id)}">${s.emoji} ${esc(s.name)}</button>`)
          .join('')}
      </div>
      <div id="n-grid" class="note-grid"></div>`;

    const render = () => {
      const needle = q.toLowerCase();
      const list = all.filter(
        (n) => (!subject || n.subjectId === subject) && (!needle || (n.title + ' ' + noteText(n)).toLowerCase().includes(needle))
      );
      $('#n-grid').innerHTML = list.length
        ? list
            .map((n) => {
              const s = Store.subject(n.subjectId);
              const preview = n.thumb
                ? `<img src="${n.thumb}" alt="" loading="lazy">`
                : `<div class="note-snippet">${esc(noteText(n).slice(0, 220)) || '<span class="muted">Pagina vuota</span>'}</div>`;
              return `<a class="note-card" href="#/note/${encodeURIComponent(n.id)}" style="--c:${s.color}">
                <div class="note-preview">${preview}</div>
                <div class="note-info"><b>${esc(n.title)}</b><small>${s.emoji} ${esc(s.name)} · ${esc(U.fmtDate(n.updatedAt))} · ${U.plural(n.pages.length, 'pagina', 'pagine')}</small></div>
              </a>`;
            })
            .join('')
        : `<div class="empty"><div class="big-emoji">📓</div><p>${all.length ? 'Nessun risultato.' : 'Il quaderno è vuoto.<br>Crea i tuoi primi appunti!'}</p></div>`;
    };
    render();
    $('#n-search').oninput = U.debounce((e) => {
      q = e.target.value;
      render();
    }, 200);
    $('#n-chips').onclick = (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      subject = b.dataset.s;
      $$('#n-chips .chip').forEach((c) => c.classList.toggle('active', c === b));
      render();
    };
    $('#n-new').onclick = async () => {
      const n = await newNoteDialog({ subjectId: subject });
      if (n) H().go(`#/note/${n.id}`);
    };
  }

  /* ======================= EDITOR ======================= */
  async function noteEditor(id) {
    const note = await Store.notes.get(id);
    if (!note) {
      H().view().innerHTML = `<div class="empty"><div class="big-emoji">🤷</div><p>Appunti non trovati.</p><a class="btn" href="#/notes">Vai al quaderno</a></div>`;
      return;
    }
    const s = Store.settings();
    const state = {
      tool: 'pen',
      color: COLORS[0],
      size: 4,
      penOnly: !!s.penOnly,
      ...(s.ink || {}),
    };
    if (state.tool === 'eraser' || state.tool === 'hand') state.tool = 'pen';
    const controllers = new Map(); // pageId -> controller ink
    let active = null;

    H().view().innerHTML = `
      <section class="note-editor">
        <div class="note-head">
          <a href="#/notes" class="icon-btn" aria-label="Indietro">←</a>
          <input id="ne-title" class="note-title" value="${esc(note.title)}" aria-label="Titolo">
          <span id="ne-saved" class="muted small">✓</span>
          <button class="icon-btn" id="ne-menu" aria-label="Altre azioni">⋯</button>
        </div>
        <div class="note-sub">
          <select id="ne-subj" class="input input-sm">${H().subjectOptions(note.subjectId)}</select>
          ${note.lessonId ? `<a class="btn btn-sm btn-ghost" href="#/lesson/${encodeURIComponent(note.lessonId)}">📖 Lezione collegata</a>` : ''}
        </div>
        <div class="ink-toolbar" id="ne-tools">
          <div class="tool-group">
            <button class="tool" data-tool="pen" title="Penna">✏️</button>
            <button class="tool" data-tool="hl" title="Evidenziatore">🖍️</button>
            <button class="tool" data-tool="eraser" title="Gomma">🧽</button>
            <button class="tool" data-tool="hand" title="Scorri (mano)">✋</button>
          </div>
          <div class="tool-group" id="ne-colors"></div>
          <div class="tool-group" id="ne-sizes">${SIZES.map(([v, l]) => `<button class="tool size" data-size="${v}" title="${l}"><span style="--s:${v + 2}px"></span></button>`).join('')}</div>
          <div class="tool-group">
            <button class="tool" data-act="undo" title="Annulla">↶</button>
            <button class="tool" data-act="redo" title="Ripeti">↷</button>
          </div>
          <div class="tool-group text-tools" title="Formattazione testo">
            <button class="tool" data-cmd="bold" title="Grassetto"><b>B</b></button>
            <button class="tool" data-cmd="italic" title="Corsivo"><i>I</i></button>
            <button class="tool" data-cmd="underline" title="Sottolineato"><u>U</u></button>
            <button class="tool" data-cmd="h3" title="Titolo">H</button>
            <button class="tool" data-cmd="insertUnorderedList" title="Elenco">•</button>
            <button class="tool" data-cmd="insertOrderedList" title="Elenco numerato">1.</button>
            <button class="tool" data-cmd="mark" title="Evidenzia">🖍</button>
            <button class="tool" data-cmd="red" title="Rosso"><span style="color:#e5484d">A</span></button>
            <button class="tool" data-cmd="removeFormat" title="Togli formattazione">⌫</button>
          </div>
          <label class="pen-only" title="Il dito scorre la pagina, scrive solo la penna (evita i segni del palmo)"><input type="checkbox" id="ne-penonly" ${state.penOnly ? 'checked' : ''}> 🖊️ Solo penna</label>
        </div>
        <div id="ne-pages" class="note-pages"></div>
        <div class="add-page">
          <button class="btn" data-add="ink">➕ ✍️ Pagina a mano</button>
          <button class="btn" data-add="text">➕ ⌨️ Pagina di testo</button>
        </div>
      </section>`;

    /* ---------- Salvataggio ---------- */
    const savedEl = $('#ne-saved');
    let dirty = false;
    const doSave = async () => {
      if (!dirty) return;
      dirty = false;
      const first = note.pages[0];
      note.thumb = first && first.type === 'ink' && !Ink.isEmpty(first) ? Ink.toImage(first, { width: 260, quality: 0.7 }).url : '';
      await Store.notes.put(note);
      if (savedEl.isConnected) savedEl.textContent = '✓ Salvato';
    };
    const saveSoon = U.debounce(doSave, 700);
    const changed = () => {
      dirty = true;
      savedEl.textContent = '…';
      saveSoon();
    };
    H().onCleanup(() => {
      doSave();
      controllers.forEach((c) => c.destroy());
      document.body.classList.remove('ink-hand');
    });

    $('#ne-title').oninput = () => {
      note.title = $('#ne-title').value.trim() || 'Appunti';
      changed();
    };
    $('#ne-subj').onchange = (e) => {
      note.subjectId = e.target.value;
      changed();
    };

    /* ---------- Strumenti ---------- */
    const persistTools = () => Store.saveSettings({ ink: { color: state.color, size: state.size, tool: state.tool }, penOnly: state.penOnly });
    const renderColors = () => {
      const list = state.tool === 'hl' ? HL_COLORS : COLORS;
      if (!list.includes(state.color) && state.tool === 'hl') state.color = HL_COLORS[0];
      if (state.tool === 'pen' && HL_COLORS.includes(state.color)) state.color = COLORS[0];
      $('#ne-colors').innerHTML =
        list.map((c) => `<button class="swatch ${c === state.color ? 'active' : ''}" data-color="${c}" style="--sw:${c}" title="${c}"></button>`).join('') +
        `<label class="swatch custom" title="Altro colore"><input type="color" value="${state.color}" id="ne-color"></label>`;
      $('#ne-color').oninput = (e) => {
        state.color = e.target.value;
        renderColors();
        persistTools();
      };
    };
    const syncTools = () => {
      $$('#ne-tools [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === state.tool));
      $$('#ne-tools [data-size]').forEach((b) => b.classList.toggle('active', +b.dataset.size === state.size));
      document.body.classList.toggle('ink-hand', state.tool === 'hand');
      renderColors();
    };
    syncTools();

    const textCmd = (cmd) => {
      // colori come stile CSS, grassetto/corsivo/sottolineato come tag (<b>, <i>, <u>)
      document.execCommand('styleWithCSS', false, cmd === 'mark' || cmd === 'red');
      if (cmd === 'h3') {
        const cur = document.queryCommandValue('formatBlock').toLowerCase();
        document.execCommand('formatBlock', false, cur === 'h3' ? 'div' : 'h3');
      } else if (cmd === 'mark') document.execCommand('hiliteColor', false, '#fff3a3');
      else if (cmd === 'red') document.execCommand('foreColor', false, '#e5484d');
      else document.execCommand(cmd, false, null);
    };

    const tools = $('#ne-tools');
    tools.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-cmd]')) e.preventDefault(); // mantieni la selezione nel testo
    });
    tools.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tool]');
      const c = e.target.closest('[data-color]');
      const z = e.target.closest('[data-size]');
      const a = e.target.closest('[data-act]');
      const cmd = e.target.closest('[data-cmd]');
      if (t) state.tool = t.dataset.tool;
      if (c) {
        state.color = c.dataset.color;
        if (state.tool === 'eraser' || state.tool === 'hand') state.tool = HL_COLORS.includes(state.color) ? 'hl' : 'pen';
      }
      if (z) {
        state.size = +z.dataset.size;
        if (state.tool === 'eraser' || state.tool === 'hand') state.tool = 'pen';
      }
      if (a) {
        const ctrl = active || [...controllers.values()].pop();
        if (ctrl) a.dataset.act === 'undo' ? ctrl.undo() : ctrl.redo();
      }
      if (cmd) {
        textCmd(cmd.dataset.cmd);
        const ed = document.activeElement && document.activeElement.closest('.note-text');
        if (ed) ed.dispatchEvent(new Event('input'));
      }
      if (t || c || z) {
        syncTools();
        persistTools();
      }
    });
    $('#ne-penonly').onchange = (e) => {
      state.penOnly = e.target.checked;
      persistTools();
    };
    // Rilevamento automatico della penna: attiva "solo penna" per ignorare il palmo
    const onPen = (e) => {
      if (e.pointerType === 'pen' && !state.penOnly && !Store.settings().penAsked) {
        state.penOnly = true;
        $('#ne-penonly').checked = true;
        Store.saveSettings({ penAsked: true });
        persistTools();
        U.toast('🖊️ Penna rilevata: ora scrive solo la penna, con il dito scorri la pagina', 'info', 4500);
      }
    };
    document.addEventListener('pointerdown', onPen, true);
    H().onCleanup(() => document.removeEventListener('pointerdown', onPen, true));

    /* ---------- Pagine ---------- */
    const pagesEl = $('#ne-pages');

    function renderPages() {
      controllers.forEach((c) => c.destroy());
      controllers.clear();
      active = null;
      pagesEl.innerHTML = note.pages
        .map(
          (p, i) => `
          <div class="note-page" data-id="${p.id}">
            <div class="page-bar">
              <span class="muted small">Pagina ${i + 1} · ${p.type === 'ink' ? '✍️ a mano' : '⌨️ testo'}</span>
              <span class="page-actions">
                ${
                  p.type === 'ink'
                    ? `<select class="input input-sm" data-pa="bg">${Object.entries(Ink.BACKGROUNDS)
                        .map(([k, l]) => `<option value="${k}" ${p.bg === k ? 'selected' : ''}>${l}</option>`)
                        .join('')}</select>
                       <button class="btn btn-sm" data-pa="ocr" title="Trasforma la scrittura a mano in testo">✨ In testo</button>
                       <button class="icon-btn" data-pa="clear" title="Svuota pagina">🧹</button>`
                    : ''
                }
                <button class="icon-btn" data-pa="up" title="Sposta su" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="icon-btn" data-pa="down" title="Sposta giù" ${i === note.pages.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="icon-btn" data-pa="del" title="Elimina pagina">🗑️</button>
              </span>
            </div>
            ${p.type === 'ink' ? '<div class="ink-host"></div>' : `<div class="note-text md" contenteditable="true" spellcheck="true" data-placeholder="Scrivi qui… (usa la barra sopra per grassetto, titoli, elenchi, evidenziatore)">${sanitize(p.html)}</div>`}
          </div>`
        )
        .join('');
      note.pages.forEach((p) => {
        const box = pagesEl.querySelector(`.note-page[data-id="${p.id}"]`);
        if (p.type === 'ink') {
          const ctrl = Ink.mount(box.querySelector('.ink-host'), p, {
            state,
            onChange: () => {
              active = ctrl;
              changed();
            },
          });
          controllers.set(p.id, ctrl);
        } else {
          const ed = box.querySelector('.note-text');
          ed.addEventListener('input', () => {
            p.html = ed.innerHTML;
            changed();
          });
          ed.addEventListener('paste', (e) => {
            // incolla solo testo semplice (niente stili strani da siti web)
            e.preventDefault();
            const txt = (e.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, txt);
          });
          ed.addEventListener('blur', () => {
            p.html = sanitize(ed.innerHTML);
          });
        }
      });
    }
    renderPages();

    pagesEl.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-pa="bg"]');
      if (!sel) return;
      const id = sel.closest('.note-page').dataset.id;
      controllers.get(id).setBackground(sel.value);
    });
    pagesEl.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-pa]');
      if (!b) return;
      const id = b.closest('.note-page').dataset.id;
      const idx = note.pages.findIndex((p) => p.id === id);
      const page = note.pages[idx];
      const act = b.dataset.pa;
      if (act === 'up' || act === 'down') {
        const j = act === 'up' ? idx - 1 : idx + 1;
        [note.pages[idx], note.pages[j]] = [note.pages[j], note.pages[idx]];
        renderPages();
        changed();
      } else if (act === 'del') {
        const empty = page.type === 'ink' ? Ink.isEmpty(page) : !textOf(page.html);
        if (!empty && !(await U.confirm('Eliminare questa pagina?', { okLabel: 'Elimina', danger: true }))) return;
        note.pages.splice(idx, 1);
        if (!note.pages.length) note.pages.push(newPage('ink'));
        renderPages();
        changed();
      } else if (act === 'clear') {
        if (await U.confirm('Cancellare tutto quello che hai scritto su questa pagina? (puoi annullare con ↶)', { okLabel: 'Svuota', danger: true }))
          controllers.get(id).clear();
      } else if (act === 'ocr') {
        if (Ink.isEmpty(page)) return U.toast('La pagina è vuota');
        await transcribe([page], idx + 1, b);
      }
    });

    async function transcribe(pages, insertAt, btn) {
      if (!Store.settings().apiKey) {
        U.toast('Serve la API key di Google (Impostazioni)', 'error');
        return H().go('#/settings');
      }
      const label = btn && btn.textContent;
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Leggo…';
      }
      try {
        const text = await Gemini.transcribeHandwriting(pages.map((p) => Ink.toImage(p, { width: 1200 })));
        note.pages.splice(insertAt, 0, { id: U.uid(), type: 'text', html: sanitize(U.md(text)) });
        renderPages();
        changed();
        U.toast('✨ Scrittura trasformata in testo!', 'success');
        const el = pagesEl.querySelectorAll('.note-page')[insertAt];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        U.toast(err.message, 'error', 5000);
      } finally {
        if (btn && btn.isConnected) {
          btn.disabled = false;
          btn.textContent = label;
        }
      }
    }

    $('.add-page').onclick = (e) => {
      const b = e.target.closest('[data-add]');
      if (!b) return;
      const last = [...note.pages].reverse().find((p) => p.type === 'ink');
      note.pages.push(newPage(b.dataset.add, last ? last.bg : 'lines'));
      renderPages();
      changed();
      const el = pagesEl.lastElementChild;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const ed = el.querySelector('.note-text');
      if (ed) setTimeout(() => ed.focus(), 300);
    };

    /* ---------- Menu ---------- */
    $('#ne-menu').onclick = async () => {
      const choice = await U.modal({
        title: 'Azioni',
        body: `<div class="menu-list">
          <button data-v="ocr">✨ Trasforma tutta la scrittura a mano in testo</button>
          <button data-v="schemi">🗺️ Crea schemi, flashcard e quiz da questi appunti</button>
          <button data-v="chat">💬 Chiedi a Prof AI su questi appunti</button>
          <button data-v="print">🖨️ Stampa / Salva PDF</button>
          <button data-v="png">🖼️ Scarica le pagine a mano come immagini</button>
          <button data-v="delete" class="danger">🗑️ Elimina appunti</button>
        </div>`,
        actions: [{ label: 'Chiudi', value: null }],
        onOpen: (w, close) =>
          w.querySelector('.menu-list').addEventListener('click', (e) => {
            const b = e.target.closest('[data-v]');
            if (b) close(b.dataset.v);
          }),
      });
      if (!choice) return;
      await doSave();
      if (choice === 'ocr') {
        const pages = inkPages(note).slice(0, 8);
        if (!pages.length) return U.toast('Non ci sono pagine scritte a mano');
        U.toast('⏳ Leggo la tua scrittura…');
        await transcribe(pages, note.pages.length, null);
      } else if (choice === 'schemi') {
        const images = inkPages(note)
          .slice(0, 10)
          .map((p) => {
            const im = Ink.toImage(p, { width: 1200 });
            return { mime: im.mime, data: im.data };
          });
        const text = noteText(note);
        if (!images.length && !text) return U.toast('Gli appunti sono vuoti');
        const l = H().newLesson({ source: 'note', subjectId: note.subjectId, title: note.title, inputText: text, images });
        await H().saveLesson(l);
        H().go(`#/lesson/${l.id}?process=1`);
      } else if (choice === 'chat') {
        H().goChat(`note:${note.id}`);
      } else if (choice === 'print') {
        printNote(note);
      } else if (choice === 'png') {
        inkPages(note).forEach((p, i) => {
          const im = Ink.toImage(p, { width: 1600, mime: 'image/png' });
          U.download(`${U.slug(note.title)}-pagina-${i + 1}.png`, U.base64ToBlob(im.data, 'image/png'));
        });
      } else if (choice === 'delete') {
        if (await U.confirm('Gli appunti verranno eliminati definitivamente.', { okLabel: 'Elimina', danger: true })) {
          dirty = false;
          await Store.notes.del(note.id);
          U.toast('Appunti eliminati');
          H().go('#/notes');
        }
      }
    };
  }

  function printNote(note) {
    const s = Store.subject(note.subjectId);
    const area = $('#print-area');
    area.innerHTML =
      `<h1>${esc(note.title)}</h1><p>${s.emoji} ${esc(s.name)} · ${esc(U.fmtDate(note.updatedAt))}</p>` +
      note.pages
        .map((p) =>
          p.type === 'ink'
            ? `<div class="print-page"><img src="${Ink.toImage(p, { width: 1400 }).url}" alt=""></div>`
            : `<div class="print-text">${sanitize(p.html)}</div>`
        )
        .join('');
    setTimeout(() => window.print(), 200);
  }

  App.route('notes', notesList);
  App.route('note', noteEditor);
  window.Notes = { createNote, newNoteDialog, noteText, sanitize };
})();
