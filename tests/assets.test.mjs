import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addAsset, importAsset } from '../tools/assets.mjs';
import { ROOT, filmDir, filmSources, hashFiles } from '../tools/lib/common.mjs';

test('stored media is reusable, immutable and verified before importing', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'video-assets-'));
  const id = `test-asset-${process.pid}`;
  const filmA = `test-a-${process.pid}`, filmB = `test-b-${process.pid}`;
  const stored = path.join(ROOT, 'assets/library', id);
  try {
    fs.writeFileSync(path.join(temp, 'notes.txt'), 'Original material\n');
    for (const slug of [filmA, filmB]) fs.mkdirSync(filmDir(slug), { recursive: true });
    const rec = addAsset(id, temp, { license: 'Test fixture', attribution: 'Local test' });
    assert.equal(rec.files.length, 1);
    assert.equal(rec.license, 'Test fixture');
    assert.throws(() => addAsset(id, temp), /already exists/);
    const a = importAsset(filmA, id);
    const b = importAsset(filmB, id);
    assert.deepEqual(a.files, b.files);
    assert.equal(a.files[0].file, `assets/${id}/notes.txt`);
    assert.throws(() => importAsset(filmA, id), /refusing to overwrite/);
    const snapshot = path.join(filmDir(filmA), a.files[0].file);
    fs.writeFileSync(path.join(stored, 'assets/notes.txt'), 'Modified after saving');
    assert.throws(() => importAsset(`missing-film-${process.pid}`, id), /create the film first/);
    fs.rmSync(path.join(filmDir(filmB), 'assets', id), { recursive: true });
    assert.throws(() => importAsset(filmB, id), /stored asset changed/);
    assert.equal(fs.readFileSync(snapshot, 'utf8'), 'Original material\n');
  } finally {
    for (const dir of [temp, stored, filmDir(filmA), filmDir(filmB)]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('asset ids and film paths reject traversal', () => {
  assert.throws(() => filmDir('../outside'), /invalid film slug/);
  assert.throws(() => filmDir(''), /invalid film slug/);
  assert.throws(() => addAsset('../escape', '.'), /asset id/);
});

test('approval source hash changes when an imported asset changes', () => {
  const slug = `test-approval-${process.pid}`;
  const dir = filmDir(slug);
  try {
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'film.json'), '{"shots":[]}');
    const asset = path.join(dir, 'assets/notes.txt');
    fs.writeFileSync(asset, 'Version one');
    const inputs = filmSources(slug);
    assert.ok(inputs.includes(path.join(ROOT, 'src/engine/main.js')));
    assert.ok(inputs.includes(asset));
    const before = hashFiles(inputs);
    fs.writeFileSync(asset, 'Version two');
    assert.notEqual(hashFiles(filmSources(slug)), before);
    fs.mkdirSync(path.join(dir, 'output'));
    fs.writeFileSync(path.join(dir, 'output/ignored.json'), 'Generated');
    const current = hashFiles(filmSources(slug));
    fs.writeFileSync(path.join(dir, 'output/ignored.json'), 'Regenerated');
    assert.equal(hashFiles(filmSources(slug)), current);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
