/* Node smoke test: resolve every preset through the real data.js + geo.js
 * code paths (fetch shimmed to the filesystem) and sanity-check the scenes.
 * Usage: node tools/test-resolve.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

globalThis.self = globalThis;
globalThis.fetch = async (rel) => {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return { ok: false, status: 404 };
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
};

const Geo = require(path.join(root, 'js/geo.js'));
require(path.join(root, 'js/data.js'));
const Data = globalThis.Data;

const presets = JSON.parse(fs.readFileSync(path.join(root, 'data/presets.json'), 'utf8'));
let failed = 0;

for (const cfg of presets) {
  try {
    const quiz = await Data.resolveQuiz(cfg);
    const scene = Geo.buildScene(quiz.features, quiz.context, 1000, { bounds: quiz.bounds });
    const targetSet = new Set(quiz.targetIds);
    const targetShapes = scene.shapes.filter((s) => targetSet.has(s.id));
    const problems = [];
    if (targetShapes.length !== quiz.targetIds.length) {
      problems.push(`targets missing from scene: ${quiz.targetIds.length - targetShapes.length}`);
    }
    if (!(scene.height > 10 && scene.height < 20000)) problems.push('bad height ' + scene.height);
    for (const s of scene.shapes) {
      const vals = s.d !== undefined
        ? [...s.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].flatMap((m) => [+m[1], +m[2]])
        : [s.x, s.y];
      if (vals.some((v) => !isFinite(v))) { problems.push(s.name + ': non-finite coords'); break; }
    }
    const names = new Set();
    let dup = null;
    for (const id of quiz.targetIds) {
      const n = scene.shapes.find((s) => s.id === id)?.name;
      if (names.has(n)) dup = n;
      names.add(n);
    }
    if (dup) problems.push('duplicate target name: ' + dup);
    if (problems.length) {
      failed++;
      console.log('FAIL', cfg.id, '—', problems.join('; '));
    } else {
      console.log('ok  ', cfg.id.padEnd(24), quiz.targetIds.length, 'targets,',
        quiz.features.length, 'features,', (quiz.context || []).length, 'context,',
        Math.round(scene.height), 'h');
    }
  } catch (err) {
    failed++;
    console.log('FAIL', cfg.id, '—', err.message);
  }
}
process.exit(failed ? 1 : 0);
