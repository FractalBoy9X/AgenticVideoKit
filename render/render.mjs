import { PY } from '../tools/lib/common.mjs';
// Render a local film: node render/render.mjs --film example --preview
// Final render: film.mjs approve <slug>, then render without --preview.
// Options: --lang en|all --format 9:16 --fps 30 --from 0 --to 4 --out path.mp4
//          --no-audio --no-master --force (explicitly bypass review approval)

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { openFilm, prepareFilm, film as filmSpec, ROOT } from './common.mjs';
import { hashFiles, filmSources } from '../tools/lib/common.mjs';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };


const preview = flag('--preview');
const F = filmSpec(opt('--film', 'example'));
const fps = Number(opt('--fps', preview ? 30 : 60));
const withAudio = !flag('--no-audio') && !F.noAudio;

/** Frames t ∈ [from, to) → ffmpeg (H.264, optional audio, optional half size). */
async function encode(film, { out, wav, from, to, fade }) {
  const nFrames = Math.round((to - from) * fps);
  const vf = preview ? ['-vf', 'scale=iw/2:ih/2:flags=lanczos'] : [];
  const af = wav && fade ? ['-af', `afade=t=out:st=${Math.max(0, to - from - 1.5)}:d=1.5`] : [];
  const args = [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    ...(wav ? ['-ss', String(from), '-t', String(to - from), '-i', wav] : []),
    ...vf,
    '-c:v', 'libx264', '-preset', preview ? 'veryfast' : 'slow', '-crf', preview ? '23' : '15',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-tune', 'film',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    ...af,
    ...(wav ? ['-c:a', 'aac', '-b:a', '256k', '-shortest'] : []),
    '-movflags', '+faststart', out,
  ];
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  const t0 = Date.now();
  for (let i = 0; i < nFrames; i++) {
    const t = from + i / fps;
    const buf = await film.frame(t, 'png');
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % fps === 0 || i === nFrames - 1) {
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`frame ${i + 1}/${nFrames}  t=${t.toFixed(2)}s  ${(el / (i + 1) * 1000).toFixed(0)} ms/frame  eta ${((el / (i + 1)) * (nFrames - i - 1)).toFixed(0)}s\n`);
    }
  }
  ff.stdin.end();
  await done;
}

/** EBU R128 of a finished file (ffmpeg ebur128, independent of our own meter). */
export function loudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const sum = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const num = (re) => { const m = sum.match(re); return m ? +m[1] : null; };
  return { lufs: num(/I:\s+(-?[\d.]+) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), tp: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

// ------------------------------------------------------------------ engine films
function approvalProblem() {
  if (preview || flag('--force')) return null;
  const file = path.join(F.dir, 'approved.json');
  if (!fs.existsSync(file)) return `no approval: look at the preview, then \`node tools/film.mjs approve ${F.slug}\` (or --force)`;
  const ok = JSON.parse(fs.readFileSync(file, 'utf8')).hash === hashFiles(filmSources(F.slug));
  return ok ? null : `film changed since approval: review the preview again, then \`node tools/film.mjs approve ${F.slug}\` (or --force)`;
}
async function renderEngine() {
  const problem = approvalProblem();
  if (problem) { console.error(`final render refused: ${problem}`); process.exit(1); }
  const { toSrt } = await import('../src/engine/narration.js');
  const langs = !opt('--lang') || opt('--lang') === 'all' ? F.languages : opt('--lang').split(',');
  const format = opt('--format', F.formats[0]);
  for (const l of langs) if (!F.languages.includes(l)) throw new Error(`language ${l}: film has ${F.languages.join(', ')}`);
  if (!F.sizes[format] && !F.formats.includes(format)) console.log(`note: ${format} is not in film.formats (${F.formats.join(', ')}); rendering it anyway`);
  if (opt('--out') && langs.length > 1) throw new Error('--out needs a single --lang');
  prepareFilm(F);
  const results = [];
  for (const lang of langs) {
    const V = F.variant({ lang, format, preview });
    const out = path.resolve(ROOT, opt('--out', V.out));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    console.log(`\n== ${F.slug} [${lang} ${format}${preview ? ' preview' : ''}] → ${path.relative(ROOT, out)}`);
    const film = await openFilm({ page: V.page, width: V.size[0], height: V.size[1] });
    const duration = await film.page.evaluate(() => window.DURATION);
    const plan = await film.page.evaluate(() => window.getPlan());
    const from = Number(opt('--from', 0));
    const to = Math.min(Number(opt('--to', duration)), duration);
    let mix = null;
    const job = {
      duration, out: path.join(ROOT, V.wav), stems: path.join(ROOT, V.stems), musicStems: lang === langs[0] ? path.join(ROOT, V.musicStems) : null,
      base: path.join(F.dir, 'audio'), filmDir: path.relative(ROOT, F.dir), sounds: F.sounds,
      cues: await film.page.evaluate(() => window.getCues()), sections: await film.page.evaluate(() => window.getSections()),
      plan: { shots: plan.shots }, music: F.music, levels: F.spec.mix || null,
      master: flag('--no-master') ? false : { lufs: -14, tp: -1, margin: 0.8 },
    };
    const runMix = () => {
      fs.writeFileSync(path.join(ROOT, V.job), JSON.stringify(job, null, 1));
      const r = spawnSync(PY, [path.join(ROOT, 'audio/mix.py'), path.join(ROOT, V.job)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
      if (r.status !== 0) throw new Error('audio/mix.py failed');
      return JSON.parse(r.stdout.trim().split('\n').pop());
    };
    if (withAudio) { mix = runMix(); console.log(`audio: music ${mix.music.engine}${mix.music.preset ? ` (${mix.music.preset})` : ''}, mastered ${mix.lufs} LUFS / ${mix.tp} dBTP`); }
    await encode(film, { out, wav: withAudio ? path.join(ROOT, V.wav) : null, from, to });
    await film.close();

    // measure the delivered file; AAC can lift true peaks: re-master with more headroom once
    let loud = withAudio ? loudness(out) : null;
    if (loud && job.master && loud.tp !== null && loud.tp > -1.0) {
      job.master.margin += 0.7;
      mix = runMix();
      const tmp = out.replace(/\.mp4$/, '.tmp.mp4');
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-ss', String(from), '-t', String(to - from), '-i', path.join(ROOT, V.wav), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', tmp]);
      fs.renameSync(tmp, out);
      loud = loudness(out);
    }
    // subtitles (sidecar .srt): same timing as the burned-in ones
    let srt = null;
    if (plan.subtitles.length && F.spec.subtitles !== false && from === 0) {
      srt = path.join(ROOT, V.srt);
      fs.writeFileSync(srt, toSrt(plan.subtitles));
    }
    const manifest = {
      film: F.slug, lang, format, preview, fps, size: preview ? V.size.map((v) => v / 2) : V.size, duration: +(to - from).toFixed(3),
      out: path.relative(ROOT, out), srt: srt && path.relative(ROOT, srt), loudness: loud, master: mix && { lufs: mix.lufs, tp: mix.tp }, music: mix?.music ?? null,
      sources: hashFiles(filmSources(F.slug)), subtitles: plan.subtitles.length, burnedSubtitles: plan.burnedSubtitles,
      shots: plan.shots.map((s) => ({ id: s.id, type: s.type, t0: +s.t0.toFixed(3), hold: s.hold, ...(s.holdDeclared ? { holdDeclared: s.holdDeclared } : {}) })),
      created: new Date().toISOString(),
    };
    fs.writeFileSync(path.resolve(ROOT, opt('--out') ? out.replace(/\.mp4$/, '.json') : V.manifest), JSON.stringify(manifest, null, 1));
    results.push(manifest);
    console.log(`wrote ${path.relative(ROOT, out)}${srt ? ` + ${path.relative(ROOT, srt)}` : ''}${loud ? `  loudness ${loud.lufs} LUFS, true peak ${loud.tp} dBTP, LRA ${loud.lra} LU` : ''}`);
  }
  if (results.length > 1) for (const r of results) console.log(`  ${r.lang}: ${r.out} (${r.duration}s${r.loudness ? `, ${r.loudness.lufs} LUFS, ${r.loudness.tp} dBTP` : ''})`);
}

await renderEngine();
