/*
 * Build the release bundles that tools/fetch-packs.mjs downloads.
 *
 *   node tools/release-packs.mjs            build tarballs into dist/release/
 *   node tools/release-packs.mjs --publish  also create/replace the GitHub release
 *
 * Splits data/packs into tiers so someone who only wants world quizzes pulls a
 * few MB instead of everything. Each tarball carries data/index-fragment.json —
 * just the index entries for its own packs — which fetch-packs merges.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'dist/release');
const TAG = process.env.MAPGAMES_TAG || 'data-' + new Date().toISOString().slice(0, 10);

const index = JSON.parse(fs.readFileSync(path.join(root, 'data/index.json'), 'utf8'));
const CITY_PREFIXES = ['neighborhoods/', 'osm-', 'zips/'];
// cities with full layer coverage also get a standalone bundle, so someone who
// only wants their own city pulls ~1MB instead of the 30MB city-layers tier
const SOLO_CITIES = new Set(JSON.parse(
  fs.readFileSync(path.join(root, 'tools/cities.json'), 'utf8')).map((c) => c.slug));

const cityOf = (id) =>
  CITY_PREFIXES.some((p) => id.startsWith(p)) ? id.slice(id.indexOf('/') + 1) : null;

// The four tiers are disjoint and cover everything; per-city bundles are an
// extra convenience copy of what's already inside city-layers.
function tierOf(id) {
  if (cityOf(id)) return 'city-layers';
  if (id.startsWith('us-')) return 'us';
  if (id === 'cities' || id.startsWith('geocities/')) return 'cities';
  if (id.startsWith('custom/')) return null; // user-authored, never shipped
  return 'world'; // world-countries, admin1/*, adm2/*
}

const bundles = {};
for (const [id, meta] of Object.entries(index.packs)) {
  const tier = tierOf(id);
  if (!tier) continue;
  (bundles[tier] ||= []).push([id, meta]);
  const city = cityOf(id);
  if (city && SOLO_CITIES.has(city)) (bundles['city-' + city] ||= []).push([id, meta]);
}

// menus each bundle needs, so the builder UI lists what was actually downloaded
function menusFor(bundle, packIds) {
  const m = {};
  const ids = new Set(packIds);
  const keep = (key, pred) => {
    const src = index.menus[key];
    if (Array.isArray(src)) {
      const v = src.filter(pred);
      if (v.length) m[key] = v;
    }
  };
  if (bundle === 'world') {
    m.continents = index.menus.continents;
    m.countries = index.menus.countries;
    keep('admin1Countries', (c) => ids.has('admin1/' + c.a3));
    keep('adm2Countries', (c) => ids.has('adm2/' + c.a3));
  } else if (bundle === 'us') {
    keep('usStates', (s) => ids.has('us-counties/' + s.st));
  } else if (bundle === 'cities') {
    keep('geocitiesCountries', (c) => ids.has('geocities/' + c.a3));
  } else if (bundle === 'city-layers' || bundle.startsWith('city-')) {
    const slugs = new Set(packIds.map(cityOf).filter(Boolean));
    keep('hoodCities', (c) => slugs.has(c.slug));
    keep('zipCities', (c) => slugs.has(c.slug));
    const layers = {};
    for (const [layer, cities] of Object.entries(index.menus.osmLayers || {})) {
      const hit = cities.filter((c) => slugs.has(c.slug));
      if (hit.length) layers[layer] = hit;
    }
    if (Object.keys(layers).length) m.osmLayers = layers;
  }
  return m;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const built = [];
for (const [bundle, entries] of Object.entries(bundles)) {
  const packIds = entries.map(([id]) => id);
  const fragment = {
    packs: Object.fromEntries(entries),
    menus: menusFor(bundle, packIds),
  };
  const fragPath = path.join(root, 'data/index-fragment.json');
  fs.writeFileSync(fragPath, JSON.stringify(fragment));

  const files = ['data/index-fragment.json',
    ...entries.map(([, meta]) => meta.path)];
  const listFile = path.join(OUT, bundle + '.files');
  fs.writeFileSync(listFile, files.join('\n') + '\n');

  const tgz = path.join(OUT, 'packs-' + bundle + '.tar.gz');
  execFileSync('tar', ['-czf', tgz, '-C', root, '-T', listFile]);
  fs.unlinkSync(listFile);
  fs.unlinkSync(fragPath);

  const mb = fs.statSync(tgz).size / 1e6;
  built.push({ bundle, packs: entries.length, mb });
}

fs.copyFileSync(path.join(root, 'data/groups.json'), path.join(OUT, 'groups.json'));

built.sort((a, b) => b.mb - a.mb);
for (const b of built.slice(0, 8)) {
  console.log(('packs-' + b.bundle).padEnd(30), String(b.packs).padStart(4), 'packs',
    b.mb.toFixed(1).padStart(7), 'MB');
}
const total = built.reduce((s, b) => s + b.mb, 0);
console.log(`${built.length} bundles, ${total.toFixed(0)} MB total → dist/release/`);

if (process.argv.includes('--publish')) {
  const assets = fs.readdirSync(OUT).map((f) => path.join(OUT, f));
  const exists = (() => {
    try {
      execFileSync('gh', ['release', 'view', TAG], { stdio: 'ignore' });
      return true;
    } catch { return false; }
  })();
  if (exists) {
    console.log('updating release', TAG);
    execFileSync('gh', ['release', 'upload', TAG, ...assets, '--clobber'],
      { stdio: 'inherit', cwd: root });
  } else {
    console.log('creating release', TAG);
    execFileSync('gh', ['release', 'create', TAG, ...assets,
      '--title', 'Quiz data ' + TAG.replace('data-', ''),
      '--notes', 'Prebuilt quiz packs. Download with `node tools/fetch-packs.mjs` ' +
        '(see DATA.md). Regenerate from source with `node tools/build-packs.mjs all`.'],
      { stdio: 'inherit', cwd: root });
  }
}
