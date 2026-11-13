/* Holy-C — map navigation, markers, panels, ambience.
   Everything on the map is generated from data/projects.json:
   regions are laid out left to right, projects are placed on a staggered grid inside their region,
   links join projects of a region, and a bridge joins each region to the next one. */
(function () {
  'use strict';

  const GL = window.WORLD_GL;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const body = document.body;
  const stage = $('#stage');
  const world = $('#world');
  const hero = $('#hero');
  const panel = $('#panel');
  const narrow = () => window.innerWidth <= 860;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const word = (n) => NUM[n] || String(n);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const pad2 = (n) => String(n).padStart(2, '0');
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  }

  /* ------------------------------------------------------------------ grain */
  (function makeGrain() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 90 + Math.random() * 120;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    document.documentElement.style.setProperty('--grain-img', `url(${c.toDataURL('image/png')})`);
  })();

  /* --------------------------------------------------------------- ambience */
  const Ambience = {
    ctx: null, master: null, on: false, built: false,
    build() {
      if (this.built) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      const master = this.master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      const pad = ctx.createGain(); pad.gain.value = 0.16;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.7;
      pad.connect(lp); lp.connect(master);
      [55, 82.41, 110, 164.81, 220].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.type = i % 2 ? 'triangle' : 'sine';
        o.frequency.value = f;
        o.detune.value = (i - 2) * 4;
        const g = ctx.createGain(); g.gain.value = i < 2 ? 0.5 : 0.22;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.04 + i * 0.013;
        const lg = ctx.createGain(); lg.gain.value = 0.12;
        lfo.connect(lg); lg.connect(g.gain);
        o.connect(g); g.connect(pad);
        o.start(); lfo.start();
      });
      const flfo = ctx.createOscillator(); flfo.frequency.value = 0.05;
      const fg = ctx.createGain(); fg.gain.value = 180;
      flfo.connect(fg); fg.connect(lp.frequency); flfo.start();
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6;
      const wg = ctx.createGain(); wg.gain.value = 0.035;
      const wl = ctx.createOscillator(); wl.frequency.value = 0.07;
      const wlg = ctx.createGain(); wlg.gain.value = 0.02;
      wl.connect(wlg); wlg.connect(wg.gain);
      src.connect(bp); bp.connect(wg); wg.connect(master);
      src.start(); wl.start();
      this.built = true;
    },
    set(on) {
      this.on = on;
      $('#soundToggle').setAttribute('aria-pressed', on ? 'true' : 'false');
      if (!on && !this.built) return;
      this.build();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(on ? 1 : 0, t, on ? 1.2 : 0.4);
    },
    blip(freq) {
      if (!this.on || !this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(freq || 880, t);
      o.frequency.exponentialRampToValueAtTime((freq || 880) * 0.6, t + 0.25);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.04, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.4);
    }
  };
  $('#soundToggle').addEventListener('click', () => Ambience.set(!Ambience.on));

  /* ----------------------------------------------------------------- layout */
  // Grid spacing inside a region, room for the names, gap between regions, outer margins.
  const L = { col: 460, row: 330, label: 340, gap: 820, padX: 920, top: 640, bottom: 640 };

  function layout(data) {
    const regions = (data.regions || []).map((r) => Object.assign({}, r, { items: [] }));
    const byId = {};
    regions.forEach((r) => { byId[r.id] = r; });
    const projects = (data.projects || []).filter((p) => {
      if (byId[p.region]) return true;
      console.warn(`[holy-c] project "${p.id}" has unknown region "${p.region}", skipped`);
      return false;
    });
    projects.forEach((p, i) => { p.index = i; byId[p.region].items.push(p); });
    const used = regions.filter((r) => r.items.length);

    // phones: one zigzag column per region; larger screens: a staggered grid
    const mobile = narrow();
    const row = mobile ? 290 : L.row;
    const stagger = mobile ? 170 : L.col / 2;
    let cursor = L.padX, maxH = 0;
    used.forEach((r) => {
      const n = r.items.length;
      r.cols = mobile ? 1 : Math.max(1, Math.ceil(Math.sqrt(n * 1.5)));
      r.rows = Math.ceil(n / r.cols);
      r.w = (Math.min(n, r.cols) - 1) * L.col + (r.rows > 1 ? stagger : 0);
      r.h = (r.rows - 1) * row;
      maxH = Math.max(maxH, r.h);
      r.x0 = cursor;
      cursor += r.w + L.label + L.gap;
    });
    const W = Math.max(cursor - L.gap + L.padX, 1600);
    const cy = L.top + maxH / 2;
    const H = L.top + maxH + L.bottom;

    used.forEach((r, ri) => {
      r.order = ri;
      r.cx = r.x0 + (r.w + L.label) / 2 - 30;
      r.cy = cy;
      r.rx = (r.w + L.label) / 2 + 190;
      r.ry = r.h / 2 + 210;
      const y0 = cy - r.h / 2;
      r.items.forEach((p, k) => {
        const rw = Math.floor(k / r.cols), col = k % r.cols;
        const jx = (hash(p.id) - 0.5) * (mobile ? 40 : 90), jy = (hash(p.id + '~') - 0.5) * (mobile ? 40 : 80);
        const nudge = p.nudge || {};
        p.x = Math.round(r.x0 + col * L.col + (rw % 2 ? stagger : 0) + jx + (nudge.x || 0));
        p.y = Math.round(y0 + rw * row + jy + (nudge.y || 0));
      });
      // snake order through the grid, used for the links
      r.path = [];
      for (let rw = 0; rw < r.rows; rw++) {
        const line = r.items.slice(rw * r.cols, rw * r.cols + r.cols);
        r.path.push(...(rw % 2 ? line.reverse() : line));
      }
    });
    return { regions: used, allRegions: byId, projects, W, H, cy };
  }

  /* ----------------------------------------------------------------- state */
  let M = null; // laid-out map
  let START = { x: 0, y: 0 };
  const cam = { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0 };
  let vw = window.innerWidth, vh = window.innerHeight;
  let zoom = narrow() ? 0.62 : 1;
  let dragging = false, dragMoved = false, panelOpen = false;
  let ease = 0.075, warm = 0, current = -1, started = false;
  const markerEls = [];
  let linePaths = [], bridges = [], beaconEls = [];

  let heroBelow = false;
  function computeStart() {
    const r = M.regions[0];
    if (!r) return { x: M.W / 2, y: M.cy };
    const hb = hero.getBoundingClientRect();
    const left = r.x0 - 40;                      // leftmost point of the first region
    const top = r.cy - r.h / 2;                  // top row of projects
    const roomRight = vw - hb.right;
    heroBelow = roomRight < 560;
    if (!heroBelow) {
      // first region to the right of the hero, its top row level with the hero title
      const sx = left - (hb.right + 70 - vw / 2) / zoom;
      const sy = top - (Math.max(hb.top + 230, vh * 0.42) - vh / 2) / zoom;
      return { x: sx, y: sy };
    }
    // narrow screens: projects start under the hero
    const sx = left - (40 - vw / 2) / zoom;
    const sy = top - (Math.min(hb.bottom + 70, vh - 220) - vh / 2) / zoom;
    return { x: sx, y: sy };
  }

  /* ----------------------------------------------------------------- camera */
  function clampTarget() {
    const halfW = vw / 2 / zoom, halfH = vh / 2 / zoom;
    cam.tx = halfW * 2 >= M.W ? M.W / 2 : Math.min(Math.max(cam.tx, halfW), M.W - halfW);
    cam.ty = halfH * 2 >= M.H ? M.H / 2 : Math.min(Math.max(cam.ty, halfH), M.H - halfH);
  }
  function applyCamera() {
    const ox = Math.round((vw / 2 - cam.x * zoom) * 100) / 100;
    const oy = Math.round((vh / 2 - cam.y * zoom) * 100) / 100;
    world.style.transform = `translate3d(${ox}px, ${oy}px, 0) scale(${zoom})`;
  }
  function regionTintAt(x, y) {
    let sw = 0, st = 0;
    M.regions.forEach((r) => {
      const d = (x - r.cx) / (r.rx + 400), e = (y - r.cy) / 1400;
      const w = Math.exp(-(d * d + e * e) * 3);
      sw += w; st += w * (r.tint || 0);
    });
    return sw > 1e-4 ? st / sw : 0;
  }
  function tick() {
    if (!dragging) {
      cam.tx += cam.vx; cam.ty += cam.vy;
      cam.vx *= 0.92; cam.vy *= 0.92;
      if (Math.abs(cam.vx) < 0.01) cam.vx = 0;
      if (Math.abs(cam.vy) < 0.01) cam.vy = 0;
    }
    clampTarget();
    const e = dragging ? 0.22 : ease;
    cam.x += (cam.tx - cam.x) * e;
    cam.y += (cam.ty - cam.y) * e;
    applyCamera();
    let target = regionTintAt(cam.x, cam.y);
    if (panelOpen && current >= 0) target = M.allRegions[M.projects[current].region].tint || 0;
    warm += (target - warm) * 0.05;
    GL.setCamera(cam.x, cam.y, zoom);
    GL.setWarm(warm);
    const d = Math.hypot(cam.x - START.x, cam.y - START.y);
    const heroOn = !(d * zoom > 260 || panelOpen);
    hero.classList.toggle('is-faded', !heroOn);
    body.classList.toggle('hero-over', heroOn && heroBelow);
    updateBridgeSigns();
    updateBeacons();
    requestAnimationFrame(tick);
  }
  window.addEventListener('resize', () => {
    vw = window.innerWidth; vh = window.innerHeight;
    zoom = narrow() ? 0.62 : 1;
    world.style.setProperty('--inv', 1 / zoom);
  });
  stage.addEventListener('scroll', () => { stage.scrollLeft = 0; stage.scrollTop = 0; });

  // drag
  let px = 0, py = 0, lastX = 0, lastY = 0, lastT = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('.explore, .beacon')) return;
    dragging = true; dragMoved = false;
    px = lastX = e.clientX; py = lastY = e.clientY; lastT = performance.now();
    cam.vx = cam.vy = 0;
    stage.classList.add('is-dragging');
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.abs(e.clientX - px) + Math.abs(e.clientY - py) > 4) dragMoved = true;
    cam.tx -= dx / zoom; cam.ty -= dy / zoom;
    const now = performance.now(), dt = Math.max(1, now - lastT);
    cam.vx = -dx / dt * 14 / zoom; cam.vy = -dy / dt * 14 / zoom;
    lastX = e.clientX; lastY = e.clientY; lastT = now;
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-dragging');
    if (performance.now() - lastT > 80) cam.vx = cam.vy = 0;
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);
  stage.addEventListener('click', (e) => { if (dragMoved) { e.stopPropagation(); e.preventDefault(); } }, true);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? vh : 1;
    let dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    cam.tx += dx * 1.1 / zoom; cam.ty += dy * 1.1 / zoom;
    cam.vx = cam.vy = 0;
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    const step = 220;
    if (e.key === 'ArrowLeft') cam.tx -= step;
    else if (e.key === 'ArrowRight') cam.tx += step;
    else if (e.key === 'ArrowUp') cam.ty -= step;
    else if (e.key === 'ArrowDown') cam.ty += step;
    else if (e.key === 'Escape') closeAll();
    else return;
    e.preventDefault();
  });

  function focusOn(x, y) {
    const shift = panelOpen && !narrow() ? Math.min(520, vw) / 2 / zoom : 0;
    cam.tx = x + shift;
    cam.ty = y + (panelOpen && narrow() ? vh * 0.22 / zoom : 0);
    cam.vx = cam.vy = 0;
  }
  function flyToRegion(r) {
    closePanel();
    closeSheets();
    ease = 0.05;
    cam.tx = r.cx; cam.ty = r.cy;
    cam.vx = cam.vy = 0;
    Ambience.blip(r.tint ? 520 : 760);
    setTimeout(() => { if (!panelOpen) ease = 0.075; }, 1600);
  }

  /* ------------------------------------------------------------ build map */
  const ns = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, parent) {
    const n = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  }

  function buildWorld() {
    world.style.width = M.W + 'px';
    world.style.height = M.H + 'px';
    world.style.setProperty('--inv', 1 / zoom);
    const lines = $('#lines');
    lines.setAttribute('viewBox', `0 0 ${M.W} ${M.H}`);
    const defs = svg('defs', {}, lines);
    const regionsEl = $('#regions');

    // region areas + titles
    M.regions.forEach((r, i) => {
      svg('ellipse', { class: 'area', cx: r.cx, cy: r.cy, rx: r.rx, ry: r.ry, style: `--accent:${r.color}` }, lines);
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'region';
      label.style.cssText = `left:${r.x0 - 30}px;top:${r.cy - r.h / 2 - 70}px;--accent:${r.color}`;
      label.innerHTML = `<small>Zone ${pad2(i + 1)} · ${word(r.items.length)} ${r.items.length > 1 ? 'projects' : 'project'}</small><span>${esc(r.title)}</span>`;
      label.addEventListener('click', () => flyToRegion(r));
      label.addEventListener('pointerdown', (e) => e.preventDefault());
      regionsEl.appendChild(label);
    });

    // links inside each region
    function curve(a, b, bend) {
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * bend;
      const my = (a.y + b.y) / 2 - (b.x - a.x) * bend;
      return { d: `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`, mid: { x: 0.25 * a.x + 0.5 * mx + 0.25 * b.x, y: 0.25 * a.y + 0.5 * my + 0.25 * b.y } };
    }
    M.regions.forEach((r) => {
      for (let k = 0; k < r.path.length - 1; k++) {
        const a = r.path[k], b = r.path[k + 1];
        const p = svg('path', { class: 'link', d: curve(a, b, 0.12).d, style: `--accent:${r.color}` }, lines);
        p.dataset.a = a.index; p.dataset.b = b.index;
        linePaths.push(p);
      }
    });

    // bridges between consecutive regions
    for (let i = 0; i < M.regions.length - 1; i++) {
      const A = M.regions[i], B = M.regions[i + 1];
      const a = A.items.reduce((m, p) => (p.x > m.x ? p : m));
      const b = B.items.reduce((m, p) => (p.x < m.x ? p : m));
      const c = curve(a, b, -0.16);
      const gid = `bridge-grad-${i}`;
      const g = svg('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, defs);
      svg('stop', { offset: '0', 'stop-color': A.color }, g);
      svg('stop', { offset: '1', 'stop-color': B.color }, g);
      svg('path', { class: 'bridge__glow', d: c.d, stroke: `url(#${gid})` }, lines);
      svg('path', { class: 'bridge', d: c.d, stroke: `url(#${gid})` }, lines);
      const sign = document.createElement('button');
      sign.type = 'button';
      sign.className = 'bridge-sign';
      sign.style.cssText = `left:${c.mid.x}px;top:${c.mid.y}px`;
      sign.innerHTML = '<small></small><span></span>';
      sign.addEventListener('pointerdown', (e) => e.preventDefault());
      const bridge = { A, B, mid: c.mid, sign, side: null };
      sign.addEventListener('click', () => flyToRegion(cam.x < bridge.mid.x ? B : A));
      regionsEl.appendChild(sign);
      bridges.push(bridge);
    }

    // project markers
    const markersEl = $('#markers');
    M.projects.forEach((p, i) => {
      const r = M.allRegions[p.region];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'marker';
      b.style.cssText = `left:${p.x}px;top:${p.y}px;--accent:${r.color};transition-delay:${(0.9 + i * 0.07).toFixed(2)}s`;
      b.setAttribute('aria-label', `${p.name}, ${r.singular}`);
      b.innerHTML = `<span class="marker__dot"></span><span class="marker__name">${esc(p.name)}</span>`;
      b.addEventListener('click', () => openProject(i));
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('pointerenter', () => Ambience.blip(r.tint ? 660 : 880));
      markersEl.appendChild(b);
      markerEls.push(b);
    });

    // about landmark, under the first bridge (or under the only region)
    const anchor = bridges[0] ? bridges[0].mid : { x: M.regions[0].cx, y: M.regions[0].cy };
    const about = document.createElement('button');
    about.type = 'button';
    about.className = 'marker marker--about';
    about.style.cssText = `left:${anchor.x}px;top:${Math.min(M.H - 160, M.cy + 470)}px;transition-delay:1.6s`;
    about.innerHTML = '<span class="marker__dot"></span><span class="marker__name">About Holy-C</span>';
    about.addEventListener('click', () => openSheet('about'));
    about.addEventListener('pointerdown', (e) => e.preventDefault());
    markersEl.appendChild(about);

    // edge beacons for regions out of view
    const beacons = $('#beacons');
    beaconEls = M.regions.map((r) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'beacon';
      el.style.setProperty('--accent', r.color);
      el.innerHTML = `<i class="beacon__arrow"></i><span><small>Zone</small>${esc(r.title)}</span>`;
      el.addEventListener('click', () => flyToRegion(r));
      beacons.appendChild(el);
      return { r, el, side: null };
    });
  }

  function updateBridgeSigns() {
    bridges.forEach((b) => {
      const side = cam.x < b.mid.x ? 'B' : 'A';
      if (side === b.side) return;
      b.side = side;
      const to = side === 'B' ? b.B : b.A;
      b.sign.style.setProperty('--accent', to.color);
      b.sign.classList.toggle('is-back', side === 'A');
      b.sign.querySelector('small').textContent = `Next zone · ${pad2(to.order + 1)}`;
      b.sign.querySelector('span').innerHTML = side === 'B' ? `${esc(to.title)} <b>→</b>` : `<b>←</b> ${esc(to.title)}`;
    });
  }
  function updateBeacons() {
    const hide = panelOpen || body.classList.contains('sheet-open') || !started;
    beaconEls.forEach((bk) => {
      const sx = vw / 2 + (bk.r.cx - cam.x) * zoom;
      const half = bk.r.rx * zoom * 0.8;          // the zone counts as visible as soon as most of its edge shows
      let side = null;
      if (!hide) {
        if (sx - half > vw - 40) side = 'right';
        else if (sx + half < 40) side = 'left';
      }
      if (side === bk.side) return;
      bk.side = side;
      bk.el.classList.toggle('is-visible', !!side);
      bk.el.classList.toggle('is-left', side === 'left');
      bk.el.classList.toggle('is-right', side === 'right');
    });
  }

  /* ----------------------------------------------------------------- panel */
  const el = {
    tag: $('#panelTag'), logo: $('#panelLogo'), title: $('#panelTitle'), meta: $('#panelMeta'),
    tagline: $('#panelTagline'), shot: $('#panelShot'), desc: $('#panelDesc'), facts: $('#panelFacts'),
    actions: $('#panelActions'), count: $('#panelCount'), prev: $('#panelPrev'), next: $('#panelNext')
  };
  function linksOf(p) {
    const L2 = p.links || {};
    const out = {};
    if (L2.play) out.play = L2.play;
    if (L2.download !== false && (L2.download || p.repo)) out.download = L2.download || `https://github.com/${p.repo}/releases${p.prerelease ? '' : '/latest'}`;
    if (L2.github !== false && (L2.github || p.repo)) out.github = L2.github || `https://github.com/${p.repo}`;
    if (L2.discord) out.discord = L2.discord;
    if (L2.website) out.website = L2.website;
    return out;
  }
  function btn(href, label, icon, primary) {
    const ic = icon === 'github' ? '<svg class="btn__icon" aria-hidden="true"><use href="#i-github"/></svg>' : '';
    const tail = icon === 'github' ? '' : `<svg aria-hidden="true"><use href="#i-${icon}"/></svg>`;
    return `<a class="btn btn--outline${primary ? ' btn--primary' : ''}" href="${esc(href)}" target="_blank" rel="noopener">${ic}<span class="btn__text"><span>${label}</span><span>${label}</span></span>${tail}</a>`;
  }
  function renderProject(p, i) {
    const r = M.allRegions[p.region];
    panel.style.setProperty('--accent', r.color);
    el.tag.textContent = r.singular || r.title;
    if (p.logo) { el.logo.src = p.logo; el.logo.hidden = false; } else { el.logo.removeAttribute('src'); el.logo.hidden = true; }
    el.logo.classList.toggle('is-wide', !!p.logoWide);
    el.title.textContent = p.name;
    const v = p.version ? `v${p.version}${p.prerelease ? ' preview' : ''} · ` : '';
    el.meta.textContent = v + (p.platforms || []).join(' · ');
    el.tagline.textContent = p.tagline || '';
    el.shot.innerHTML = '';
    el.shot.classList.toggle('is-portrait', !!p.portrait);
    const shots = p.shots || [];
    el.shot.hidden = !shots.length;
    shots.slice(0, p.portrait ? 2 : 1).forEach((src) => {
      const img = document.createElement('img');
      img.src = src; img.alt = `${p.name} screenshot`; img.loading = 'lazy'; img.decoding = 'async';
      el.shot.appendChild(img);
    });
    el.desc.textContent = p.description || '';
    el.facts.innerHTML = [...(p.facts || []), p.stack, p.license].filter(Boolean).map((f) => `<li>${esc(f)}</li>`).join('');
    const ln = linksOf(p), a = [];
    if (ln.play) a.push(btn(ln.play, 'Play in browser', 'arrow', true));
    if (ln.download) a.push(btn(ln.download, 'Download', 'arrow', !ln.play));
    if (ln.website) a.push(btn(ln.website, 'Website', 'ext', false));
    if (ln.github) a.push(btn(ln.github, 'GitHub', 'github', false));
    if (ln.discord) a.push(btn(ln.discord, 'Discord', 'ext', false));
    el.actions.innerHTML = a.join('');
    el.count.textContent = `${pad2(i + 1)} / ${pad2(M.projects.length)}`;
  }
  function openProject(i, opts) {
    closeSheets();
    body.classList.remove('menu-open');
    const p = M.projects[i];
    if (!p) return;
    current = i;
    panelOpen = true;
    renderProject(p, i);
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    $('.panel__scroll').scrollTop = 0;
    world.classList.add('has-active');
    markerEls.forEach((m, k) => m.classList.toggle('is-active', k === i));
    linePaths.forEach((path) => path.classList.toggle('is-lit', path.dataset.a == i || path.dataset.b == i));
    ease = 0.06;
    focusOn(p.x, p.y);
    history.replaceState(null, '', '#' + p.id);
    if (!opts || !opts.silent) Ambience.blip(M.allRegions[p.region].tint ? 520 : 740);
  }
  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    world.classList.remove('has-active');
    markerEls.forEach((m) => m.classList.remove('is-active'));
    linePaths.forEach((path) => path.classList.remove('is-lit'));
    ease = 0.075;
    if (current >= 0) { const p = M.projects[current]; cam.tx = p.x; cam.ty = p.y; }
    history.replaceState(null, '', location.pathname);
  }
  $('#panelClose').addEventListener('click', closePanel);
  el.prev.addEventListener('click', () => openProject((current - 1 + M.projects.length) % M.projects.length));
  el.next.addEventListener('click', () => openProject((current + 1) % M.projects.length));

  /* ----------------------------------------------------------------- sheets */
  const sheets = { index: $('#sheetIndex'), about: $('#sheetAbout'), contact: $('#sheetContact') };
  function openSheet(name) {
    closePanel();
    body.classList.remove('menu-open');
    Object.entries(sheets).forEach(([k, s]) => {
      const on = k === name;
      s.classList.toggle('is-open', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    body.classList.add('sheet-open');
    setNav(name === 'index' ? 'map' : name);
    Ambience.blip(600);
  }
  function closeSheets() {
    Object.values(sheets).forEach((s) => { s.classList.remove('is-open'); s.setAttribute('aria-hidden', 'true'); });
    body.classList.remove('sheet-open');
    setNav('map');
  }
  function closeAll() { closeSheets(); closePanel(); body.classList.remove('menu-open'); }
  function setNav(name) { $$('.nav__links a').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === name)); }
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));
  $$('[data-nav]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    if (a.dataset.nav === 'map') closeAll(); else openSheet(a.dataset.nav);
  }));
  $('#exploreBtn').addEventListener('click', () => openSheet('index'));
  $('#burger').addEventListener('click', () => body.classList.toggle('menu-open'));

  function buildTexts(data) {
    const n = M.projects.length;
    $('#heroLong').textContent = `${cap(word(n))} projects, open on GitHub`;
    $('#heroShort').textContent = `${cap(word(n))} projects`;
    $('#exploreCount').textContent = pad2(n);
    $('#indexCount').textContent = pad2(n);

    const list = $('#indexList');
    list.innerHTML = M.regions.map((r) => `<div class="index__group reveal" style="--accent:${r.color}"><h3>${esc(r.title)} — ${r.items.length}</h3>${r.items.map((p) =>
      `<button type="button" class="index__item" data-index="${p.index}"><small>${pad2(p.index + 1)}</small><strong>${esc(p.name)}</strong><span>${esc((p.platforms || []).slice(0, 3).join(' · '))}</span><svg class="arrow" aria-hidden="true"><use href="#i-arrow"/></svg></button>`
    ).join('')}</div>`).join('');
    $$('.index__item', list).forEach((b) => b.addEventListener('click', () => openProject(+b.dataset.index)));

    const counts = {};
    M.regions.forEach((r) => { counts[r.id] = r.items.length; });
    const about = ((data.site && data.site.about) || '').replace(/\{(\w+)\}/g, (_, k) => word(counts[k] || 0));
    $('#aboutIntro').textContent = cap(about);

    const stacks = new Set(), licences = new Set();
    M.projects.forEach((p) => {
      (p.stack || '').split(/,\s*/).filter(Boolean).forEach((s) => stacks.add(s));
      if (p.license && p.license !== 'Free') licences.add(p.license.replace(/\s*\(.*\)/, ''));
    });
    $('#aboutFacts').innerHTML =
      M.regions.map((r) => `<div><dt>${esc(r.title)}</dt><dd>${esc(r.items.map((p) => p.name).join(', '))}</dd></div>`).join('') +
      `<div><dt>Built with</dt><dd>${esc([...stacks].slice(0, 8).join(', '))}</dd></div>` +
      `<div><dt>Licences</dt><dd>${esc([...licences].join(', ') || 'Free')}</dd></div>`;

    const contact = $('#contactLinks');
    M.projects.forEach((p) => {
      const ln = linksOf(p);
      if (!ln.play) return;
      const host = ln.play.replace(/^https?:\/\//, '').replace(/\/$/, '');
      contact.insertAdjacentHTML('beforeend', `<li><a class="biglink" href="${esc(ln.play)}" target="_blank" rel="noopener"><span>Play ${esc(p.name)}</span><small>${esc(host)}</small><svg aria-hidden="true"><use href="#i-ext"/></svg></a></li>`);
    });
  }

  /* ------------------------------------------------------------------ intro */
  const fontsReady = (document.fonts && document.fonts.ready) ? Promise.race([document.fonts.ready, new Promise((ok) => setTimeout(ok, 2500))]) : Promise.resolve();
  const ready = Promise.all([
    fetch('data/projects.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    fontsReady
  ])
    .then(([data]) => {
      M = layout(data);
      START = computeStart();
      cam.x = cam.tx = START.x; cam.y = cam.ty = START.y;
      buildWorld();
      buildTexts(data);
      applyCamera();
      GL.setCamera(cam.x, cam.y, zoom);
      window.HOLYC = { M, openProject, openSheet, flyToRegion, cam };
    })
    .catch((err) => {
      console.error('[holy-c] could not load data/projects.json', err);
      $('#heroLong').textContent = 'Projects could not be loaded';
    });

  function enter(withSound) {
    if (withSound) Ambience.set(true);
    const intro = $('#intro');
    intro.classList.add('is-leaving');
    setTimeout(() => intro.remove(), 1400);
    ready.then(() => {
      if (!M) return;
      START = computeStart();
      cam.x = cam.tx = START.x; cam.y = cam.ty = START.y;
      applyCamera();
      body.classList.add('is-entered');
      started = true;
      requestAnimationFrame(tick);
      const id = location.hash.slice(1);
      const i = M.projects.findIndex((p) => p.id === id);
      if (i >= 0) {
        cam.x = cam.tx = M.projects[i].x; cam.y = cam.ty = M.projects[i].y;
        setTimeout(() => openProject(i, { silent: true }), 900);
      }
    });
  }
  $('#enterSound').addEventListener('click', () => enter(true));
  $('#enterMute').addEventListener('click', () => enter(false));
})();
