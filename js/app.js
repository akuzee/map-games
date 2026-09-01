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
  $('btn-new-quiz').addEventListener('click', () => { showView('builder'); refreshBuilder(); });

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

  async function play(cfg) {
    try {
      const quiz = await Data.resolveQuiz(cfg);
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
    dataset: $('b-dataset'), scope: $('b-scope'), scopeLabel: $('b-scope-label'),
    mode: $('b-mode'), n: $('b-n'), min: $('b-min'), group: $('b-group'),
    nWrap: $('b-n-wrap'), minWrap: $('b-min-wrap'), groupWrap: $('b-group-wrap'),
    manualWrap: $('b-manual-wrap'), manualSearch: $('b-manual-search'),
    manualList: $('b-manual-list'), title: $('b-title'), preview: $('b-preview'),
    play: $('b-play'), save: $('b-save'),
  };

  const DATASETS = [
    { id: 'world-countries', label: 'Countries of the world', scope: 'continent', group: 'World' },
    { id: 'admin1', label: 'States / provinces of a country', scope: 'country-admin1', group: 'World' },
    { id: 'adm2', label: 'Counties / districts of a country', scope: 'country-adm2', group: 'World' },
    { id: 'cities', label: 'Major world cities (map pins)', scope: 'cities', group: 'World' },
    { id: 'geocities', label: 'All cities of a country (map pins)', scope: 'country-geocities', group: 'World' },
    { id: 'us-counties', label: 'Counties (by state)', scope: 'us-state', group: 'United States' },
    { id: 'us-townships', label: 'Townships & municipalities (by state)', scope: 'us-state', group: 'United States' },
    { id: 'us-places', label: 'Cities & towns (by state)', scope: 'us-state', group: 'United States' },
    { id: 'us-school-districts', label: 'School districts (by state)', scope: 'us-state', group: 'United States' },
    { id: 'neighborhoods', label: 'Neighborhoods', scope: 'hood-city', group: 'City layers' },
    { id: 'osm-transit-lines', label: 'Transit lines', scope: 'osm:transit-lines', group: 'City layers' },
    { id: 'osm-transit-stations', label: 'Transit stations', scope: 'osm:transit-stations', group: 'City layers' },
    { id: 'osm-major-roads', label: 'Major roads & highways', scope: 'osm:major-roads', group: 'City layers' },
    { id: 'osm-waterways', label: 'Rivers & canals', scope: 'osm:waterways', group: 'City layers' },
    { id: 'osm-trails', label: 'Trails & bike routes', scope: 'osm:trails', group: 'City layers' },
    { id: 'osm-parks', label: 'Parks & gardens', scope: 'osm:parks', group: 'City layers' },
    { id: 'osm-landmarks', label: 'Landmarks & museums', scope: 'osm:landmarks', group: 'City layers' },
    { id: 'zips', label: 'ZIP codes (city area)', scope: 'zip-city', group: 'City layers' },
    { id: 'custom', label: 'Custom packs', scope: 'custom', group: 'Custom' },
  ];

  // which target modes make sense per dataset (population data isn't everywhere)
  const MODES = {
    'world-countries': ['independent', 'all', 'topPop', 'minPop', 'group', 'manual'],
    'admin1': ['all', 'manual'],
    'adm2': ['all', 'manual'],
    'us-counties': ['all', 'topPop', 'minPop', 'manual'],
    'us-townships': ['topPop', 'minPop', 'all', 'manual'],
    'us-places': ['topPop', 'minPop', 'all', 'manual'],
    'cities': ['topPop', 'capitals', 'minPop', 'manual'],
    'geocities': ['topPop', 'minPop', 'manual'],
    'neighborhoods': ['all', 'manual'],
    'custom': ['all', 'topPop', 'minPop', 'manual'],
    'us-school-districts': ['all', 'manual'],
    'zips': ['all', 'manual'],
    'osm-transit-lines': ['all', 'manual'],
    'osm-transit-stations': ['all', 'manual'],
    'osm-major-roads': ['all', 'manual'],
    'osm-waterways': ['all', 'manual'],
    'osm-trails': ['all', 'manual'],
    'osm-parks': ['all', 'manual'],
    'osm-landmarks': ['all', 'manual'],
  };
  const MODE_LABELS = {
    all: 'Everything in the region', independent: 'Independent countries',
    topPop: 'Top N by population', minPop: 'Population at least…',
    group: 'Members of a group', capitals: 'Capitals only', manual: 'Pick manually',
  };

  const opt = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  };

  function initBuilder() {
    const dsGroups = new Map(); // careful: `groups` (memberships) is in scope
    for (const d of DATASETS) {
      if (!dsGroups.has(d.group)) {
        const og = document.createElement('optgroup');
        og.label = d.group;
        dsGroups.set(d.group, og);
      }
      dsGroups.get(d.group).appendChild(opt(d.id, d.label));
    }
    b.dataset.replaceChildren(...dsGroups.values());
    b.group.replaceChildren(...Object.keys(groups).map((g) => opt(g, g)));
    b.dataset.addEventListener('change', refreshBuilder);
    b.scope.addEventListener('change', () => refreshModes(true));
    b.mode.addEventListener('change', () => refreshFilterInputs(true));
    for (const input of [b.n, b.min, b.group]) {
      input.addEventListener('change', updatePreview);
    }
    b.manualSearch.addEventListener('input', filterManualList);
    b.play.addEventListener('click', () => play(currentConfig()));
    b.save.addEventListener('click', () => {
      const cfg = currentConfig();
      cfg.id = 'custom-' + Date.now();
      storeSaved([cfg, ...loadSaved()]);
      renderLibrary();
      showView('home');
    });
  }

  function refreshBuilder() {
    const ds = DATASETS.find((d) => d.id === b.dataset.value) || DATASETS[0];
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
    if (kind === 'us-state') b.scope.value = 'MA';
    refreshModes(false);
  }

  function refreshModes(fromUser) {
    const modes = MODES[b.dataset.value];
    const prev = b.mode.value;
    b.mode.replaceChildren(...modes.map((m) => opt(m, MODE_LABELS[m])));
    if (fromUser && modes.includes(prev)) b.mode.value = prev;
    refreshFilterInputs(false);
  }

  async function refreshFilterInputs() {
    const mode = b.mode.value;
    b.nWrap.hidden = mode !== 'topPop';
    b.minWrap.hidden = mode !== 'minPop';
    b.groupWrap.hidden = mode !== 'group';
    b.manualWrap.hidden = mode !== 'manual';
    if (mode === 'manual') await renderManualList();
    updatePreview();
  }

  function currentConfig() {
    const ds = b.dataset.value;
    let pack = ds, scope;
    const sv = b.scope.value;
    if (ds === 'admin1' || ds === 'adm2' || ds === 'neighborhoods' || ds === 'custom' ||
        ds === 'zips' || ds.startsWith('osm-')) {
      pack = ds + '/' + sv;
    }
    else if (ds === 'geocities') { pack = 'geocities/' + sv; scope = { country: sv }; }
    else if (ds.startsWith('us-')) pack = ds + '/' + sv;
    else if (sv.startsWith('continent:')) scope = { continent: sv.slice(10) };
    else if (sv.startsWith('country:')) scope = { country: sv.slice(8) };

    const mode = b.mode.value;
    const select = { mode };
    if (mode === 'topPop') select.n = Math.max(2, +b.n.value || 20);
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
    const dsLabel = DATASETS.find((d) => d.id === b.dataset.value).label;
    const scopeLabel = b.scope.selectedOptions[0]?.textContent || '';
    const modeLabel = MODE_LABELS[b.mode.value];
    if (b.mode.value === 'topPop') {
      return scopeLabel + ': top ' + (+b.n.value || 20) + ' by population';
    }
    if (b.mode.value === 'group') return b.group.value + ' members';
    if (b.mode.value === 'capitals') return 'Capitals — ' + (scopeLabel || 'World');
    return (scopeLabel ? scopeLabel + ' — ' : '') + dsLabel + ' (' + modeLabel + ')';
  }

  let previewSeq = 0;
  async function updatePreview() {
    const seq = ++previewSeq;
    b.title.placeholder = suggestTitle();
    b.preview.textContent = 'Counting…';
    try {
      const quiz = await Data.resolveQuiz(currentConfig());
      if (seq !== previewSeq) return;
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
      refreshBuilder();
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
