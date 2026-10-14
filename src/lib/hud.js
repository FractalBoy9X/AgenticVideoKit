// 2D overlay (text, terminal, flat diagrams). Drawn onto a canvas that is
// composited into the WebGL pipeline, so it receives the same bloom / grain.

import { clamp, rgba } from './util.js';
import { C } from './palette.js';

export const MONO = 'monospace';
export const SANS = 'sans-serif';

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    // Monospace code must not ligate (`--`, `->`, `==`): render glyph-by-glyph.
    this.g.textRendering = 'optimizeSpeed';
    this.g.fontVariantLigatures = 'none';
    this.W = canvas.width;
    this.H = canvas.height;
    this._cw = {};
    /** Multiplies every glow (shadow blur); a light style sets 0. */
    this.glowScale = 1;
  }

  clear() {
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.globalAlpha = 1;
    this.g.clearRect(0, 0, this.W, this.H);
  }

  font(size, { family = MONO, weight = 400 } = {}) {
    return `${weight} ${size}px ${family}`;
  }

  /** Advance width of one monospace glyph at `size`. */
  cw(size, weight = 400) {
    const k = `${size}:${weight}`;
    if (!this._cw[k]) {
      this.g.font = this.font(size, { weight });
      this.g.letterSpacing = '0px';
      this._cw[k] = this.g.measureText('M').width;
    }
    return this._cw[k];
  }

  measure(str, size, opts = {}) {
    const g = this.g;
    g.font = this.font(size, opts);
    g.letterSpacing = `${opts.tracking || 0}px`;
    return g.measureText(str).width;
  }

  text(str, x, y, o = {}) {
    const {
      size = 16, family = MONO, weight = 400, color = C.text, alpha = 1,
      align = 'left', baseline = 'alphabetic', glow = 0, glowColor = null, tracking = 0,
    } = o;
    if (alpha <= 0.002 || !str) return 0;
    const g = this.g;
    g.save();
    g.globalAlpha = clamp(alpha);
    g.font = this.font(size, { family, weight });
    g.letterSpacing = `${tracking}px`;
    g.textAlign = align;
    g.textBaseline = baseline;
    if (glow > 0 && this.glowScale > 0) {
      g.shadowColor = glowColor || color;
      g.shadowBlur = glow * this.glowScale;
    }
    g.fillStyle = color;
    g.fillText(str, x, y);
    const w = g.measureText(str).width;
    g.restore();
    return w;
  }

  line(x1, y1, x2, y2, { color = C.line, width = 1, alpha = 1, glow = 0, dash = null } = {}) {
    if (alpha <= 0) return;
    const g = this.g;
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = width;
    if (dash) g.setLineDash(dash);
    if (glow && this.glowScale) { g.shadowColor = color; g.shadowBlur = glow * this.glowScale; }
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    g.restore();
  }

  circle(x, y, r, { fill = null, stroke = null, width = 1.5, alpha = 1, glow = 0 } = {}) {
    if (alpha <= 0 || r <= 0) return;
    const g = this.g;
    g.save();
    g.globalAlpha = clamp(alpha);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    if (glow && this.glowScale) { g.shadowColor = fill || stroke; g.shadowBlur = glow * this.glowScale; }
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
    g.restore();
  }

  rect(x, y, w, h, { fill = null, stroke = null, width = 1, alpha = 1, radius = 0, glow = 0 } = {}) {
    if (alpha <= 0) return;
    const g = this.g;
    g.save();
    g.globalAlpha = clamp(alpha);
    g.beginPath();
    if (radius) g.roundRect(x, y, w, h, radius); else g.rect(x, y, w, h);
    if (glow && this.glowScale) { g.shadowColor = fill || stroke; g.shadowBlur = glow * this.glowScale; }
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
    g.restore();
  }

  alphaColor(hex, a) { return rgba(hex, a); }
}
