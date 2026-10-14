"""Generic 48 kHz audio assembly: supplied files, user generators and narration.

    python audio/mix.py job.json

No music, sound designs, chord progressions or samples are bundled. Custom cue
functions are registered in a user sounds.py META and return mono/stereo arrays.
Music engines: none, file, command. Commands receive {plan}, {out}, {duration},
{seed}; their determinism is the responsibility of the supplied generator.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.signal import lfilter

sys.dont_write_bytecode = True
import master as M

SR = 48_000
ROOT = Path(__file__).resolve().parent.parent


def decode(file: Path, duration: float, start: float = 0.0) -> np.ndarray:
    raw = subprocess.run([
        "ffmpeg", "-v", "error", "-ss", str(start), "-i", str(file),
        "-t", str(duration), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-",
    ], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)


def stereo(samples) -> np.ndarray:
    x = np.asarray(samples, dtype=np.float64)
    if x.ndim == 1:
        x = np.repeat(x[:, None], 2, axis=1)
    elif x.ndim == 2 and x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    if x.ndim != 2 or x.shape[1] != 2 or not np.isfinite(x).all():
        raise ValueError("sound generator must return finite mono/stereo samples at 48 kHz")
    return x


def place(dest: np.ndarray, samples, at: float, gain: float = 1.0) -> None:
    x = stereo(samples)
    offset = round(at * SR)
    source_start = max(0, -offset)
    target_start = max(0, offset)
    size = min(len(x) - source_start, len(dest) - target_start)
    if size > 0:
        dest[target_start:target_start + size] += x[source_start:source_start + size] * gain


def generators(paths: list) -> dict:
    found = {}
    for i, file in enumerate(paths):
        spec = importlib.util.spec_from_file_location(f"user_sounds_{i}", file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for name in getattr(module, "META", {}):
            if name in {"voice", "file"}:
                raise ValueError(f"reserved cue kind: {name}")
            fn = getattr(module, name, None)
            if not callable(fn):
                raise ValueError(f"META lists missing sound generator: {name}")
            found[name] = fn
    return found


def music(job: dict, duration: float) -> tuple[np.ndarray | None, dict]:
    spec = job.get("music") or {"engine": "none"}
    engine = spec.get("engine", "none")
    if engine == "none":
        return None, {"engine": "none"}
    if engine == "file":
        source = ROOT / job["filmDir"] / spec["src"]
    elif engine == "command":
        work = Path(job["stems"])
        work.mkdir(parents=True, exist_ok=True)
        source, plan = work / "generated_music.wav", work / "music_plan.json"
        source.unlink(missing_ok=True)
        plan.write_text(json.dumps({"duration": duration, "seed": spec.get("seed", 1),
                                   "sections": job.get("sections", []), **job.get("plan", {})}))
        values = {"{plan}": str(plan), "{out}": str(source), "{duration}": str(duration), "{seed}": str(spec.get("seed", 1))}
        def substitute(arg):
            for key, value in values.items():
                arg = arg.replace(key, value)
            return arg
        subprocess.run([substitute(a) for a in spec["cmd"]], cwd=ROOT, check=True, stdout=sys.stderr)
        if not source.is_file():
            raise ValueError("music command did not produce its output file")
    else:
        raise ValueError("music.engine: use none, file or command with your own generator")
    return decode(source, duration, float(spec.get("start", 0))) * 10 ** (float(spec.get("gain", 0)) / 20), {"engine": engine, "seed": spec.get("seed", 1)}


def main() -> None:
    job = json.loads(Path(sys.argv[1]).read_text())
    duration = float(job["duration"])
    n = round(duration * SR)
    if n <= 0:
        raise ValueError("duration must be positive")
    bed, voice, sfx = (np.zeros((n, 2)) for _ in range(3))
    supplied, info = music(job, duration)
    if supplied is not None:
        place(bed, supplied, 0)
    registry = generators(job.get("sounds", []))
    for original in job.get("cues", []):
        c = {"seed": 1, **original}
        kind, t, gain = c["kind"], float(c["t"]), float(c.get("gain", 1))
        if kind == "voice":
            place(voice, decode(Path(job["base"]) / c["file"], duration), t, gain)
        elif kind == "file":
            place(sfx, decode(ROOT / job["filmDir"] / c["file"], duration), t, gain)
        elif kind in registry:
            place(sfx, registry[kind](c), t, gain)
        else:
            raise ValueError(f"no user sound generator registered for cue kind {kind!r}")
    bed += sfx
    levels = {"voice": -16, "bed": -22, "duck": 7, **(job.get("levels") or {})}
    if np.any(voice):
        voice_lufs, bed_lufs = M.loudness(voice), M.loudness(bed)
        if np.isfinite(voice_lufs):
            voice *= 10 ** ((levels["voice"] - voice_lufs) / 20)
        if np.isfinite(bed_lufs):
            bed *= 10 ** ((levels["bed"] - bed_lufs) / 20)
        coefficient = np.exp(-1 / (0.05 * SR))
        envelope = lfilter([1 - coefficient], [1, -coefficient], np.abs(voice).max(axis=1))
        envelope = np.clip(envelope / max(envelope.max(), 1e-9), 0, 1)
        bed *= (1 - envelope * (1 - 10 ** (-levels["duck"] / 20)))[:, None]
    out = bed + voice
    report = {"music": info, "lufs": None, "tp": None}
    if job.get("master") is not False and np.any(out):
        opts = job.get("master") or {}
        out, measured = M.master(out, lufs=opts.get("lufs", -14), tp=opts.get("tp", -1), margin=opts.get("margin", 0.8))
        report.update(measured)
    if job.get("writeStems", True):
        dest = Path(job["stems"])
        M.write_wav(dest / "sfx.wav", sfx)
        M.write_wav(dest / "voice.wav", voice)
        if supplied is not None and job.get("musicStems"):
            M.write_wav(Path(job["musicStems"]) / "music.wav", supplied[:n])
    M.write_wav(Path(job["out"]), out)
    print(json.dumps({**report, "out": job["out"]}))


if __name__ == "__main__":
    main()
