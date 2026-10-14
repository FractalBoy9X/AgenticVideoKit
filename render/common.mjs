// Shared helpers for the capture scripts: a tiny static server rooted at
// the project and a headless Chrome page with the film.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Frame size of each `format` in film.json (engine films). */
export const FORMATS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };

const { languagesOf, formatsOf, multilingual } = await import('../src/engine/lang.js');

/** film.json "music"/"audio" → the music engine spec for audio/mix.py. */
export function musicSpec(spec) {
  const m = spec.music;
  const audio = spec.audio ?? 'auto';
  if (audio !== 'auto' && audio !== 'none' && m === undefined) return { engine: 'file', src: audio };
  if (m === undefined || m === 'none') return { engine: 'none' };
  if (typeof m === 'string') return { engine: 'file', src: m };
  return { engine: m.engine || 'none', ...m };
}

export function film(name = 'example') {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('invalid film slug');
  // Engine films: films/<slug>/film.json, played by src/engine/index.html.
  const dir = path.join(ROOT, 'films', name);
  const specPath = path.join(dir, 'film.json');
  if (!fs.existsSync(specPath)) {
    const engine = fs.existsSync(path.join(ROOT, 'films'))
      ? fs.readdirSync(path.join(ROOT, 'films')).filter((d) => !d.startsWith('_') && fs.existsSync(path.join(ROOT, 'films', d, 'film.json')))
      : [];
    throw new Error(`unknown film ${name}; one of: ${engine.join(', ')}`);
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const rel = (p) => path.relative(ROOT, path.join(dir, p));
  const audio = spec.audio ?? 'auto';
  const languages = languagesOf(spec), formats = formatsOf(spec), multi = multilingual(spec);
  const sizes = Object.fromEntries(formats.map((f) => [f, FORMATS[f] || FORMATS['16:9']]));
  const page = `src/engine/index.html?film=${encodeURIComponent(name)}`;
  return {
    slug: name, engine: true, spec, dir, languages, formats, multilingual: multi, sizes,
    page, size: sizes[formats[0]],
    out: rel(`output/${name}.mp4`), preview: rel('output/preview.mp4'),
    cues: rel('audio/cues.json'), wav: rel('audio/soundtrack.wav'),
    music: musicSpec(spec), noAudio: audio === 'none',
    stills: rel('renders/stills'), contact: rel('renders'),
    // extra sound kinds for the mixer: the shared library, then the film's own
    sounds: [path.join(ROOT, 'src/library/sounds.py'), path.join(dir, 'sounds.py')].filter((f) => fs.existsSync(f)),
    /**
     * Paths of one render. Multilingual films: output/<slug>.<lang>[.<format>][.preview].mp4
     * and output/<slug>.<lang>.srt; other films keep their names (output/preview.mp4,
     * output/<slug>.mp4, output/<slug>.srt). A format other than the first adds e.g. ".9x16".
     */
    variant({ lang = languages[0], format = formats[0], preview = false } = {}) {
      const f = format === formats[0] ? '' : `.${format.replace(':', 'x')}`;
      const base = multi ? `${name}.${lang}${f}` : null;
      const out = multi ? `output/${base}${preview ? '.preview' : ''}.mp4` : preview ? `output/preview${f}.mp4` : `output/${name}${f}.mp4`;
      const key = multi ? `${lang}-${format.replace(':', 'x')}` : null;
      return {
        lang, format, preview,
        page: `${page}&lang=${lang}&format=${encodeURIComponent(format)}`,
        size: sizes[format] || FORMATS[format],
        out: rel(out),
        manifest: rel(out.replace(/\.mp4$/, '.json')),
        srt: rel(multi ? `output/${name}.${lang}.srt` : `output/${name}.srt`),
        job: rel(`audio/mix.${lang}.json`),
        wav: rel(`audio/soundtrack.${lang}.wav`),
        stems: rel(`audio/stems/${lang}`),
        musicStems: rel('audio/stems/music'),
        stills: key ? rel(`renders/stills/${key}`) : rel('renders/stills'),
        contact: rel('renders'),
        tag: key,
      };
    },
  };
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jsonl': 'text/plain', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.md': 'text/plain',
};

export function serve(port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let file;
      try { file = path.resolve(ROOT, '.' + new URL(req.url, 'http://localhost').pathname.split('/').map(decodeURIComponent).join('/')); }
      catch { res.writeHead(400); res.end(); return; }
      const relative = path.relative(ROOT, file);
      if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some((s) => s.startsWith('.')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end(); return;
      }
      const real = path.relative(ROOT, fs.realpathSync(file));
      if (real.startsWith('..') || path.isAbsolute(real)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.once('error', (error) => reject(new Error(`Cannot start local render server: ${error.message}`)));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/** Engine films: synthesise narration before the page opens (subtitles are timed by it). */
export function prepareFilm(F) {
  if (!F.engine) return;
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/film.mjs'), 'voice', F.slug], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('voice generation failed');
}

export function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map((p) => path.join(p, 'Google/Chrome/Application/chrome.exe')),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found: set CHROME_PATH');
  return found;
}

export async function openFilm({ width = 1920, height = 1080, page: pagePath = 'src/engine/index.html?film=example' } = {}) {
  const server = await serve();
  const { port } = server.address();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath(),
      headless: true,
      protocolTimeout: 600000,
      args: [`--use-angle=${process.env.CHROME_ANGLE || (process.platform === 'darwin' ? 'metal' : 'gl')}`,  '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars',
        '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--force-color-profile=srgb'],
      defaultViewport: { width, height, deviceScaleFactor: 1 },
    });
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text()); });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(`http://127.0.0.1:${port}/${pagePath}`);
    await page.waitForFunction('window.__ready || window.__error', { timeout: 120000 });
    const err = await page.evaluate(() => window.__error);
    if (err) throw new Error(err);
    const cdp = await page.createCDPSession();
    return {
      page, cdp, browser, server,
      async frame(t, format = 'png', quality = 92) {
        await page.evaluate((tt) => window.renderAt(tt), t);
        const { data } = await cdp.send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? quality : undefined, optimizeForSpeed: true });
        return Buffer.from(data, 'base64');
      },
      async close() { await browser.close(); server.close(); },
    };
  } catch (error) {
    if (browser) await browser.close();
    server.close();
    throw error;
  }
}
