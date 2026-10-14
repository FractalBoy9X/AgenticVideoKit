// `film.mjs check <slug>`: everything that can be verified without rendering, for
// every language and format of the film: modules and their params (meta), validate
// hooks, translations, layers, style, music, narration (synthesised here), fitted
// holds, length against the brief, licences of the voices.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, filmDir, readJSON, refFile, loadModule, exists, rel } from './common.mjs';
import { synthVoice } from './voice.mjs';

const { FORMATS, TRANSITIONS, resolveStyle } = await import('../../src/engine/styles.js');
const { PRESETS } = await import('../../src/library/styles.js');
const { SHOT_KEYS, LAYER_KEYS, buildTimeline, buildLayers } = await import('../../src/engine/timeline.js');
const { voiceSpec, narrationLines, planFilm } = await import('../../src/engine/narration.js');
const { LANGS, VETTED_VOICES, languagesOf, formatsOf, multilingual, missingTranslations } = await import('../../src/engine/lang.js');
const INTERNAL = new Set(['sayAll', 'holdDeclared']);

export function typeOk(t, v, dir) {
  if (t.includes('|')) return t.split('|').includes(v) || `one of ${t}`;
  switch (t) {
    case 'string': return typeof v === 'string' || 'string';
    case 'number': return typeof v === 'number' || 'number';
    case 'bool': return typeof v === 'boolean' || 'true/false';
    case 'string[]': return (Array.isArray(v) && v.every((x) => typeof x === 'string')) || 'array of strings';
    case 'number[]': return (Array.isArray(v) && v.every((x) => typeof x === 'number')) || 'array of numbers';
    case 'number[][]': return (Array.isArray(v) && v.every((x) => Array.isArray(x) && x.every((y) => typeof y === 'number'))) || 'array of number arrays';
    case 'object': return (v && typeof v === 'object' && !Array.isArray(v)) || 'object';
    case 'object[]': return (Array.isArray(v) && v.every((x) => x && typeof x === 'object')) || 'array of objects';
    case 'array': return Array.isArray(v) || 'array';
    case 'asset': return (typeof v === 'string' && exists(path.join(dir, v))) || `existing file in films/<slug>/ (${v})`;
    case 'asset-dir': return (typeof v === 'string' && exists(path.join(dir, v, 'clip.json'))) || `folder with clip.json (${v}); run ingest`;
    default: return true; // 'any' or free-form
  }
}

function checkMusic(film, dir, errors, warns) {
  const m = film.music;
  if (m === undefined || m === 'none') return;
  const spec = typeof m === 'string' ? { engine: 'file', src: m } : m;
  const engine = spec.engine || 'none';
  if (!['file', 'command', 'none'].includes(engine)) errors.push(`music.engine "${engine}": one of file, command, none (provide your own generator)`);
  if (engine === 'file' && !(spec.src && exists(path.join(dir, spec.src)))) errors.push(`music.src: file not found in films/<slug>/ (${spec.src})`);
  if (engine === 'command') {
    if (!Array.isArray(spec.cmd) || !spec.cmd.some((a) => a.includes('{out}'))) errors.push('music.cmd = ["program", …, "{plan}", "{out}"] required');
    warns.push('music engine "command": the generator (code and weights) must have suitable terms for your intended use; record them in brief.json');
  }
  if (engine === 'file') warns.push(`music file ${spec.src}: record its source and terms in brief.json`);
}

export async function check(slug, { log = console.log } = {}) {
  const dir = filmDir(slug);
  const errors = [], warns = [], infos = [];
  let raw;
  try { raw = readJSON(path.join(dir, 'film.json')); } catch (e) { return { errors: [`film.json: ${e.message}`], warns, infos, total: 0 }; }
  const brief = exists(path.join(dir, 'brief.json')) ? readJSON(path.join(dir, 'brief.json')) : null;
  const langs = languagesOf(raw), formats = formatsOf(raw);
  for (const l of langs) if (!LANGS[l]) errors.push(`language "${l}": one of ${Object.keys(LANGS).join(', ')} (add it to src/engine/lang.js)`);
  for (const f of formats) if (!FORMATS[f]) errors.push(`format "${f}": one of ${Object.keys(FORMATS).join(', ')}`);
  if (!Array.isArray(raw.shots) || !raw.shots.length) return { errors: [...errors, 'film.json has no shots'], warns, infos, total: 0 };
  if (raw.in && !TRANSITIONS.includes(raw.in)) errors.push(`film.in: one of ${TRANSITIONS.join(', ')}`);
  const audio = raw.audio ?? 'auto';
  if (audio !== 'auto' && audio !== 'none' && !exists(path.join(dir, audio))) errors.push(`audio file not found: films/${slug}/${audio}`);
  checkMusic(raw, dir, errors, warns);
  if (raw.fonts !== undefined && !Array.isArray(raw.fonts)) errors.push('fonts must be an array');
  else for (const font of raw.fonts || []) if (!font || typeof font.family !== 'string' || typeof font.src !== 'string' || !exists(path.join(dir, font.src))) errors.push('font requires family and an existing src in the film folder');
  for (const m of missingTranslations(raw)) errors.push(`translation missing: ${m}`);
  if (raw.sections !== undefined && !Array.isArray(raw.sections)) errors.push('sections must be an array for your music generator');
  if (raw.subtitles !== undefined && ![true, false, 'srt'].includes(raw.subtitles)) errors.push('subtitles: true | false | "srt"');
  for (const lang of langs.filter((l) => LANGS[l])) {
    const v = voiceSpec(raw, lang);
    if (!v || !raw.shots.some((s) => s.say)) continue;
    if (v.engine === 'say') warns.push(`voice ${lang} "say": macOS-specific draft adapter; review applicable terms before distribution`);
    if (v.engine === 'piper' && !VETTED_VOICES[v.name]) warns.push(`voice ${lang} "${v.name}": review its model card and dataset terms before distribution`);
    if (v.engine === 'command') warns.push(`voice ${lang} engine "command": the TTS (code and weights) must have a commercial licence; add it to AGENTS.md`);
  }
  const ids = raw.shots.map((x) => x.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) errors.push('shot ids must be unique');
  if (errors.length) return { errors, warns, infos, total: 0 };

  // narration first: the holds of a multilingual film follow it
  let durations = {};
  try { durations = synthVoice(slug, raw, { log }); } catch (e) { errors.push(`voice: ${e.message.split('\n')[0]}`); }

  const metas = {};
  // rigs of every world's cast, for the validate hooks of shots (env.meta)
  const rigMeta = {};
  for (const l of raw.layers || []) for (const r of Object.values(l.cast || {})) {
    const ref = String(r).startsWith('./') ? r : `rigs/${r}`;
    if (!(ref in rigMeta) && exists(refFile(ref, slug))) rigMeta[ref] = (await loadModule(refFile(ref, slug))).mod?.meta || null;
  }
  const seen = new Set();
  const once = (list, msg) => { if (!seen.has(msg)) { seen.add(msg); list.push(msg); } };
  let total = 0, primaryShots = null;
  for (const lang of langs) for (const format of formats) {
    const tag = langs.length * formats.length > 1 ? `[${lang} ${format}] ` : '';
    const film = planFilm(raw, { lang, format, durations });
    const { style, error } = resolveStyle(film.style, PRESETS);
    if (error) { once(errors, `style: ${error}`); continue; }
    const clips = [...(film.layers || []).map((x, i) => [`layer ${x.id || i} (${x.type})`, x, LAYER_KEYS]),
      ...film.shots.map((x, i) => [`shot ${x.id || i} (${x.type})`, x, SHOT_KEYS])];
    for (const [at, x, keys] of clips) {
      if (typeof x.type !== 'string') { once(errors, `${at}: missing type`); continue; }
      const file = refFile(x.type, slug);
      if (!exists(file)) { once(errors, `${at}: no module file ${rel(file)}`); continue; }
      if (!(x.type in metas)) {
        const { mod, error: e } = await loadModule(file);
        metas[x.type] = mod || null;
        if (e) once(warns, `${x.type}: not importable in Node (${e}); params not checked`);
        else if (!mod.meta) once(warns, `${x.type}: no meta export; params not checked`);
        if (mod && typeof mod.default !== 'function') once(errors, `${x.type}: no default export create(ctx, clip)`);
      }
      const mod = metas[x.type];
      const params = mod?.meta?.params;
      if (params) {
        for (const [k, [t, req]] of Object.entries(params)) {
          if (x[k] === undefined) { if (req) once(errors, `${tag}${at}: missing ${k}`); continue; }
          const ok = typeOk(t, x[k], dir);
          if (ok !== true) once(errors, `${tag}${at}: ${k} must be ${ok}`);
        }
        for (const k of Object.keys(x)) if (!keys.includes(k) && !params[k] && !INTERNAL.has(k)) once(warns, `${at}: unknown key "${k}" (ignored)`);
      }
      const env = { slug, lang, format, exists: (ref) => exists(refFile(ref, slug)), assetExists: (p) => exists(path.join(dir, p)), meta: (ref) => rigMeta[ref] };
      if (mod?.validate) for (const e of mod.validate(x, film, env) || []) once(errors, `${tag}${at}: ${e}`);
      if (keys === SHOT_KEYS) {
        if (typeof x.hold !== 'number' || x.hold <= 0) once(errors, `${at}: hold must be a positive number of seconds`);
        else if (x.hold < 1.5) once(warns, `${at}: hold ${x.hold}s is very short`);
        if (x.in && !TRANSITIONS.includes(x.in)) once(errors, `${at}: in — one of ${TRANSITIONS.join(', ')}`);
        if (x.caption && !(Array.isArray(x.caption) && x.caption.length >= 2)) once(errors, `${at}: caption = [index, name, tagline]`);
        if (x.energy !== undefined && !(typeof x.energy === 'number' && x.energy >= 0 && x.energy <= 1)) once(errors, `${at}: energy must be 0–1`);
      }
    }
    if (errors.length) continue;
    const { shots, DURATION } = buildTimeline(film, style);
    if (!primaryShots) { primaryShots = shots; total = DURATION; }
    for (const e of buildLayers(film, shots, DURATION).errors) once(errors, e);
    if (!multilingual(raw)) {
      for (const l of narrationLines(shots, film, durations, lang)) {
        const s = shots[l.shot];
        const room = s.t1 + (s.in === 'cross' ? 0.3 : 0) - l.t1;
        if (room < 0) once(errors, `shot ${s.id || s.i}: narration ends ${(-room).toFixed(1)}s after the shot (${(l.t1 - l.t0).toFixed(1)}s of speech) — raise hold to ≥ ${Math.ceil((l.t1 - s.t0 + 0.4) * 10) / 10} or shorten "say"`);
      }
    }
  }
  if (primaryShots && multilingual(raw)) {
    for (const s of primaryShots) if (s.holdDeclared !== undefined) infos.push(`shot ${s.id || s.i}: hold ${s.holdDeclared} → ${s.hold} s (fitted to the longest narration)`);
  }
  if (brief?.duration && total) {
    const [lo, hi] = brief.duration;
    if (total < lo || total > hi) errors.push(`duration ${total.toFixed(1)}s outside the brief's ${lo}–${hi}s`);
  }
  if (brief?.format && !formats.includes(brief.format)) warns.push(`format ${formats.join(', ')} differs from the brief (${brief.format})`);
  return { errors, warns, infos, total, langs, formats, shots: raw.shots.length, layers: (raw.layers || []).length };
}

export async function cmdCheck(slug) {
  const r = await check(slug);
  for (const i of r.infos) console.log('info ', i);
  for (const w of r.warns) console.log('warn ', w);
  for (const e of r.errors) console.log('ERROR', e);
  const what = r.langs ? `${r.shots} shots, ${r.layers} layers, ${r.total.toFixed(1)}s, ${r.formats.join(' + ')}, ${r.langs.join(' + ')}` : '';
  console.log(`${r.errors.length ? 'FAIL' : 'OK'}: ${what}`);
  return r.errors.length ? 1 : 0;
}
