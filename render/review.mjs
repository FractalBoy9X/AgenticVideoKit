import { PY } from '../tools/lib/common.mjs';
// Cheap preview + critique loop: check, one frame per shot at 70 % (plus its entry with
// --entry) in every language × format, the box of every text drawn, measured
// problems (tools/critique.py), one contact sheet per variant. Seconds, not minutes.
//
//   node render/review.mjs --film <slug> [--lang pl|all] [--format 16:9|all] [--entry] [--no-check]
//   → films/<slug>/review/<lang>-<format>.jpg, films/<slug>/review/critique.json
//
// The agent reads the printed issues and at most one contact sheet; the human looks
// at the sheets and decides (film.mjs approve) — taste is not measured here.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { openFilm, prepareFilm, film as filmSpec, ROOT } from './common.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);

const slug = opt('--film');
if (!slug) { console.error('usage: review.mjs --film <slug> [--lang pl|all] [--format 16:9|all] [--entry] [--no-check]'); process.exit(2); }
const F = filmSpec(slug);
if (!F.engine) { console.error('review works on engine films (films/<slug>/)'); process.exit(2); }

if (!flag('--no-check')) {
  const { check } = await import('../tools/lib/check.mjs');
  const r = await check(slug, { log: () => {} });
  for (const e of r.errors) console.log('ERROR', e);
  if (r.errors.length) { console.log('fix check errors first'); process.exit(1); }
  for (const w of r.warns) console.log('warn ', w);
}
prepareFilm(F);
const pick = (v, all) => (!v || v === 'all' ? all : v.split(','));
const langs = pick(opt('--lang'), F.languages);
const formats = pick(opt('--format'), opt('--format') ? F.formats : [F.formats[0]]);
const outDir = path.join(F.dir, 'review');
fs.mkdirSync(outDir, { recursive: true });
const report = { film: slug, variants: {} };
let errors = 0, warns = 0;

for (const lang of langs) for (const format of formats) {
  const V = F.variant({ lang, format });
  const tag = `${lang}-${format.replace(':', 'x')}`;
  const dir = path.join(outDir, tag);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const film = await openFilm({ page: V.page, width: V.size[0], height: V.size[1] });
  const plan = await film.page.evaluate(() => window.getPlan());
  const frames = [];
  for (const s of plan.shots) {
    const ts = [+Math.min(s.t1 - 0.3, s.t0 + s.hold * 0.7).toFixed(2)]; // built up, before the exit
    if (flag('--entry')) ts.unshift(+(s.t0 + Math.min(1.0, s.hold * 0.3)).toFixed(2));
    for (const t of ts) {
      const boxes = await film.page.evaluate((tt) => window.probeAt(tt), t);
      const file = path.join(dir, `${String(s.i).padStart(2, '0')}_${s.id || s.type}_${t}.jpg`);
      const { data } = await film.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85, optimizeForSpeed: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ file, t, shot: s.i, id: s.id, type: s.type, boxes });
    }
  }
  await film.close();
  const probe = { size: V.size, lang, format, frames, subtitles: plan.subtitles, shots: plan.shots };
  const probeFile = path.join(dir, 'probe.json');
  fs.writeFileSync(probeFile, JSON.stringify(probe));
  const r = spawnSync(PY, [path.join(ROOT, 'tools/critique.py'), probeFile], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  const crit = JSON.parse(r.stdout);
  report.variants[tag] = { ...crit, duration: plan.duration, sheet: path.relative(ROOT, path.join(outDir, `${tag}.jpg`)) };
  errors += crit.stats.error; warns += crit.stats.warn;

  // contact sheet: 4 columns, label = shot number, id and time
  const cols = 4, tw = 480, th = Math.round((tw * V.size[1]) / V.size[0] / 2) * 2;
  const esc = (x) => String(x).replace(/[:'\\%]/g, '');
  const inputs = frames.flatMap((f) => ['-i', f.file]);
  const labels = frames.map((f, i) => `[${i}:v]scale=${tw}:${th},drawtext=text='${esc(`${f.shot + 1} ${f.id || f.type} ${f.t}s`)}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.55[v${i}]`);
  const layout = frames.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|');
  const filter = frames.length > 1 ? `${labels.join(';')};${frames.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${frames.length}:layout=${layout}:fill=black` : labels[0].replace(/\[v0\]$/, '');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-frames:v', '1', '-q:v', '4', path.join(outDir, `${tag}.jpg`)]);

  console.log(`\n${tag}: ${plan.shots.length} shots, ${plan.duration.toFixed(1)} s, ${crit.stats.error} error(s), ${crit.stats.warn} warning(s) → ${report.variants[tag].sheet}`);
  for (const i of crit.issues.slice(0, 14)) console.log(`  ${i.level.padEnd(5)} ${i.at}: ${i.msg}`);
  if (crit.issues.length > 14) console.log(`  … ${crit.issues.length - 14} more in films/${slug}/review/critique.json`);
}
fs.writeFileSync(path.join(outDir, 'critique.json'), JSON.stringify(report, null, 1));
console.log(`\nreview: ${errors} error(s), ${warns} warning(s). Next: fix, review again (≤ 3 rounds), then render --preview and ask the human to approve.`);
process.exit(errors ? 1 : 0);
