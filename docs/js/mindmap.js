'use strict';

/* Mappa concettuale in SVG: layout a due lati, rami colorati, zoom/pan (anche pinch), export SVG/PNG. */
const MindMap = (() => {
  const PALETTE = ['#3e63dd', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#12a594', '#d6409f', '#ad7f58', '#0090ff'];
  const ROOT_W = 220;
  const NODE_W = [ROOT_W, 200, 190, 170];
  const GAP_X = 56;
  const GAP_Y = 14;
  const LINE_H = [20, 18, 16, 15];
  const FONT = [16, 14, 13, 12];

  function toTree(mm) {
    const conv = (n, depth) => ({
      label: (n.title || n.center || '').trim() || '…',
      note: (n.detail || '').trim(),
      depth,
      children: (n.children || n.branches || []).filter(Boolean).map((c) => conv(c, depth + 1)),
    });
    return conv({ center: mm.center, branches: mm.branches || [] }, 0);
  }

  function wrap(text, maxChars) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > maxChars && cur) {
        lines.push(cur);
        cur = w;
      } else cur = (cur + ' ' + w).trim();
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 5);
  }

  function measure(node) {
    const d = Math.min(node.depth, 3);
    node.w = NODE_W[d];
    node.lines = wrap(node.label, Math.floor((node.w - 24) / (FONT[d] * 0.56)));
    node.h = node.lines.length * LINE_H[d] + (d === 0 ? 30 : 18);
    node.children.forEach(measure);
  }

  function subtreeH(node, collapsed) {
    if (!node.children.length || collapsed.has(node.path)) return (node.sh = node.h);
    const ch = node.children.reduce((s, c) => s + subtreeH(c, collapsed), 0) + GAP_Y * (node.children.length - 1);
    return (node.sh = Math.max(node.h, ch));
  }

  function colX(depth) {
    let x = ROOT_W / 2 + GAP_X;
    for (let d = 1; d < depth; d++) x += NODE_W[Math.min(d, 3)] + GAP_X;
    return x;
  }

  function place(node, side, yTop, collapsed, color) {
    node.side = side;
    node.color = color;
    node.y = yTop + node.sh / 2;
    const x0 = colX(node.depth);
    node.x = side > 0 ? x0 : -x0 - node.w; // x = bordo sinistro
    if (collapsed.has(node.path)) return;
    const total = node.children.reduce((s, c) => s + c.sh, 0) + GAP_Y * (node.children.length - 1);
    let y = node.y - total / 2;
    for (const c of node.children) {
      place(c, side, y, collapsed, color);
      y += c.sh + GAP_Y;
    }
  }

  function assignPaths(node, path = 'r') {
    node.path = path;
    node.children.forEach((c, i) => assignPaths(c, path + '.' + i));
  }

  function layout(tree, collapsed, oneSided = false) {
    measure(tree);
    assignPaths(tree);
    tree.children.forEach((c) => subtreeH(c, collapsed));
    tree.x = -tree.w / 2;
    tree.y = 0;
    const n = tree.children.length;
    const half = oneSided ? n : Math.ceil(n / 2);
    const right = tree.children.slice(0, half);
    const left = tree.children.slice(half);
    [
      [right, 1],
      [left, -1],
    ].forEach(([list, side]) => {
      const total = list.reduce((s, c) => s + c.sh, 0) + GAP_Y * 1.6 * Math.max(0, list.length - 1);
      let y = -total / 2;
      list.forEach((c) => {
        const idx = tree.children.indexOf(c);
        place(c, side, y, collapsed, PALETTE[idx % PALETTE.length]);
        y += c.sh + GAP_Y * 1.6;
      });
    });
  }

  function walk(node, fn, collapsed) {
    fn(node);
    if (collapsed && collapsed.has(node.path)) return;
    node.children.forEach((c) => walk(c, fn, collapsed));
  }

  function bounds(tree, collapsed) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    walk(
      tree,
      (n) => {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x + n.w);
        minY = Math.min(minY, n.y - n.h / 2);
        maxY = Math.max(maxY, n.y + n.h / 2);
      },
      collapsed
    );
    const pad = 30;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }

  function svgContent(tree, collapsed, { dark = false, selected = null } = {}) {
    const text = dark ? '#eceef3' : '#1c2024';
    const nodeBg = dark ? '#1e1f26' : '#ffffff';
    let edges = '';
    let nodes = '';
    walk(
      tree,
      (n) => {
        const d = Math.min(n.depth, 3);
        if (n.depth > 0 && n.parent) {
          const p = n.parent;
          const x1 = n.side > 0 ? p.x + p.w : p.x;
          const y1 = p.y;
          const x2 = n.side > 0 ? n.x : n.x + n.w;
          const y2 = n.y;
          const mx = (x1 + x2) / 2;
          edges += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${n.color}" stroke-width="${Math.max(1.5, 4 - d)}" stroke-opacity="0.75"/>`;
        }
        const isRoot = n.depth === 0;
        const fill = isRoot ? '#3e63dd' : d === 1 ? n.color : nodeBg;
        const stroke = isRoot ? '#3e63dd' : n.color;
        const tColor = isRoot || d === 1 ? '#ffffff' : text;
        const top = n.y - n.h / 2;
        const sel = selected === n.path ? `<rect x="${n.x - 4}" y="${top - 4}" width="${n.w + 8}" height="${n.h + 8}" rx="16" fill="none" stroke="${n.color || '#3e63dd'}" stroke-width="2" stroke-dasharray="4 3"/>` : '';
        const hasKids = n.children.length > 0;
        const isCollapsed = collapsed.has(n.path);
        let badge = '';
        if (hasKids && !isRoot) {
          const bx = n.side > 0 ? n.x + n.w : n.x;
          badge = `<g class="mm-toggle" data-path="${n.path}"><circle cx="${bx}" cy="${n.y}" r="9" fill="${nodeBg}" stroke="${n.color}" stroke-width="1.5"/><text x="${bx}" y="${n.y + 4}" text-anchor="middle" font-size="13" font-weight="700" fill="${n.color}">${isCollapsed ? '+' : '−'}</text></g>`;
        }
        const ty = top + (isRoot ? 15 : 9) + LINE_H[d] * 0.75;
        const tspans = n.lines
          .map((l, i) => `<tspan x="${n.x + n.w / 2}" y="${ty + i * LINE_H[d]}">${U.esc(l)}</tspan>`)
          .join('');
        const noteMark = n.note ? `<circle cx="${n.x + n.w - 8}" cy="${top + 8}" r="3" fill="${tColor}" opacity="0.6"/>` : '';
        nodes += `<g class="mm-node" data-path="${n.path}">${sel}<rect x="${n.x}" y="${top}" width="${n.w}" height="${n.h}" rx="${isRoot ? 16 : 12}" fill="${fill}" stroke="${stroke}" stroke-width="${d >= 2 ? 1.6 : 0}"/>${noteMark}<text text-anchor="middle" font-size="${FONT[d]}" font-weight="${d <= 1 ? 700 : 500}" fill="${tColor}">${tspans}</text>${n.note ? `<title>${U.esc(n.note)}</title>` : ''}</g>${badge}`;
      },
      collapsed
    );
    return edges + nodes;
  }

  function linkParents(node) {
    node.children.forEach((c) => {
      c.parent = node;
      linkParents(c);
    });
  }

  function find(tree, path) {
    let found = null;
    walk(tree, (n) => {
      if (n.path === path) found = n;
    });
    return found;
  }

  const isDark = () => document.documentElement.dataset.theme === 'dark';

  /* Monta una mappa interattiva dentro container. Ritorna un controller. */
  function mount(container, mm, { onSelect } = {}) {
    const tree = toTree(mm);
    linkParents(tree);
    const collapsed = new Set();
    let selected = null;
    let vb = null;
    let oneSided = false;
    container.innerHTML = `
      <div class="mm-wrap">
        <svg class="mm-svg" xmlns="http://www.w3.org/2000/svg" font-family="Inter, system-ui, sans-serif"></svg>
        <div class="mm-tools">
          <button class="icon-btn" data-mm="in" title="Zoom +">＋</button>
          <button class="icon-btn" data-mm="out" title="Zoom −">－</button>
          <button class="icon-btn" data-mm="fit" title="Mostra tutto">⤢</button>
        </div>
        <div class="mm-hint hidden">👆 Trascina per muoverti · pizzica o ＋/－ per lo zoom</div>
      </div>`;
    const svg = container.querySelector('svg');
    const hint = container.querySelector('.mm-hint');

    // fit: false = mantieni la vista, 'smart' = leggibile e centrata sul nodo centrale, 'all' = mostra tutto
    function draw(fit) {
      const rect = svg.getBoundingClientRect();
      if (rect.width) oneSided = rect.width < 600; // telefono: albero verso destra, sfrutta l'altezza
      layout(tree, collapsed, oneSided);
      svg.innerHTML = svgContent(tree, collapsed, { dark: isDark(), selected });
      if (fit || !vb) {
        const r = svg.getBoundingClientRect();
        if (!r.width || !r.height) {
          // non ancora visibile: riprova al prossimo frame
          vb = vb || { x: -400, y: -300, w: 800, h: 600 };
          apply();
          if (container.isConnected) requestAnimationFrame(() => draw(fit || 'smart'));
          return;
        }
        const b = bounds(tree, collapsed);
        const fitScale = Math.min(r.width / b.w, r.height / b.h);
        const MIN_READABLE = 0.6;
        let scale = Math.min(fitScale, 1.2);
        let cx = b.x + b.w / 2;
        let cy = b.y + b.h / 2;
        if (fit !== 'all' && fitScale < MIN_READABLE) {
          scale = MIN_READABLE;
          cx = oneSided ? b.x + r.width / scale / 2 : 0; // con albero a destra: radice sul bordo sinistro
          cy = 0;
          hint.classList.remove('hidden');
        }
        // riquadro più basso se la mappa è piccola
        const wanted = Math.max(260, Math.ceil(b.h * scale + 20));
        if (fit !== 'all' && wanted < r.height - 4 && !svg.style.height) {
          svg.style.height = wanted + 'px';
          return draw(fit);
        }
        vb = { w: r.width / scale, h: r.height / scale };
        if (fit !== 'all' && fitScale < MIN_READABLE) {
          // non lasciare spazio vuoto sopra/sotto se la mappa ci sta in altezza
          if (b.h <= vb.h) cy = b.y + b.h / 2;
          else cy = Math.min(Math.max(cy, b.y + vb.h / 2), b.y + b.h - vb.h / 2);
        }
        vb.x = cx - vb.w / 2;
        vb.y = cy - vb.h / 2;
      }
      apply();
    }
    const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);

    function zoom(factor, cx, cy) {
      const r = svg.getBoundingClientRect();
      const px = cx === undefined ? 0.5 : (cx - r.left) / r.width;
      const py = cy === undefined ? 0.5 : (cy - r.top) / r.height;
      const nw = Math.min(Math.max(vb.w * factor, 150), 20000);
      const nh = nw * (vb.h / vb.w);
      vb.x += (vb.w - nw) * px;
      vb.y += (vb.h - nh) * py;
      vb.w = nw;
      vb.h = nh;
      apply();
    }

    container.querySelector('.mm-tools').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mm]');
      if (!b) return;
      if (b.dataset.mm === 'in') zoom(0.8);
      if (b.dataset.mm === 'out') zoom(1.25);
      if (b.dataset.mm === 'fit') draw('all');
    });

    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        zoom(e.deltaY > 0 ? 1.12 : 0.89, e.clientX, e.clientY);
      },
      { passive: false }
    );

    // Pan e pinch-zoom con Pointer Events
    const pointers = new Map();
    let moved = false;
    let lastDist = 0;
    svg.addEventListener('pointerdown', (e) => {
      hint.classList.add('hidden');
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        lastDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      const r = svg.getBoundingClientRect();
      if (pointers.size === 1) {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) {
          if (!moved) svg.setPointerCapture(e.pointerId);
          moved = true;
        }
        vb.x -= dx * (vb.w / r.width);
        vb.y -= dy * (vb.h / r.height);
        apply();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastDist) zoom(lastDist / dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        lastDist = dist;
        moved = true;
      }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) lastDist = 0;
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);

    svg.addEventListener('click', (e) => {
      if (moved) return;
      const t = e.target.closest('.mm-toggle');
      if (t) {
        const p = t.dataset.path;
        collapsed.has(p) ? collapsed.delete(p) : collapsed.add(p);
        draw(false);
        return;
      }
      const g = e.target.closest('.mm-node');
      if (g) {
        selected = selected === g.dataset.path ? null : g.dataset.path;
        draw(false);
        const n = selected && find(tree, selected);
        onSelect && onSelect(n ? { label: n.label, note: n.note, color: n.color || '#3e63dd', children: n.children.map((c) => c.label) } : null);
      }
    });

    requestAnimationFrame(() => draw('smart'));
    return {
      redraw: () => draw(false),
      fit: () => draw('all'),
      expandAll() {
        collapsed.clear();
        svg.style.height = '';
        draw('smart');
      },
      collapseAll() {
        walk(tree, (n) => n.depth >= 1 && n.children.length && collapsed.add(n.path));
        draw('all');
      },
    };
  }

  /* SVG statico (per export/stampa) */
  function toSVG(mm, { dark = false } = {}) {
    const tree = toTree(mm);
    linkParents(tree);
    const collapsed = new Set();
    layout(tree, collapsed);
    const b = bounds(tree, collapsed);
    const bg = dark ? '#111113' : '#ffffff';
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="${Math.round(b.w)}" height="${Math.round(b.h)}" font-family="Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${bg}"/>${svgContent(tree, collapsed, { dark })}</svg>`,
      width: b.w,
      height: b.h,
    };
  }

  function toPNG(mm, scale = 2) {
    const { svg, width, height } = toSVG(mm);
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.round(width * scale);
        c.height = Math.round(height * scale);
        const g = c.getContext('2d');
        g.scale(scale, scale);
        g.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('Export PNG fallito'))), 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Export PNG fallito'));
      };
      img.src = url;
    });
  }

  /* Schema a elenco annidato (HTML) */
  function outline(mm) {
    const tree = toTree(mm);
    const li = (n) =>
      `<li><span class="ol-label">${U.esc(n.label)}</span>${n.note ? `<span class="ol-note"> — ${U.esc(n.note)}</span>` : ''}${
        n.children.length ? `<ul>${n.children.map(li).join('')}</ul>` : ''
      }</li>`;
    return `<div class="outline"><div class="ol-root">${U.esc(tree.label)}</div><ul>${tree.children
      .map((c, i) => li(c).replace('<li>', `<li style="--c:${PALETTE[i % PALETTE.length]}">`))
      .join('')}</ul></div>`;
  }

  function toMarkdown(mm) {
    const tree = toTree(mm);
    const lines = [`**${tree.label}**`];
    const rec = (n, lvl) => {
      lines.push(`${'  '.repeat(lvl)}- ${lvl === 0 ? `**${n.label}**` : n.label}${n.note ? ` — ${n.note}` : ''}`);
      n.children.forEach((c) => rec(c, lvl + 1));
    };
    tree.children.forEach((c) => rec(c, 0));
    return lines.join('\n');
  }

  return { mount, toSVG, toPNG, outline, toMarkdown };
})();
