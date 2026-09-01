/*
 * Turn any GeoJSON of named polygons or points into a quiz pack.
 *
 *   node tools/add-pack.mjs <file.geojson> --id <slug> --label "Shown in menus" \
 *     --name-prop NAME [--id-prop GEOID] [--pop-prop POP]
 *
 * Writes data/packs/custom/<slug>.json and registers it in data/index.json
 * (menu: builder → "Custom packs"). Custom packs survive pipeline re-runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const id = flag('id');
const label = flag('label');
const nameProp = flag('name-prop') || 'name';
const idProp = flag('id-prop');
const popProp = flag('pop-prop');

if (!file || !id || !label) {
  console.error('usage: node tools/add-pack.mjs <file.geojson> --id <slug> --label "…" ' +
    '--name-prop NAME [--id-prop GEOID] [--pop-prop POP]');
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(id)) {
  console.error('--id must be a lowercase slug (a-z, 0-9, hyphens)');
  process.exit(1);
}

const gj = JSON.parse(fs.readFileSync(file, 'utf8'));
const raw = gj.type === 'FeatureCollection' ? gj.features : [gj];

const seen = new Set();
const features = raw
  .filter((f) => f?.geometry && f.properties?.[nameProp] != null)
  .map((f, i) => {
    const base = {
      id: String(idProp ? f.properties[idProp] : i),
      name: String(f.properties[nameProp]),
      pop: popProp ? (Number(f.properties[popProp]) || null) : null,
    };
    if (f.geometry.type === 'Point') {
      return { ...base, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    }
    if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
      return { ...base, geometry: f.geometry };
    }
    return null;
  })
  .filter(Boolean)
  .filter((f) => !seen.has(f.name) && seen.add(f.name))
  .sort((a, b) => a.name.localeCompare(b.name));

if (features.length < 2) {
  console.error('Found only ' + features.length + ' usable feature(s). Need named ' +
    'Polygon/MultiPolygon or Point features; check --name-prop (available props on the ' +
    'first feature: ' + Object.keys(raw[0]?.properties || {}).join(', ') + ')');
  process.exit(1);
}
const kind = features[0].geometry ? 'polygon' : 'point';

const packRel = path.join('data', 'packs', 'custom', id + '.json');
fs.mkdirSync(path.join(root, 'data', 'packs', 'custom'), { recursive: true });
fs.writeFileSync(path.join(root, packRel), JSON.stringify({ kind, features }));

const indexPath = path.join(root, 'data', 'index.json');
const index = fs.existsSync(indexPath)
  ? JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  : { packs: {}, menus: {} };
index.packs['custom/' + id] = {
  kind, level: 'custom', label, path: 'data/packs/custom/' + id + '.json',
  count: features.length,
};
index.menus.customPacks = (index.menus.customPacks || [])
  .filter((c) => c.slug !== id)
  .concat({ slug: id, label, count: features.length })
  .sort((a, b) => a.label.localeCompare(b.label));
fs.writeFileSync(indexPath, JSON.stringify(index));

console.log(`wrote ${packRel} — ${features.length} ${kind} features`);
console.log('Play it: builder → "Custom packs" → ' + label);
