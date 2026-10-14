// Film pipeline CLI (engine films in films/<slug>/). See AGENTS.md.
//
//   new <slug> [brief.json]        scaffold films/<slug>/ (brief + script.json template)
//   ingest <slug> [dir]            materials → assets/ + index.json + _contact.jpg
//   sketch <slug> [--force]        script.json (or brief) → film.json + shots.md (shot list)
//   find <words…> [--kind k]       search the user's modules, rigs, worlds, sounds and styles
//   show <name> | catalog [slug] | lint
//   check <slug>                   validate every language × format (+ synthesise narration)
//   voice <slug>                   narration only (all languages) → audio/voice/
//   srt <slug>                     subtitles → output/<slug>.<lang>.srt
//   approve <slug>                 record human acceptance of the current film (needed for a final render)
//   promote <slug> <module|style|sound:<kind>> [--as name]   move a film's block into the library

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, FILMS, filmDir, readJSON, exists, die, hashFiles, filmSources } from './lib/common.mjs';

const [cmd, slug, arg, ...rest] = process.argv.slice(2);
const args = process.argv.slice(3);

async function cmdNew() {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) die('usage: film.mjs new <slug> [brief.json]  (a-z, 0-9, -)');
  const dir = filmDir(slug);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  if (arg) fs.copyFileSync(path.resolve(arg), path.join(dir, 'brief.json'));
  else if (!exists(path.join(dir, 'brief.json'))) fs.copyFileSync(path.join(FILMS, '_template/brief.json'), path.join(dir, 'brief.json'));
  fs.mkdirSync(path.join(dir, 'modules'), { recursive: true });
  const sample = path.join(dir, 'modules/message.js');
  if (!exists(sample) && !exists(path.join(dir, 'script.json')) && !exists(path.join(dir, 'film.json'))) fs.copyFileSync(path.join(FILMS, '_template/modules/message.js'), sample);
  const script = path.join(dir, 'script.json');
  if (!exists(script) && !exists(path.join(dir, 'film.json'))) fs.copyFileSync(path.join(FILMS, '_template/script.json'), script);
  console.log(`films/${slug}/ ready${exists(path.join(dir, 'brief.json')) ? ' (brief.json present)' : ''}; write script.json, then: node tools/film.mjs sketch ${slug}`);
  return 0;
}

async function cmdVoice() {
  if (!slug) die('usage: film.mjs voice <slug>');
  const { synthVoice } = await import('./lib/voice.mjs');
  try { synthVoice(slug, readJSON(path.join(filmDir(slug), 'film.json'))); } catch (e) { die(`voice: ${e.message.split('\n')[0]}`); }
  return 0;
}

async function cmdSrt() {
  if (!slug) die('usage: film.mjs srt <slug>');
  const { writeSrt } = await import('./lib/srt.mjs');
  for (const f of await writeSrt(slug)) console.log(`→ ${path.relative(ROOT, f)}`);
  return 0;
}

async function cmdApprove() {
  if (!slug) die('usage: film.mjs approve <slug>');
  const files = filmSources(slug);
  const rec = { hash: hashFiles(files), at: new Date().toISOString(), files: files.map((f) => path.relative(filmDir(slug), f)) };
  fs.writeFileSync(path.join(filmDir(slug), 'approved.json'), JSON.stringify(rec, null, 1));
  console.log(`approved films/${slug} (${rec.hash}); a final render is allowed until the film, its assets or pipeline sources change`);
  return 0;
}

const lib = () => import('./lib/library.mjs');
const CMDS = {
  new: cmdNew,
  ingest: async () => (await import('./lib/ingest.mjs')).cmdIngest(slug, arg),
  sketch: async () => (await import('./lib/sketch.mjs')).cmdSketch(slug, args),
  find: async () => (await lib()).cmdFind(args),
  show: async () => (await lib()).cmdShow(slug),
  lint: async () => (await lib()).cmdLint(),
  catalog: async () => {
    const { SHOT_KEYS, LAYER_KEYS } = await import('../src/engine/timeline.js');
    const { FORMATS, TRANSITIONS } = await import('../src/engine/styles.js');
    return (await lib()).cmdCatalog(slug, { SHOT_KEYS, LAYER_KEYS, FORMATS, TRANSITIONS });
  },
  check: async () => { if (!slug) die('usage: film.mjs check <slug>'); return (await import('./lib/check.mjs')).cmdCheck(slug); },
  voice: cmdVoice,
  srt: cmdSrt,
  approve: cmdApprove,
  promote: async () => (await lib()).cmdPromote(slug, arg, rest),
};

if (!CMDS[cmd]) die(`usage: film.mjs ${Object.keys(CMDS).join('|')} …  (see the header of tools/film.mjs)`);
process.exitCode = await CMDS[cmd]();
