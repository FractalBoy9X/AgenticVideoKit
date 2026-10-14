// Subtitles (.srt) of every language of a film, timed exactly as the render times
// them (same planFilm + narrationLines). Used by `film.mjs srt` and render/render.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { filmDir, readJSON } from './common.mjs';

/** Subtitles of every language, timed exactly as the render times them. */
export async function writeSrt(s, { log = console.log, names } = {}) {
  const { synthVoice } = await import('./voice.mjs');
  const { planFilm, narrationLines, toSrt } = await import('../../src/engine/narration.js');
  const { languagesOf, formatsOf, multilingual } = await import('../../src/engine/lang.js');
  const { resolveStyle } = await import('../../src/engine/styles.js');
  const { PRESETS } = await import('../../src/library/styles.js');
  const { buildTimeline } = await import('../../src/engine/timeline.js');
  const raw = readJSON(path.join(filmDir(s), 'film.json'));
  if (raw.subtitles === false || !(raw.shots || []).some((x) => x.say)) return [];
  const durations = synthVoice(s, raw, { log });
  const out = [];
  for (const lang of languagesOf(raw)) {
    const film = planFilm(raw, { lang, format: formatsOf(raw)[0], durations });
    const { shots } = buildTimeline(film, resolveStyle(film.style, PRESETS).style);
    const subs = narrationLines(shots, film, durations, lang).flatMap((l) => l.subs);
    if (!subs.length) continue;
    const file = names ? names(lang) : path.join(filmDir(s), 'output', multilingual(raw) ? `${s}.${lang}.srt` : `${s}.srt`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, toSrt(subs));
    out.push(file);
  }
  return out;
}
