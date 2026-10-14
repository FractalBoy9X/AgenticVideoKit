// Shared layout helpers for shot modules. Sizes are given at 1080 px on the
// short side of the frame and multiplied by ctx.u, so a module works in 16:9,
// 9:16, 1:1 and 4:5 without changes.

import { SANS } from '../lib/hud.js';
import { easeOutCubic } from '../lib/util.js';

/** Title-safe area in pixels. */
export function safe(ctx, margin = 0.1) {
  const m = Math.round(Math.min(ctx.W, ctx.H) * margin);
  return { x0: m, y0: m, x1: ctx.W - m, y1: ctx.H - m, w: ctx.W - 2 * m, h: ctx.H - 2 * m, cx: ctx.W / 2, cy: ctx.H / 2 };
}

/**
 * Safe area for a shot's content: safe(ctx, margin), and when the shot is narrated
 * with burned-in subtitles, everything above the subtitle band. Shots without
 * narration get exactly safe(ctx, margin).
 */
export function stage(ctx, s, margin = 0.1) {
  const S = safe(ctx, margin);
  if (!s || !s.say || !ctx.burnedSubtitles) return S;
  const band = (ctx.W > ctx.H ? 230 : 420) * ctx.u;
  const y1 = Math.min(S.y1, ctx.H - band);
  return { ...S, y1, h: y1 - S.y0, cy: (S.y0 + y1) / 2 };
}

/** Text with "*accent*" spans and "\n" breaks → [{w, accent, glue}] or {br: true}.
 *  A word that touches the previous one across a "*" (e.g. "*typów*.") is glued to it. */
export function words(str = '') {
  const out = [];
  const segs = String(str).split('*');
  segs.forEach((seg, i) => {
    const touches = i > 0 && !/\s$/.test(segs[i - 1]) && !/^\s/.test(seg);
    seg.split('\n').forEach((part, j) => {
      if (j > 0) out.push({ br: true });
      part.split(/\s+/).forEach((w, k) => {
        if (!w) return;
        const prev = out[out.length - 1];
        const glue = touches && j === 0 && k === 0 && prev && !prev.br;
        out.push({ w, accent: i % 2 === 1, glue });
      });
    });
  });
  return out;
}

/** Greedy wrap. measure(word) → px. Returns lines [{words, width}], word.x set. */
export function wrapWords(ws, maxW, measure, space) {
  const lines = [{ words: [], width: 0 }];
  let x = 0;
  for (const w of ws) {
    if (w.br) { lines.push({ words: [], width: 0 }); x = 0; continue; }
    const ww = measure(w);
    if (x > 0 && x + space + ww > maxW) { lines.push({ words: [], width: 0 }); x = 0; }
    if (x > 0 && !w.glue) x += space;
    w.x = x; w.width = ww;
    x += ww;
    const L = lines[lines.length - 1];
    L.words.push(w); L.width = x;
  }
  return lines;
}

/**
 * Wrapped sans text, words rising in one after another from t0.
 * Returns the block height. o: {size, weight, strong, tracking, color, align,
 * maxW, lh, stagger, alpha}.
 */
export function layoutText(ctx, str, o) {
  const { hud } = ctx;
  const f = { family: o.family || SANS, weight: o.weight ?? 400, tracking: o.tracking ?? 0 };
  const fa = { ...f, weight: o.strong ?? f.weight };
  const ws = words(str);
  const lines = wrapWords(ws, o.maxW, (w) => hud.measure(w.w, o.size, w.accent ? fa : f), hud.measure(' ', o.size, f));
  const lh = o.size * (o.lh ?? 1.18);
  return {
    lines, height: lines.length * lh, lh, count: ws.filter((w) => !w.br).length,
    draw(t, x, y, { t0 = -1e9, stagger = 0.1, rise = 0.5, alpha = 1, align = 'left', color, accent } = {}) {
      let k = 0;
      lines.forEach((L, li) => {
        const lx = align === 'center' ? x - L.width / 2 : align === 'right' ? x - L.width : x;
        const ly = y + li * lh + o.size;
        for (const w of L.words) {
          const e = easeOutCubic((t - t0 - k++ * stagger) / rise);
          if (e <= 0) continue;
          hud.text(w.w, lx + w.x, ly + (1 - e) * o.size * 0.35, {
            size: o.size, family: f.family, weight: w.accent ? fa.weight : f.weight, tracking: f.tracking,
            color: w.accent ? (accent || ctx.C.accent) : (color || ctx.C.strong), alpha: alpha * e,
            glow: 0,
          });
        }
      });
    },
  };
}
