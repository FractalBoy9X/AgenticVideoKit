# What determinism means here

The visual renderer calls `window.renderAt(t)` with explicit timestamps rather than recording browser playback in real time. Modules must reconstruct their complete state at `t`, including when frames are requested out of order. Procedural code uses seeded generators. Ingested video is read as fixed numbered frames.

Your audio files and sound generators are assembled locally; no procedural music/sound catalog is provided. Seeded Piper narration creates a fresh seeded inference session for each utterance and caches WAV files by text/voice settings. Recording-based narration uses your own local files. These mechanisms support repeatable content when their environment and inputs stay fixed.

## Verification

`npm run test:frames` compares exact PNG hashes for each example shot in every language/format across two independent browser sessions. It also seeks in reverse order and revisits frames. This catches hidden animation state and browser-session differences for the sampled scenes, not every possible custom module/time.

`npm run test:quick` checks metadata, every local film, multilingual timing, subtitles, mastering against FFmpeg and repeatability of a temporary user-generator fixture and supplied recordings across separate Python processes. Piper repeatability is checked if the Polish model is installed; the test reports when it is skipped. `npm test` also runs the frame test.

For intentional appearance changes, use `node render/snap.mjs --film <slug> --update` to establish baselines. `npm run snap` compares stills with local approved baselines. Missing baselines fail instead of silently accepting new output. Comparisons use downscaled JPEGs and tolerance thresholds; they are visual regression checks, not proof of identical encoded files.

## Reproduce a render

Archive the film JSON, modules, recordings and imported assets; the Git revision; the npm lockfile and Python package versions; Chrome/FFmpeg versions and flags; OS/architecture/GPU details; and the exact Piper `.onnx` and `.onnx.json` files if used. Keep the generated WAVs if narration must be reproduced without relying on a model download.

`film.mjs approve` records a source hash covering the film, assets, recordings, shared engine/library code and user font files, audio/render/tools code and dependency files. Render manifests record that hash, timing, FPS, frame size and measured output loudness. Approval does not enforce an OS, GPU driver, installed browser version or Python installation.

The manifest's creation timestamp intentionally changes each run. GPU floating point, system or supplied font rasterization, JPEG/PNG and H.264/AAC encoder implementations, model updates and dependency changes may affect outputs. No cross-platform or cross-version byte-identity claim is made.

Voice cache IDs include text and settings, not model-file content. After replacing a voice model or its runtime, remove that film's `audio/voice/` cache and recheck timing before reapproving. `command` engines must manage their own seeds, versions and caches. macOS `say` is retained for draft compatibility; it is outside the seeded inference guarantee. Review its current terms yourself before distribution.
