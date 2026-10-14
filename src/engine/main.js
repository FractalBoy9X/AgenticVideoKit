// Film engine — runtime for every film in films/<slug>/. Same contract as the
// capture scripts: `window.renderAt(t)`
// renders the frame at t, and the page exposes DURATION, FPS, getCues(),
// and getSections() to render/render.mjs.
//
// The engine knows no kinds of content. It owns time, 2D/3D layers,
// transitions, camera hand-over, narration, sound cues and the render
// contract; everything a film shows comes from modules. A `type` is a path:
// "my-shot" → src/library/modules/my-shot.js (your reusable code),
// "./cat" → films/<slug>/modules/cat.js (written for this film).
//
//   index.html?film=<slug>&play     real time (space pauses, slider scrubs)
//   index.html?film=<slug>&t=12.5   one frame
//   …&lang=en&format=9:16           one language / format of a multilingual, multi-format film

import * as THREE from 'three';
import { createPost } from '../lib/post.js';
import { Hud } from '../lib/hud.js';
import { C } from '../lib/palette.js';
import { smooth, window01 } from '../lib/util.js';
import { FORMATS, resolveStyle } from './styles.js';
import { PRESETS } from '../library/styles.js';
import { buildTimeline, buildLayers, cue, typingCues, allCues } from './timeline.js';
import { narrationLines, planFilm, voiceSpec } from './narration.js';
import { LANGS, formatsOf, languagesOf } from './lang.js';
import { layoutText } from './kit.js';

const params = new URLSearchParams(location.search);
const slug = params.get('film');
const BASE = `/films/${slug}/`;
/** "./x" → the film's modules/x.js; "rigs/x" → src/library/rigs/x.js; "x" → src/library/modules/x.js. */
const moduleURL = (ref) => (ref.startsWith('./') ? `${BASE}modules/${ref.slice(2)}.js` : ref.includes('/') ? `../library/${ref}.js` : `../library/modules/${ref}.js`);

async function boot() {
  if (!slug) throw new Error('missing ?film=<slug>');
  const raw = await fetch(`${BASE}film.json`).then((r) => {
    if (!r.ok) throw new Error(`films/${slug}/film.json not found`);
    return r.json();
  });
  // One render = one language and one format; every language shares the timeline,
  // whose holds are fitted to the longest narration (voice.json has every language).
  const langs = languagesOf(raw);
  const lang = params.get('lang') || langs[0];
  if (!langs.includes(lang)) throw new Error(`language "${lang}" is not in film.languages (${langs.join(', ')})`);
  const format = params.get('format') || formatsOf(raw)[0];
  let durations = {};
  if ((raw.shots || []).some((s) => s.say) && raw.voice !== 'none') {
    const r = await fetch(`${BASE}audio/voice/voice.json`);
    if (r.ok) durations = await r.json();
    else console.warn(`no voice.json yet: run \`node tools/film.mjs voice ${slug}\`; timing uses estimates`);
  }
  const film = planFilm(raw, { lang, format, durations });
  const { style, error } = resolveStyle(film.style, PRESETS);
  if (error) throw new Error(error);
  Object.assign(C, style.colors);
  if (!FORMATS[film.format]) throw new Error(`format "${film.format}": one of ${Object.keys(FORMATS).join(', ')}`);
  const [W, H] = FORMATS[film.format];
  const FPS = film.fps || 60;

  // Load only fonts explicitly supplied by this film. System fonts are the default.
  for (const font of raw.fonts || []) {
    const face = new FontFace(font.family, `url(${BASE}${font.src})`, { weight: String(font.weight || 400), style: font.style || 'normal' });
    document.fonts.add(await face.load());
  }
  await document.fonts.ready;

  const glCanvas = document.getElementById('gl');
  const hudCanvas = document.getElementById('hud');
  for (const c of [glCanvas, hudCanvas]) { c.width = W; c.height = H; }
  Object.assign(glCanvas.style, { width: `${W}px`, height: `${H}px`, aspectRatio: `${W} / ${H}` });
  document.body.style.background = '#' + C.bg.toString(16).padStart(6, '0');

  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(C.bg, 1);
  renderer.toneMapping = { aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping }[style.renderer.toneMapping] || THREE.NoToneMapping;
  renderer.toneMappingExposure = style.renderer.exposure;
  renderer.shadowMap.enabled = !!style.renderer.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const bgColor = new THREE.Color(C.bg);
  scene.background = bgColor;
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.01, 400);
  const hud = new Hud(hudCanvas);
  hud.glowScale = style.glow;
  const post = createPost(renderer, scene, camera, hudCanvas, W, H, { hudLate: style.hudLate });
  post.grade.uniforms.uVignette.value = style.grade.vignette;
  post.grade.uniforms.uGrain.value = style.grade.grain;
  post.grade.uniforms.uAberration.value = style.grade.aberration;

  const tmp = new THREE.Vector3();
  const ctx = {
    THREE, renderer, scene, camera, hud, W, H, C, style, film, FPS,
    /** Language of this render, its number/date locale, all languages of the film, the format. */
    lang, locale: LANGS[lang]?.locale || lang, languages: langs, format: film.format,
    /** true when narrated shots carry burned-in subtitles (kit.stage() keeps content above them). */
    burnedSubtitles: film.subtitles !== false && film.subtitles !== 'srt' && (film.shots || []).some((s) => s.say),
    /** Instances of film.layers by id (a shot can drive a world layer, e.g. ctx.layers.world). */
    layers: {},
    /** Layout unit: 1 at 1080 px on the short side of the frame. */
    u: Math.min(W, H) / 1080,
    fx: {},
    cue, typingCues,
    /** URL of a file in films/<slug>/ (e.g. "assets/shot.png"). */
    asset: (p) => BASE + p,
    /** Import a module by reference ("./x", "rigs/my-rig", "x"): worlds load their rigs with it. */
    load: (ref) => import(moduleURL(ref)),
    async loadImage(p) {
      const r = await fetch(BASE + p);
      if (!r.ok) throw new Error(`asset not found: films/${slug}/${p}`);
      return createImageBitmap(await r.blob());
    },
    async loadJSON(p) {
      const r = await fetch(BASE + p);
      if (!r.ok) throw new Error(`asset not found: films/${slug}/${p}`);
      return r.json();
    },
    /** World position → screen pixels. Returns [x, y, inFront]. */
    project(v) {
      tmp.copy(v).project(camera);
      return [(tmp.x * 0.5 + 0.5) * W, (-tmp.y * 0.5 + 0.5) * H, tmp.z < 1];
    },
  };

  // Modules: a type is a path (library or film-local); load each once.
  const mods = {};
  for (const x of [...(film.layers || []), ...film.shots]) {
    if (mods[x.type]) continue;
    const url = moduleURL(x.type);
    try { mods[x.type] = await import(url); } catch (e) { throw new Error(`module "${x.type}" (${url}): ${e.message}`); }
  }
  const { shots, DURATION, SECTIONS, dip } = buildTimeline(film, style, (s) => s.in || mods[s.type].meta?.in || film.in || 'cross');
  const { layers, errors } = buildLayers(film, shots, DURATION);
  if (errors.length) throw new Error(errors.join('\n'));
  ctx.DURATION = DURATION;
  ctx.shots = shots;
  // Layers first, so shots can find them in ctx.layers; each clip gets its own
  // 3D group, shown only while the clip is on screen.
  for (const c of [...layers, ...shots]) {
    c.group = new THREE.Group();
    scene.add(c.group);
    c.inst = await mods[c.type].default(ctx, c);
    if (layers.includes(c)) ctx.layers[c.id] = c.inst;
  }
  const under = layers.filter((l) => l.z < 0), over = layers.filter((l) => l.z >= 0);

  // Narration: voice cues (one per line, or per sentence in multilingual films) + subtitles.
  const spec = voiceSpec(film, lang);
  const lines = narrationLines(shots, film, durations, lang);
  if (spec) for (const l of lines) for (const p of l.whole ? l.parts.slice(0, 1) : l.parts) if (p.id && durations[p.id]) cue(p.t0, 'voice', { file: `voice/${p.id}.wav`, gain: spec.gain });
  const allSubs = lines.flatMap((l) => l.subs);
  // subtitles: true (burned in, default) | "srt" (sidecar file only) | false
  const subs = film.subtitles === false || film.subtitles === 'srt' ? [] : allSubs;
  const subSize = style.subtitle.size * ctx.u;
  const subLayouts = subs.map(([, , text]) => layoutText(ctx, text, { size: subSize, family: style.subtitle.family, weight: style.subtitle.weight, maxW: W * 0.78, lh: 1.3 }));

  function drawSubtitles(t) {
    subs.forEach(([a, b], i) => {
      const al = window01(t, a - 0.1, b + 0.25, 0.15, 0.25);
      if (al <= 0) return;
      const L = subLayouts[i];
      const w = Math.max(...L.lines.map((x) => x.width)) + 48 * ctx.u;
      const h = L.height + 26 * ctx.u;
      const y = H - (W > H ? 70 : 260) * ctx.u - h;
      hud.rect(W / 2 - w / 2, y, w, h, { fill: style.subtitle.box, alpha: al, radius: 10 * ctx.u });
      L.draw(t, W / 2, y + 8 * ctx.u, { alpha: al, align: 'center', color: style.subtitle.color, rise: 1e-3 });
    });
  }

  function setCamera(t, act, actL) {
    // The most visible shot that drives the camera wins, then a layer's camera,
    // otherwise a fixed neutral camera.
    let best = null, ba = 0;
    for (const s of act) {
      const a = s.alpha(t);
      if (s.inst.camera && a > ba) { const c = s.inst.camera(t, a); if (c) { best = c; ba = a; } }
    }
    for (const l of actL) if (!best && l.inst.camera) best = l.inst.camera(t, l.alpha(t));
    const cam = best || { pos: [0, 0, 10], target: [0, 0, 0], fov: 35 };
    camera.position.set(...cam.pos);
    camera.up.set(0, 1, 0);
    camera.fov = cam.fov || 35;
    camera.near = cam.near || 0.05;
    camera.far = cam.far || 400;
    camera.updateProjectionMatrix();
    camera.lookAt(...cam.target);
    camera.updateMatrixWorld();
  }

  const active = (t, list = shots) => list.filter((s) => t >= s.lo && t <= s.hi);
  const drawLayers = (t, list) => { for (const l of list) { const a = l.alpha(t); if (a > 0) l.inst.update(t, a); } };

  function draw(t, act, actL) {
    hud.clear();
    ctx.fx = { fade: 1, flash: 0, ...style.fx };
    scene.background = bgColor;
    scene.fog = null;
    scene.environment = null;
    scene.environmentIntensity = 1;
    for (const c of [...layers, ...shots]) c.group.visible = act.includes(c) || actL.includes(c);
    setCamera(t, act, actL);
    drawLayers(t, under.filter((l) => actL.includes(l)));
    for (const s of act) {
      const a = s.alpha(t);
      if (a > 0) s.inst.update(t, a);

    }
    drawLayers(t, over.filter((l) => actL.includes(l)));
    drawSubtitles(t);
    ctx.fx.fade *= dip(t);
    post.render(t, ctx.fx);
  }

  async function renderAt(t) {
    const act = active(t), actL = active(t, layers);
    await Promise.all([...actL, ...act].map((s) => s.inst.prepare && s.inst.prepare(t)));
    draw(t, act, actL);
    return true;
  }

  // Probe for render/review.mjs: the box of every text drawn in a frame (critique).
  let probe = null;
  const drawText = hud.text.bind(hud);
  hud.text = (str, x, y, o = {}) => {
    const w = drawText(str, x, y, o);
    if (probe && w > 0 && (o.alpha ?? 1) > 0.3) {
      const size = o.size || 16, align = o.align || 'left', base = o.baseline || 'alphabetic';
      const x0 = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
      const y0 = base === 'middle' ? y - size * 0.5 : base === 'top' ? y : y - size * 0.78;
      const m = hud.g.getTransform();
      const pt = (px, py) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f];
      const [a0, b0] = pt(x0, y0), [a1, b1] = pt(x0 + w, y0 + size);
      if (!o.chrome) probe.push({ s: String(str).slice(0, 80), x0: Math.min(a0, a1), y0: Math.min(b0, b1), x1: Math.max(a0, a1), y1: Math.max(b0, b1), size: size / ctx.u, weight: o.weight || 400, color: o.color || null, alpha: o.alpha ?? 1 });
    }
    return w;
  };

  window.DURATION = DURATION;
  window.FPS = FPS;
  window.renderAt = renderAt;
  window.probeAt = async (t) => { probe = []; await renderAt(t); const r = probe; probe = null; return r; };
  window.getCues = () => allCues();
  window.getSections = () => SECTIONS;
  /** Everything outside the picture needs: timeline, sections, subtitles of this language. */
  window.getPlan = () => ({
    slug, lang, format: film.format, languages: langs, duration: DURATION, fps: FPS, size: [W, H],
    shots: shots.map((s) => ({ id: s.id ?? null, i: s.i, type: s.type, t0: s.t0, t1: s.t1, hold: s.hold, holdDeclared: s.holdDeclared ?? null, section: s.section ?? null, energy: s.energy ?? null, say: s.say ?? null })),
    subtitles: allSubs.map(([a, b, text]) => [+a.toFixed(3), +b.toFixed(3), text]),
    burnedSubtitles: subs.length > 0,
  });
  window.__ready = true;

  if (params.has('play') || params.has('t')) {
    document.body.classList.add('preview');
    const slider = document.querySelector('#scrub input');
    slider.max = DURATION;
    let t0 = parseFloat(params.get('t') || '0');
    await renderAt(t0);
    slider.value = t0;
    let playing = params.has('play');
    let start = performance.now() - t0 * 1000;
    slider.addEventListener('input', () => { t0 = +slider.value; start = performance.now() - t0 * 1000; renderAt(t0); });
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') { playing = !playing; start = performance.now() - t0 * 1000; } });
    const loop = async () => {
      if (playing) {
        t0 = ((performance.now() - start) / 1000) % DURATION;
        slider.value = t0;
        await renderAt(t0);
      }
      requestAnimationFrame(loop);
    };
    loop();
  }
}

boot().catch((e) => {
  console.error(e);
  window.__error = String((e && e.stack) || e);
  const el = document.createElement('div');
  el.id = 'err';
  el.textContent = window.__error;
  document.body.appendChild(el);
});
