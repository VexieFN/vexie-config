'use strict';

/* Motore per la scrittura a mano: pagine vettoriali (formato A4) con penna sensibile alla pressione,
   evidenziatore, gomma, annulla/ripeti e sfondi (bianco, righe, quadretti, puntini).
   I tratti sono salvati in coordinate logiche 1000×1414, quindi la pagina è nitida su ogni schermo. */
const Ink = (() => {
  const W = 1000;
  const H = 1414;
  const MAX_PX = 2400; // limite di risoluzione del canvas (memoria su tablet)

  const BACKGROUNDS = {
    blank: 'Bianco',
    lines: 'Righe',
    grid: 'Quadretti',
    dots: 'Puntini',
  };

  function drawBackground(g, bg, s) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W * s, H * s);
    g.lineWidth = Math.max(1, 1.2 * s);
    if (bg === 'lines') {
      g.strokeStyle = '#c7d3ee';
      for (let y = 120; y < H - 20; y += 44) {
        g.beginPath();
        g.moveTo(0, y * s);
        g.lineTo(W * s, y * s);
        g.stroke();
      }
      g.strokeStyle = '#f2a7a7';
      g.beginPath();
      g.moveTo(90 * s, 0);
      g.lineTo(90 * s, H * s);
      g.stroke();
    } else if (bg === 'grid') {
      g.strokeStyle = '#e1e6f0';
      for (let x = 0; x <= W; x += 40) {
        g.beginPath();
        g.moveTo(x * s, 0);
        g.lineTo(x * s, H * s);
        g.stroke();
      }
      for (let y = 0; y <= H; y += 40) {
        g.beginPath();
        g.moveTo(0, y * s);
        g.lineTo(W * s, y * s);
        g.stroke();
      }
    } else if (bg === 'dots') {
      g.fillStyle = '#c3c9d6';
      const r = Math.max(1, 2 * s);
      for (let x = 40; x < W; x += 40)
        for (let y = 40; y < H; y += 40) {
          g.beginPath();
          g.arc(x * s, y * s, r, 0, Math.PI * 2);
          g.fill();
        }
    }
  }

  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ((a[2] || 0.5) + (b[2] || 0.5)) / 2];

  function drawStroke(g, st, s) {
    const p = st.pts;
    if (!p || !p.length) return;
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = st.color;
    g.fillStyle = st.color;
    if (st.tool === 'hl') {
      // evidenziatore: tratto unico semitrasparente (niente sovrapposizioni più scure)
      g.globalAlpha = 0.32;
      g.globalCompositeOperation = 'multiply';
      g.lineCap = 'butt';
      g.lineWidth = st.size * s;
      g.beginPath();
      g.moveTo(p[0][0] * s, p[0][1] * s);
      for (let i = 1; i < p.length - 1; i++) {
        const m = mid(p[i], p[i + 1]);
        g.quadraticCurveTo(p[i][0] * s, p[i][1] * s, m[0] * s, m[1] * s);
      }
      const last = p[p.length - 1];
      g.lineTo(last[0] * s, last[1] * s);
      g.stroke();
      g.restore();
      return;
    }
    const width = (pr) => Math.max(0.6, st.size * (0.45 + (pr ?? 0.5) * 1.1) * s);
    if (p.length === 1) {
      g.beginPath();
      g.arc(p[0][0] * s, p[0][1] * s, width(p[0][2]) / 2, 0, Math.PI * 2);
      g.fill();
      g.restore();
      return;
    }
    // segmenti curvi con spessore variabile in base alla pressione
    let start = p[0];
    for (let i = 1; i < p.length; i++) {
      const end = i < p.length - 1 ? mid(p[i], p[i + 1]) : p[i];
      g.lineWidth = width(p[i][2]);
      g.beginPath();
      g.moveTo(start[0] * s, start[1] * s);
      g.quadraticCurveTo(p[i][0] * s, p[i][1] * s, end[0] * s, end[1] * s);
      g.stroke();
      start = end;
    }
    g.restore();
  }

  function render(g, page, s) {
    drawBackground(g, page.bg || 'lines', s);
    for (const st of page.strokes || []) drawStroke(g, st, s);
  }

  function distToSeg(px, py, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    let t = len ? ((px - a[0]) * dx + (py - a[1]) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }

  function hits(st, x, y, r) {
    const p = st.pts;
    const rr = r + st.size / 2;
    if (p.length === 1) return Math.hypot(p[0][0] - x, p[0][1] - y) < rr;
    for (let i = 1; i < p.length; i++) if (distToSeg(x, y, p[i - 1], p[i]) < rr) return true;
    return false;
  }

  /* Rende la pagina come immagine (per l'AI, le miniature e l'export) */
  function toImage(page, { width = 1000, mime = 'image/jpeg', quality = 0.85 } = {}) {
    const s = width / W;
    const c = document.createElement('canvas');
    c.width = Math.round(W * s);
    c.height = Math.round(H * s);
    render(c.getContext('2d'), page, s);
    const url = c.toDataURL(mime, quality);
    return { url, mime, data: url.split(',')[1] };
  }

  const isEmpty = (page) => !(page.strokes || []).length;

  /* Pagina interattiva.
     state (condiviso tra le pagine): { tool: 'pen'|'hl'|'eraser'|'hand', color, size, penOnly } */
  function mount(host, page, { state, onChange } = {}) {
    page.strokes = page.strokes || [];
    page.bg = page.bg || 'lines';
    host.innerHTML = '<div class="ink-page"><canvas class="ink-base"></canvas><canvas class="ink-live"></canvas></div>';
    const base = host.querySelector('.ink-base');
    const live = host.querySelector('.ink-live');
    const gb = base.getContext('2d');
    const gl = live.getContext('2d');
    let scale = 1;
    const undo = [];
    const redo = [];
    let cur = null;
    let pointerId = null;
    let erased = null;
    let scrollY = null;

    function resize() {
      const cssW = host.clientWidth;
      if (!cssW) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_PX / cssW);
      const pw = Math.round(cssW * dpr);
      if (pw === base.width) return;
      scale = pw / W;
      base.width = live.width = pw;
      base.height = live.height = Math.round(H * scale);
      render(gb, page, scale);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const redrawAll = () => render(gb, page, scale);
    const changed = () => onChange && onChange(page);

    function pos(e) {
      const r = live.getBoundingClientRect();
      const pr = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5;
      return [
        Math.round(((e.clientX - r.left) / r.width) * W * 10) / 10,
        Math.round(((e.clientY - r.top) / r.height) * H * 10) / 10,
        Math.round(pr * 100) / 100,
      ];
    }

    function eraseAt(x, y) {
      const r = 14;
      let any = false;
      for (let i = page.strokes.length - 1; i >= 0; i--) {
        if (hits(page.strokes[i], x, y, r)) {
          erased.push({ stroke: page.strokes[i], index: i });
          page.strokes.splice(i, 1);
          any = true;
        }
      }
      if (any) redrawAll();
    }

    live.addEventListener('pointerdown', (e) => {
      if (pointerId !== null) return;
      // Modalità "solo penna" o strumento mano: il dito scorre la pagina invece di scrivere
      if (state.tool === 'hand' || (state.penOnly && e.pointerType === 'touch')) {
        if (e.pointerType === 'touch' && state.tool !== 'hand') {
          scrollY = e.clientY;
          pointerId = e.pointerId;
        }
        return;
      }
      if (e.button > 0) return;
      e.preventDefault();
      live.setPointerCapture(e.pointerId);
      pointerId = e.pointerId;
      const p = pos(e);
      if (state.tool === 'eraser') {
        erased = [];
        eraseAt(p[0], p[1]);
        return;
      }
      const size = state.tool === 'hl' ? state.size * 5 + 10 : state.size;
      cur = { tool: state.tool === 'hl' ? 'hl' : 'pen', color: state.color, size, pts: [p] };
      gl.clearRect(0, 0, live.width, live.height);
      drawStroke(gl, cur, scale);
    });

    live.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointerId) return;
      if (scrollY !== null) {
        window.scrollBy(0, scrollY - e.clientY);
        scrollY = e.clientY;
        return;
      }
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (state.tool === 'eraser' && erased) {
        for (const ev of evs.length ? evs : [e]) {
          const p = pos(ev);
          eraseAt(p[0], p[1]);
        }
        return;
      }
      if (!cur) return;
      for (const ev of evs.length ? evs : [e]) {
        const p = pos(ev);
        const last = cur.pts[cur.pts.length - 1];
        if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 1.2) continue;
        cur.pts.push(p);
      }
      gl.clearRect(0, 0, live.width, live.height);
      drawStroke(gl, cur, scale);
    });

    const end = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      scrollY = null;
      if (erased) {
        if (erased.length) {
          undo.push({ type: 'erase', items: erased });
          redo.length = 0;
          changed();
        }
        erased = null;
        return;
      }
      if (!cur) return;
      page.strokes.push(cur);
      undo.push({ type: 'add', stroke: cur });
      redo.length = 0;
      drawStroke(gb, cur, scale);
      gl.clearRect(0, 0, live.width, live.height);
      cur = null;
      changed();
    };
    live.addEventListener('pointerup', end);
    live.addEventListener('pointercancel', end);

    function apply(action, reverse) {
      if (action.type === 'add') {
        if (reverse) page.strokes.splice(page.strokes.lastIndexOf(action.stroke), 1);
        else page.strokes.push(action.stroke);
      } else if (action.type === 'erase') {
        if (reverse) action.items.slice().reverse().forEach(({ stroke, index }) => page.strokes.splice(index, 0, stroke));
        else action.items.forEach(({ stroke }) => page.strokes.splice(page.strokes.indexOf(stroke), 1));
      } else if (action.type === 'clear') {
        page.strokes = reverse ? action.strokes.slice() : [];
      }
      redrawAll();
      changed();
    }

    return {
      page,
      undo() {
        const a = undo.pop();
        if (!a) return false;
        apply(a, true);
        redo.push(a);
        return true;
      },
      redo() {
        const a = redo.pop();
        if (!a) return false;
        apply(a, false);
        undo.push(a);
        return true;
      },
      clear() {
        if (!page.strokes.length) return;
        undo.push({ type: 'clear', strokes: page.strokes.slice() });
        redo.length = 0;
        page.strokes = [];
        redrawAll();
        changed();
      },
      setBackground(bg) {
        page.bg = bg;
        redrawAll();
        changed();
      },
      destroy() {
        ro.disconnect();
      },
    };
  }

  return { mount, toImage, isEmpty, BACKGROUNDS, W, H };
})();
