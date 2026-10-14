// Languages and formats: one film.json, many renders. Shared by the engine and
// tools/film.mjs (no DOM, no Node, no imports).
//
//   film.languages: ["pl", "en"]     every render is one language; the first is the primary
//   any value: { "pl": "…", "en": "…" }  (an object whose keys are all language codes)
//   shot.say: { "pl": "…", "en": "…" }    narration per language (each with its own voice)
//   film.formats: ["16:9", "9:16"]   one source, several frames
//   "9:16": { …overrides }           on the film, a shot or a layer: used only in that format
//
// A new language = one entry in LANGS and a user-selected voice with suitable terms.

export const LANGS = {
  pl: { name: 'polski', locale: 'pl-PL', cps: 14, voice: { engine: 'piper', name: 'pl_PL-gosia-medium' } },
  en: { name: 'English', locale: 'en-US', cps: 15, voice: { engine: 'piper', name: 'en_US-ljspeech-high' } },
};

/** Optional user-reviewed voice notes. No models are pre-verified or bundled. */
export const VETTED_VOICES = {};

const FORMAT_KEY = /^\d+:\d+$/;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** { pl: …, en: … }: a value given per language. */
export const isLoc = (v) => isObj(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => k in LANGS);

/** Films that declare `languages` use the bilingual rules (per-sentence voice, fitted holds). */
export const multilingual = (film) => Array.isArray(film.languages) && film.languages.length > 0;
export const languagesOf = (film) => (multilingual(film) ? film.languages : [film.language || 'pl']);
export const formatsOf = (film) => (Array.isArray(film.formats) && film.formats.length ? film.formats : [film.format || '16:9']);

/** The value for `lang` (falls back to the primary language, then any). */
export function localize(v, lang, primary) {
  if (isLoc(v)) return v[lang] ?? v[primary] ?? Object.values(v)[0];
  if (Array.isArray(v)) return v.map((x) => localize(x, lang, primary));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, localize(x, lang, primary)]));
  return v;
}

/** obj with its `format` overrides merged in (one level deep) and all format keys removed. */
export function applyFormat(obj, format) {
  if (!isObj(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!FORMAT_KEY.test(k)) out[k] = v;
  const o = obj[format];
  if (isObj(o)) for (const [k, v] of Object.entries(o)) out[k] = isObj(v) && isObj(out[k]) && !isLoc(v) ? { ...out[k], ...v } : v;
  return out;
}

/** Narration text of a shot in `lang`, or null. A plain string belongs to the primary language. */
export function sayText(shot, lang, film) {
  const s = shot.say;
  if (!s) return null;
  if (typeof s === 'string') return lang === languagesOf(film)[0] ? s : null;
  return isLoc(s) ? s[lang] || null : null;
}

/**
 * The film as one render sees it: format overrides applied, every { pl, en } value
 * resolved to `lang`, holds replaced by `holds` (fitted to the narration). Each shot
 * keeps its narration per language in `sayAll` and its own hold in `holdDeclared`;
 * `voice` stays as written (narration.js reads it per language).
 */
export function resolveFilm(film, { lang, format, holds } = {}) {
  const langs = languagesOf(film);
  lang = lang || langs[0];
  format = format || formatsOf(film)[0];
  const primary = langs[0];
  const f = applyFormat(film, format);
  const shot = (s, i) => {
    const x = applyFormat(s, format);
    const sayAll = Object.fromEntries(langs.map((l) => [l, sayText(x, l, film)]).filter(([, v]) => v));
    const { say, ...rest } = x;
    const out = localize(rest, lang, primary);
    if (sayAll[lang]) out.say = sayAll[lang];
    if (Object.keys(sayAll).length) out.sayAll = sayAll;
    if (holds && holds[i] !== undefined && holds[i] !== x.hold) { out.holdDeclared = x.hold; out.hold = holds[i]; }
    return out;
  };
  const { shots, layers, voice, ...top } = f;
  return {
    ...localize(top, lang, primary),
    ...(voice !== undefined ? { voice } : {}),
    language: lang, format,
    ...(multilingual(film) ? { languages: langs } : {}),
    shots: (shots || []).map(shot),
    ...(layers ? { layers: layers.map((l) => localize(applyFormat(l, format), lang, primary)) } : {}),
  };
}

/** Every { pl, en } value lacking one of the film's languages: ["shots[2].text: en", …]. */
export function missingTranslations(film) {
  const langs = languagesOf(film);
  const out = [];
  const walk = (v, where) => {
    if (isLoc(v)) { for (const l of langs) if (!v[l]) out.push(`${where}: ${l}`); return; }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, where ? `${where}.${k}` : k);
  };
  walk(film, '');
  if (multilingual(film)) (film.shots || []).forEach((s, i) => {
    if (typeof s.say === 'string' && langs.length > 1) out.push(`shots[${i}].say: one text for ${langs.length} languages; write { ${langs.map((l) => `"${l}": "…"`).join(', ')} }`);
  });
  return out;
}
