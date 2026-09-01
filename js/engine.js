/*
 * Quiz engine: renders a resolved quiz (see js/data.js) and runs the
 * Seterra-style game loop. Engine.start(quiz) / Engine.stop().
 *
 * Resolved quiz shape:
 *   { title, subtitle, kind: 'polygon'|'point',
 *     features: [{id, name, geometry} | {id, name, lon, lat}],
 *     targetIds: [id], context: [{geometry}] }
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAP_WIDTH = 1000;
  const MAX_ATTEMPTS = 3;
  const POINTS = [1, 0.7, 0.4, 0];
  const REVEAL_PAUSE_MS = 1400;
  const POINT_R = 7; // screen px at home zoom

  let el = null;      // dom refs, bound on first start
  let svg = null, layer = null;
  let shapeById = new Map(), nameById = new Map();
  let hitById = new Map(); // for line targets: invisible fat stroke that takes the click
  let circles = [];
  let home = null, view = null, minW = 0;
  let drag = null;

  let quiz = null;
  let order = [], idx = 0, attempts = 0, results = new Map();
  let locked = false, startedAt = 0, timerId = null, revealTimer = null;
  let wrongLabelTimer = null;

  function bindDom() {
    if (el) return;
    const $ = (id) => document.getElementById(id);
    el = {
      map: $('map'), prompt: $('prompt'), promptName: $('prompt-name'),
      triesLeft: $('tries-left'), progress: $('stat-progress'),
      score: $('stat-score'), timer: $('stat-timer'),
      wrongLabel: $('wrong-label'), endPanel: $('end-panel'),
      endScore: $('end-score'), endTime: $('end-time'),
      endBreakdown: $('end-breakdown'), missedWrap: $('missed-wrap'),
      missedList: $('missed-list'), btnRestart: $('btn-restart'),
      btnRetryMissed: $('btn-retry-missed'),
      quizTitle: $('quiz-title'), quizSubtitle: $('quiz-subtitle'),
    };
    $('btn-zoom-in').addEventListener('click', () => zoomCenter(1.5));
    $('btn-zoom-out').addEventListener('click', () => zoomCenter(1 / 1.5));
    $('btn-zoom-reset').addEventListener('click', () => { view = { ...home }; applyView(); });
    el.btnRestart.addEventListener('click', () => startRound(quiz.targetIds));
  }

  // ---------- rendering ----------
  function render() {
    el.map.replaceChildren();
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    layer = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(layer);
    el.map.appendChild(svg);

    const scene = Geo.buildScene(quiz.features, quiz.context, MAP_WIDTH,
      { bounds: quiz.bounds });
    home = { x: 0, y: 0, w: scene.width, h: scene.height };
    view = { ...home };
    minW = scene.width / 60;
    shapeById = new Map();
    nameById = new Map();
    hitById = new Map();
    circles = [];

    for (const d of scene.context) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.classList.add('ctx');
      layer.appendChild(p);
    }

    const targetSet = new Set(quiz.targetIds);
    const sorted = [...scene.shapes].sort(
      (a, b) => Number(targetSet.has(a.id)) - Number(targetSet.has(b.id))
    );
    const hitLayer = document.createElementNS(SVG_NS, 'g');
    for (const s of sorted) {
      nameById.set(s.id, s.name);
      let node;
      if (s.d !== undefined) {
        node = document.createElementNS(SVG_NS, 'path');
        node.setAttribute('d', s.d);
        if (s.line) node.classList.add('town--line');
      } else {
        node = document.createElementNS(SVG_NS, 'circle');
        node.setAttribute('cx', s.x);
        node.setAttribute('cy', s.y);
        circles.push(node);
      }
      if (targetSet.has(s.id)) {
        node.classList.add('town', 'town--target');
        shapeById.set(s.id, node);
        if (s.line) {
          // nobody can click a 2px stroke — pair each line with a fat invisible one
          const hit = document.createElementNS(SVG_NS, 'path');
          hit.setAttribute('d', s.d);
          hit.classList.add('hitline');
          hit.dataset.id = s.id;
          hitById.set(s.id, hit);
          hitLayer.appendChild(hit);
        } else {
          node.dataset.id = s.id;
        }
      } else {
        node.classList.add('town', 'town--bg');
        const tip = document.createElementNS(SVG_NS, 'title');
        tip.textContent = s.name + ' — not in this quiz';
        node.appendChild(tip);
      }
      layer.appendChild(node);
    }
    layer.appendChild(hitLayer);
    wireMapEvents();
    applyView();
  }

  // ---------- zoom & pan ----------
  function applyView() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    if (circles.length) {
      const r = Math.max(POINT_R * (view.w / home.w), home.w / 900);
      for (const c of circles) c.setAttribute('r', r);
    }
  }
  function clientToMap(cx, cy) {
    const r = svg.getBoundingClientRect();
    const s = Math.min(r.width / view.w, r.height / view.h);
    const ox = (r.width - view.w * s) / 2;
    const oy = (r.height - view.h * s) / 2;
    return [view.x + (cx - r.left - ox) / s, view.y + (cy - r.top - oy) / s];
  }
  function zoomAt(cx, cy, factor) {
    const [mx, my] = clientToMap(cx, cy);
    const w = Math.min(Math.max(view.w / factor, minW), home.w * 1.5);
    const h = w * (home.h / home.w);
    view = {
      x: mx - ((mx - view.x) / view.w) * w,
      y: my - ((my - view.y) / view.h) * h,
      w, h,
    };
    applyView();
  }
  function zoomCenter(f) {
    const r = svg.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  }

  function wireMapEvents() {
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.002));
    }, { passive: false });
    svg.addEventListener('pointerdown', (ev) => {
      drag = { sx: ev.clientX, sy: ev.clientY, view0: { ...view }, moved: false };
      svg.setPointerCapture(ev.pointerId);
    });
    svg.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
      if (!drag.moved) return;
      const r = svg.getBoundingClientRect();
      const s = Math.min(r.width / view.w, r.height / view.h);
      view.x = drag.view0.x - dx / s;
      view.y = drag.view0.y - dy / s;
      applyView();
    });
    svg.addEventListener('pointerup', (ev) => {
      const wasDrag = drag && drag.moved;
      drag = null;
      if (!wasDrag) handleClick(ev);
    });
    svg.addEventListener('pointercancel', () => { drag = null; });
  }

  // ---------- game loop ----------
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  function scorePercent() {
    if (results.size === 0) return 100;
    let pts = 0;
    for (const a of results.values()) pts += POINTS[a];
    return Math.round((pts / results.size) * 100);
  }

  function startRound(ids) {
    clearTimeout(revealTimer);
    order = shuffle(ids);
    idx = 0;
    attempts = 0;
    results = new Map();
    locked = false;
    el.endPanel.hidden = true;
    const inRound = new Set(ids);
    for (const [id, shape] of shapeById) {
      shape.classList.remove('town--solved', 'town--solved-0', 'town--solved-1',
        'town--solved-2', 'town--missed', 'town--pulse', 'town--flash-wrong');
      shape.classList.toggle('town--inactive', !inRound.has(id));
      shape.querySelector('title')?.remove();
      const hit = hitById.get(id);
      if (hit) {
        hit.classList.toggle('town--inactive', !inRound.has(id));
        hit.querySelector('title')?.remove();
      }
    }
    startedAt = Date.now();
    clearInterval(timerId);
    timerId = setInterval(() => { el.timer.textContent = fmtTime(Date.now() - startedAt); }, 500);
    el.timer.textContent = '00:00';
    updateHud();
  }

  function updateHud() {
    el.promptName.textContent = nameById.get(order[idx]) ?? '';
    el.progress.textContent = `${Math.min(idx + 1, order.length)} / ${order.length}`;
    el.score.textContent = scorePercent() + '%';
    el.triesLeft.textContent = attempts === 0 ? '' :
      `${MAX_ATTEMPTS - attempts} ${MAX_ATTEMPTS - attempts === 1 ? 'try' : 'tries'} left`;
  }

  function addTip(shape, id) {
    const tip = document.createElementNS(SVG_NS, 'title');
    tip.textContent = nameById.get(id);
    // for lines, hovers land on the fat hit path, so the tooltip lives there
    (hitById.get(id) || shape).appendChild(tip);
  }

  function advance() {
    attempts = 0;
    idx++;
    if (idx >= order.length) return finishRound();
    updateHud();
  }

  function handleClick(ev) {
    if (locked || idx >= order.length) return;
    // pointer capture retargets pointerup to the svg, so hit-test by position
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const id = (hit instanceof SVGPathElement || hit instanceof SVGCircleElement)
      ? hit.dataset.id : undefined;
    if (!id || !order.includes(id)) return;
    if (results.has(id)) return;
    const want = order[idx];

    if (id === want) {
      results.set(id, attempts);
      const shape = shapeById.get(id);
      shape.classList.add('town--solved', `town--solved-${attempts}`);
      addTip(shape, id);
      advance();
      return;
    }

    // Wrong guess — name what was clicked so misses teach something
    attempts++;
    showWrongLabel(nameById.get(id), ev.clientX, ev.clientY);
    const shape = shapeById.get(id);
    shape.classList.remove('town--flash-wrong');
    void shape.getBoundingClientRect();
    shape.classList.add('town--flash-wrong');
    setTimeout(() => shape.classList.remove('town--flash-wrong'), 600);
    el.prompt.classList.remove('prompt--shake');
    void el.prompt.offsetWidth;
    el.prompt.classList.add('prompt--shake');

    if (attempts >= MAX_ATTEMPTS) {
      results.set(want, MAX_ATTEMPTS);
      const target = shapeById.get(want);
      target.classList.add('town--missed', 'town--pulse');
      addTip(target, want);
      locked = true;
      updateHud();
      revealTimer = setTimeout(() => {
        target.classList.remove('town--pulse');
        locked = false;
        advance();
      }, REVEAL_PAUSE_MS);
      return;
    }
    updateHud();
  }

  function showWrongLabel(name, clientX, clientY) {
    const main = el.wrongLabel.parentElement.getBoundingClientRect();
    el.wrongLabel.textContent = 'That was ' + name;
    el.wrongLabel.hidden = false;
    el.wrongLabel.classList.remove('wrong-label--show');
    void el.wrongLabel.getBoundingClientRect();
    el.wrongLabel.classList.add('wrong-label--show');
    const w = el.wrongLabel.offsetWidth;
    const x = Math.min(Math.max(clientX - main.left, w / 2 + 8), main.width - w / 2 - 8);
    const y = Math.max(clientY - main.top, 44);
    el.wrongLabel.style.left = x + 'px';
    el.wrongLabel.style.top = y + 'px';
    clearTimeout(wrongLabelTimer);
    wrongLabelTimer = setTimeout(() => { el.wrongLabel.hidden = true; }, 1600);
  }

  function finishRound() {
    clearInterval(timerId);
    const missed = order.filter((id) => results.get(id) === MAX_ATTEMPTS);
    const firstTry = order.filter((id) => results.get(id) === 0).length;
    el.endScore.textContent = scorePercent() + '%';
    el.endTime.textContent = fmtTime(Date.now() - startedAt);
    el.endBreakdown.textContent =
      `${firstTry} of ${order.length} on the first try · ${missed.length} revealed`;
    el.missedWrap.hidden = missed.length === 0;
    el.missedList.replaceChildren(...missed.map((id) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = nameById.get(id);
      return chip;
    }));
    el.btnRetryMissed.hidden = missed.length === 0;
    el.btnRetryMissed.textContent = `Retry the ${missed.length} you missed`;
    el.btnRetryMissed.onclick = () => startRound(missed);
    el.endPanel.hidden = false;
  }

  // ---------- public ----------
  window.Engine = {
    start(resolvedQuiz) {
      bindDom();
      this.stop();
      quiz = resolvedQuiz;
      el.quizTitle.textContent = quiz.title;
      el.quizSubtitle.textContent = quiz.subtitle || '';
      render();
      startRound(quiz.targetIds);
    },
    stop() {
      clearInterval(timerId);
      clearTimeout(revealTimer);
      clearTimeout(wrongLabelTimer);
      if (el) {
        el.endPanel.hidden = true;
        el.wrongLabel.hidden = true;
        el.map.replaceChildren();
      }
      quiz = null;
      order = [];
    },
  };
})();
