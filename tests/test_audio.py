"""Integration fixtures are generated temporarily; no stock audio is bundled."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "audio"))
import master as M


class AudioPipeline(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="agentic-audio-")
        self.base = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def run_job(self, name="output", **kwargs):
        job = {"duration": 0.25, "out": str(self.base / f"{name}.wav"),
               "stems": str(self.base / "stems"), "base": str(self.base),
               "filmDir": str(self.base), "master": False, "music": {"engine": "none"},
               "cues": [], "sounds": [], **kwargs}
        file = self.base / f"{name}.json"
        file.write_text(json.dumps(job))
        result = subprocess.run([sys.executable, "-B", str(ROOT / "audio/mix.py"), str(file)], capture_output=True, text=True)
        return result, Path(job["out"])

    def test_no_content_means_silence(self):
        result, out = self.run_job()
        self.assertEqual(result.returncode, 0, result.stderr)
        x = M.read_wav(out)
        self.assertEqual(x.shape, (12000, 2))
        self.assertFalse(np.any(x))

    def test_file_cue_placement_clips_to_film(self):
        source = self.base / "tone.wav"
        M.write_wav(source, np.full((4800, 2), 0.25))
        result, out = self.run_job(cues=[{"t": -0.05, "kind": "file", "file": "tone.wav", "gain": 0.5}])
        self.assertEqual(result.returncode, 0, result.stderr)
        x = M.read_wav(out)
        self.assertTrue(np.allclose(x[:2400], 0.125, atol=2 / 32768))
        self.assertFalse(np.any(x[2400:]))

    def test_seeded_user_generator_and_recording_repeat_across_processes(self):
        module = self.base / "sounds.py"
        module.write_text('import numpy as np\nMETA={"custom": {}}\ndef custom(cue):\n    return np.random.default_rng(cue["seed"]).normal(0, 0.01, 2400)\n')
        M.write_wav(self.base / "voice.wav", np.sin(np.arange(4800)[:, None] * 0.05) * 0.03)
        config = {"sounds": [str(module)], "cues": [
            {"t": 0.1, "kind": "custom", "seed": 17},
            {"t": 0, "kind": "voice", "file": "voice.wav"}]}
        outputs = []
        for name in ["a", "b"]:
            result, out = self.run_job(name, **config)
            self.assertEqual(result.returncode, 0, result.stderr)
            outputs.append(hashlib.sha256(out.read_bytes()).hexdigest())
            self.assertTrue(np.any(M.read_wav(out)))
        self.assertEqual(outputs[0], outputs[1])

    def test_command_receives_plan_and_seed(self):
        command = self.base / "generate.py"
        command.write_text('import json,sys,wave\nplan=json.load(open(sys.argv[1]))\nassert plan["seed"] == int(sys.argv[3]) == 23\nwith wave.open(sys.argv[2],"wb") as out:\n out.setnchannels(2); out.setsampwidth(2); out.setframerate(48000); out.writeframes(b"\\0"*4800*4)\n')
        result, out = self.run_job(music={"engine": "command", "seed": 23, "cmd": [sys.executable, str(command), "{plan}", "{out}", "{seed}"]})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["music"]["engine"], "command")
        self.assertTrue(out.exists())

    def test_unregistered_cue_is_an_error(self):
        result, _ = self.run_job(cues=[{"t": 0, "kind": "missing"}])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no user sound generator", result.stderr)


if __name__ == "__main__":
    unittest.main()
