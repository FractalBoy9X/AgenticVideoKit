// npm test: everything that keeps the pipeline honest, in one command.
//
//   node tools/test.mjs [--quick]     --quick skips the browser frame checks
//
// 1. library lint (complete meta)  2. check of every film  3. units: languages, fitted
// holds, .srt, loudness meter against ffmpeg, repeatability of supplied audio and narration
// 4. exact sampled-frame determinism (visual baselines are a separate opt-in check).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { ROOT, PY, filmList } from './lib/common.mjs';

const quick = process.argv.includes('--quick');
const TMP = path.join(ROOT, 'tests/.tmp');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const results = [];
const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
function step(name, fn) {
  const t0 = Date.now();
  let ok = false, note = '';
  try { const r = fn(); ok = r === true || r?.ok; note = r?.note || ''; } catch (e) { note = e.message.split('\n')[0]; }
  results.push({ name, ok, note, s: ((Date.now() - t0) / 1000).toFixed(1) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`);
}
const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });

step('asset library and approval units', () => {
  const r = run(process.execPath, ['--test', 'tests/assets.test.mjs', 'tests/pipeline.test.mjs']);
  return { ok: r.status === 0, note: r.status ? r.stdout.trim() : 'passed' };
});

step('library lint: complete meta', () => {
  const r = run(process.execPath, ['tools/film.mjs', 'lint']);
  return { ok: r.status === 0, note: r.stdout.trim().split('\n').pop() };
});

for (const slug of filmList()) {
  step(`check ${slug}`, () => {
    const r = run(process.execPath, ['tools/film.mjs', 'check', slug]);
    return { ok: r.status === 0, note: r.stdout.trim().split('\n').pop() };
  });
}

const { planFilm, narrationLines, toSrt, fitHolds } = await import('../src/engine/narration.js');
const { missingTranslations } = await import('../src/engine/lang.js');
step('languages: shared timeline, values per language, format overrides', () => {
  const film = { languages: ['pl', 'en'], shots: [{ id: 'a', hold: 2, say: { pl: 'Krótko.', en: 'A noticeably longer English sentence here.' }, text: { pl: 'Tak', en: 'Yes' }, '9:16': { size: 70 } }] };
  const pl = planFilm(film, { lang: 'pl', format: '9:16' }), en = planFilm(film, { lang: 'en' });
  const ok = pl.shots[0].hold === en.shots[0].hold && pl.shots[0].hold > 2 && pl.shots[0].text === 'Tak' && en.shots[0].text === 'Yes'
    && pl.shots[0].size === 70 && en.shots[0].size === undefined && missingTranslations({ languages: ['pl', 'en'], shots: [{ say: { pl: 'x' } }] }).length === 1;
  return { ok, note: `hold 2 → ${pl.shots[0].hold} s` };
});
step('single-language compatibility: declared holds and recording units', () => {
  const film = { language: 'pl', shots: [{ hold: 2, say: 'Bardzo długie zdanie, które nie zmieści się w dwóch sekundach ujęcia.' }] };
  const L = narrationLines([{ ...film.shots[0], i: 0, t0: 0, t1: 2 }], film, {}, 'pl');
  return fitHolds(film)[0] === 2 && L[0].whole === true && L[0].parts.length === 1;
});
step('.srt: two balanced lines of ≤ 42 characters', () => {
  const srt = toSrt([[0.5, 4, 'The script becomes a shot plan, using the modules you create for your own project.']]);
  const lines = srt.split('\n').filter((l) => l && !/^\d+$/.test(l) && !l.includes('-->'));
  return { ok: lines.length === 2 && lines.every((l) => l.length <= 42), note: lines.map((l) => l.length).join(' + ') };
});

step('loudness meter = ffmpeg ebur128 (±0.1 LU)', () => {
  const wav = path.join(TMP, 'tone.wav');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=997:duration=6,volume=0.25', '-af', 'aformat=channel_layouts=stereo', '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
  const mine = JSON.parse(execFileSync(PY, [path.join(ROOT, 'audio/master.py'), 'measure', wav], { encoding: 'utf8' })).lufs;
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const ref = +ff.slice(ff.lastIndexOf('Summary')).match(/I:\s+(-?[\d.]+)/)[1];
  return { ok: Math.abs(mine - ref) <= 0.1, note: `${mine} vs ${ref} LUFS` };
});
step('mastering: −14 LUFS, true peak ≤ −1.5 dBTP', () => {
  const wav = path.join(TMP, 'tone.wav'), out = path.join(TMP, 'tone_m.wav');
  const r = JSON.parse(execFileSync(PY, [path.join(ROOT, 'audio/master.py'), 'master', wav, out, '--margin', '0.8'], { encoding: 'utf8' }));
  return { ok: Math.abs(r.lufs + 14) <= 0.1 && r.tp <= -1.5, note: `${r.lufs} LUFS, ${r.tp} dBTP` };
});
step('audio assembly: user files, seeded generators, commands and cue placement', () => {
  const r = run(PY, ['-B', 'tests/test_audio.py']);
  return { ok: r.status === 0, note: r.status ? (r.stderr || r.stdout).trim() : '5 integration cases passed' };
});
step('narration (Piper, seeded) is deterministic', () => {
  const model = path.join(ROOT, '.voices/pl_PL-gosia-medium.onnx');
  if (!fs.existsSync(model)) return { ok: true, note: 'voice model not downloaded: skipped' };
  const job = (n) => { const f = path.join(TMP, `j${n}.json`); fs.writeFileSync(f, JSON.stringify([{ text: 'Test lektora.', out: path.join(TMP, `v${n}.wav`), model, seed: 5 }])); return f; };
  execFileSync(PY, [path.join(ROOT, 'audio/tts.py'), job(1)]);
  execFileSync(PY, [path.join(ROOT, 'audio/tts.py'), job(2)]);
  return { ok: md5(path.join(TMP, 'v1.wav')) === md5(path.join(TMP, 'v2.wav')) };
});

if (!quick) step('sampled frame determinism', () => {
  const r = run(process.execPath, ['tools/determinism.mjs']);
  return { ok: r.status === 0, note: r.status ? (r.stderr || r.stdout).trim().slice(-600) : r.stdout.trim().split('\n').filter((l) => l.startsWith('PASS')).join('; ') };
});

fs.rmSync(TMP, { recursive: true, force: true });
const bad = results.filter((r) => !r.ok);
console.log(`\n${bad.length ? 'FAIL' : 'OK'}: ${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
