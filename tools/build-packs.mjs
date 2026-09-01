/*
 * Data pipeline: bulk open-data downloads → normalized quiz "packs".
 *
 *   node tools/build-packs.mjs download   fetch + unzip sources into tools/cache/
 *   node tools/build-packs.mjs convert    shapefiles → simplified GeoJSON (needs npx mapshaper)
 *   node tools/build-packs.mjs pops       fetch US population (Census ACS 2023 5-yr) → cache
 *   node tools/build-packs.mjs emit       write data/packs/*, data/index.json, data/groups.json
 *   node tools/build-packs.mjs all        everything, in order
 *
 * Sources:
 *   Natural Earth admin-0 (countries), admin-1 (states/provinces), populated places
 *   US Census cartographic boundaries 1:500k (counties, county subdivisions, places)
 *   US Census ACS 5-year B01003 (population for counties/cousubs/places)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(root, 'tools/cache');
const OUT = path.join(root, 'data');

const SOURCES = {
  admin0: 'https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip',
  admin1: 'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip',
  cities: 'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places_simple.zip',
  county: 'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip',
  cousub: 'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_cousub_500k.zip',
  place:  'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_place_500k.zip',
};

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

// ---------------------------------------------------------------- download
function download() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [key, url] of Object.entries(SOURCES)) {
    const zip = path.join(CACHE, key + '.zip');
    const dir = path.join(CACHE, key);
    if (!fs.existsSync(zip)) {
      console.log('downloading', key);
      sh('curl', ['-sL', '--fail', '-o', zip, url]);
    }
    if (!fs.existsSync(dir)) sh('unzip', ['-o', '-q', zip, '-d', dir]);
  }
}

// ---------------------------------------------------------------- convert
function mapshaper(args) {
  sh('npx', ['-y', 'mapshaper', ...args], {
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });
}

const shp = (key) => {
  const dir = path.join(CACHE, key);
  const f = fs.readdirSync(dir).find((n) => n.endsWith('.shp'));
  return path.join(dir, f);
};

function convert() {
  const gj = (key) => path.join(CACHE, key + '.geojson');
  const jobs = [
    ['admin0', ['-filter', 'ADM0_A3 != "ATA"', '-simplify', '12%', 'keep-shapes',
      '-o', 'precision=0.001']],
    ['admin1', ['-simplify', '6%', 'keep-shapes', '-o', 'precision=0.001']],
    ['cities', ['-o']],
    ['county', ['-simplify', '22%', 'keep-shapes', '-o', 'precision=0.0001']],
    ['cousub', ['-filter', 'NAME != "County subdivisions not defined"',
      '-simplify', '22%', 'keep-shapes', '-o', 'precision=0.0001']],
    ['place', ['-simplify', '25%', 'keep-shapes', '-o', 'precision=0.0001']],
  ];
  for (const [key, args] of jobs) {
    if (fs.existsSync(gj(key))) { console.log('convert: cached', key); continue; }
    console.log('convert:', key);
    const out = [...args];
    out.splice(out.lastIndexOf('-o') + 1, 0, 'format=geojson', gj(key));
    mapshaper(['-i', shp(key), ...out]);
  }
}

// ------------------------------------------- pops (Census population estimates CSVs)
// The ACS API needs an API key nowadays; the Vintage 2024 population estimate
// CSVs are keyless bulk downloads carrying the same numbers.
const POP_SOURCES = {
  counties: 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/counties/totals/co-est2024-alldata.csv',
  subcounty: 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv',
};

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (field || row.length) { row.push(field); rows.push(row); row = []; field = ''; }
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function pops() {
  const out = {}; // GEOID -> population
  for (const [key, url] of Object.entries(POP_SOURCES)) {
    const file = path.join(CACHE, key + '.csv');
    if (!fs.existsSync(file)) {
      console.log('pops: downloading', key);
      sh('curl', ['-sL', '--fail', '-o', file, url]);
    }
    const rows = parseCSV(fs.readFileSync(file, 'latin1'));
    const col = Object.fromEntries(rows[0].map((h, i) => [h, i]));
    const popCol = col.POPESTIMATE2024;
    for (const r of rows.slice(1)) {
      if (key === 'counties') {
        if (r[col.COUNTY] !== '000') out[r[col.STATE] + r[col.COUNTY]] = +r[popCol];
      } else {
        const sumlev = r[col.SUMLEV];
        if (sumlev === '162') out[r[col.STATE] + r[col.PLACE]] = +r[popCol];
        else if (sumlev === '061') {
          out[r[col.STATE] + r[col.COUNTY] + r[col.COUSUB]] = +r[popCol];
        }
      }
    }
  }
  fs.writeFileSync(path.join(CACHE, 'pops.json'), JSON.stringify(out));
  console.log('pops:', Object.keys(out).length, 'geoids');
}

// -------------------------------------------- geonames (all cities ≥500 pop)
const GEONAMES = {
  'geonames-cities.zip': 'https://download.geonames.org/export/dump/cities500.zip',
  'geonames-countries.txt': 'https://download.geonames.org/export/dump/countryInfo.txt',
  'geonames-admin1.txt': 'https://download.geonames.org/export/dump/admin1CodesASCII.txt',
};

function geonames() {
  for (const [file, url] of Object.entries(GEONAMES)) {
    const p = path.join(CACHE, file);
    if (fs.existsSync(p)) continue;
    console.log('geonames: downloading', file);
    sh('curl', ['-sL', '--fail', '-o', p, url]);
  }
  if (!fs.existsSync(path.join(CACHE, 'cities500.txt'))) {
    sh('unzip', ['-o', '-q', path.join(CACHE, 'geonames-cities.zip'), '-d', CACHE]);
  }
}

// -------------------------------------------- adm2 (geoBoundaries districts)
async function adm2() {
  const dir = path.join(CACHE, 'adm2');
  fs.mkdirSync(dir, { recursive: true });
  const metaFile = path.join(CACHE, 'adm2-meta.json');
  if (!fs.existsSync(metaFile)) {
    console.log('adm2: fetching geoBoundaries catalog');
    const res = await fetch('https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM2/');
    if (!res.ok) throw new Error('geoBoundaries catalog: HTTP ' + res.status);
    fs.writeFileSync(metaFile, JSON.stringify(await res.json()));
  }
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const todo = meta.filter((m) => m.boundaryISO && m.simplifiedGeometryGeoJSON &&
    !fs.existsSync(path.join(dir, m.boundaryISO + '.geojson')));
  console.log('adm2:', meta.length, 'countries in catalog,', todo.length, 'to download');
  let done = 0, failed = 0;
  const pool = Array.from({ length: 8 }, async function worker() {
    for (;;) {
      const m = todo.shift();
      if (!m) return;
      try {
        const res = await fetch(m.simplifiedGeometryGeoJSON);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        fs.writeFileSync(path.join(dir, m.boundaryISO + '.geojson'),
          Buffer.from(await res.arrayBuffer()));
        done++;
        if (done % 20 === 0) console.log('adm2:', done, 'downloaded');
      } catch (err) {
        failed++;
        console.log('adm2: FAILED', m.boundaryISO, '-', err.message);
      }
    }
  });
  await Promise.all(pool);
  console.log('adm2: done —', done, 'new,', failed, 'failed');

  // simplify each country (raw "simplified" files are still heavy)
  const sdir = path.join(CACHE, 'adm2s');
  fs.mkdirSync(sdir, { recursive: true });
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.geojson'))) {
    const out = path.join(sdir, f);
    if (fs.existsSync(out)) continue;
    console.log('adm2: simplifying', f);
    mapshaper(['-i', path.join(dir, f), '-simplify', '30%', 'keep-shapes',
      '-o', 'precision=0.001', 'format=geojson', out]);
  }
}

// -------------------------------------------- hoods (click-that-hood neighborhoods)
const HOODS_ZIP = 'https://github.com/codeforgermany/click_that_hood/archive/refs/heads/main.zip';

function hoods() {
  const zip = path.join(CACHE, 'hoods.zip');
  const dir = path.join(CACHE, 'hoods');
  if (!fs.existsSync(zip)) {
    console.log('hoods: downloading click-that-hood');
    sh('curl', ['-sL', '--fail', '-o', zip, HOODS_ZIP]);
  }
  if (!fs.existsSync(dir)) sh('unzip', ['-o', '-q', zip, '-d', dir]);

  // simplify each city's polygons (raw files are vertex-dense)
  const dataDir = fs.readdirSync(dir)
    .map((d) => path.join(dir, d, 'public', 'data')).find(fs.existsSync);
  const sdir = path.join(CACHE, 'hoods-s');
  fs.mkdirSync(sdir, { recursive: true });
  for (const f of fs.readdirSync(dataDir).filter((n) => n.endsWith('.geojson'))) {
    const out = path.join(sdir, f);
    if (fs.existsSync(out)) continue;
    try {
      mapshaper(['-i', path.join(dataDir, f), '-simplify', '25%', 'keep-shapes',
        '-o', 'precision=0.0001', 'format=geojson', out]);
    } catch { console.log('hoods: mapshaper failed on', f, '- skipping'); }
  }
}

// -------------------------------------------- osm (per-city layers via Overpass)
const CITIES = JSON.parse(fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'cities.json'), 'utf8'));

// One query per city per layer, cached on disk. Overpass is a shared community
// service: keep the throttle, don't parallelize.
const OSM_LAYERS = {
  'transit-lines': (b) => `relation["route"~"^(subway|light_rail|tram)$"](${b});out geom;`,
  'transit-stations': (b) => `node["railway"~"^(station|tram_stop)$"]["name"](${b});out;`,
  'major-roads': (b) => `way["highway"~"^(motorway|trunk|primary)$"](${b});out geom;`,
  'waterways': (b) => `way["waterway"~"^(river|canal)$"]["name"](${b});out geom;`,
  'trails': (b) => `relation["route"~"^(hiking|bicycle|foot)$"]["name"](${b});out geom;`,
  'parks': (b) => `(way["leisure"~"^(park|garden)$"]["name"](${b});relation["leisure"~"^(park|garden)$"]["name"](${b}););out geom;`,
  'landmarks': (b) => `(nwr["tourism"~"^(museum|attraction|zoo|aquarium)$"]["name"]["wikidata"](${b});nwr["leisure"="stadium"]["name"]["wikidata"](${b});nwr["amenity"="university"]["name"]["wikidata"](${b});nwr["aeroway"="aerodrome"]["name"](${b}););out center;`,
};
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function osm() {
  const dir = path.join(CACHE, 'osm');
  let endpoint = 0;
  for (const city of CITIES) {
    fs.mkdirSync(path.join(dir, city.slug), { recursive: true });
    const rl = city.r, rlon = city.r / Math.cos(city.lat * Math.PI / 180);
    const bbox = [city.lat - rl, city.lon - rlon, city.lat + rl, city.lon + rlon]
      .map((n) => n.toFixed(3)).join(',');
    for (const [layer, q] of Object.entries(OSM_LAYERS)) {
      const file = path.join(dir, city.slug, layer + '.json');
      if (fs.existsSync(file)) continue;
      const query = '[out:json][timeout:120];' + q(bbox);
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const res = await fetch(OVERPASS[endpoint % OVERPASS.length], {
            method: 'POST',
            body: 'data=' + encodeURIComponent(query),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              // Apache 406s UA-less requests; identify ourselves politely
              'User-Agent': 'map-games-pipeline/1.0 (open-source geography quiz)',
            },
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const json = await res.json();
          fs.writeFileSync(file, JSON.stringify(json));
          console.log('osm:', city.slug, layer, '—', json.elements.length, 'elements');
          break;
        } catch (err) {
          endpoint++;
          console.log('osm: retry', city.slug, layer, '-', err.message);
          if (attempt === 5) console.log('osm: GIVING UP on', city.slug, layer);
          else await sleep(20000 * (attempt + 1));
        }
      }
      await sleep(2500);
    }
  }
}

// -------------------------------------------- civic (ZIP codes, school districts)
const CIVIC_SOURCES = {
  zcta: 'https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip',
  unsd: 'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_unsd_500k.zip',
};

function civic() {
  for (const [key, url] of Object.entries(CIVIC_SOURCES)) {
    const zip = path.join(CACHE, key + '.zip');
    const dir = path.join(CACHE, key);
    if (!fs.existsSync(zip)) {
      console.log('civic: downloading', key);
      sh('curl', ['-sL', '--fail', '-o', zip, url]);
    }
    if (!fs.existsSync(dir)) sh('unzip', ['-o', '-q', zip, '-d', dir]);
    const gj = path.join(CACHE, key + '.geojson');
    if (!fs.existsSync(gj)) {
      console.log('civic: converting', key);
      mapshaper(['-i', shp(key), '-simplify', key === 'zcta' ? '15%' : '20%',
        'keep-shapes', '-o', 'precision=0.0001', 'format=geojson', gj]);
    }
  }
}

// ---------------------------------------------------------------- emit
const GROUPS = {
  NATO: ['USA','CAN','GBR','FRA','DEU','ITA','ESP','PRT','NLD','BEL','LUX','DNK','NOR','ISL','TUR','GRC','POL','CZE','HUN','SVK','SVN','EST','LVA','LTU','ROU','BGR','HRV','ALB','MNE','MKD','FIN','SWE'],
  EU: ['AUT','BEL','BGR','HRV','CYP','CZE','DNK','EST','FIN','FRA','DEU','GRC','HUN','IRL','ITA','LVA','LTU','LUX','MLT','NLD','POL','PRT','ROU','SVK','SVN','ESP','SWE'],
  G7: ['USA','GBR','FRA','DEU','ITA','CAN','JPN'],
  G20: ['ARG','AUS','BRA','CAN','CHN','FRA','DEU','IND','IDN','ITA','JPN','KOR','MEX','RUS','SAU','ZAF','TUR','GBR','USA'],
  ASEAN: ['BRN','KHM','IDN','LAO','MYS','MMR','PHL','SGP','THA','VNM'],
};

const readGJ = (key) =>
  JSON.parse(fs.readFileSync(path.join(CACHE, key + '.geojson'), 'utf8'));

function writePack(rel, pack) {
  const p = path.join(OUT, 'packs', rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(pack));
  return { path: 'data/packs/' + rel, count: pack.features.length };
}

function emit() {
  fs.mkdirSync(path.join(OUT, 'packs'), { recursive: true });
  const popByGeoid = JSON.parse(fs.readFileSync(path.join(CACHE, 'pops.json'), 'utf8'));
  const index = { packs: {}, menus: {} };

  // user-added packs (tools/add-pack.mjs) survive re-emits
  try {
    const old = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
    for (const [k, v] of Object.entries(old.packs)) {
      if (k.startsWith('custom/')) index.packs[k] = v;
    }
    if (old.menus.customPacks) index.menus.customPacks = old.menus.customPacks;
  } catch { /* first run */ }

  // ---- world countries
  const a0 = readGJ('admin0');
  const continentByA3 = {};
  const nameByA3 = {};
  for (const f of a0.features) nameByA3[f.properties.ADM0_A3] = f.properties.NAME_EN || f.properties.NAME;
  {
    const feats = a0.features.map((f) => {
      const p = f.properties;
      continentByA3[p.ADM0_A3] = p.CONTINENT;
      return {
        id: p.ADM0_A3, name: p.NAME_EN || p.NAME, pop: Math.round(p.POP_EST) || null,
        continent: p.CONTINENT, subregion: p.SUBREGION, type: p.TYPE,
        geometry: f.geometry,
      };
    }).sort((x, y) => x.name.localeCompare(y.name));
    index.packs['world-countries'] = {
      kind: 'polygon', level: 'country', label: 'Countries of the world',
      ...writePack('world-countries.json', { kind: 'polygon', features: feats }),
    };
    index.menus.continents = [...new Set(feats.map((f) => f.continent))]
      .filter((c) => c && c !== 'Seven seas (open ocean)').sort();
    index.menus.countries = feats.map((f) => ({ a3: f.id, name: f.name }));
  }

  // ---- admin-1 (states/provinces) per country
  {
    const byCountry = {};
    for (const f of readGJ('admin1').features) {
      const p = f.properties;
      if (!p.adm0_a3) continue;
      (byCountry[p.adm0_a3] ||= []).push({
        id: p.iso_3166_2 || p.adm1_code, name: p.name || p.name_en || p.gn_name,
        pop: null, geometry: f.geometry,
      });
    }
    const countries = [];
    for (const [a3, feats] of Object.entries(byCountry)) {
      if (feats.length < 2 || feats.some((f) => !f.name)) continue;
      feats.sort((x, y) => x.name.localeCompare(y.name));
      const countryName =
        a0.features.find((f) => f.properties.ADM0_A3 === a3)?.properties.NAME_EN;
      if (!countryName) continue;
      index.packs['admin1/' + a3] = {
        kind: 'polygon', level: 'admin1', label: 'States/provinces of ' + countryName,
        country: a3,
        ...writePack('admin1/' + a3 + '.json', { kind: 'polygon', features: feats }),
      };
      countries.push({ a3, name: countryName, count: feats.length });
    }
    index.menus.admin1Countries = countries.sort((x, y) => x.name.localeCompare(y.name));
  }

  // ---- world cities (points)
  {
    const feats = readGJ('cities').features
      .map((f) => {
        const p = f.properties;
        return {
          id: String(p.ne_id ?? p.NE_ID ?? p.geonameid ?? p.name + ':' + p.adm0_a3),
          name: p.name, pop: p.pop_max > 0 ? p.pop_max : null,
          capital: (p.adm0cap === 1 || p.featurecla === 'Admin-0 capital') ? 1 : 0,
          country: p.adm0_a3 || p.sov_a3, admin1: p.adm1name || null,
          continent: continentByA3[p.adm0_a3 || p.sov_a3] || null,
          lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
        };
      })
      .filter((c) => c.name && (c.capital || (c.pop ?? 0) >= 100000));
    index.packs['cities'] = {
      kind: 'point', level: 'city', label: 'World cities (100k+ and capitals)',
      ...writePack('cities.json', { kind: 'point', features: feats }),
    };
  }

  // ---- US counties / county subdivisions / places, split per state
  const usSets = [
    ['county', 'us-counties', 'Counties'],
    ['cousub', 'us-townships', 'Townships & municipalities'],
    ['place', 'us-places', 'Cities & towns (places)'],
  ];
  const stateNames = {};
  for (const [key, packPrefix, labelPrefix] of usSets) {
    const byState = {};
    for (const f of readGJ(key).features) {
      const p = f.properties;
      const st = p.STUSPS;
      stateNames[st] = p.STATE_NAME;
      (byState[st] ||= []).push({
        id: p.GEOID,
        name: p.NAME.replace(/ Town$/, ''),
        pop: popByGeoid[p.GEOID] ?? null,
        county: (p.NAMELSADCO || '').replace(/ County$/, '') || undefined,
        geometry: f.geometry,
      });
    }
    for (const [st, feats] of Object.entries(byState)) {
      feats.sort((x, y) => x.name.localeCompare(y.name));
      index.packs[packPrefix + '/' + st] = {
        kind: 'polygon', level: key, label: labelPrefix + ' — ' + stateNames[st],
        state: st,
        ...writePack(packPrefix + '/' + st + '.json', { kind: 'polygon', features: feats }),
      };
    }
  }
  index.menus.usStates = Object.entries(stateNames)
    .map(([st, name]) => ({ st, name })).sort((x, y) => x.name.localeCompare(y.name));

  // ---- geonames: every city ≥500 pop, per country (if the geonames step ran)
  if (fs.existsSync(path.join(CACHE, 'cities500.txt'))) {
    const tsv = (file) => fs.readFileSync(path.join(CACHE, file), 'utf8')
      .split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
    const a3ByIso2 = Object.fromEntries(tsv('geonames-countries.txt').map((r) => [r[0], r[1]]));
    const admin1Names = Object.fromEntries(tsv('geonames-admin1.txt').map((r) => [r[0], r[1]]));
    const byCountry = {};
    for (const r of tsv('cities500.txt')) {
      const a3 = a3ByIso2[r[8]];
      if (!a3) continue;
      (byCountry[a3] ||= []).push({
        id: 'gn' + r[0], name: r[1], pop: +r[14] || null,
        capital: r[7] === 'PPLC' ? 1 : 0,
        admin1: admin1Names[r[8] + '.' + r[10]] || null,
        country: a3, lon: +r[5], lat: +r[4],
      });
    }
    const menu = [];
    for (const [a3, feats] of Object.entries(byCountry)) {
      if (feats.length < 5 || !nameByA3[a3]) continue;
      feats.sort((x, y) => x.name.localeCompare(y.name));
      index.packs['geocities/' + a3] = {
        kind: 'point', level: 'city', label: 'Cities of ' + nameByA3[a3] + ' (500+ pop)',
        country: a3,
        ...writePack('geocities/' + a3 + '.json', { kind: 'point', features: feats }),
      };
      menu.push({ a3, name: nameByA3[a3], count: feats.length });
    }
    index.menus.geocitiesCountries = menu.sort((x, y) => x.name.localeCompare(y.name));
  }

  // ---- adm2: geoBoundaries districts, per country (if the adm2 step ran)
  const roundCoords = (c) => Array.isArray(c[0]) ? c.map(roundCoords)
    : [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000];
  const adm2Dir = path.join(CACHE, 'adm2s');
  if (fs.existsSync(adm2Dir)) {
    const menu = [];
    for (const file of fs.readdirSync(adm2Dir).filter((f) => f.endsWith('.geojson'))) {
      const a3 = file.replace('.geojson', '');
      if (!nameByA3[a3]) continue;
      let gj;
      try { gj = JSON.parse(fs.readFileSync(path.join(adm2Dir, file), 'utf8')); }
      catch { console.log('adm2 emit: bad json, skipping', a3); continue; }
      const feats = gj.features
        .filter((f) => f.properties.shapeName && f.geometry)
        .map((f) => ({
          id: f.properties.shapeID || a3 + ':' + f.properties.shapeName,
          name: f.properties.shapeName, pop: null,
          geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
        }))
        .sort((x, y) => x.name.localeCompare(y.name));
      if (feats.length < 3) continue;
      index.packs['adm2/' + a3] = {
        kind: 'polygon', level: 'adm2', label: 'Districts of ' + nameByA3[a3] + ' (ADM2)',
        country: a3,
        ...writePack('adm2/' + a3 + '.json', { kind: 'polygon', features: feats }),
      };
      menu.push({ a3, name: nameByA3[a3], count: feats.length });
    }
    index.menus.adm2Countries = menu.sort((x, y) => x.name.localeCompare(y.name));
  }

  // ---- neighborhoods: click-that-hood, per city (if the hoods step ran)
  const hoodsRepo = path.join(CACHE, 'hoods');
  const dataDir = path.join(CACHE, 'hoods-s');
  if (fs.existsSync(dataDir)) {
    let cityMeta = {};
    try {
      const metaPath = fs.readdirSync(hoodsRepo)
        .map((d) => path.join(hoodsRepo, d, 'src', 'cities.json')).find(fs.existsSync);
      for (const c of JSON.parse(fs.readFileSync(metaPath, 'utf8'))) {
        cityMeta[c.id] = c;
      }
    } catch { /* label from slug below */ }
    const menu = [];
    for (const file of fs.readdirSync(dataDir).filter((f) => f.endsWith('.geojson'))) {
      const slug = file.replace('.geojson', '');
      let gj;
      try { gj = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')); }
      catch { continue; }
      const seen = new Set();
      const feats = (gj.features || [])
        .filter((f) => f.properties?.name && f.geometry &&
          (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
        .map((f, i) => ({
          id: slug + ':' + i, name: f.properties.name, pop: null,
          geometry: f.geometry, // precision already handled by mapshaper
        }))
        .filter((f) => !seen.has(f.name) && seen.add(f.name))
        .sort((x, y) => x.name.localeCompare(y.name));
      if (feats.length < 5) continue;
      const m = cityMeta[slug];
      const label = (m?.name || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())) +
        (m?.state ? ', ' + m.state : m?.country ? ', ' + m.country : '');
      index.packs['neighborhoods/' + slug] = {
        kind: 'polygon', level: 'neighborhood', label: 'Neighborhoods — ' + label,
        ...writePack('neighborhoods/' + slug + '.json', { kind: 'polygon', features: feats }),
      };
      menu.push({ slug, label, count: feats.length });
    }
    index.menus.hoodCities = menu.sort((x, y) => x.label.localeCompare(y.label));
  }

  // ---- osm city layers (if the osm step ran)
  emitOsm(index);

  // ---- civic geometry (if the civic step ran)
  emitCivic(index);

  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(OUT, 'groups.json'), JSON.stringify(GROUPS));
  console.log('emit: wrote', Object.keys(index.packs).length, 'packs');
}

// ---------------------------------------------------------------- emit: osm
// Douglas-Peucker line simplification (OSM geometry is vertex-dense)
function dpSimplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  let maxD = -1, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
  return [...dpSimplify(pts.slice(0, maxI + 1), tol).slice(0, -1),
    ...dpSimplify(pts.slice(maxI), tol)];
}
const rnd4 = (pts) => pts.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
const simpLines = (lines, tol = 2e-4) => lines
  .map((l) => rnd4(dpSimplify(l, tol))).filter((l) => l.length >= 2);
const lineLen = (lines) => lines.reduce((s, l) => {
  for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
  return s;
}, 0);
const wayCoords = (g) => g.map((p) => [p.lon, p.lat]);

// stitch relation member ways into closed rings (best effort)
function assembleRings(segs) {
  const eq = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  const pool = segs.filter((s) => s.length >= 2);
  const rings = [];
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (grew && !eq(ring[0], ring[ring.length - 1])) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i], end = ring[ring.length - 1];
        if (eq(s[0], end)) { ring = ring.concat(s.slice(1)); pool.splice(i, 1); grew = true; break; }
        if (eq(s[s.length - 1], end)) {
          ring = ring.concat(s.slice(0, -1).reverse());
          pool.splice(i, 1); grew = true; break;
        }
      }
    }
    if (eq(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// land backdrop for city-scale quizzes: counties overlapping the city's box
let countyBoxCache = null;
function cityContext(city) {
  if (!countyBoxCache) {
    countyBoxCache = readGJ('county').features.filter((f) => f.geometry).map((f) => {
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      const scan = (c) => {
        if (typeof c[0] === 'number') {
          if (c[0] < minLon) minLon = c[0];
          if (c[0] > maxLon) maxLon = c[0];
          if (c[1] < minLat) minLat = c[1];
          if (c[1] > maxLat) maxLat = c[1];
        } else c.forEach(scan);
      };
      scan(f.geometry.coordinates);
      return { minLon, maxLon, minLat, maxLat, geometry: f.geometry };
    });
  }
  const rl = city.r, rlon = city.r / Math.cos(city.lat * Math.PI / 180);
  return countyBoxCache
    .filter((c) => c.minLon < city.lon + rlon && c.maxLon > city.lon - rlon &&
      c.minLat < city.lat + rl && c.maxLat > city.lat - rl)
    .map((c) => ({ geometry: c.geometry }));
}

function emitOsm(index) {
  const osmDir = path.join(CACHE, 'osm');
  if (!fs.existsSync(osmDir)) return;
  const layerMenus = {};
  const LAYER_DEFS = {
    'transit-lines': { kind: 'line', label: 'Transit lines' },
    'transit-stations': { kind: 'point', label: 'Transit stations' },
    'major-roads': { kind: 'line', label: 'Major roads', cap: 120 },
    'waterways': { kind: 'line', label: 'Rivers & canals', cap: 40 },
    'trails': { kind: 'line', label: 'Trails & bike routes', cap: 40 },
    'parks': { kind: 'polygon', label: 'Parks & gardens', cap: 60 },
    'landmarks': { kind: 'point', label: 'Landmarks', cap: 120 },
  };

  for (const city of CITIES) {
    for (const [layer, def] of Object.entries(LAYER_DEFS)) {
      const file = path.join(osmDir, city.slug, layer + '.json');
      if (!fs.existsSync(file)) continue;
      let elements;
      try { elements = JSON.parse(fs.readFileSync(file, 'utf8')).elements; }
      catch { continue; }
      let feats = [];

      if (layer === 'transit-lines') {
        const byName = {};
        for (const e of elements) {
          const t = e.tags || {};
          let name = t.ref && t.ref.length <= 8
            ? t.ref + (/line/i.test(t.ref) ? '' : ' Line')
            : (t.name || '').replace(/:.*$/, '')
              .replace(/^(MBTA|MTA|CTA|WMATA|SEPTA|BART|Muni|Metro|Sound Transit|MAX|RTD|DART|TriMet|Link)\s+/i, '');
          if (!name) continue;
          const lines = (e.members || [])
            .filter((m) => m.type === 'way' && m.geometry && !/platform|stop/.test(m.role || ''))
            .map((m) => wayCoords(m.geometry));
          if (!lines.length) continue;
          (byName[name] ||= { lines: [], color: t.colour || null }).lines.push(...lines);
        }
        feats = Object.entries(byName).map(([name, v]) => ({
          id: 'tl:' + name, name, pop: null, color: v.color,
          geometry: { type: 'MultiLineString', coordinates: simpLines(v.lines) },
        }));
      } else if (layer === 'major-roads' || layer === 'waterways') {
        const byName = {};
        for (const e of elements) {
          const name = e.tags?.name || e.tags?.ref;
          if (!name || !e.geometry) continue;
          (byName[name] ||= []).push(wayCoords(e.geometry));
        }
        feats = Object.entries(byName).map(([name, lines]) => ({
          id: layer + ':' + name, name, pop: null, len: lineLen(lines),
          geometry: { type: 'MultiLineString', coordinates: simpLines(lines) },
        }));
      } else if (layer === 'trails') {
        const byName = {};
        for (const e of elements) {
          const name = e.tags?.name;
          if (!name) continue;
          const lines = (e.members || [])
            .filter((m) => m.type === 'way' && m.geometry)
            .map((m) => wayCoords(m.geometry));
          if (lines.length) (byName[name] ||= []).push(...lines);
        }
        feats = Object.entries(byName).map(([name, lines]) => ({
          id: 'tr:' + name, name, pop: null, len: lineLen(lines),
          geometry: { type: 'MultiLineString', coordinates: simpLines(lines) },
        }));
      } else if (layer === 'transit-stations' || layer === 'landmarks') {
        const seen = new Set();
        for (const e of elements) {
          const name = e.tags?.name;
          const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
          if (!name || lon == null || seen.has(name)) continue;
          seen.add(name);
          feats.push({ id: 'n' + e.id, name, pop: null, lon, lat });
        }
      } else if (layer === 'parks') {
        const seen = new Set();
        for (const e of elements) {
          const name = e.tags?.name;
          if (!name || seen.has(name)) continue;
          let rings = [];
          if (e.type === 'way' && e.geometry) {
            rings = assembleRings([wayCoords(e.geometry)]);
          } else if (e.type === 'relation' && e.members) {
            rings = assembleRings(e.members
              .filter((m) => m.type === 'way' && m.geometry && (m.role === 'outer' || !m.role))
              .map((m) => wayCoords(m.geometry)));
          }
          if (!rings.length) continue;
          seen.add(name);
          feats.push({
            id: 'p' + e.id, name, pop: null, len: lineLen(rings),
            geometry: { type: 'Polygon', coordinates: [rnd4(dpSimplify(rings[0], 1e-4))] },
          });
        }
      }

      if (def.cap && feats.length > def.cap) {
        feats.sort((a, b) => (b.len ?? 0) - (a.len ?? 0));
        feats = feats.slice(0, def.cap);
      }
      for (const f of feats) delete f.len;
      feats.sort((a, b) => a.name.localeCompare(b.name));
      if (feats.length < 5) continue;

      const packId = 'osm-' + layer + '/' + city.slug;
      index.packs[packId] = {
        kind: def.kind, level: 'osm', label: def.label + ' — ' + city.label,
        ...writePack('osm-' + layer + '/' + city.slug + '.json',
          { kind: def.kind, features: feats, context: cityContext(city) }),
      };
      (layerMenus[layer] ||= []).push({ slug: city.slug, label: city.label, count: feats.length });
    }
  }
  index.menus.osmLayers = layerMenus;
}

// ---------------------------------------------------------------- emit: civic
function emitCivic(index) {
  // school districts, split per state
  if (fs.existsSync(path.join(CACHE, 'unsd.geojson'))) {
    const fipsToSt = {};
    for (const f of readGJ('county').features) {
      fipsToSt[f.properties.STATEFP] = f.properties.STUSPS;
    }
    const byState = {};
    const stNames = Object.fromEntries(index.menus.usStates.map((s) => [s.st, s.name]));
    for (const f of readGJ('unsd').features) {
      const p = f.properties;
      const st = p.STUSPS || fipsToSt[p.STATEFP];
      if (!st || !p.NAME || !f.geometry) continue;
      (byState[st] ||= []).push({
        id: p.GEOID, name: p.NAME.replace(/ School District$/, ''),
        pop: null, geometry: f.geometry,
      });
    }
    const menu = [];
    for (const [st, feats] of Object.entries(byState)) {
      if (feats.length < 3) continue;
      feats.sort((x, y) => x.name.localeCompare(y.name));
      index.packs['us-school-districts/' + st] = {
        kind: 'polygon', level: 'district',
        label: 'School districts — ' + (stNames[st] || st), state: st,
        ...writePack('us-school-districts/' + st + '.json',
          { kind: 'polygon', features: feats }),
      };
      menu.push(st);
    }
    console.log('emit: school districts for', menu.length, 'states');
  }

  // ZIP codes, clipped to each city's bbox
  if (fs.existsSync(path.join(CACHE, 'zcta.geojson'))) {
    const zctas = readGJ('zcta').features.filter((f) => f.geometry).map((f) => {
      let sx = 0, sy = 0, n = 0;
      const ring = (f.geometry.type === 'Polygon'
        ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]) || [];
      for (const [x, y] of ring) { sx += x; sy += y; n++; }
      return {
        cx: sx / n, cy: sy / n,
        zip: f.properties.ZCTA5CE20 || f.properties.GEOID20,
        geometry: f.geometry,
      };
    });
    const menu = [];
    for (const city of CITIES) {
      const rl = city.r, rlon = city.r / Math.cos(city.lat * Math.PI / 180);
      const feats = zctas
        .filter((z) => z.zip && Math.abs(z.cy - city.lat) < rl &&
          Math.abs(z.cx - city.lon) < rlon)
        .map((z) => ({ id: z.zip, name: z.zip, pop: null, geometry: z.geometry }))
        .sort((x, y) => x.name.localeCompare(y.name));
      if (feats.length < 10) continue;
      index.packs['zips/' + city.slug] = {
        kind: 'polygon', level: 'zip', label: 'ZIP codes — ' + city.label,
        ...writePack('zips/' + city.slug + '.json',
          { kind: 'polygon', features: feats, context: cityContext(city) }),
      };
      menu.push({ slug: city.slug, label: city.label, count: feats.length });
    }
    index.menus.zipCities = menu;
  }
}

// ---------------------------------------------------------------- main
const step = process.argv[2] || 'all';
if (step === 'download' || step === 'all') download();
if (step === 'convert' || step === 'all') convert();
if (step === 'pops' || step === 'all') await pops();
if (step === 'geonames' || step === 'all') geonames();
if (step === 'adm2' || step === 'all') await adm2();
if (step === 'hoods' || step === 'all') hoods();
if (step === 'osm' || step === 'all') await osm();
if (step === 'civic' || step === 'all') civic();
if (step === 'emit' || step === 'all') emit();
