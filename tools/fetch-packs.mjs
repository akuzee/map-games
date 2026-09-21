/*
 * Download prebuilt quiz packs from the latest GitHub release, so you don't
 * have to run the (slow, rate-limited) pipeline yourself.
 *
 *   node tools/fetch-packs.mjs                 everything (~66MB)
 *   node tools/fetch-packs.mjs --world         countries, states/provinces, districts
 *   node tools/fetch-packs.mjs --us            US counties, townships, places, districts
 *   node tools/fetch-packs.mjs --cities        world cities, per-country city packs
 *   node tools/fetch-packs.mjs --city-layers   every city's neighborhoods/transit/etc
 *   node tools/fetch-packs.mjs --city boston   just one city (~1MB)
 *   node tools/fetch-packs.mjs --list          show what a release offers
 *
 * Flags combine: --world --city boston pulls both.
 *
 * Bundles are tarballs attached to the release; each also carries the index
 * fragment it needs, merged into data/index.json as bundles arrive.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = process.env.MAPGAMES_REPO || 'akuzee/map-games';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

async function latestRelease() {
  const res = await fetch(API, {
    headers: { 'User-Agent': 'map-games-fetch', Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) {
    throw new Error(`No releases found for ${REPO}. Either publish one with ` +
      '"node tools/release-packs.mjs", or build the data locally with ' +
      '"node tools/build-packs.mjs all" (slow — see DATA.md).');
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${REPO}`);
  return res.json();
}

function download(url, dest) {
  execFileSync('curl', ['-sL', '--fail', '-H', 'Accept: application/octet-stream',
    '-o', dest, url], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function mergeIndex(fragmentPath) {
  const indexPath = path.join(root, 'data/index.json');
  const current = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    : { packs: {}, menus: {} };
  const frag = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));
  current.packs = { ...current.packs, ...frag.packs };
  for (const [k, v] of Object.entries(frag.menus || {})) {
    // menus are either arrays of entries or (osmLayers) an object of arrays
    if (Array.isArray(v)) {
      const seen = new Set((current.menus[k] || []).map((e) => JSON.stringify(e)));
      current.menus[k] = (current.menus[k] || [])
        .concat(v.filter((e) => !seen.has(JSON.stringify(e))));
    } else if (v && typeof v === 'object') {
      current.menus[k] = { ...(current.menus[k] || {}), ...v };
    }
  }
  fs.writeFileSync(indexPath, JSON.stringify(current));
}

async function main() {
  const release = await latestRelease();
  const assets = release.assets || [];

  if (has('--list')) {
    console.log(`${REPO} — ${release.tag_name} (${release.published_at?.slice(0, 10)})`);
    for (const a of assets) {
      console.log('  ' + a.name.padEnd(28) + (a.size / 1e6).toFixed(1) + ' MB');
    }
    return;
  }

  const TIERS = ['world', 'us', 'cities', 'city-layers'];
  const wanted = [];
  for (const t of TIERS) if (has('--' + t)) wanted.push('packs-' + t + '.tar.gz');
  const city = valueOf('--city');
  if (city) wanted.push('packs-city-' + city + '.tar.gz');
  // no tier flags → the four tiers, which together are the whole library
  if (!wanted.length) wanted.push(...TIERS.map((t) => 'packs-' + t + '.tar.gz'));

  const missing = wanted.filter((n) => !assets.some((a) => a.name === n));
  if (missing.length) {
    console.error('Not in release ' + release.tag_name + ': ' + missing.join(', '));
    if (city && missing.includes('packs-city-' + city + '.tar.gz')) {
      console.error(`"${city}" has no standalone bundle — it is inside ` +
        '--city-layers. Run with --list to see the cities that do.');
    } else {
      console.error('Run with --list to see what is available.');
    }
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mapgames-'));
  fs.mkdirSync(path.join(root, 'data/packs'), { recursive: true });

  for (const name of wanted) {
    const asset = assets.find((a) => a.name === name);
    const tgz = path.join(tmp, name);
    process.stdout.write(`downloading ${name} (${(asset.size / 1e6).toFixed(1)} MB)… `);
    download(asset.browser_download_url, tgz);
    execFileSync('tar', ['-xzf', tgz, '-C', root]);
    console.log('done');
    // each bundle ships data/index-fragment.json; fold it in, then drop it
    const frag = path.join(root, 'data/index-fragment.json');
    if (fs.existsSync(frag)) {
      mergeIndex(frag);
      fs.unlinkSync(frag);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  const groups = path.join(root, 'data/groups.json');
  if (!fs.existsSync(groups)) {
    const a = assets.find((x) => x.name === 'groups.json');
    if (a) download(a.browser_download_url, groups);
  }
  const index = JSON.parse(fs.readFileSync(path.join(root, 'data/index.json'), 'utf8'));
  console.log(`\nReady — ${Object.keys(index.packs).length} packs.`);
  console.log('Start the app:  node tools/serve.mjs   → http://localhost:8017');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
