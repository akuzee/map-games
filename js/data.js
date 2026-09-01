/*
 * Pack loading + quiz resolution. A quiz *config* is small and declarative
 * (this is what presets and saved quizzes store); resolveQuiz() turns it into
 * the resolved quiz the engine renders.
 *
 * Config:
 *   {
 *     title, subtitle?,
 *     pack: 'world-countries' | 'admin1/JPN' | 'us-counties/MA' |
 *           'us-townships/MA' | 'us-places/MA' | 'cities',
 *     scope?: { continent? | country? | counties?: [names] },
 *     select: { mode: 'all'|'topPop'|'minPop'|'group'|'capitals'|'manual',
 *               n?, min?, group?, ids?, names? },
 *     context?: 'auto'          // point quizzes: draw country/continent under pins
 *   }
 */
(function (root) {
  'use strict';

  const cache = new Map();

  async function loadJSON(relPath) {
    // Single-file (artifact) builds preload packs onto window
    const inline = root.__MAPGAMES_INLINE__;
    if (inline && inline[relPath]) return inline[relPath];
    if (cache.has(relPath)) return cache.get(relPath);
    const res = await fetch(relPath);
    if (!res.ok) {
      throw new Error(relPath.includes('packs/')
        ? 'This dataset is not included in this bundle: ' + relPath
        : 'Failed to load ' + relPath + ' (' + res.status + ')');
    }
    const json = await res.json();
    cache.set(relPath, json);
    return json;
  }

  const loadIndex = () => loadJSON('data/index.json');
  const loadGroups = () => loadJSON('data/groups.json');
  const loadPack = (id) => loadJSON('data/packs/' + id + '.json');

  function applyScope(features, scope) {
    if (!scope) return features;
    return features.filter((f) =>
      (scope.continent ? f.continent === scope.continent : true) &&
      (scope.country ? f.country === scope.country : true) &&
      (scope.counties ? scope.counties.includes(f.county) : true)
    );
  }

  async function selectTargets(features, select) {
    const s = select || { mode: 'all' };
    switch (s.mode) {
      case 'all':
        return features;
      case 'topPop':
        return features.filter((f) => f.pop != null)
          .sort((a, b) => b.pop - a.pop).slice(0, s.n || 20);
      case 'minPop':
        return features.filter((f) => (f.pop ?? 0) >= (s.min || 0));
      case 'group': {
        const groups = await loadGroups();
        const ids = new Set(groups[s.group] || []);
        return features.filter((f) => ids.has(f.id));
      }
      case 'capitals':
        return features.filter((f) => f.capital);
      case 'independent':
        return features.filter((f) => f.type === 'Sovereign country' || f.type === 'Country');
      case 'manual': {
        const ids = new Set(s.ids || []);
        const names = new Set(s.names || []);
        return features.filter((f) => ids.has(f.id) || names.has(f.name));
      }
      default:
        throw new Error('Unknown select mode: ' + s.mode);
    }
  }

  async function resolveContext(config, index) {
    // Backdrop polygons for point quizzes: the country's admin-1 divisions if
    // we have them, else the country/continent outlines.
    const scope = config.scope || {};
    if (scope.country && index.packs['admin1/' + scope.country]) {
      try {
        return (await loadPack('admin1/' + scope.country)).features;
      } catch { /* pack not in this bundle — fall through to countries */ }
    }
    const world = await loadPack('world-countries');
    if (scope.country) return world.features.filter((f) => f.id === scope.country);
    if (scope.continent) return world.features.filter((f) => f.continent === scope.continent);
    return world.features;
  }

  async function resolveQuiz(config) {
    const index = await loadIndex();
    const pack = await loadPack(config.pack);
    const scoped = applyScope(pack.features, config.scope);
    const targets = await selectTargets(scoped, config.select);
    if (targets.length < 2) {
      throw new Error('This quiz would have ' + targets.length +
        ' target(s) — need at least 2. Loosen the filters.');
    }
    const isPoint = pack.kind === 'point';
    return {
      title: config.title,
      subtitle: config.subtitle ||
        targets.length + ' to find' + (isPoint ? '' : ' of ' + scoped.length + ' shown'),
      kind: pack.kind,
      // point quizzes render only the targets (pins); polygon quizzes render
      // the whole scoped region with non-targets muted
      features: isPoint ? targets : scoped,
      targetIds: targets.map((f) => f.id),
      // packs may carry their own backdrop (city quizzes: surrounding counties);
      // otherwise point quizzes get country/admin-1 outlines
      context: pack.context || (isPoint ? await resolveContext(config, index) : []),
      bounds: config.bounds,
    };
  }

  root.Data = { loadIndex, loadGroups, loadPack, resolveQuiz };
})(typeof self !== 'undefined' ? self : this);
