/* Holy-C — map navigation, markers, panels, ambience. */
(function () {
  'use strict';

  const WORLD = { w: 3600, h: 2200 };
  const narrow = () => window.innerWidth <= 860;
  const START = narrow() ? { x: 2000, y: 1050 } : { x: 1250, y: 1020 };
  const PROJECTS = window.PROJECTS || [];
  const LANDMARKS = window.LANDMARKS || [];
  const GL = window.WORLD_GL;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  const body = document.body;
  const stage = $('#stage');
  const world = $('#world');
  const markersEl = $('#markers');
  const linesEl = $('#lines');
  const hero = $('#hero');
  const panel = $('#panel');
  const compassDot = $('#compass i');

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
      const notes = [55, 82.41, 110, 164.81, 220];
      notes.forEach((f, i) => {
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

      // wind
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

  /* ----------------------------------------------------------------- camera */
  const cam = { x: START.x, y: START.y, tx: START.x, ty: START.y, vx: 0, vy: 0 };
  let vw = window.innerWidth, vh = window.innerHeight;
  let zoom = narrow() ? 0.7 : 1;
  let dragging = false, dragMoved = false;
  let panelOpen = false;
  let ease = 0.075;

  function clampTarget() {
    const halfW = vw / 2 / zoom, halfH = vh / 2 / zoom;
    cam.tx = halfW * 2 >= WORLD.w ? WORLD.w / 2 : Math.min(Math.max(cam.tx, halfW), WORLD.w - halfW);
    cam.ty = halfH * 2 >= WORLD.h ? WORLD.h / 2 : Math.min(Math.max(cam.ty, halfH), WORLD.h - halfH);
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
    const ox = Math.round((vw / 2 - cam.x * zoom) * 100) / 100;
    const oy = Math.round((vh / 2 - cam.y * zoom) * 100) / 100;
    world.style.transform = `translate3d(${ox}px, ${oy}px, 0) scale(${zoom})`;
    GL.setCamera(cam.x, cam.y, zoom);
    const p = (cam.x - vw / 2) / Math.max(1, WORLD.w - vw);
    compassDot.style.setProperty('--p', (12 + p * 76).toFixed(1) + '%');
    // hero fades as you leave the starting area
    const d = Math.hypot(cam.x - START.x, cam.y - START.y);
    hero.classList.toggle('is-faded', d * zoom > 260 || panelOpen);
    requestAnimationFrame(tick);
  }
  window.addEventListener('resize', () => { vw = window.innerWidth; vh = window.innerHeight; zoom = narrow() ? 0.7 : 1; world.style.setProperty('--inv', 1 / zoom); });
  // a focused marker must never scroll the clipped stage
  stage.addEventListener('scroll', () => { stage.scrollLeft = 0; stage.scrollTop = 0; });

  // drag
  let px = 0, py = 0, lastX = 0, lastY = 0, lastT = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
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
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-dragging');
    if (performance.now() - lastT > 80) { cam.vx = cam.vy = 0; }
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);
  stage.addEventListener('click', (e) => { if (dragMoved) { e.stopPropagation(); e.preventDefault(); } }, true);

  // wheel
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? vh : 1;
    let dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    cam.tx += dx * 1.1 / zoom; cam.ty += dy * 1.1 / zoom;
    cam.vx = cam.vy = 0;
  }, { passive: false });

  // keys
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    const step = 220;
    if (e.key === 'ArrowLeft') cam.tx -= step;
    else if (e.key === 'ArrowRight') cam.tx += step;
    else if (e.key === 'ArrowUp') cam.ty -= step;
    else if (e.key === 'ArrowDown') cam.ty += step;
    else if (e.key === 'Escape') { closeAll(); }
    else return;
    e.preventDefault();
  });

  function focusOn(x, y) {
    const shift = panelOpen && vw > 860 ? panelWidth() / 2 / zoom : 0;
    cam.tx = x + shift;
    cam.ty = y + (panelOpen && vw <= 860 ? vh * 0.22 / zoom : 0);
    cam.vx = cam.vy = 0;
  }
  function panelWidth() { return Math.min(520, vw); }

  /* ---------------------------------------------------------------- markers */
  const markerByIndex = [];
  function buildMarkers() {
    PROJECTS.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `marker marker--${p.category}` + (p.x > 2500 || (p.category === 'software' && p.x < 1000) ? ' marker--left' : '');
      b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
      b.style.transitionDelay = (0.9 + i * 0.09) + 's';
      b.dataset.index = i;
      b.setAttribute('aria-label', p.name);
      b.innerHTML = `<span class="marker__dot"></span><span class="marker__text"><span class="marker__label">${p.category === 'game' ? 'Game' : 'Software'} · ${String(i + 1).padStart(2, '0')}</span><span class="marker__name">${p.name}</span></span>`;
      b.addEventListener('click', () => openProject(i));
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('pointerenter', () => Ambience.blip(p.category === 'game' ? 660 : 880));
      markersEl.appendChild(b);
      markerByIndex.push(b);
    });
    LANDMARKS.forEach((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'marker marker--about';
      b.style.left = l.x + 'px'; b.style.top = l.y + 'px';
      b.style.transitionDelay = '1.8s';
      b.setAttribute('aria-label', l.label);
      b.innerHTML = `<span class="marker__dot"></span><span class="marker__text"><span class="marker__label">${l.label}</span><span class="marker__name">${l.name}</span></span>`;
      b.addEventListener('click', () => openSheet(l.target));
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('pointerenter', () => Ambience.blip(520));
      markersEl.appendChild(b);
    });
  }

  function buildLines() {
    const groups = { software: [], game: [] };
    PROJECTS.forEach((p, i) => groups[p.category].push({ ...p, i }));
    const ns = 'http://www.w3.org/2000/svg';
    const paths = [];
    function link(a, b) {
      const path = document.createElementNS(ns, 'path');
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12;
      const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
      path.setAttribute('d', `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`);
      path.dataset.a = a.i; path.dataset.b = b.i;
      linesEl.appendChild(path);
      paths.push(path);
    }
    // software: a loop in order around the cluster
    const s = groups.software;
    const order = [0, 5, 4, 3, 2, 0].map((k) => s[k]).filter(Boolean);
    for (let k = 0; k < order.length - 1; k++) link(order[k], order[k + 1]);
    if (s[1]) { link(s[0], s[1]); link(s[1], s[4]); }
    // games
    const g = groups.game;
    if (g.length === 2) link(g[0], g[1]);
    // a faint bridge between regions
    if (s[5] && g[0]) { const bridge = link(s[5], g[0]); }
    linesEl.setAttribute('viewBox', `0 0 ${WORLD.w} ${WORLD.h}`);
    return paths;
  }

  /* ----------------------------------------------------------------- panel */
  let current = -1;
  const el = {
    tag: $('#panelTag'), logo: $('#panelLogo'), title: $('#panelTitle'), meta: $('#panelMeta'),
    tagline: $('#panelTagline'), shot: $('#panelShot'), desc: $('#panelDesc'), facts: $('#panelFacts'),
    actions: $('#panelActions'), count: $('#panelCount'), prev: $('#panelPrev'), next: $('#panelNext')
  };
  function renderProject(p, i) {
    el.tag.textContent = p.category === 'game' ? 'Game' : 'Software';
    el.tag.classList.toggle('tag--game', p.category === 'game');
    el.logo.src = p.logo; el.logo.alt = '';
    el.logo.classList.toggle('is-wide', !!p.wideLogo);
    el.title.textContent = p.name;
    el.meta.textContent = `v${p.version} · ${p.platforms.join(' · ')}`;
    el.tagline.textContent = p.tagline;
    el.shot.innerHTML = '';
    el.shot.classList.toggle('is-portrait', !!p.portrait);
    [p.shot, p.shot2].filter(Boolean).forEach((src) => {
      const img = document.createElement('img');
      img.src = src; img.alt = `${p.name} screenshot`; img.loading = 'lazy'; img.decoding = 'async';
      el.shot.appendChild(img);
    });
    el.desc.textContent = p.description;
    el.facts.innerHTML = [...p.facts, p.stack, p.license].map((f) => `<li>${f}</li>`).join('');
    const L = p.links, a = [];
    if (L.play) a.push(`<a class="btn btn--outline btn--primary" href="${L.play}" target="_blank" rel="noopener"><span class="btn__text"><span>Play in browser</span><span>Play in browser</span></span><svg aria-hidden="true"><use href="#i-arrow"/></svg></a>`);
    if (L.download) a.push(`<a class="btn btn--outline${L.play ? '' : ' btn--primary'}" href="${L.download}" target="_blank" rel="noopener"><span class="btn__text"><span>Download</span><span>Download</span></span><svg aria-hidden="true"><use href="#i-arrow"/></svg></a>`);
    if (L.github) a.push(`<a class="btn btn--outline" href="${L.github}" target="_blank" rel="noopener"><svg class="btn__icon" aria-hidden="true"><use href="#i-github"/></svg><span class="btn__text"><span>GitHub</span><span>GitHub</span></span></a>`);
    if (L.discord) a.push(`<a class="btn btn--outline" href="${L.discord}" target="_blank" rel="noopener"><span class="btn__text"><span>Discord</span><span>Discord</span></span><svg aria-hidden="true"><use href="#i-ext"/></svg></a>`);
    el.actions.innerHTML = a.join('');
    el.count.textContent = `${String(i + 1).padStart(2, '0')} / ${String(PROJECTS.length).padStart(2, '0')}`;
  }
  function openProject(i, opts) {
    closeSheets();
    body.classList.remove('menu-open');
    const p = PROJECTS[i];
    if (!p) return;
    current = i;
    panelOpen = true;
    renderProject(p, i);
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    $('.panel__scroll').scrollTop = 0;
    markerByIndex.forEach((m, k) => m.classList.toggle('is-active', k === i));
    linePaths.forEach((path) => path.classList.toggle('is-lit', path.dataset.a == i || path.dataset.b == i));
    GL.setWarm(p.category === 'game' ? 1 : 0);
    ease = 0.06;
    focusOn(p.x, p.y);
    history.replaceState(null, '', '#' + p.id);
    if (!opts || !opts.silent) Ambience.blip(p.category === 'game' ? 520 : 740);
  }
  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    markerByIndex.forEach((m) => m.classList.remove('is-active'));
    linePaths.forEach((path) => path.classList.remove('is-lit'));
    GL.setWarm(0);
    ease = 0.075;
    if (current >= 0) { const p = PROJECTS[current]; cam.tx = p.x; cam.ty = p.y; }
    history.replaceState(null, '', location.pathname);
  }
  $('#panelClose').addEventListener('click', closePanel);
  el.prev.addEventListener('click', () => openProject((current - 1 + PROJECTS.length) % PROJECTS.length));
  el.next.addEventListener('click', () => openProject((current + 1) % PROJECTS.length));

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
    setNav(name === 'index' ? 'map' : name);
    Ambience.blip(600);
  }
  function closeSheets() {
    Object.values(sheets).forEach((s) => { s.classList.remove('is-open'); s.setAttribute('aria-hidden', 'true'); });
    setNav('map');
  }
  function closeAll() { closeSheets(); closePanel(); body.classList.remove('menu-open'); }
  function setNav(name) {
    $$('.nav__links a').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === name));
  }
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));
  $$('[data-nav]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const n = a.dataset.nav;
    if (n === 'map') { closeAll(); }
    else openSheet(n);
  }));
  $('#exploreBtn').addEventListener('click', () => openSheet('index'));
  $('#burger').addEventListener('click', () => body.classList.toggle('menu-open'));

  function buildIndex() {
    const list = $('#indexList');
    const groups = [['game', 'Games'], ['software', 'Software']];
    list.innerHTML = groups.map(([cat, title]) => {
      const items = PROJECTS.map((p, i) => ({ p, i })).filter(({ p }) => p.category === cat);
      return `<div class="index__group reveal"><h3>${title} — ${items.length}</h3>${items.map(({ p, i }) =>
        `<button type="button" class="index__item" data-index="${i}"><small>${String(i + 1).padStart(2, '0')}</small><strong>${p.name}</strong><span>${p.platforms.slice(0, 3).join(' · ')}</span><svg class="arrow" aria-hidden="true"><use href="#i-arrow"/></svg></button>`
      ).join('')}</div>`;
    }).join('');
    $('#indexCount').textContent = String(PROJECTS.length).padStart(2, '0');
    $$('.index__item', list).forEach((b) => b.addEventListener('click', () => openProject(+b.dataset.index)));
  }

  /* ------------------------------------------------------------------ intro */
  function enter(withSound) {
    const intro = $('#intro');
    if (withSound) Ambience.set(true);
    intro.classList.add('is-leaving');
    body.classList.add('is-entered');
    setTimeout(() => intro.remove(), 1400);
    requestAnimationFrame(tick);
    // deep link
    const id = location.hash.slice(1);
    const i = PROJECTS.findIndex((p) => p.id === id);
    if (i >= 0) {
      cam.x = cam.tx = PROJECTS[i].x; cam.y = cam.ty = PROJECTS[i].y;
      setTimeout(() => openProject(i, { silent: true }), 900);
    }
  }
  $('#enterSound').addEventListener('click', () => enter(true));
  $('#enterMute').addEventListener('click', () => enter(false));

  /* ------------------------------------------------------------------- init */
  buildMarkers();
  const linePaths = buildLines();
  buildIndex();
  // place the world before the intro lifts so the first frame is right
  world.style.setProperty('--inv', 1 / zoom);
  world.style.transform = `translate3d(${vw / 2 - cam.x * zoom}px, ${vh / 2 - cam.y * zoom}px, 0) scale(${zoom})`;
  GL.setCamera(cam.x, cam.y, zoom);
  window.HOLYC = { openProject, openSheet, cam };
})();
