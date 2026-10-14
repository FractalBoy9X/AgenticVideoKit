// Paths and small helpers shared by tools/film.mjs and its commands.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FILMS = path.join(ROOT, 'films');
export const LIB = path.join(ROOT, 'src/library');
export const PY = process.env.PYTHON || [path.join(ROOT, '.venv/bin/python'), path.join(ROOT, '.venv/Scripts/python.exe')].find((p) => fs.existsSync(p)) || (process.platform === 'win32' ? 'python' : 'python3');

export const imp = (p) => import(pathToFileURL(path.join(ROOT, p)));
export const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const filmDir = (s) => {
  if (typeof s !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s)) throw new Error('invalid film slug (use a-z, 0-9 and -)');
  return path.join(FILMS, s);
};
export const rel = (p) => path.relative(ROOT, p);
export const die = (msg) => { console.error(msg); process.exit(1); };
export const exists = (p) => fs.existsSync(p);

/** Films in films/ (folders with a film.json; names starting with _ or . are templates). */
export const filmList = () => fs.readdirSync(FILMS).filter((d) => !/^[_.]/.test(d) && exists(path.join(FILMS, d, 'film.json'))).sort();

/**
 * File of a module reference: "./x" → films/<slug>/modules/x.js (the film's own),
 * "rigs/x" or "lib3d/x" → src/library/<ref>.js, "x" → src/library/modules/x.js.
 */
export function refFile(ref, slug) {
  if (ref.startsWith('./')) return path.join(filmDir(slug), 'modules', ref.slice(2) + '.js');
  if (ref.includes('/')) return path.join(LIB, ref + '.js');
  return path.join(LIB, 'modules', ref + '.js');
}

/** Import a module in Node for its meta / validate (film modules may be browser-only). */
export async function loadModule(file) {
  try { return { mod: await import(pathToFileURL(file)) }; } catch (e) { return { error: e.message.split('\n')[0] }; }
}

/** JSON with short arrays and objects kept on one line (readable film.json). */
export function pretty(v, indent = '') {
  const one = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || one.length + indent.length <= 100) return one;
  const next = indent + '  ';
  if (Array.isArray(v)) return `[\n${v.map((x) => next + pretty(x, next)).join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(v).map(([k, x]) => `${next}${JSON.stringify(k)}: ${pretty(x, next)}`).join(',\n')}\n${indent}}`;
}

/** sha256 (12 hex) over files: what a human approved / what a render was made from. */
export function hashFiles(files) {
  const h = crypto.createHash('sha256');
  for (const f of files.filter(exists).sort()) { h.update(rel(f)); h.update(fs.readFileSync(f)); }
  return h.digest('hex').slice(0, 12);
}

/** Every file that decides how a film looks and sounds (for approval / manifests). */
export function filmSources(slug) {
  const dir = filmDir(slug);
  const walk = (d) => (exists(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
  // Include code, fonts and assets: changing a reusable block or a photo invalidates approval.
  return [path.join(dir, 'film.json'), path.join(dir, 'sounds.py'),
    ...walk(path.join(dir, 'modules')), ...walk(path.join(dir, 'assets')), ...walk(path.join(dir, 'voice')),
    ...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'audio')),
    ...walk(path.join(ROOT, 'render')), ...walk(path.join(ROOT, 'tools')),
    path.join(ROOT, 'package-lock.json'), path.join(ROOT, 'requirements.txt'), path.join(ROOT, 'requirements-tts.txt')]
    .filter((f) => exists(f) && !path.basename(f).startsWith('._') && !f.includes('__pycache__')
      && f !== path.join(LIB, 'index.json') && !f.endsWith('/_contact.jpg'));
}
