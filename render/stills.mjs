// Render inspection stills and a contact sheet.
//   node render/stills.mjs 0.5 3 12.25        → renders/stills/t_000.50.jpg ...
//   node render/stills.mjs --every 1          → one still per second + contact sheet
//   node render/stills.mjs --range 30 34 0.25 → dense sampling of a window
//   node render/stills.mjs --film <slug> --every 2   (engine film in films/<slug>/)
//   node render/stills.mjs --film <slug> --lang en --format 9:16 --every 2

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFilm, prepareFilm, film as filmSpec, ROOT } from './common.mjs';

let args = process.argv.slice(2);
const take = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args = args.filter((_, j) => j !== i && j !== i + 1); return v; };
const filmName = take('--film') || 'example';
const lang = take('--lang'), format = take('--format');
const F0 = filmSpec(filmName);
// engine films: one language / format (default: the first of each)
const F = F0.engine ? { ...F0, ...F0.variant({ lang: lang || F0.languages[0], format: format || F0.formats[0] }) } : F0;
prepareFilm(F0);
const film = await openFilm({ page: F.page, width: F.size[0], height: F.size[1] });
const duration = await film.page.evaluate(() => window.DURATION);
let times = [];
if (args[0] === '--every') {
  const step = parseFloat(args[1] || '1');
  for (let t = 0.5; t < duration; t += step) times.push(+t.toFixed(3));
} else if (args[0] === '--range') {
  const [a, b, s] = args.slice(1).map(Number);
  for (let t = a; t <= b + 1e-9; t += s) times.push(+t.toFixed(3));
} else {
  times = args.map(Number);
}

const outDir = path.join(ROOT, F.stills);
fs.mkdirSync(outDir, { recursive: true });
const files = [];
for (const t of times) {
  const buf = await film.frame(t, 'jpeg', 90);
  const f = path.join(outDir, `t_${t.toFixed(2).padStart(6, '0')}.jpg`);
  fs.writeFileSync(f, buf);
  files.push(f);
  console.log(f);
}
await film.close();

if (files.length > 4) {
  // Contact sheet: 4 columns of 480-px-wide thumbnails with timestamps.
  const tw = 480, th = Math.round((tw * F.size[1]) / F.size[0] / 2) * 2;
  const sheet = path.join(ROOT, F.contact, `contact_${F.tag ? `${F.tag}_` : ''}${times[0]}-${times[times.length - 1]}.jpg`);
  const inputs = files.flatMap((f) => ['-i', f]);
  const cols = 4;
  const labels = files.map((f, i) => `[${i}:v]scale=${tw}:${th},drawtext=text='${times[i].toFixed(2)}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.5[v${i}]`);
  const layout = files.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|');
  const filter = `${labels.join(';')};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=black`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-frames:v', '1', '-q:v', '3', sheet]);
  console.log('contact sheet:', sheet);
}
