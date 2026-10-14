import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, filmDir } from '../tools/lib/common.mjs';
import { buildTimeline, allCues } from '../src/engine/timeline.js';
import { BASE, resolveStyle } from '../src/engine/styles.js';
import { musicSpec } from '../render/common.mjs';

test('default timeline and style do not inject sound, chords or visual treatments', () => {
  const before = allCues();
  const timeline = buildTimeline({ shots: [{ type: './custom', hold: 2 }, { type: './custom', hold: 3 }] }, BASE);
  assert.equal(timeline.DURATION, 5);
  assert.deepEqual(timeline.SECTIONS, []);
  assert.deepEqual(allCues(), before);
  assert.equal(BASE.grade.grain, 0);
  assert.equal(BASE.grade.vignette, 0);
  assert.equal(BASE.fx.bloomStrength, 0);
  assert.deepEqual(musicSpec({}), { engine: 'none' });
  assert.deepEqual(musicSpec({ music: 'assets/my-track.wav' }), { engine: 'file', src: 'assets/my-track.wav' });
  assert.ok(resolveStyle('missing-user-preset').error);
});

test('new → sketch → check works with film-local code and no stock module library', () => {
  const slug = `test-scaffold-${process.pid}`;
  const dir = filmDir(slug);
  const run = (...args) => spawnSync(process.execPath, ['tools/film.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
  try {
    for (const cmd of ['new', 'sketch', 'check']) {
      const result = run(cmd, slug);
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    const file = path.join(dir, 'film.json');
    const film = JSON.parse(fs.readFileSync(file));
    assert.equal(film.shots[0].type, './message');
    assert.equal(film.music, 'none');
    assert.equal(film.voice, 'none');
    const original = fs.readFileSync(file, 'utf8');
    assert.equal(run('sketch', slug).status, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.ok(fs.existsSync(path.join(dir, 'film.draft.json')));
    const scriptPath = path.join(dir, 'script.json');
    const script = JSON.parse(fs.readFileSync(scriptPath));
    script.beats[0].use = './missing';
    fs.writeFileSync(scriptPath, JSON.stringify(script));
    const failed = run('sketch', slug);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /missing module/);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a user-created module can be promoted and reused by another film', () => {
  const slug = `test-promote-${process.pid}`;
  const target = `test-reuse-${process.pid}`;
  const sharedName = `test-message-${process.pid}`;
  const shared = path.join(ROOT, 'src/library/modules', `${sharedName}.js`);
  const run = (...args) => spawnSync(process.execPath, ['tools/film.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
  try {
    for (const args of [['new', slug], ['promote', slug, 'message', '--as', sharedName], ['new', target]]) {
      const result = run(...args);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    assert.ok(fs.existsSync(shared));
    const scriptFile = path.join(filmDir(target), 'script.json');
    const script = JSON.parse(fs.readFileSync(scriptFile));
    script.beats[0].use = sharedName;
    fs.writeFileSync(scriptFile, JSON.stringify(script));
    for (const args of [['sketch', target], ['check', target]]) {
      const result = run(...args);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(filmDir(target), 'film.json'))).shots[0].type, sharedName);
  } finally {
    fs.rmSync(shared, { force: true });
    for (const name of [slug, target]) fs.rmSync(filmDir(name), { recursive: true, force: true });
  }
});
