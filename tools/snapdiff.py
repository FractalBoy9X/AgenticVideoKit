"""Visual regression for stills: compare frames rendered now with stored baselines.

    python tools/snapdiff.py --cur DIR --base DIR [--diff DIR] [--update] [--width 480]

Every *.jpg in --cur is downscaled to --width and compared with the file of the same
name in --base. Prints one JSON object (frames + summary). --update stores the current frame as the baseline. Missing baselines fail. A changed frame gets a heat map
(baseline | current | difference) in --diff.

Metrics: mae = mean absolute difference (0–255, all channels); pct = share of pixels
whose largest channel difference exceeds 24/255. A frame is "same" when mae < 0.6 and
pct < 0.2 %. Determinism makes real regressions stand out by orders of magnitude.
"""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image

SAME_MAE, SAME_PCT = 0.6, 0.2


def encode(path: Path, width: int) -> tuple[bytes, Image.Image]:
    """Downscale and JPEG-encode exactly as a stored baseline is, so an unchanged
    render compares as equal byte for byte. Returns (jpeg bytes, decoded image)."""
    im = Image.open(path).convert("RGB")
    if im.width != width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=92)
    data = buf.getvalue()
    return data, Image.open(io.BytesIO(data)).convert("RGB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cur", required=True)
    ap.add_argument("--base", required=True)
    ap.add_argument("--diff")
    ap.add_argument("--update", action="store_true")
    ap.add_argument("--width", type=int, default=480)
    a = ap.parse_args()
    cur, base = Path(a.cur), Path(a.base)
    base.mkdir(parents=True, exist_ok=True)
    frames = []
    for f in sorted(cur.glob("*.jpg")):
        data, im = encode(f, a.width)
        b = base / f.name
        if not b.exists() and not a.update:
            frames.append({"name": f.name, "status": "missing"})
            continue
        if a.update:
            existed = b.exists()
            b.write_bytes(data)
            frames.append({"name": f.name, "status": "updated" if existed else "new"})
            continue
        ref = Image.open(b).convert("RGB")
        if ref.size != im.size:
            frames.append({"name": f.name, "status": "changed", "why": f"size {ref.size} → {im.size}"})
            continue
        x, y = np.asarray(im, dtype=np.int16), np.asarray(ref, dtype=np.int16)
        d = np.abs(x - y)
        mae = float(d.mean())
        pct = float((d.max(axis=2) > 24).mean() * 100)
        same = mae < SAME_MAE and pct < SAME_PCT
        row = {"name": f.name, "status": "same" if same else "changed", "mae": round(mae, 3), "pct": round(pct, 3)}
        if not same and a.diff:
            out = Path(a.diff)
            out.mkdir(parents=True, exist_ok=True)
            heat = np.clip(d.max(axis=2) * 4, 0, 255).astype(np.uint8)
            heat = np.stack([heat, heat // 3, heat // 3], axis=2)
            sheet = np.concatenate([y, x, heat], axis=1).astype(np.uint8)
            Image.fromarray(sheet).save(out / f.name, quality=90)
            row["diff"] = str(out / f.name)
        frames.append(row)
    stored = {f.name for f in cur.glob("*.jpg")}
    for b in sorted(base.glob("*.jpg")):
        if b.name not in stored:
            frames.append({"name": b.name, "status": "missing"})
    count = lambda s: sum(1 for r in frames if r["status"] == s)
    summary = {k: count(k) for k in ("same", "changed", "new", "updated", "missing")}
    print(json.dumps({"frames": frames, "summary": summary}))


if __name__ == "__main__":
    main()
