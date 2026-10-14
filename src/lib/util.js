// Small deterministic math helpers. Every frame is a pure function of time,
// so nothing here keeps state between frames.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => clamp((x - a) / (b - a));
export const remap = (x, a, b, c, d) => lerp(c, d, invLerp(a, b, x));
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInCubic = (t) => Math.pow(clamp(t), 3);
export const easeInOutCubic = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeOutExpo = (t) => { t = clamp(t); return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); };
export const easeInExpo = (t) => { t = clamp(t); return t === 0 ? 0 : Math.pow(2, 10 * t - 10); };
export const easeInOutExpo = (t) => {
  t = clamp(t);
  if (t === 0 || t === 1) return t;
  return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
};
export const easeOutBack = (t, s = 1.4) => { t = clamp(t) - 1; return t * t * ((s + 1) * t + s) + 1; };

/** 0 → 1 over [a, a+fadeIn], hold, 1 → 0 over [b-fadeOut, b]. */
export function window01(t, a, b, fadeIn = 0.3, fadeOut = 0.3) {
  if (t < a || t > b) return 0;
  return Math.min(smooth((t - a) / fadeIn), smooth((b - t) / fadeOut));
}

/** Mulberry32 seeded PRNG. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless hash noise in [0, 1). */
export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function hexToRgb(hex) {
  const h = typeof hex === 'number' ? hex : parseInt(hex.replace('#', ''), 16);
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}

export function rgba(hex, a = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function mixHex(h1, h2, t) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  const c = a.map((v, i) => Math.round(lerp(v, b[i], t)));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

/** Quadratic bezier point for flying particles. */
export function qbez(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
