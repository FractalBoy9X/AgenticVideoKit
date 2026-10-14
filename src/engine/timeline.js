// Engine timeline. A film is a list of shots; each shot stays up for `hold`
// seconds and every absolute time is derived from those holds. The transition into a shot (`in`) is a
// cross-fade over `transition` seconds, a hard cut, or a dip through black.
// Layers are modules that live across shots (a 3D world, a watermark, a
// running chart…): film.layers = [{ id, type, from, to, z, ...params }].

import { window01, smooth } from '../lib/util.js';

// ------------------------------------------------------------------ sound
const cues = [];

/** Queue a user-defined sound or a narration cue. No sound designs are bundled. */
export function cue(t, kind, params = {}) {
  cues.push({ t: +Math.max(0, t).toFixed(4), kind, ...params });
}

export function allCues() {
  return cues.slice().sort((a, b) => a.t - b.t);
}

export function typingCues(str, t0, cps, gain = 1) {
  for (let i = 0; i < str.length; i++) {
    if (str[i] === ' ') continue;
    cue(t0 + i / cps, 'key', { gain, seed: i });
  }
}

// ------------------------------------------------------------------ shots
/** Keys every shot may carry besides its module's own params. */
export const SHOT_KEYS = ['id', 'type', 'hold', 'in', 'say', 'sayAt', 'sayTail', 'section', 'energy', 'notes'];
/** Keys every layer may carry besides its module's own params. */
export const LAYER_KEYS = ['id', 'type', 'from', 'to', 'fadeIn', 'fadeOut', 'z', 'notes'];

/**
 * shots → absolute times. inOf(shot) gives the transition into the shot
 * (shot.in, else the module's default, else film.in, else 'cross').
 */
export function buildTimeline(film, style, inOf = (s) => s.in || film.in || 'cross') {
  const X = film.transition ?? 0.6;
  let t = 0;
  const shots = film.shots.map((s, i) => {
    const sh = { ...s, i, t0: t, t1: t + s.hold };
    t += s.hold;
    return sh;
  });
  const DURATION = +t.toFixed(3);
  const last = shots.length - 1;
  shots.forEach((s, i) => { s.in = i === 0 ? 'cut' : inOf(s); });
  const dips = [];
  shots.forEach((s, i) => {
    const next = shots[i + 1];
    const tin = s.in, tout = next ? next.in : 'cut';
    s.lo = tin === 'cross' ? s.t0 - X / 2 : s.t0;
    s.hi = tout === 'cross' ? s.t1 + X / 2 : s.t1;
    const fin = tin === 'cross' ? X : tin === 'fade' ? X / 2 : 1e-3;
    const fout = tout === 'cross' ? X : tout === 'fade' ? X / 2 : 1e-3;
    /** Visibility of the shot at t: 0 → 1 → 0 across its transitions. */
    s.alpha = (tt) => window01(tt, s.lo, s.hi, i === 0 ? 1e-3 : fin, i === last ? 1e-3 : fout);
    if (tin === 'fade' && i > 0) dips.push(s.t0);
  });
  /** Whole-picture dim for 'fade' transitions (3D included). */
  const dip = (tt) => dips.reduce((f, b) => f * smooth(Math.abs(tt - b) / (X / 2)), 1);

  // Optional structure passed through to user music generators.
  const SECTIONS = film.sections || [];

  return { shots, DURATION, SECTIONS, dip };
}

/**
 * Layers → absolute windows. from / to: seconds, a shot id (from = its start,
 * to = its end), or omitted (whole film). z < 0 (default) draws under the
 * shots, z ≥ 0 over them. Returns { layers, errors }.
 */
export function buildLayers(film, shots, DURATION) {
  const errors = [];
  const at = (v, edge, def) => {
    if (v === undefined) return def;
    if (typeof v === 'number') return v;
    const s = shots.find((x) => x.id === v);
    if (!s) { errors.push(`layer time "${v}": no shot with that id`); return def; }
    return edge === 'from' ? s.t0 : s.t1;
  };
  const layers = (film.layers || []).map((l, i) => {
    const L = { ...l, i, id: l.id || `layer${i}`, z: l.z ?? -1 };
    L.t0 = L.lo = at(l.from, 'from', 0);
    L.t1 = L.hi = at(l.to, 'to', DURATION);
    L.hold = L.t1 - L.t0;
    const fin = l.fadeIn ?? (L.t0 > 0 ? 0.5 : 1e-3), fout = l.fadeOut ?? (L.t1 < DURATION ? 0.5 : 1e-3);
    L.alpha = (tt) => window01(tt, L.lo, L.hi, fin || 1e-3, fout || 1e-3);
    if (!(L.t1 > L.t0)) errors.push(`layer ${L.id}: empty time range`);
    return L;
  });
  return { layers, errors };
}
