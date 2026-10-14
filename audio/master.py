"""Loudness and mastering (ITU-R BS.1770-4 / EBU R128), numpy + scipy only.

    python audio/master.py measure FILE.wav            → {"lufs", "tp"} as JSON
    python audio/master.py master IN.wav OUT.wav [--lufs -14] [--tp -1] [--margin 0.5]

Used by audio/mix.py: integrated loudness to `lufs`, true peak (4× oversampling)
limited to `tp - margin` dBTP, so the AAC encode that follows stays under `tp`.
Everything is deterministic: same input, same output.
"""

from __future__ import annotations

import json
import sys
import wave
from pathlib import Path

import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import lfilter, resample_poly

SR = 48_000

# K-weighting at 48 kHz (BS.1770-4, table 1 and 2): high shelf, then RLB high-pass.
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def _stereo(x: np.ndarray) -> np.ndarray:
    return x[:, None] if x.ndim == 1 else x


def loudness(x: np.ndarray, sr: int = SR) -> float:
    """Integrated loudness in LUFS (gated). -inf for silence."""
    assert sr == SR, "loudness() is calibrated for 48 kHz"
    x = _stereo(x)
    y = lfilter(*_K2, lfilter(*_K1, x, axis=0), axis=0)
    block, hop = int(0.4 * sr), int(0.1 * sr)
    if len(y) < block:
        y = np.pad(y, ((0, block - len(y)), (0, 0)))
    sq = np.cumsum(np.concatenate([np.zeros((1, y.shape[1])), y ** 2]), axis=0)
    starts = np.arange(0, len(y) - block + 1, hop)
    z = (sq[starts + block] - sq[starts]) / block          # mean square per block and channel
    zs = z.sum(axis=1)                                     # channel weights G = 1 (L, R)
    with np.errstate(divide="ignore"):
        lj = -0.691 + 10 * np.log10(zs)
    keep = lj > -70.0
    if not keep.any():
        return float("-inf")
    rel = -0.691 + 10 * np.log10(zs[keep].mean()) - 10.0
    keep &= lj > rel
    return float(-0.691 + 10 * np.log10(zs[keep].mean()))


def true_peak(x: np.ndarray) -> float:
    """True peak in dBTP (4× oversampling)."""
    up = resample_poly(_stereo(x), 4, 1, axis=0)
    p = float(np.abs(up).max())
    return 20 * np.log10(p) if p > 0 else float("-inf")


def limit(x: np.ndarray, ceiling_db: float, lookahead: float = 0.005, release: float = 0.08) -> np.ndarray:
    """Look-ahead peak limiter on the oversampled peak envelope. The gain is already at
    its minimum when a peak arrives (forward min over `lookahead`, then a backward
    average of the same length) and recovers with a one-pole `release`."""
    x = _stereo(x)
    ceil = 10 ** (ceiling_db / 20)
    up = np.abs(resample_poly(x, 4, 1, axis=0)).max(axis=1)
    pk = up[: len(x) * 4].reshape(len(x), 4).max(axis=1)
    need = np.minimum(1.0, ceil / np.maximum(pk, 1e-12))
    L = max(2, int(lookahead * SR) // 2 * 2)
    g = minimum_filter1d(need, size=L + 1, origin=-(L // 2), mode="nearest")   # min over [n, n+L]
    g = uniform_filter1d(g, size=L + 1, origin=L // 2, mode="nearest")         # mean over [n-L, n]
    gr = 1.0 - g
    a = np.exp(-1.0 / (release * SR))
    gr = np.maximum(gr, lfilter([1 - a], [1, -a], gr))
    return x * (1.0 - gr)[:, None]


def master(x: np.ndarray, lufs: float = -14.0, tp: float = -1.0, margin: float = 0.5) -> tuple[np.ndarray, dict]:
    """Gain to `lufs` LUFS integrated, true peak ≤ tp - margin dBTP. Returns (audio, report)."""
    x = _stereo(x).astype(np.float64)
    src = loudness(x)
    if not np.isfinite(src):
        return x, {"lufs": src, "tp": float("-inf"), "gain_db": 0.0}
    ceiling = tp - margin
    gain = lufs - src
    y = x
    for _ in range(6):
        y = limit(x * 10 ** (gain / 20), ceiling)
        for _ in range(3):  # inter-sample overs left by the gain curve itself
            p = true_peak(y)
            if p <= ceiling + 0.02:
                break
            y = limit(y, ceiling - (p - ceiling))
        err = lufs - loudness(y)
        if abs(err) < 0.05:
            break
        gain += err
    return y, {"lufs": round(loudness(y), 2), "tp": round(true_peak(y), 2), "gain_db": round(gain, 2), "input_lufs": round(src, 2)}


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        assert w.getframerate() == SR and w.getsampwidth() == 2, f"{path}: need 16-bit {SR} Hz"
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
        return x.reshape(-1, w.getnchannels())


def write_wav(path: Path, x: np.ndarray) -> None:
    x = _stereo(x)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype(np.int16)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main() -> None:
    args = sys.argv[1:]
    if args[:1] == ["measure"] and len(args) == 2:
        x = read_wav(Path(args[1]))
        print(json.dumps({"lufs": round(loudness(x), 2), "tp": round(true_peak(x), 2)}))
    elif args[:1] == ["master"] and len(args) >= 3:
        opts = {k[2:]: float(v) for k, v in zip(args[3::2], args[4::2])}
        y, rep = master(read_wav(Path(args[1])), **opts)
        write_wav(Path(args[2]), y)
        print(json.dumps(rep))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
