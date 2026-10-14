// Personal reusable media library. Contents stay local unless explicitly shared.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROOT, filmDir, readJSON } from './lib/common.mjs';
import { ingestMaterials } from './lib/ingest.mjs';

const STORE = path.join(ROOT, 'assets/library');
const validId = (id) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id || '')) throw new Error('asset id: use a-z, 0-9 and -');
  return id;
};
function hashes(dir) {
  return Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error('symlink assets are not supported');
    return e.isDirectory() ? Object.entries(hashes(p)).map(([k, v]) => [`${e.name}/${k}`, v])
      : [[e.name, crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]];
  }));
}
export function addAsset(id, source, { license = 'unspecified', attribution = '' } = {}) {
  const dest = path.join(STORE, validId(id));
  if (!source || !fs.existsSync(source)) throw new Error('source file or directory does not exist');
  if (fs.existsSync(dest)) throw new Error('asset already exists; use a new version id instead of overwriting');
  fs.mkdirSync(dest, { recursive: true });
  try {
    ingestMaterials(path.resolve(source), dest);
    const index = readJSON(path.join(dest, 'assets/index.json'));
    if (!index.files.length) throw new Error('no supported media found');
    fs.writeFileSync(path.join(dest, 'asset.json'), JSON.stringify({ id, license, attribution, files: index.files, sha256: hashes(path.join(dest, 'assets')) }, null, 2) + '\n');
    return readJSON(path.join(dest, 'asset.json'));
  } catch (e) { fs.rmSync(dest, { recursive: true, force: true }); throw e; }
}
export function importAsset(slug, id) {
  const src = path.join(STORE, validId(id));
  const dir = filmDir(slug);
  if (!fs.existsSync(dir)) throw new Error('create the film first: film.mjs new <slug>');
  const record = readJSON(path.join(src, 'asset.json'));
  if (JSON.stringify(hashes(path.join(src, 'assets'))) !== JSON.stringify(record.sha256)) throw new Error('stored asset changed; add it under a new version id');
  const dest = path.join(dir, 'assets', id);
  if (fs.existsSync(dest)) throw new Error('film already contains this asset; refusing to overwrite');
  fs.cpSync(path.join(src, 'assets'), dest, { recursive: true });
  const imported = { ...record, files: record.files.map((e) => ({ ...e, file: `assets/${id}/${e.file.slice('assets/'.length)}` })) };
  fs.writeFileSync(path.join(dest, 'asset.json'), JSON.stringify(imported, null, 2) + '\n');
  return imported;
}
function main() {
  const [cmd, id, source, ...args] = process.argv.slice(2);
  const option = (k, d = '') => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
  if (cmd === 'add') {
    console.log(JSON.stringify(addAsset(id, source, { license: option('--license', 'unspecified'), attribution: option('--source') }), null, 2));
  } else if (cmd === 'import') {
    // import <film-slug> <asset-id>
    console.log(JSON.stringify(importAsset(id, source), null, 2));
  } else if (cmd === 'list') {
    const entries = fs.existsSync(STORE) ? fs.readdirSync(STORE).filter((s) => fs.existsSync(path.join(STORE, s, 'asset.json'))) : [];
    for (const name of entries) { const a = readJSON(path.join(STORE, name, 'asset.json')); console.log(`${name}\t${a.files.length} file(s)\t${a.license}`); }
    if (!entries.length) console.log('Library is empty. Add your own files with: npm run assets -- add <id> <path>');
  } else throw new Error('usage: assets.mjs add <id> <file-or-dir> [--license text] [--source text] | list | import <film-slug> <id>');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
