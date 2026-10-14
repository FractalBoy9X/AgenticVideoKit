// `film.mjs ingest <slug> [dir]`: materials folder → films/<slug>/assets/ + index.json +
// _contact.jpg. Videos become frame sequences for the `clip` module (exact frames,
// no seeking at render time). Unchanged from the first pipeline.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { filmDir, readJSON, die } from './common.mjs';

const KIND = {
  image: ['.png', '.jpg', '.jpeg', '.webp'],
  video: ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.gif'],
  audio: ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'],
  font: ['.woff2', '.woff', '.ttf', '.otf'],
  data: ['.glb', '.gltf', '.bin', '.hdr', '.exr'],
  text: ['.txt', '.md', '.json', '.csv', '.pdf', '.html'],
};
const kindOf = (f) => Object.keys(KIND).find((k) => KIND[k].includes(path.extname(f).toLowerCase()));
const slugify = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
  .toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');

function probe(file) {
  try {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_entries', 'stream=width,height:format=duration', file], { encoding: 'utf8' }));
    const v = (j.streams || []).find((x) => x.width) || {};
    return { w: v.width, h: v.height, duration: j.format?.duration ? +(+j.format.duration).toFixed(2) : undefined };
  } catch { return {}; }
}

function walk(dir, depth = 0) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith('.')) return [];
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return depth < 2 ? walk(p, depth + 1) : [];
    return [p];
  });
}

export function cmdIngest(slug, arg) {
  if (!slug) die('usage: film.mjs ingest <slug> [materials-dir]');
  const dir = filmDir(slug);
  const brief = fs.existsSync(path.join(dir, 'brief.json')) ? readJSON(path.join(dir, 'brief.json')) : {};
  const src = arg || brief.materials;
  if (!src) die('no materials folder: pass one or set "materials" in brief.json');
  if (!fs.existsSync(src)) die(`materials folder not found: ${src}`);
  return ingestMaterials(src, dir);
}

export function ingestMaterials(src, dir) {
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const index = [], skipped = [], used = new Set();
  for (const file of (fs.statSync(src).isFile() ? [src] : walk(src))) {
    const kind = kindOf(file);
    if (!kind) { skipped.push(path.relative(src, file)); continue; }
    let name = slugify(path.basename(file, path.extname(file))) || 'file';
    while (used.has(name)) name += '-2';
    used.add(name);
    const ext = path.extname(file).toLowerCase();
    const entry = { from: fs.statSync(src).isFile() ? path.basename(src) : path.relative(src, file), kind };
    if (kind === 'image') {
      const info = probe(file);
      // Huge images are scaled to 3840 px wide: enough for a slow zoom at 1080p.
      if (info.w > 3840) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', 'scale=3840:-2', path.join(assets, name + ext)]);
      else fs.copyFileSync(file, path.join(assets, name + ext));
      Object.assign(entry, { file: `assets/${name}${ext}`, ...probe(path.join(assets, name + ext)) });
    } else if (kind === 'video') {
      const out = path.join(assets, name);
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(out);
      const fps = 30;
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', `fps=${fps},scale='min(iw,1920)':-2`, '-q:v', '3', path.join(out, '%05d.jpg')]);
      const frames = fs.readdirSync(out).filter((f) => f.endsWith('.jpg')).length;
      const info = probe(path.join(out, '00001.jpg'));
      const clip = { fps, frames, w: info.w, h: info.h, duration: +(frames / fps).toFixed(2), from: entry.from };
      fs.writeFileSync(path.join(out, 'clip.json'), JSON.stringify(clip, null, 1));
      Object.assign(entry, { file: `assets/${name}`, module: 'clip', w: clip.w, h: clip.h, duration: clip.duration });
    } else {
      fs.copyFileSync(file, path.join(assets, name + ext));
      Object.assign(entry, { file: `assets/${name}${ext}` }, kind === 'audio' ? { duration: probe(file).duration } : {});
    }
    index.push(entry);
  }
  fs.writeFileSync(path.join(assets, 'index.json'), JSON.stringify({ files: index, skipped }, null, 1));

  // One contact sheet of every image and clip (first frame), labelled with its asset path.
  const thumbs = index.filter((e) => e.kind === 'image' || e.kind === 'video').slice(0, 24);
  if (thumbs.length) {
    const sheet = path.join(assets, '_contact.jpg');
    const inputs = thumbs.flatMap((e) => ['-i', path.join(dir, e.kind === 'video' ? `${e.file}/00001.jpg` : e.file)]);
    const cols = Math.min(4, thumbs.length), TW = 480, TH = 300;
    const esc = (s) => s.replace(/[:'\\]/g, '');
    const labels = thumbs.map((e, i) => `[${i}:v]scale=${TW}:${TH - 30}:force_original_aspect_ratio=decrease,pad=${TW}:${TH}:(ow-iw)/2:0:color=0x111111,drawtext=text='${esc(e.file.replace('assets/', ''))}${e.kind === 'video' ? ` (clip ${e.duration}s)` : ''}':x=8:y=h-24:fontsize=16:fontcolor=white[v${i}]`);
    const layout = thumbs.map((_, i) => `${(i % cols) * TW}_${Math.floor(i / cols) * TH}`).join('|');
    const filter = thumbs.length > 1
      ? `${labels.join(';')};${thumbs.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${thumbs.length}:layout=${layout}:fill=black`
      : labels[0].replace(/\[v0\]$/, '');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-frames:v', '1', '-q:v', '4', sheet]);
  }
  const by = (k) => index.filter((e) => e.kind === k).length;
  console.log(`ingested ${index.length} files (images ${by('image')}, clips ${by('video')}, audio ${by('audio')}, text ${by('text')}); skipped ${skipped.length}`);
  console.log(`→ ${assets}/index.json`);
  return 0;
}
