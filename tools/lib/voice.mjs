// Narration synthesis for every language of a film (`film.mjs voice`, also run by
// check, stills and render). Output: films/<slug>/audio/voice/<id>.wav (48 kHz mono)
// and voice.json { id: seconds }. A file is made once; ids hash the voice settings
// and the text, Piper is seeded (audio/tts.py), so the same film gives the same audio.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, PY, filmDir, readJSON, exists } from './common.mjs';

const { voiceSpec, voiceUnits } = await import('../../src/engine/narration.js');
const { languagesOf } = await import('../../src/engine/lang.js');

const VOICES = path.join(ROOT, '.voices'); // downloaded Piper models (not in the repo)
const seedOf = (id) => parseInt(id, 16) & 0x7fffffff;
const toWav = (src, wav) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
const seconds = (wav) => +(+execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' })).toFixed(3);

function piperModel(name) {
  if (!name) throw new Error('voice.name required for piper in this language (e.g. "en_US-…-medium"; check its MODEL_CARD licence)');
  const model = path.join(VOICES, `${name}.onnx`);
  if (!exists(model)) {
    fs.mkdirSync(VOICES, { recursive: true });
    execFileSync(PY, ['-m', 'piper.download_voices', '--download-dir', VOICES, name], { stdio: 'inherit' });
  }
  return model;
}

/** Synthesise what is missing; returns voice.json ({ id: seconds }). */
export function synthVoice(slug, film, { log = console.log } = {}) {
  const dir = path.join(filmDir(slug), 'audio/voice');
  const index = path.join(dir, 'voice.json');
  const durations = exists(index) ? readJSON(index) : {};
  const todo = new Map();
  for (const lang of languagesOf(film)) {
    const spec = voiceSpec(film, lang);
    if (!spec) continue;
    (film.shots || []).forEach((shot, i) => {
      for (const u of voiceUnits(film, shot, lang)) {
        const fresh = exists(path.join(dir, `${u.id}.wav`)) && durations[u.id];
        if (!todo.has(u.id) && (!fresh || spec.engine === 'files')) todo.set(u.id, { ...u, lang, spec, shot: { id: shot.id, i } });
      }
    });
  }
  if (!todo.size) return durations;
  fs.mkdirSync(dir, { recursive: true });
  const units = [...todo.values()];

  // piper: one seeded batch (audio/tts.py)
  const piper = units.filter((u) => u.spec.engine === 'piper');
  if (piper.length) {
    const jobs = piper.map((u) => ({
      text: u.text, out: path.join(dir, `${u.id}.wav`), model: piperModel(u.spec.name), speaker: u.spec.speaker,
      length_scale: 1 / (u.spec.speed || 1), seed: u.spec.seed ?? seedOf(u.id), sentence_silence: 0.25,
    }));
    const jobFile = path.join(dir, '_jobs.json');
    fs.writeFileSync(jobFile, JSON.stringify(jobs));
    const got = JSON.parse(execFileSync(PY, [path.join(ROOT, 'audio/tts.py'), jobFile], { encoding: 'utf8', maxBuffer: 1 << 26 }));
    fs.rmSync(jobFile, { force: true });
    for (const u of piper) durations[u.id] = got[path.join(dir, `${u.id}.wav`)];
  }
  // other engines: one call per unit, converted to 48 kHz mono
  for (const u of units.filter((x) => x.spec.engine !== 'piper')) {
    const wav = path.join(dir, `${u.id}.wav`);
    const raw = path.join(dir, `${u.id}.src`);
    if (u.spec.engine === 'files') {
      const vdir = path.join(filmDir(slug), 'voice');
      const base = String(u.shot.id ?? u.shot.i);
      const cands = [path.join(vdir, u.lang), vdir].flatMap((d) => ['wav', 'mp3', 'm4a', 'aiff', 'flac'].map((e) => path.join(d, `${base}.${e}`)));
      const src = cands.find(exists);
      if (!src) throw new Error(`no recording for shot ${base} (${u.lang}): put films/${slug}/voice/${u.lang}/${base}.wav (or .mp3/.m4a)`);
      toWav(src, wav);
    } else if (u.spec.engine === 'command') {
      if (!Array.isArray(u.spec.cmd) || !u.spec.cmd.length) throw new Error('voice.cmd = ["program", "arg", "{text}", "{out}"] required');
      const textfile = raw + '.txt';
      fs.writeFileSync(textfile, u.text);
      const sub = (a) => a.replaceAll('{text}', u.text).replaceAll('{textfile}', textfile).replaceAll('{out}', raw).replaceAll('{lang}', u.lang).replaceAll('{seed}', String(u.spec.seed ?? seedOf(u.id)));
      execFileSync(sub(u.spec.cmd[0]), u.spec.cmd.slice(1).map(sub), { stdio: 'inherit', cwd: ROOT });
      fs.rmSync(textfile, { force: true });
      toWav(raw, wav);
    } else if (u.spec.engine === 'say') {
      execFileSync('say', ['-v', u.spec.name, '-r', String(Math.round(175 * (u.spec.speed || 1))), '-o', raw + '.aiff', u.text]);
      toWav(raw + '.aiff', wav);
      fs.rmSync(raw + '.aiff', { force: true });
    } else {
      throw new Error(`voice.engine "${u.spec.engine}": one of piper, files, command, say`);
    }
    fs.rmSync(raw, { force: true });
    durations[u.id] = seconds(wav);
  }
  fs.writeFileSync(index, JSON.stringify(durations, null, 1));
  const by = {};
  for (const u of units) by[u.lang] = (by[u.lang] || 0) + 1;
  log(`voice: ${units.length} file(s) (${Object.entries(by).map(([l, n]) => `${l} ${n}`).join(', ')})`);
  return durations;
}
