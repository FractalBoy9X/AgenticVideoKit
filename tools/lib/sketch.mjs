// Compile explicit, user-authored beats. No stock modules or genre guesses.
import fs from 'node:fs';
import path from 'node:path';
import { filmDir, readJSON, exists, pretty } from './common.mjs';
import { buildIndex, filmModules } from './library.mjs';
import { estimate } from '../../src/engine/narration.js';

export async function cmdSketch(slug, args = []) {
  const dir = filmDir(slug);
  const script = readJSON(path.join(dir, 'script.json'));
  const briefPath = path.join(dir, 'brief.json');
  const brief = exists(briefPath) ? readJSON(briefPath) : {};
  if (!Array.isArray(script.beats) || !script.beats.length) throw new Error('script.json needs a non-empty beats array');
  const modules = [...await buildIndex(), ...await filmModules(slug)];
  const known = new Map(modules.filter((m) => m.kind === 'shot').map((m) => [m.name, m]));
  const languages = script.languages || brief.languages || ['en'];
  const shots = script.beats.map((beat, i) => {
    const { use, show, intent, ...params } = beat;
    if (!use || !known.has(use)) throw new Error(`beat ${i + 1}: supply "use" naming your own module (e.g. "./message"); missing module: ${use || '(none)'}`);
    const narration = typeof beat.say === 'string' ? [beat.say] : Object.values(beat.say || {});
    const estimated = Math.max(0, ...narration.map((text) => 0.9 + estimate(text)));
    const hold = beat.hold ?? Math.max(3, estimated);
    if (!Number.isFinite(hold) || hold <= 0) throw new Error(`beat ${i + 1}: hold must be positive seconds`);
    return { id: beat.id || `shot-${i + 1}`, ...params, type: use, hold };
  });
  const { beats, ...settings } = script;
  const film = {
    title: brief.title || slug, languages, formats: brief.formats || ['16:9'],
    style: {}, voice: 'none', music: 'none', ...settings, shots,
  };
  const target = exists(path.join(dir, 'film.json')) && !args.includes('--force') ? 'film.draft.json' : 'film.json';
  fs.writeFileSync(path.join(dir, target), pretty(film) + '\n');
  let t = 0;
  const rows = shots.map((s) => { const row = `| ${s.id} | ${t.toFixed(2)} | ${s.hold} | ${s.type} |`; t += s.hold; return row; });
  fs.writeFileSync(path.join(dir, 'shots.md'), `# Shot plan\n\n${shots.length} shots; declared duration ${t.toFixed(2)} seconds. Narration may extend holds.\n\n| id | start (s) | hold (s) | module |\n|---|---:|---:|---|\n${rows.join('\n')}\n`);
  console.log(`sketch: ${shots.length} user-defined shots → films/${slug}/${target}`);
  return 0;
}
