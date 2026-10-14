// Narration: a shot's `say` becomes voice-over (synthesised by `tools/film.mjs voice`,
// cached in films/<slug>/audio/voice/) and subtitles. Shared by the engine and
// tools/film.mjs (no DOM, no Node).
//
// film.voice: "none" | { engine, name, speed, speaker, gain, seed, cmd }      one voice (primary language)
//           | { "pl": { … } | "none", "en": { … } }                          one voice per language
//   engine "piper"   local, default; voices per language in lang.js (licences: AGENTS.md)
//   engine "files"   your recordings: films/<slug>/voice/[<lang>/]<shot id or index>.(wav|mp3|m4a|aiff)
//   engine "command" any TTS: cmd = ["prog", "--text", "{text}", "--out", "{out}"] ({textfile}, {lang} too)
//   engine "say"     macOS draft adapter; review applicable terms before distribution
// film.subtitles: true (burned in + .srt) | "srt" (sidecar only) | false
// shot.say: "text" | { "pl": "…", "en": "…" };  shot.sayAt: seconds after the shot starts (0.5)
//
// Multilingual films (film.languages) speak sentence by sentence: every subtitle is
// exactly as long as its own audio, and a shot's hold grows to fit the longest
// language (fitHolds). Films without `languages` keep the one-file-per-line timing.

import { LANGS, applyFormat, formatsOf, isLoc, languagesOf, multilingual, resolveFilm, sayText } from './lang.js';

const GAP = 0.25;   // silence between two sentences of one line (as Piper's sentence silence)
const TAIL = 0.4;   // room after the last word before the shot may end

/** Voice settings for `lang`, or null (no voice: subtitles only). */
export function voiceSpec(film, lang) {
  const langs = languagesOf(film);
  lang = lang || langs[0];
  if (film.voice === 'none') return null;
  let v = typeof film.voice === 'object' && film.voice ? film.voice : {};
  if (isLoc(v)) v = v[lang] ?? {};
  else if (lang !== langs[0]) v = v.engine && v.engine !== 'piper' ? v : { speed: v.speed, gain: v.gain };
  if (v === 'none') return null;
  const engine = v.engine || 'piper';
  const def = LANGS[lang]?.voice || {};
  const name = engine === 'piper' ? def.name || null : engine === 'say' ? 'Zosia' : null;
  return { engine, name, speed: 1, gain: 1, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
}

/** Stable file id of one line (FNV-1a over the voice settings and the text). */
export function voiceId(text, spec) {
  const s = `${spec.engine}|${spec.name}|${spec.speed}|${spec.speaker ?? ''}|${(spec.cmd || []).join(' ')}|${text}${spec.seed !== undefined ? `|seed ${spec.seed}` : ''}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Rough spoken length when no voice file exists yet. */
export const estimate = (text, lang) => 0.4 + text.length / (LANGS[lang]?.cps || 14);

/** Subtitle chunks: whole sentences, merged up to ~90 characters. */
export function chunks(text) {
  const parts = text.match(/[^.!?…]+[.!?…]*["”]?\s*/g) || [text];
  const out = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (out.length && out[out.length - 1].length + p.length < 90) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}

/**
 * What has to be synthesised for one shot in one language: [{ id, text }].
 * Multilingual films: one unit per subtitle chunk; others: the whole line.
 */
export function voiceUnits(film, shot, lang) {
  const text = sayText(shot, lang, film);
  const spec = voiceSpec(film, lang);
  if (!text || !spec) return [];
  const per = multilingual(film) && spec.engine !== 'files';
  return (per ? chunks(text) : [text]).map((t) => ({ id: voiceId(t, spec), text: t }));
}

/** Timing of one line from t0: { t1, parts: [{ id, t0, t1, text }] }. */
function timeLine(film, shot, lang, durations, t0) {
  const text = sayText(shot, lang, film);
  const spec = voiceSpec(film, lang);
  const cs = chunks(text);
  if (multilingual(film) && (!spec || spec.engine !== 'files')) {
    let t = t0;
    const parts = cs.map((c) => {
      const id = spec ? voiceId(c, spec) : null;
      const d = (id && durations[id]) || estimate(c, lang);
      const p = { id, t0: t, t1: t + d, text: c };
      t = p.t1 + GAP;
      return p;
    });
    return { t1: parts[parts.length - 1].t1, parts, whole: false };
  }
  // one file per line; subtitles split in proportion to their length
  const id = spec ? voiceId(text, spec) : null;
  const dur = (id && durations[id]) || estimate(text, lang);
  const total = cs.reduce((n, c) => n + c.length, 0);
  let t = t0;
  const parts = cs.map((c) => { const a = t; t += (dur * c.length) / total; return { id, t0: a, t1: t, text: c }; });
  return { t1: t0 + dur, parts, whole: true };
}

/**
 * Holds that fit the narration: for multilingual films a shot lasts at least as long
 * as its longest language needs (sayAt + speech + TAIL). Other films: declared holds.
 */
export function fitHolds(film, durations = {}) {
  const shots = film.shots || [];
  if (!multilingual(film)) return shots.map((s) => s.hold);
  return shots.map((s) => {
    let need = 0;
    for (const lang of languagesOf(film)) {
      if (!sayText(s, lang, film)) continue;
      const L = timeLine(film, s, lang, durations, s.sayAt ?? 0.5);
      need = Math.max(need, L.t1 + (s.sayTail ?? film.sayTail ?? TAIL));
    }
    return typeof s.hold === 'number' && need > s.hold ? Math.ceil(need * 10) / 10 : s.hold;
  });
}

/**
 * One render's view of a film: format overrides, holds fitted to the narration of every
 * language (so all languages share one timeline), values resolved to `lang`.
 */
export function planFilm(film, { lang, format, durations = {} } = {}) {
  format = format || formatsOf(film)[0];
  const holds = fitHolds({ ...film, shots: (film.shots || []).map((s) => applyFormat(s, format)) }, durations);
  return resolveFilm(film, { lang, format, holds });
}

/**
 * Lines of the film in `lang`: [{ shot, t0, t1, text, id, parts, subs: [[t0, t1, text]] }].
 * shots: the timeline (absolute t0); durations: { id: seconds } from voice.json.
 * Voice cues: one per part (`whole` lines: one file for the line, at t0).
 */
export function narrationLines(shots, film, durations = {}, lang) {
  lang = lang || film.language || languagesOf(film)[0];
  return shots.filter((s) => sayText(s.sayAll ? { say: s.sayAll } : s, lang, film)).map((s) => {
    const src = s.sayAll ? { say: s.sayAll } : s;
    const t0 = s.t0 + (s.sayAt ?? 0.5);
    const L = timeLine(film, src, lang, durations, t0);
    const text = sayText(src, lang, film);
    return { shot: s.i, t0, t1: L.t1, text, id: L.parts[0].id, whole: L.whole, parts: L.parts, subs: L.parts.map((p) => [p.t0, p.t1, p.text]) };
  });
}

// ------------------------------------------------------------------ .srt
const stamp = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** Up to two balanced lines of at most `max` characters; longer text → several cues. */
function wrap(text, max) {
  const words = text.replace(/\*/g, '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  if (lines.length === 2) { // balance two lines
    let best = lines, score = Math.abs(lines[0].length - lines[1].length);
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      if (a.length <= max && b.length <= max && Math.abs(a.length - b.length) < score) { best = [a, b]; score = Math.abs(a.length - b.length); }
    }
    return [best.join('\n')];
  }
  const out = [];
  for (let i = 0; i < lines.length; i += 2) out.push(lines.slice(i, i + 2).join('\n'));
  return out;
}

/** subs [[t0, t1, text]] → SubRip text (≤ 2 lines × max characters per cue). */
export function toSrt(subs, max = 42) {
  const cues = [];
  for (const [a, b, text] of subs) {
    const parts = wrap(text, max);
    const total = parts.reduce((n, p) => n + p.length, 0) || 1;
    let t = a;
    for (const p of parts) { const d = ((b - a) * p.length) / total; cues.push([t, t + d, p]); t += d; }
  }
  return cues.map(([a, b, p], i) => `${i + 1}\n${stamp(a)} --> ${stamp(b)}\n${p}\n`).join('\n');
}
