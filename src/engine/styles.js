// Style configuration mechanics. No appearance presets are bundled.

export const BASE = {
  about: '',
  colors: {},
  glow: 0,
  fx: { bloomStrength: 0, bloomThreshold: 0.72, bloomRadius: 0.5 },
  grade: { vignette: 0, grain: 0, aberration: 0 },
  // toneMapping 'aces' | 'neutral' suits lit 3D worlds; hudLate draws the 2D layer after
  // tone mapping, so text keeps its exact colours.
  renderer: { toneMapping: 'none', exposure: 1, shadows: false },
  hudLate: true,
  subtitle: { family: 'sans-serif', size: 40, color: '#ffffff', box: 'rgba(0,0,0,0.45)', weight: 500 },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** a ← b, merging plain objects one level deep (colors, fx, renderer, …). */
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(a[k]) ? { ...a[k], ...v } : v;
  return out;
}

/**
 * film.style → complete style, or { error }. spec: undefined | "preset" |
 * { extends?: "preset", ...overrides }. presets: src/library/styles.js PRESETS.
 */
export function resolveStyle(spec, presets = {}) {
  const own = typeof spec === 'string' ? { extends: spec } : spec || {};
  const parent = own.extends;
  if (parent && !presets[parent]) return { error: `unknown style preset "${parent}" (presets: ${Object.keys(presets).join(', ')})` };
  const { extends: _, ...rest } = own;
  const style = merge(merge(BASE, parent ? presets[parent] : {}), rest);
  // hex strings are accepted for bg (C.bg is a number elsewhere)
  if (typeof style.colors.bg === 'string') style.colors = { ...style.colors, bg: parseInt(style.colors.bg.replace('#', ''), 16) };
  return { style, name: parent ? (Object.keys(rest).length ? `${parent}+` : parent) : (spec ? 'custom' : 'base') };
}

/** Frame size of each film.json "format". Mirrors render/common.mjs FORMATS. */
export const FORMATS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };

/** Transition into a shot: cross-fade, hard cut, or dip through black. */
export const TRANSITIONS = ['cross', 'cut', 'fade'];
