import { PY } from '../tools/lib/common.mjs';
// Visual regression of stills: one frame from the middle of every shot, compared
// with the baselines in tests/snapshots/<slug>/<lang>-<format>/ (tools/snapdiff.py).
//
//   node render/snap.mjs --all                    every film in films/
//   node render/snap.mjs --film <slug> [--lang en] [--format 9:16]
//   node render/snap.mjs --film <slug> --update   accept the current frames as baselines
//
// Exit code 1 when a frame changed or a baseline is missing (a human decides whether
// the change is intended and then runs --update).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { openFilm, prepareFilm, film as filmSpec, ROOT } from './common.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);

const SNAP = path.join(ROOT, 'tests/snapshots');

const films = flag('--all')
  ? fs.readdirSync(path.join(ROOT, 'films')).filter((d) => !d.startsWith('_') && !d.startsWith('.') && fs.existsSync(path.join(ROOT, 'films', d, 'film.json'))).sort()
  : [opt('--film')];
if (!films[0]) { console.error('usage: snap.mjs --all | --film <slug> [--lang xx] [--format 16:9] [--update]'); process.exit(2); }

/** Shot windows from the page (engine films); fallback: holds summed in Node. */
async function shotTimes(page, slug) {
  const plan = await page.evaluate(() => (window.getPlan ? window.getPlan() : null));
  if (plan) return plan.shots.map((s) => ({ id: s.id, t0: s.t0, t1: s.t1 }));
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'films', slug, 'film.json'), 'utf8'));
  const { buildTimeline } = await import(pathToFileURL(path.join(ROOT, 'src/engine/timeline.js')));
  const { resolveStyle } = await import(pathToFileURL(path.join(ROOT, 'src/engine/styles.js')));
  const { PRESETS } = await import(pathToFileURL(path.join(ROOT, 'src/library/styles.js')));
  return buildTimeline(spec, resolveStyle(spec.style, PRESETS).style).shots.map((s) => ({ id: s.id, t0: s.t0, t1: s.t1 }));
}

/** Variants to test: requested ones, else every language × format of the film. */
function variants(slug) {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'films', slug, 'film.json'), 'utf8'));
  const langs = opt('--lang') ? [opt('--lang')] : spec.languages || [spec.language || 'pl'];
  const formats = opt('--format') ? [opt('--format')] : spec.formats || [spec.format || '16:9'];
  return langs.flatMap((lang) => formats.map((format) => ({ lang, format })));
}

let bad = 0;
const report = {};
for (const slug of films) {
  const F = filmSpec(slug);
  prepareFilm(F);
  for (const { lang, format } of variants(slug)) {
    const key = `${lang}-${format.replace(':', 'x')}`;
    const V = F.variant({ lang, format });
    const film = await openFilm({ page: V.page, width: V.size[0], height: V.size[1] });
    const shots = await shotTimes(film.page, slug);
    const cur = path.join(SNAP, '_cur', slug, key);
    fs.rmSync(cur, { recursive: true, force: true });
    fs.mkdirSync(cur, { recursive: true });
    for (const [i, s] of shots.entries()) {
      const t = +((s.t0 + s.t1) / 2).toFixed(3);
      fs.writeFileSync(path.join(cur, `${String(i).padStart(2, '0')}_${s.id || 'shot'}.jpg`), await film.frame(t, 'jpeg', 92));
    }
    await film.close();
    const r = spawnSync(PY, [path.join(ROOT, 'tools/snapdiff.py'), '--cur', cur, '--base', path.join(SNAP, slug, key),
      '--diff', path.join(SNAP, '_diff', slug, key), ...(flag('--update') ? ['--update'] : [])], { encoding: 'utf8' });
    if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
    const res = JSON.parse(r.stdout);
    report[`${slug}/${key}`] = res;
    const s = res.summary;
    const changed = res.frames.filter((f) => f.status === 'changed' || f.status === 'missing');
    bad += changed.length;
    console.log(`${changed.length ? 'CHANGED' : 'ok     '} ${slug} ${key}: same ${s.same}, new ${s.new}, updated ${s.updated}, changed ${s.changed}, missing ${s.missing}`);
    for (const f of changed) console.log(`        ${f.name} ${f.status}${f.mae !== undefined ? ` mae ${f.mae} px ${f.pct}%` : ''}${f.diff ? ` → ${path.relative(ROOT, f.diff)}` : ''}`);
  }
}
fs.writeFileSync(path.join(SNAP, '_report.json'), JSON.stringify(report, null, 1));
process.exit(bad && !flag('--update') ? 1 : 0);
