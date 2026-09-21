/*
 * App shell: view routing, quiz library (presets + saved), and the builder.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SAVED_KEY = 'mapgames.saved';

  let index = null, groups = null, presets = [];

  // ---------- views ----------
  function showView(name) {
    for (const v of ['home', 'builder', 'play']) {
      $('view-' + v).hidden = v !== name;
    }
    document.body.classList.toggle('mode-play', name === 'play');
    if (name !== 'play') Engine.stop();
  }

  $('btn-home').addEventListener('click', () => { showView('home'); });
  $('btn-exit-play').addEventListener('click', () => { showView('home'); });
  $('btn-back-play').addEventListener('click', () => { showView('builder'); });
  $('btn-new-quiz').addEventListener('click', () => { showView('builder'); });

  // ---------- library ----------
  const loadSaved = () => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; }
    catch { return []; }
  };
  const storeSaved = (list) => {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  };

  function describeConfig(cfg) {
    const packMeta = index.packs[cfg.pack];
    const s = cfg.select || { mode: 'all' };
    const what = {
      all: 'all', independent: 'independent countries',
      top: 'top ' + (s.n || 20),
      topPop: 'top ' + (s.n || 20) + ' by population',
      minPop: 'population ≥ ' + Number(s.min || 0).toLocaleString(),
      group: s.group + ' members', capitals: 'capitals',
      manual: (s.ids?.length || s.names?.length || 0) + ' hand-picked',
    }[s.mode] || s.mode;
    return (packMeta ? packMeta.label : cfg.pack) + ' · ' + what;
  }

  function renderLibrary() {
    const grid = $('quiz-grid');
    grid.replaceChildren();
    const saved = loadSaved();
    const cards = [
      ...saved.map((cfg) => ({ cfg, custom: true })),
      ...presets.map((cfg) => ({ cfg, custom: false })),
    ];
    for (const { cfg, custom } of cards) {
      const card = document.createElement('button');
      card.className = 'quiz-card';
      card.innerHTML = '<span class="quiz-card-title"></span><span class="quiz-card-meta"></span>';
      card.querySelector('.quiz-card-title').textContent = cfg.title;
      card.querySelector('.quiz-card-meta').textContent = describeConfig(cfg);
      card.addEventListener('click', () => play(cfg));
      if (custom) {
        const del = document.createElement('span');
        del.className = 'quiz-card-del';
        del.textContent = '×';
        del.title = 'Delete this saved quiz';
        del.addEventListener('click', (ev) => {
          ev.stopPropagation();
          storeSaved(loadSaved().filter((c) => c.id !== cfg.id));
          renderLibrary();
        });
        card.appendChild(del);
      }
      grid.appendChild(card);
    }
  }

  // where this quiz was launched from, so leaving it returns you there
  let playedFrom = 'home';

  async function play(cfg, from) {
    try {
      const quiz = await Data.resolveQuiz(cfg);
      playedFrom = from || 'home';
      $('btn-back-play').hidden = playedFrom !== 'builder';
      showView('play');
      Engine.start(quiz);
    } catch (err) {
      flashError(err.message);
    }
  }

  function flashError(msg) {
    const bar = $('error-bar');
    bar.textContent = msg;
    bar.hidden = false;
    clearTimeout(flashError.t);
    flashError.t = setTimeout(() => { bar.hidden = true; }, 5000);
  }

  // ---------- builder ----------
  const b = {
    cats: $('b-cats'), dataset: $('b-dataset'), scope: $('b-scope'), scopeLabel: $('b-scope-label'),
    mode: $('b-mode'), n: $('b-n'), min: $('b-min'), group: $('b-group'),
    detail: $('b-detail'), detailWrap: $('b-detail-wrap'),
    detailNote: $('b-detail-note'), detailScale: document.querySelector('.detail-scale'),
    nWrap: $('b-n-wrap'), minWrap: $('b-min-wrap'), groupWrap: $('b-group-wrap'),
    manualWrap: $('b-manual-wrap'), manualSearch: $('b-manual-search'),
    manualList: $('b-manual-list'), title: $('b-title'), preview: $('b-preview'),
    play: $('b-play'), save: $('b-save'),
  };

  /*
   * One row per dataset: which category tab it lives under, what its region
   * picker means, and which target modes make sense for it. Modes are the
   * source of truth for the form — a field only appears if the chosen mode
   * uses it, so population never shows up for transit lines and membership
   * groups never show up for cities.
   */
  const DATASETS = [
    { id: 'world-countries', cat: 'world', label: 'Countries', scope: 'continent',
      modes: ['detail', 'independent', 'top', 'minPop', 'group', 'manual'],
      detail: { quick: 12, standard: 60 } },
    { id: 'admin1', cat: 'world', label: 'States & provinces', scope: 'country-admin1',
      modes: ['all', 'manual'] },
    { id: 'adm2', cat: 'world', label: 'Counties & districts', scope: 'country-adm2',
      modes: ['all', 'manual'] },
    { id: 'cities', cat: 'world', label: 'Major cities', scope: 'cities',
      modes: ['detail', 'top', 'capitals', 'minPop', 'manual'],
      detail: { quick: 10, standard: 40 } },
    { id: 'geocities', cat: 'world', label: 'All cities of one country',
      scope: 'country-geocities', modes: ['detail', 'top', 'minPop', 'manual'],
      detail: { quick: 10, standard: 30 } },

    { id: 'us-counties', cat: 'us', label: 'Counties', scope: 'us-state',
      modes: ['detail', 'top', 'minPop', 'manual'], detail: { quick: 10, standard: 45 } },
    { id: 'us-townships', cat: 'us', label: 'Townships & municipalities', scope: 'us-state',
      modes: ['detail', 'top', 'minPop', 'manual'], detail: { quick: 10, standard: 40 } },
    { id: 'us-places', cat: 'us', label: 'Cities & towns', scope: 'us-state',
      modes: ['detail', 'top', 'minPop', 'manual'], detail: { quick: 10, standard: 40 } },
    { id: 'us-school-districts', cat: 'us', label: 'School districts', scope: 'us-state',
      modes: ['all', 'manual'] },

    { id: 'neighborhoods', cat: 'city', label: 'Neighborhoods', scope: 'hood-city',
      modes: ['all', 'manual'] },
    { id: 'osm-transit-lines', cat: 'city', label: 'Transit lines', scope: 'osm:transit-lines',
      modes: ['detail', 'top', 'manual'], detail: { quick: 5, standard: 12 } },
    { id: 'osm-transit-stations', cat: 'city', label: 'Transit stations',
      scope: 'osm:transit-stations', modes: ['detail', 'top', 'manual'],
      detail: { quick: 10, standard: 30 } },
    { id: 'osm-major-roads', cat: 'city', label: 'Major roads & highways',
      scope: 'osm:major-roads', modes: ['detail', 'top', 'manual'],
      detail: { quick: 6, standard: 15 } },
    { id: 'osm-landmarks', cat: 'city', label: 'Landmarks & museums', scope: 'osm:landmarks',
      modes: ['detail', 'top', 'manual'], detail: { quick: 8, standard: 25 } },
    { id: 'osm-parks', cat: 'city', label: 'Parks & gardens', scope: 'osm:parks',
      modes: ['detail', 'top', 'manual'], detail: { quick: 6, standard: 18 } },
    { id: 'osm-waterways', cat: 'city', label: 'Rivers & canals', scope: 'osm:waterways',
      modes: ['detail', 'top', 'manual'], detail: { quick: 4, standard: 10 } },
    { id: 'osm-trails', cat: 'city', label: 'Trails & bike routes', scope: 'osm:trails',
      modes: ['detail', 'top', 'manual'], detail: { quick: 5, standard: 12 } },
    { id: 'zips', cat: 'city', label: 'ZIP codes', scope: 'zip-city',
      modes: ['all', 'manual'] },

    { id: 'custom', cat: 'custom', label: 'Your own packs', scope: 'custom',
      modes: ['all', 'detail', 'top', 'minPop', 'manual'],
      detail: { quick: 10, standard: 30 } },
  ];

  // the three rungs of the detail slider
  const LEVELS = ['quick', 'standard', 'all'];
  const LEVEL_LABELS = { quick: 'Quick', standard: 'Standard', all: 'Everything' };

  const CATEGORIES = [
    { id: 'world', label: 'World' },
    { id: 'us', label: 'United States' },
    { id: 'city', label: 'City layers' },
    { id: 'custom', label: 'Custom' },
  ];

  const MODE_LABELS = {
    detail: 'Level of detail',
    all: 'Everything in the region',
    independent: 'Independent countries',
    top: 'Top N by population',            // relabelled per dataset below
    minPop: 'Population at least…',
    group: 'Members of a group',
    capitals: 'Capitals only',
    manual: 'Pick manually',
  };
  // datasets with no population: "top" ranks by prominence instead
  const POP_DATASETS = new Set(['world-countries', 'cities', 'geocities',
    'us-counties', 'us-townships', 'us-places', 'custom']);
  const modeLabel = (mode, dsId) =>
    mode === 'top' && !POP_DATASETS.has(dsId)
      ? 'Top N most prominent' : MODE_LABELS[mode];

  const opt = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  };

  let activeCat = 'world';

  function initBuilder() {
    b.cats.replaceChildren(...CATEGORIES.map((c) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'cat-tab';
      tab.role = 'tab';
      tab.textContent = c.label;
      tab.addEventListener('click', () => {
        activeCat = c.id;
        refreshCategory();
      });
      tab.dataset.cat = c.id;
      return tab;
    }));
    b.group.replaceChildren(...Object.keys(groups).map((g) => opt(g, g)));
    b.dataset.addEventListener('change', refreshBuilder);
    b.scope.addEventListener('change', () => { refreshModes(true); });
    b.mode.addEventListener('change', () => refreshFilterInputs());
    for (const input of [b.n, b.min, b.group]) {
      input.addEventListener('change', updatePreview);
    }
    b.detail.addEventListener('input', () => { markDetailScale(); updatePreview(); });
    b.manualSearch.addEventListener('input', filterManualList);
    b.play.addEventListener('click', () => play(currentConfig(), 'builder'));
    b.save.addEventListener('click', () => {
      const cfg = currentConfig();
      cfg.id = 'custom-' + Date.now();
      storeSaved([cfg, ...loadSaved()]);
      renderLibrary();
      showView('home');
    });
    refreshCategory();
  }

  const datasetsIn = (cat) => DATASETS.filter((d) => d.cat === cat);
  const currentDataset = () =>
    DATASETS.find((d) => d.id === b.dataset.value) || datasetsIn(activeCat)[0];

  function refreshCategory() {
    for (const tab of b.cats.children) {
      tab.setAttribute('aria-selected', String(tab.dataset.cat === activeCat));
    }
    b.dataset.replaceChildren(...datasetsIn(activeCat).map((d) => opt(d.id, d.label)));
    refreshBuilder();
  }

  function refreshBuilder() {
    const ds = currentDataset();
    const kind = ds.scope;
    b.scopeLabel.textContent = {
      continent: 'Region', 'country-admin1': 'Country', 'country-adm2': 'Country',
      'us-state': 'State', cities: 'Region', 'country-geocities': 'Country',
      'hood-city': 'City', custom: 'Pack', 'zip-city': 'City',
    }[kind] || (kind.startsWith('osm:') ? 'City' : 'Region');

    const options = [];
    if (kind === 'continent') {
      options.push(opt('', 'Whole world'));
      for (const c of index.menus.continents) options.push(opt('continent:' + c, c));
    } else if (kind === 'country-admin1') {
      for (const c of index.menus.admin1Countries) options.push(opt(c.a3, c.name));
    } else if (kind === 'country-adm2') {
      for (const c of index.menus.adm2Countries || []) options.push(opt(c.a3, c.name));
    } else if (kind === 'country-geocities') {
      for (const c of index.menus.geocitiesCountries || []) options.push(opt(c.a3, c.name));
    } else if (kind === 'hood-city') {
      for (const c of index.menus.hoodCities || []) options.push(opt(c.slug, c.label));
    } else if (kind === 'custom') {
      for (const c of index.menus.customPacks || []) options.push(opt(c.slug, c.label));
      if (!options.length) {
        options.push(opt('', 'None yet — see DATA.md → "Bring your own data"'));
      }
    } else if (kind.startsWith('osm:')) {
      const cities = (index.menus.osmLayers || {})[kind.slice(4)] || [];
      for (const c of cities) options.push(opt(c.slug, c.label));
    } else if (kind === 'zip-city') {
      for (const c of index.menus.zipCities || []) options.push(opt(c.slug, c.label));
    } else if (kind === 'us-state') {
      for (const s of index.menus.usStates) options.push(opt(s.st, s.name));
    } else if (kind === 'cities') {
      options.push(opt('', 'Whole world'));
      for (const c of index.menus.continents) options.push(opt('continent:' + c, c));
      for (const c of index.menus.countries) options.push(opt('country:' + c.a3, c.name));
    }
    b.scope.replaceChildren(...options);
    b.scope.parentElement.hidden = options.length <= 1 && !options[0]?.value;
    if (kind === 'us-state') b.scope.value = 'MA';
    refreshModes(false);
  }

  function refreshModes(keepMode) {
    const ds = currentDataset();
    const prev = b.mode.value;
    b.mode.replaceChildren(...ds.modes.map((m) => opt(m, modeLabel(m, ds.id))));
    if (keepMode && ds.modes.includes(prev)) b.mode.value = prev;
    refreshFilterInputs();
  }

  function markDetailScale() {
    const v = b.detail.value;
    for (const span of b.detailScale.children) {
      span.dataset.active = String(span.dataset.lv === v);
    }
  }

  async function refreshFilterInputs() {
    const mode = b.mode.value;
    b.detailWrap.hidden = mode !== 'detail';
    if (mode === 'detail') markDetailScale();
    b.nWrap.hidden = mode !== 'top';
    b.minWrap.hidden = mode !== 'minPop';
    b.groupWrap.hidden = mode !== 'group';
    b.manualWrap.hidden = mode !== 'manual';
    if (mode === 'manual') await renderManualList();
    updatePreview();
  }

  function currentConfig() {
    const ds = currentDataset();
    let pack = ds.id, scope;
    const sv = b.scope.value;
    if (['admin1', 'adm2', 'neighborhoods', 'custom', 'zips'].includes(ds.id) ||
        ds.id.startsWith('osm-')) {
      pack = ds.id + '/' + sv;
    } else if (ds.id === 'geocities') {
      pack = 'geocities/' + sv;
      scope = { country: sv };
    } else if (ds.id.startsWith('us-')) {
      pack = ds.id + '/' + sv;
    } else if (sv.startsWith('continent:')) {
      scope = { continent: sv.slice(10) };
    } else if (sv.startsWith('country:')) {
      scope = { country: sv.slice(8) };
    }

    const mode = b.mode.value;
    const select = { mode };
    if (mode === 'detail') {
      const level = LEVELS[+b.detail.value] || 'standard';
      select.level = level;
      // resolve the level to a count here: the dataset knows what "quick" means
      // for it, and the saved config stays self-describing
      if (level !== 'all') select.n = (ds.detail || { quick: 10, standard: 30 })[level];
    }
    if (mode === 'top') select.n = Math.max(2, +b.n.value || 20);
    if (mode === 'minPop') select.min = +b.min.value || 0;
    if (mode === 'group') select.group = b.group.value;
    if (mode === 'manual') {
      select.ids = [...b.manualList.querySelectorAll('input:checked')].map((i) => i.value);
    }
    const cfg = { title: b.title.value.trim() || suggestTitle(), pack, select };
    if (scope) cfg.scope = scope;
    return cfg;
  }

  function suggestTitle() {
    const ds = currentDataset();
    const scopeLabel = b.scope.parentElement.hidden
      ? '' : (b.scope.selectedOptions[0]?.textContent || '');
    const mode = b.mode.value;
    if (mode === 'detail') {
      const level = LEVELS[+b.detail.value] || 'standard';
      const noun = ds.label.toLowerCase();
      if (level === 'quick') return (scopeLabel ? scopeLabel + ': ' : '') + 'essential ' + noun;
      if (level === 'all') {
        return scopeLabel ? scopeLabel + ': all ' + noun : 'All ' + noun;
      }
      return (scopeLabel ? scopeLabel + ' — ' : '') + ds.label;
    }
    if (mode === 'top') {
      return (scopeLabel ? scopeLabel + ': ' : '') + 'top ' + (+b.n.value || 20) +
        ' ' + ds.label.toLowerCase();
    }
    if (mode === 'group') return b.group.value + ' members';
    if (mode === 'capitals') return 'Capitals — ' + (scopeLabel || 'World');
    return (scopeLabel ? scopeLabel + ' — ' : '') + ds.label;
  }

  let previewSeq = 0;
  async function updatePreview() {
    const seq = ++previewSeq;
    b.title.placeholder = suggestTitle();
    b.preview.textContent = 'Counting…';
    try {
      const quiz = await Data.resolveQuiz(currentConfig());
      if (seq !== previewSeq) return;
      if (b.mode.value === 'detail') {
        const level = LEVELS[+b.detail.value] || 'standard';
        b.detailNote.textContent = level === 'all'
          ? 'Everything in this dataset — ' + quiz.targetIds.length + ' to find.'
          : LEVEL_LABELS[level] + ' — the ' + quiz.targetIds.length +
            ' most prominent' + (quiz.kind === 'point' ? '' : ' of them') + '.';
      }
      b.preview.textContent = quiz.targetIds.length + ' targets' + {
        polygon: ' on a map of ' + quiz.features.length + ' regions',
        line: ' — lines on the map',
        point: ' (map pins)',
      }[quiz.kind];
      b.play.disabled = b.save.disabled = false;
    } catch (err) {
      if (seq !== previewSeq) return;
      b.preview.textContent = err.message;
      b.play.disabled = b.save.disabled = true;
    }
  }

  async function renderManualList() {
    b.manualList.textContent = 'Loading…';
    const cfg = currentConfig();
    try {
      const pack = await Data.loadPack(cfg.pack);
      let feats = pack.features;
      if (cfg.scope) {
        feats = feats.filter((f) =>
          (cfg.scope.continent ? f.continent === cfg.scope.continent : true) &&
          (cfg.scope.country ? f.country === cfg.scope.country : true));
      }
      feats = [...feats].sort((a, c) => (c.pop ?? 0) - (a.pop ?? 0));
      b.manualList.replaceChildren(...feats.slice(0, 2000).map((f) => {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = f.id;
        cb.addEventListener('change', updatePreview);
        label.append(cb, ' ' + f.name + (f.pop ? ' (' + f.pop.toLocaleString() + ')' : ''));
        return label;
      }));
    } catch (err) {
      b.manualList.textContent = err.message;
    }
  }

  function filterManualList() {
    const q = b.manualSearch.value.toLowerCase();
    for (const label of b.manualList.children) {
      label.hidden = q !== '' && !label.textContent.toLowerCase().includes(q);
    }
  }

  // ---------- boot ----------
  (async () => {
    try {
      [index, groups, presets] = await Promise.all([
        Data.loadIndex(), Data.loadGroups(),
        fetch('data/presets.json').then((r) => r.json())
          .catch(() => self.__MAPGAMES_INLINE__?.['data/presets.json'] || []),
      ]);
      initBuilder();
      renderLibrary();
      for (const chip of document.querySelectorAll('.play-chip[data-play]')) {
        chip.addEventListener('click', () => {
          const cfg = presets.find((p) => p.id === chip.dataset.play);
          if (cfg) play(cfg);
        });
      }
      const deepLink = new URLSearchParams(location.search).get('play');
      const cfg = deepLink && presets.find((p) => p.id === deepLink);
      if (cfg) play(cfg);
      else showView('home');
    } catch (err) {
      flashError('Could not load quiz data. Run "node tools/serve.mjs" and open ' +
        'http://localhost:8017 — pack files cannot be fetched from file:// URLs. (' +
        err.message + ')');
    }
  })();
})();
