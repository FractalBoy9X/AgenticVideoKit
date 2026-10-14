// Discover and promote the user's own modules, rigs, styles and sound generators.
// The shared library starts empty; there are no stock scenes or sounds.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, LIB, PY, FILMS, filmDir, filmList, readJSON, loadModule, exists, rel, die, imp, pretty } from './common.mjs';

const INDEX = path.join(LIB, 'index.json');

const fold = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
const tokens = (s) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
const listJs = (dir) => (exists(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !/^[_.]/.test(f)).sort() : []);

async function moduleEntries(dir, defKind, origin) {
  const out = [];
  for (const f of listJs(dir)) {
    const file = path.join(dir, f);
    const { mod, error } = await loadModule(file);
    const m = mod?.meta;
    const name = f.slice(0, -3);
    if (!m) { out.push({ kind: defKind, name, path: rel(file), about: `(no meta${error ? `: ${error}` : ''})`, tags: [], incomplete: ['meta'] }); continue; }
    const kind = m.kind || defKind;
    out.push({ kind, name, path: rel(file), about: m.about || '', tags: m.tags || [], params: m.params || {}, example: m.example, api: m.api, actions: m.actions, origin: m.origin || origin, cost: m.cost });
  }
  return out;
}

/** A film's own modules (films/<slug>/modules), named "./<file>" as film.json refers to them. */
export async function filmModules(slug) {
  return (await moduleEntries(path.join(filmDir(slug), 'modules'), 'shot', `films/${slug}`)).map((e) => ({ ...e, name: `./${e.name}` }));
}

/** Build the index from the library files (cached in src/library/index.json by mtime). */
export async function buildIndex({ films = false } = {}) {
  const watched = [path.join(LIB, 'modules'), path.join(LIB, 'rigs'), path.join(LIB, 'styles.js'), path.join(LIB, 'sounds.py')];
  const stamp = watched.filter(exists).map((p) => {
    const st = fs.statSync(p);
    return st.isDirectory() ? fs.readdirSync(p).map((f) => fs.statSync(path.join(p, f)).mtimeMs).reduce((a, b) => Math.max(a, b), st.mtimeMs) : st.mtimeMs;
  }).join(',');
  let entries;
  const cached = exists(INDEX) ? readJSON(INDEX) : null;
  if (cached?.stamp === stamp) entries = cached.entries;
  else {
    entries = [...await moduleEntries(path.join(LIB, 'modules'), 'shot'), ...await moduleEntries(path.join(LIB, 'rigs'), 'rig')];
    const { PRESETS } = await imp('src/library/styles.js');
    for (const [name, s] of Object.entries(PRESETS)) entries.push({ kind: 'style', name, path: 'src/library/styles.js', about: s.about || '', tags: s.tags || [] });
    const py = JSON.parse(execFileSync(PY, [path.join(ROOT, 'tools/pymeta.py'), 'meta', path.join(LIB, 'sounds.py')], { encoding: 'utf8' }));
    for (const k of Object.values(py)[0]) entries.push({ kind: 'sound', name: k.name, path: 'src/library/sounds.py', about: k.about, tags: k.tags, params: k.params, ...(k.documented ? {} : { incomplete: ['META'] }) });
    fs.writeFileSync(INDEX, JSON.stringify({ stamp, entries }, null, 0));
  }
  if (films) {
    for (const slug of filmList()) {
      for (const e of await moduleEntries(path.join(filmDir(slug), 'modules'), 'shot', `films/${slug}`)) entries.push({ ...e, kind: `${e.kind}@${slug}`, film: slug });
    }
  }
  return entries;
}

/** What a block lacks to be a good building block. */
export function incomplete(e) {
  const miss = [...(e.incomplete || [])];
  if (!e.about) miss.push('about');
  if (!e.tags || e.tags.length < 2) miss.push('tags (≥ 2)');
  if (['shot', 'layer', 'world'].includes(e.kind)) {
    if (!e.example) miss.push('example');
    for (const [k, v] of Object.entries(e.params || {})) if (!Array.isArray(v) || !v[2]) miss.push(`params.${k} description`);
  }
  if (e.kind === 'rig' && !(e.actions && Object.keys(e.actions).length)) miss.push('actions');
  return miss;
}

function score(e, q) {
  const fields = [[e.name, 6], [(e.tags || []).join(' '), 4], [e.kind, 3], [e.about, 2], [Object.keys(e.params || {}).join(' '), 1],
    [Object.keys(e.actions || {}).join(' ') + ' ' + (e.beats || []).join(' '), 1.5]];
  let total = 0;
  for (const t of q) {
    let best = 0;
    for (const [text, w] of fields) {
      for (const x of tokens(text || '')) {
        const m = x === t ? 1 : x.startsWith(t) && t.length >= 3 ? 0.8 : t.startsWith(x) && x.length >= 4 ? 0.7
          : t.length >= 5 && x.length >= 5 && x.slice(0, 5) === t.slice(0, 5) ? 0.6 : t.length >= 4 && x.includes(t) ? 0.4 : 0;
        best = Math.max(best, m * w);
      }
    }
    total += best;
  }
  return total;
}

const paramLine = (e) => Object.entries(e.params || {}).map(([k, v]) => (Array.isArray(v) ? `${k}${v[1] ? '*' : ''}` : k)).join(' · ');

function line(e, { example = false } = {}) {
  const out = [`${e.kind.padEnd(6)} ${e.name.padEnd(12)} ${e.about}${e.tags?.length ? `  #${e.tags.slice(0, 6).join(' #')}` : ''}`];
  const extra = [e.kind === 'rig' && e.actions ? `actions: ${Object.keys(e.actions).join(' ')}` : '', e.api ? `api: ${Object.keys(e.api).join(', ')}` : '',
    paramLine(e) ? `params: ${paramLine(e)}` : ''].filter(Boolean);
  if (extra.length) out.push(`       ${extra.join(' | ')}`);
  if (example && e.example) out.push(`       e.g. ${JSON.stringify(e.example)}`);
  return out.join('\n');
}

export async function cmdFind(args) {
  const kindArg = args.includes('--kind') ? args[args.indexOf('--kind') + 1] : null;
  const words = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--kind' && args[i - 1] !== '--n');
  const q = tokens(words.join(' '));
  const entries = (await buildIndex({ films: args.includes('--films') })).filter((e) => !kindArg || e.kind.split('@')[0] === kindArg);
  if (!q.length) { console.log('usage: film.mjs find <words…> [--kind shot|layer|world|rig|style|sound] [--films]'); return 1; }
  const hits = entries.map((e) => [score(e, q), e]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, Number(args.includes('--n') ? args[args.indexOf('--n') + 1] : 8));
  if (!hits.length) { console.log('no block matches; implement your own film module (see AGENTS.md)'); return 0; }
  if (args.includes('--short')) for (const [, e] of hits) console.log(`${e.kind.padEnd(6)} ${e.name.padEnd(9)} #${(e.tags || []).slice(0, 3).join(' #')}`);
  else for (const [, e] of hits) console.log(line(e, { example: hits.length <= 3 }));
  return 0;
}

export async function cmdShow(name) {
  const entries = await buildIndex({ films: true });
  const hits = entries.filter((e) => e.name === name || `${e.kind}:${e.name}` === name);
  if (!hits.length) die(`no block "${name}" (film.mjs find <words>)`);
  for (const e of hits) {
    console.log(`${e.kind} ${e.name} (${e.path}${e.origin ? `, from ${e.origin}` : ''})\n  ${e.about}`);
    if (e.tags?.length) console.log(`  tags: ${e.tags.join(', ')}`);
    for (const [k, v] of Object.entries(e.params || {})) console.log(Array.isArray(v) ? `  ${k}${v[1] ? '*' : ''}: ${v[0]} — ${v[2] || ''}` : `  ${k}: ${v}`);
    for (const [k, v] of Object.entries(e.api || {})) console.log(`  api ${k}: ${v}`);
    for (const [k, v] of Object.entries(e.actions || {})) console.log(`  action ${k}: ${v}`);
    if (e.beats) console.log(`  beats: ${e.beats.join(' → ')}`);
    if (e.example) console.log(`  e.g. ${JSON.stringify(e.example)}`);
  }
  return 0;
}

export async function cmdCatalog(slug, { SHOT_KEYS, LAYER_KEYS, FORMATS, TRANSITIONS }) {
  const entries = await buildIndex();
  const out = ['# BLOCKS ("type": "<name>" for shot/layer/world; rigs go into a world\'s cast; film.mjs show <name> for details)',
    `  every shot also takes: ${SHOT_KEYS.filter((k) => k !== 'type').join(', ')}, "9:16": {overrides}`,
    `  every layer also takes: ${LAYER_KEYS.filter((k) => k !== 'type').join(', ')}`];
  for (const kind of ['shot', 'layer', 'world', 'rig', 'style', 'sound']) {
    const list = entries.filter((e) => e.kind === kind);
    if (!list.length) continue;
    out.push(`\n## ${kind}`);
    for (const e of list) out.push(kind === 'sound' ? `  ${e.name} — ${e.about}` : line(e));
  }
  if (slug) {
    const own = await moduleEntries(path.join(filmDir(slug), 'modules'), 'shot', `films/${slug}`);
    if (own.length) { out.push(`\n## films/${slug}/modules ("type": "./<name>")`); for (const e of own) out.push(line(e, { example: true })); }
  }
  out.push(`\n# FORMATS  ${Object.entries(FORMATS).map(([k, [w, h]]) => `${k} (${w}×${h})`).join(', ')}`);
  out.push(`# TRANSITIONS  ${TRANSITIONS.join(', ')}`);
  console.log(out.join('\n'));
  return 0;
}

export async function cmdLint() {
  const entries = await buildIndex();
  let bad = 0;
  for (const e of entries) {
    const miss = incomplete(e);
    if (miss.length) { bad++; console.log(`${e.kind} ${e.name}: ${miss.join(', ')}`); }
  }
  console.log(`${bad ? 'FAIL' : 'OK'}: ${entries.length} blocks${bad ? `, ${bad} incomplete` : ', complete meta'}`);
  return bad ? 1 : 0;
}

// ------------------------------------------------------------------ promote
const IMPORT_RE = /(from\s+|import\s*\(\s*)(['"])(\.\/_[\w-]+\.js)\2/g;

export async function cmdPromote(slug, what, args) {
  if (!slug || !what) die('usage: film.mjs promote <slug> <module | style | sound:<kind>> [--as <name>]');
  const as = args.includes('--as') ? args[args.indexOf('--as') + 1] : null;
  if (what === 'style') return promoteStyle(slug, as);
  if (what.startsWith('sound:')) {
    const kind = what.slice(6);
    const r = JSON.parse(execFileSync(PY, [path.join(ROOT, 'tools/pymeta.py'), 'promote', path.join(filmDir(slug), 'sounds.py'), kind, path.join(LIB, 'sounds.py')], { encoding: 'utf8' }));
    console.log(`sound "${kind}" → src/library/sounds.py (with ${r.copied.length - 1} helper(s))${r.meta ? '' : '; add META["' + kind + '"] = {about, tags, params}'}`);
    return 0;
  }
  const src = path.join(filmDir(slug), 'modules', `${what}.js`);
  if (!exists(src)) die(`no module films/${slug}/modules/${what}.js`);
  const { mod, error } = await loadModule(src);
  if (!mod?.meta) die(`${what}: ${error || 'no meta export'}`);
  const kind = mod.meta.kind || 'shot';
  const miss = incomplete({ ...mod.meta, kind, name: what, params: mod.meta.params || {} });
  if (miss.length) die(`${what}: complete its meta before promoting: ${miss.join(', ')}`);
  const name = as || what;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || !/^[a-z0-9][a-z0-9-]*$/.test(what)) die('module names: use a-z, 0-9 and -');
  const destDir = path.join(LIB, kind === 'rig' ? 'rigs' : 'modules');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${name}.js`);
  if (exists(dest)) die(`${rel(dest)} exists; pick another name with --as`);
  // the module and the film-local helpers (./_x.js) it imports, recursively
  const copied = [];
  const copy = (file, target) => {
    let text = fs.readFileSync(file, 'utf8').replaceAll("'../../../src/", "'../../").replaceAll('"../../../src/', '"../../');
    text = text.replace(IMPORT_RE, (m, pre, q, ref) => {
      const from = path.join(path.dirname(file), ref);
      let to = path.join(destDir, path.basename(ref));
      if (exists(to) && fs.readFileSync(to, 'utf8') !== fs.readFileSync(from, 'utf8')) to = path.join(destDir, `_${name}-${path.basename(ref).slice(1)}`);
      if (!copied.includes(to)) copy(from, to);
      return `${pre}${q}./${path.basename(to)}${q}`;
    });
    if (file === src) {
      text = text.replace(/export const meta = \{/, `export const meta = {\n  origin: 'films/${slug}',`).replace(/(['"])type\1\s*:\s*(['"])\.\/([\w-]+)\2/g, `$1type$1: $2${name}$2`)
        .replace(/type:\s*(['"])\.\/([\w-]+)\1/g, `type: $1${name}$1`);
    }
    if (!exists(target)) { fs.writeFileSync(target, text); copied.push(target); }
  };
  copy(src, dest);
  console.log(`promoted ${what} → ${copied.map(rel).join(', ')}`);
  console.log(`films/${slug} still uses its own copy; "type": "${name}" uses the library one. Check: node tools/film.mjs lint`);
  return 0;
}

function promoteStyle(slug, as) {
  const film = readJSON(path.join(filmDir(slug), 'film.json'));
  if (!film.style || typeof film.style !== 'object') die(`films/${slug}: style is not an inline object`);
  const name = as || slug.replace(/[^a-z0-9]+/g, '_');
  const file = path.join(LIB, 'styles.js');
  let text = fs.readFileSync(file, 'utf8');
  if (new RegExp(`\\n  ${name}: \\{`).test(text)) die(`style preset "${name}" exists; pick another with --as`);
  const st = { ...film.style };
  if (!st.about) die('add "about" (one sentence) and "tags" to the film style before promoting it');
  if (!st.tags) st.tags = [];
  const body = pretty({ origin: `films/${slug}`, ...st }, '  ');
  text = text.replace(/\n};\s*$/, `\n\n  ${name}: ${body},\n};\n`);
  fs.writeFileSync(file, text);
  console.log(`style "${name}" → src/library/styles.js ("style": "${name}" or { "extends": "${name}", … })`);
  return 0;
}

export { FILMS };
