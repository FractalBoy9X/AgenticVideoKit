"""Cheap critique of review frames (render/review.mjs): measurable problems only.

    python tools/critique.py PROBE.json   → JSON {issues: [...], stats: {...}}

PROBE.json: {size: [W, H], frames: [{file, t, shot, id, boxes: [{s, x0, y0, x1, y1, size, color, alpha}]}],
             subtitles: [[t0, t1, text]], shots: [{id, t0, t1, hold, holdDeclared}], lang, format}

Checks (level · what):
  error · text cut by the frame edge
  warn  · text outside the title-safe area (5 % of the short side)
  warn  · two different texts overlapping
  warn  · contrast below WCAG 3:1 (large text) / 4.5:1 (small), measured against the pixels behind the text
  warn  · text smaller than 18 px at 1080p
  warn  · an empty frame (flat image, no text)
  warn  · subtitles faster than 17 characters per second
  warn  · more text on screen than ~22 characters per second of the shot
  info  · holds fitted to the narration
The picture's taste (composition, motion, story) stays with the human: see the contact sheet.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def parse_color(c):
    if not c:
        return None
    c = c.strip()
    if c.startswith("#") and len(c) in (4, 7):
        h = c[1:]
        if len(h) == 3:
            h = "".join(x * 2 for x in h)
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    m = re.match(r"rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)", c)
    return tuple(int(float(m.group(i))) for i in (1, 2, 3)) if m else None


def lum(rgb):
    a = np.asarray(rgb, dtype=np.float64) / 255.0
    a = np.where(a <= 0.03928, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    return float(0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]) if a.ndim == 1 else 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def contrast(l1, l2):
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def main() -> None:
    P = json.loads(Path(sys.argv[1]).read_text())
    W, H = P["size"]
    margin = 0.05 * min(W, H)
    u = min(W, H) / 1080
    issues = []
    add = lambda level, where, msg: issues.append({"level": level, "at": where, "msg": msg})

    for fr in P["frames"]:
        where = f"{fr['id'] or '#' + str(fr['shot'])} @ {fr['t']:.1f}s"
        im = np.asarray(Image.open(fr["file"]).convert("RGB"))
        sx, sy = im.shape[1] / W, im.shape[0] / H
        boxes = [b for b in fr["boxes"] if b["alpha"] >= 0.6 and b["s"].strip()]
        if not boxes and (lum(im[::8, ::8].reshape(-1, 3)).std() < 0.004):
            add("warn", where, "pusta klatka (płaski obraz bez tekstu)")
        cut, out, small, low = [], [], [], []
        for b in boxes:
            if b["x0"] < -2 or b["y0"] < -2 or b["x1"] > W + 2 or b["y1"] > H + 2:
                cut.append(b["s"])
            elif b["x0"] < margin or b["y0"] < margin or b["x1"] > W - margin or b["y1"] > H - margin:
                out.append(b["s"])
            if b["size"] < 18 and len(b["s"]) > 2:
                small.append(f"{b['s'][:24]} ({b['size']:.0f}px)")
            rgb = parse_color(b.get("color"))
            if rgb is None or b["size"] < 12:
                continue
            # background = a ring just outside the text box (inside it, glyph edges and
            # their glow would count as background)
            pad = 0.35 * b["size"] * u
            X0, X1 = int(max(0, (b["x0"] - pad) * sx)), int(min(im.shape[1], (b["x1"] + pad) * sx))
            Y0, Y1 = int(max(0, (b["y0"] - pad) * sy)), int(min(im.shape[0], (b["y1"] + pad) * sy))
            x0, x1 = int(max(0, b["x0"] * sx)), int(min(im.shape[1], b["x1"] * sx))
            y0, y1 = int(max(0, b["y0"] * sy)), int(min(im.shape[0], b["y1"] * sy))
            if x1 - x0 < 3 or y1 - y0 < 3:
                continue
            ring = np.ones((Y1 - Y0, X1 - X0), bool)
            ring[y0 - Y0: y1 - Y0, x0 - X0: x1 - X0] = False
            patch = im[Y0:Y1, X0:X1][ring].astype(np.float64)
            far = np.linalg.norm(patch - np.asarray(rgb), axis=1) > 90  # pixels that are not other glyphs
            if far.sum() < 0.2 * max(1, len(patch)):
                continue
            bg = np.median(patch[far], axis=0)
            ratio = contrast(lum(rgb), lum(bg))
            large = b["size"] >= 23.5 or (b.get("weight", 400) >= 600 and b["size"] >= 18.5)
            need = 3.0 if large else 4.5
            if ratio < need:
                low.append(f"„{b['s'][:24]}” {ratio:.1f}:1")
        if cut:
            add("error", where, f"tekst ucięty przez krawędź kadru: {', '.join(sorted(set(cut))[:4])}")
        if out:
            add("warn", where, f"tekst poza marginesem bezpieczeństwa: {', '.join(sorted(set(out))[:4])}")
        if small:
            add("warn", where, f"drobny tekst: {', '.join(sorted(set(small))[:3])}")
        if low:
            add("warn", where, f"niski kontrast: {', '.join(low[:3])}")
        # overlap of different texts (words of one line touch, they do not overlap)
        seen = set()
        for i, a in enumerate(boxes):
            for b in boxes[i + 1:]:
                if a["s"] == b["s"]:
                    continue
                ix = min(a["x1"], b["x1"]) - max(a["x0"], b["x0"])
                iy = min(a["y1"], b["y1"]) - max(a["y0"], b["y0"])
                if ix <= 0 or iy <= 0:
                    continue
                area = min((a["x1"] - a["x0"]) * (a["y1"] - a["y0"]), (b["x1"] - b["x0"]) * (b["y1"] - b["y0"]))
                if ix * iy > 0.12 * area:
                    key = tuple(sorted((a["s"][:20], b["s"][:20])))
                    if key not in seen:
                        seen.add(key)
                        add("warn", where, f"teksty nachodzą na siebie: „{key[0]}” / „{key[1]}”")
        # too much to read in the shot
        shot = next((s for s in P["shots"] if s["i"] == fr["shot"]), None)
        chars = sum(len(b["s"]) for b in boxes if b["size"] >= 18)
        if shot and chars / max(1.0, shot["hold"] - 1.0) > 22 and not shot.get("say"):
            add("warn", where, f"dużo tekstu na ujęcie: {chars} znaków w {shot['hold']} s")

    for a, b, text in P.get("subtitles", []):
        cps = len(text) / max(0.1, b - a)
        if cps > 17:
            add("warn", f"napisy {a:.1f}s", f"napis za szybki: {cps:.0f} znaków/s (≤ 17): „{text[:40]}…”")
    for s in P["shots"]:
        if s.get("holdDeclared"):
            add("info", s["id"] or f"#{s['i']}", f"hold {s['holdDeclared']} → {s['hold']} s (dopasowany do dłuższej narracji)")

    order = {"error": 0, "warn": 1, "info": 2}
    issues.sort(key=lambda x: order[x["level"]])
    stats = {k: sum(1 for i in issues if i["level"] == k) for k in order}
    print(json.dumps({"issues": issues, "stats": stats}, ensure_ascii=False))


if __name__ == "__main__":
    main()
