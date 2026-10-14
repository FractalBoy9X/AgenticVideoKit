// Compare exact PNG bytes across independent browser runs and out-of-order seeks.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openFilm, film, prepareFilm } from '../render/common.mjs';

const args = process.argv.slice(2);
const slug = args.includes('--film') ? args[args.indexOf('--film') + 1] : 'example';
const F = film(slug);
prepareFilm(F);
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
for (const lang of F.languages) for (const format of F.formats) {
  const V = F.variant({ lang, format });
  const frames = [];
  let times;
  for (let run = 0; run < 2; run++) {
    const browser = await openFilm({ page: V.page, width: V.size[0], height: V.size[1] });
    try {
      const plan = await browser.page.evaluate(() => window.getPlan());
      times ||= plan.shots.map((s) => +((s.t0 + s.t1) / 2).toFixed(3));
      const current = {};
      for (const t of (run ? [...times].reverse() : times)) current[t] = hash(await browser.frame(t));
      // Revisit after other shots to catch hidden state in modules.
      for (const t of times) assert.equal(hash(await browser.frame(t)), current[t], `seek depends on history at ${t}s`);
      frames.push(current);
    } finally { await browser.close(); }
  }
  assert.deepEqual(frames[0], frames[1], 'independent browser runs must match');
  console.log(`PASS ${slug} ${lang} ${format}: ${times.length} frames, two browser runs, shuffled seeks`);
}
