# Validation report

Prepared on 2026-10-15. The original pipeline was developed and tested on macOS. The content-free version received the checks below in a restricted macOS session. Its shared module, rig, style and sound registries are empty. The only sample is the newly written technical message/progress-bar contract example.

## Environment

| Component | Observed version |
| --- | --- |
| Platform | macOS, Apple Silicon (darwin/arm64) |
| Node | 24.4.1 |
| Python | 3.12.14 |
| FFmpeg / FFprobe | 7.1, with libx264 and drawtext |
| numpy | 2.5.3 |
| scipy | 1.18.1 |
| Pillow | 12.3.0 |
| Optional Piper / ONNX Runtime | 1.8.0 / 1.31.0 installed |

The existing local Python environment was selected with `PYTHON`; virtual environments and voice weights were not copied into the public source. Chrome was found at the standard macOS path, but could not launch inside this session. Its version and visual output were therefore not verified here. A clean dependency installation and GitHub Actions execution have not been performed in this session.

## Passed

- `npm run doctor -- --tts`: executable discovery, Python imports, FFmpeg encoder/filter availability and optional TTS imports.
- `npm run test:unit`: six tests covering asset snapshots/integrity and approval hashes, neutral defaults, new → sketch → check with film-local code, and promotion/reuse of a user module in another project.
- `npm run test:quick`: 10 reported checks passed, including one explicitly skipped Piper synthesis check because no voice model was downloaded into this repository. Executed checks cover the units, empty shared registries, one technical sample in both languages/formats, timing, subtitles and audio metering/mastering. Five audio integration cases cover silence without content, file-cue placement/clipping, deterministic supplied generators plus recordings across processes, command plan/seed substitution, and rejection of unknown cue kinds.
- Media integration: generated synthetic PNG, MP4 and WAV files, saved a versioned asset collection, imported it into a new film, checked extracted video frames and validated a film-local module and supplied music reference; no stock image/clip modules are needed. Fixtures were removed afterward.
- Visual baseline utility: a missing baseline is reported as missing, an explicit update creates it, and an unchanged synthetic frame matches. This tests the comparison utility, not browser rendering.
- Syntax checks for JavaScript plus Python/JSON parsing, and relative source import/link validation.

## Still to verify locally

`npm test` reaches its browser frame comparison and fails because the session disallows binding the local render server (`listen EPERM` on loopback). Direct Chrome startup also terminated with `SIGABRT`. A full render, visual review and frame determinism of this extracted version remain unverified; the checks are provided, not claimed as passed. Piper synthesis repeatability also remains unverified here.

Outside the restricted session, after installation:

```bash
npm run doctor
npm test
npm run review -- --film example --lang all --format all
npm run preview -- --film example --lang en
npm run preview -- --film example --lang pl --format 9:16
# Watch the previews, then:
node tools/film.mjs approve example
npm run render -- --film example --lang en
```

Linux and Windows have not been tested. Treat browser/path fallbacks as starting points for a port, and record new validation results before claiming support.
