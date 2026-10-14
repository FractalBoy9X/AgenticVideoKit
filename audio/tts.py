"""Seeded, batched Piper TTS: deterministic narration (same text + voice + seed → same wav).

    python audio/tts.py jobs.json      → prints {"out path": seconds, ...}

jobs.json: [{"text", "out", "model", "speaker"?, "length_scale"?, "seed", "sentence_silence"?}]

onnxruntime seeds its random ops (VITS noise) when a session is created, so every job
gets a fresh session right after onnxruntime.set_seed(seed): the result of a job does
not depend on the jobs before it. Output: 48 kHz mono 16-bit wav.
Piper (piper-tts, GPL-3.0) runs locally; voices and their licences: AGENTS.md.
"""

from __future__ import annotations

import json
import sys
import wave
from math import gcd
from pathlib import Path

import numpy as np
import onnxruntime as ort
from scipy.signal import resample_poly

SR = 48_000


def synth(job: dict) -> float:
    from piper import PiperVoice, SynthesisConfig

    ort.set_seed(int(job.get("seed", 1)) & 0x7FFFFFFF)
    voice = PiperVoice.load(job["model"])
    cfg = SynthesisConfig(speaker_id=job.get("speaker"), length_scale=job.get("length_scale"))
    rate = voice.config.sample_rate
    gap = np.zeros(int(rate * job.get("sentence_silence", 0.25)), dtype=np.float32)
    parts = []
    for i, chunk in enumerate(voice.synthesize(job["text"], cfg)):
        if i:
            parts.append(gap)
        parts.append(chunk.audio_float_array)
    x = np.concatenate(parts) if parts else np.zeros(rate // 10, dtype=np.float32)
    g = gcd(SR, rate)
    y = resample_poly(x.astype(np.float64), SR // g, rate // g)
    pcm = np.clip(np.round(y * 32767), -32768, 32767).astype(np.int16)
    out = Path(job["out"])
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return round(len(pcm) / SR, 3)


def main() -> None:
    jobs = json.loads(Path(sys.argv[1]).read_text())
    print(json.dumps({j["out"]: synth(j) for j in jobs}))


if __name__ == "__main__":
    main()
