'use strict';

/* Utility generiche: escape, markdown, formattazione, toast, modali. */
const U = (() => {
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('it-IT', opts);
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${fmtDate(iso)} · ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function todayStr(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return todayStr(d);
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const a = new Date(todayStr() + 'T12:00:00');
    const b = new Date(dateStr + 'T12:00:00');
    if (isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  function fmtDue(dateStr) {
    const n = daysUntil(dateStr);
    if (n === null) return 'senza data';
    if (n < -1) return `scaduto da ${-n} giorni`;
    if (n === -1) return 'era ieri';
    if (n === 0) return 'oggi';
    if (n === 1) return 'domani';
    if (n < 7) return `tra ${n} giorni · ${fmtDate(dateStr, { weekday: 'long' })}`;
    return fmtDate(dateStr, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /* ---------- Markdown minimale e sicuro (l'input viene sempre escapato) ---------- */
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function md(src) {
    const lines = esc(src || '').replace(/\r/g, '').split('\n');
    const out = [];
    let list = null;
    let para = [];
    let code = null;
    let table = [];

    const flushPara = () => {
      if (para.length) out.push(`<p>${inline(para.join('<br>'))}</p>`);
      para = [];
    };
    const closeList = () => {
      if (list) out.push(`</${list}>`);
      list = null;
    };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table
        .filter((r) => !/^\|?\s*:?-{2,}/.test(r.trim()))
        .map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())));
      if (rows.length) {
        const [head, ...body] = rows;
        out.push(
          '<div class="table-wrap"><table><thead><tr>' +
            head.map((c) => `<th>${c}</th>`).join('') +
            '</tr></thead><tbody>' +
            body.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') +
            '</tbody></table></div>'
        );
      }
      table = [];
    };
    const flushAll = () => {
      flushPara();
      closeList();
      flushTable();
    };

    for (const raw of lines) {
      const line = raw;
      if (/^\s*```/.test(line)) {
        if (code === null) {
          flushAll();
          code = [];
        } else {
          out.push(`<pre><code>${code.join('\n')}</code></pre>`);
          code = null;
        }
        continue;
      }
      if (code !== null) {
        code.push(line);
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line)) {
        flushPara();
        closeList();
        table.push(line);
        continue;
      } else if (table.length) {
        flushTable();
      }
      let m;
      if (!line.trim()) {
        flushPara();
        closeList();
      } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        flushAll();
        const lvl = Math.min(6, m[1].length + 2);
        out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        flushAll();
        out.push('<hr>');
      } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
        flushPara();
        if (list !== 'ul') {
          closeList();
          out.push('<ul>');
          list = 'ul';
        }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara();
        if (list !== 'ol') {
          closeList();
          out.push('<ol>');
          list = 'ol';
        }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if ((m = line.match(/^&gt;\s?(.*)$/))) {
        flushAll();
        out.push(`<blockquote>${inline(m[1])}</blockquote>`);
      } else {
        closeList();
        para.push(line.trim());
      }
    }
    if (code !== null) out.push(`<pre><code>${code.join('\n')}</code></pre>`);
    flushAll();
    return out.join('\n');
  }

  /* Renderizza formule LaTeX se KaTeX è stato caricato (serve internet). */
  function renderMath(el) {
    if (!el || typeof window.renderMathInElement !== 'function') return;
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) {
      /* ignora */
    }
  }

  /* ---------- Toast ---------- */
  function toast(msg, type = 'info', ms = 3200) {
    let box = $('#toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      document.body.appendChild(box);
    }
    while (box.children.length >= 2) box.firstElementChild.remove();
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, ms);
  }

  /* ---------- Modale generica ---------- */
  function modal({ title = '', body = '', actions = [{ label: 'OK', value: true, primary: true }], onOpen } = {}) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          ${title ? `<h3 class="modal-title">${esc(title)}</h3>` : ''}
          <div class="modal-body">${body}</div>
          <div class="modal-actions">
            ${actions
              .map(
                (a, i) =>
                  `<button class="btn ${a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-ghost'}" data-i="${i}">${esc(a.label)}</button>`
              )
              .join('')}
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const close = (v) => {
        wrap.classList.remove('show');
        setTimeout(() => wrap.remove(), 200);
        resolve(v);
      };
      wrap.addEventListener('click', (e) => {
        if (e.target === wrap) close(null);
        const b = e.target.closest('[data-i]');
        if (b) {
          const a = actions[+b.dataset.i];
          const v = typeof a.value === 'function' ? a.value(wrap) : a.value;
          if (v !== undefined) close(v);
        }
      });
      requestAnimationFrame(() => wrap.classList.add('show'));
      if (onOpen) onOpen(wrap, close);
      const first = wrap.querySelector('input,textarea,select');
      if (first) setTimeout(() => first.focus(), 50);
    });
  }

  const confirm = (msg, { okLabel = 'Conferma', danger = false, title = 'Sei sicuro?' } = {}) =>
    modal({
      title,
      body: `<p>${esc(msg)}</p>`,
      actions: [
        { label: 'Annulla', value: false },
        { label: okLabel, value: true, primary: !danger, danger },
      ],
    });

  const ask = (title, { value = '', placeholder = '', multiline = false } = {}) =>
    modal({
      title,
      body: multiline
        ? `<textarea class="input" rows="5" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
        : `<input class="input" value="${esc(value)}" placeholder="${esc(placeholder)}">`,
      actions: [
        { label: 'Annulla', value: null },
        { label: 'OK', primary: true, value: (w) => w.querySelector('input,textarea').value.trim() },
      ],
      onOpen: (w) => {
        const i = w.querySelector('input');
        if (i) i.addEventListener('keydown', (e) => e.key === 'Enter' && w.querySelector('.btn-primary').click());
      },
    });

  function download(filename, content, mime = 'text/plain') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* Ridimensiona un'immagine e la restituisce come {mime, data(base64), url} */
  function imageToJpeg(file, max = 1600, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const dataUrl = c.toDataURL('image/jpeg', quality);
        resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1], url: dataUrl });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Immagine non valida'));
      };
      img.src = url;
    });
  }

  const debounce = (fn, ms = 400) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const slug = (s) =>
    String(s || 'lezione')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'lezione';

  return {
    esc, uid, $, $$, fmtDuration, fmtDate, fmtDateTime, todayStr, addDays, daysUntil, fmtDue,
    md, renderMath, toast, modal, confirm, ask, download, blobToBase64, base64ToBlob, imageToJpeg,
    debounce, plural, slug,
  };
})();
