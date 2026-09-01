/*
 * Bundles the app + a curated subset of data packs into one self-contained
 * file (dist/map-games.html) for publishing as a Claude artifact. The
 * artifact host supplies the doctype/head/body skeleton.
 *
 * Packs not in INLINE_PACKS show a friendly "not included in this bundle"
 * error in the artifact; the full local app serves everything.
 *
 * Usage: node tools/build-artifact.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const INLINE_PACKS = [
  'world-countries',
  'cities',
  ...fs.readdirSync(path.join(root, 'data/packs/admin1'))
    .map((f) => 'admin1/' + f.replace('.json', '')),
  ...fs.readdirSync(path.join(root, 'data/packs/us-counties'))
    .map((f) => 'us-counties/' + f.replace('.json', '')),
  'us-townships/MA',
  'us-places/MA',
  'geocities/FRA',
  'osm-transit-lines/boston', 'osm-transit-stations/boston', 'osm-major-roads/boston',
  'osm-waterways/boston', 'osm-parks/boston', 'osm-landmarks/boston',
  'osm-transit-lines/new-york', 'zips/boston', 'us-school-districts/MA',
  // neighborhood starter set (the full local app has ~200 cities)
  'neighborhoods/boston', 'neighborhoods/new-york', 'neighborhoods/chicago',
  'neighborhoods/san-francisco', 'neighborhoods/los-angeles', 'neighborhoods/seattle',
  'neighborhoods/philadelphia', 'neighborhoods/washington', 'neighborhoods/washington-dc',
].filter((id) => fs.existsSync(path.join(root, 'data/packs', id + '.json')));

const inline = {
  'data/index.json': JSON.parse(read('data/index.json')),
  'data/groups.json': JSON.parse(read('data/groups.json')),
  'data/presets.json': JSON.parse(read('data/presets.json')),
};
for (const id of INLINE_PACKS) {
  inline['data/packs/' + id + '.json'] = JSON.parse(read('data/packs/' + id + '.json'));
}

const html = read('index.html');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/\s*<script src="[^"]+"><\/script>/g, '');
const fontsLink = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];

const out = [
  '<title>Map Games</title>',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  fontsLink,
  '<style>\n' + read('css/styles.css') + '\n</style>',
  body,
  '<script>window.__MAPGAMES_INLINE__ = ' + JSON.stringify(inline) + '</script>',
  ...['js/geo.js', 'js/data.js', 'js/engine.js', 'js/app.js']
    .map((f) => '<script>\n' + read(f) + '\n</script>'),
].join('\n');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/map-games.html'), out);
console.log('wrote dist/map-games.html —', (out.length / 1024 / 1024).toFixed(1) + 'MB,',
  INLINE_PACKS.length, 'packs inlined');
