# AgenticVideoKit

A local video pipeline for **your own modules and assets**. Describe a film in JSON, implement its scenes yourself or with an agent, and render frames at explicit timestamps using Three.js, Canvas, Chrome and FFmpeg.

The repository provides the generation workflow and runtime: scaffolding, a module contract, timeline, languages/formats, asset storage, validation, frame capture, audio assembly, subtitles and render manifests. The shared module library starts empty. You create the visual content, characters, environments, styles, music and sound generators for your projects.

**Developed and tested on macOS. Linux and Windows have not been validated and may require adapting browser flags, Python paths, FFmpeg configuration and font handling.** The current verification scope is recorded in [docs/VALIDATION.md](docs/VALIDATION.md).

## Install and run the technical example

Use Node 18 or newer, Python 3.12 or newer, Google Chrome, and FFmpeg with `libx264` and `drawtext`. The Python versions from the tested macOS environment are pinned in `requirements.txt`.

```bash
# Install Chrome separately. If using Homebrew:
brew install ffmpeg
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm run doctor
npm run film -- check example
npm run preview -- --film example --lang en
```

The only sample is a **technical module** in `films/example/modules/message.js`: white text and a progress bar derived from `t`. It demonstrates the API, bilingual text and landscape/portrait output. It is also copied by the scaffolder as a starting point; replace it with your own implementation. It uses system fonts, no music and no narration models. No media, bundled font files, scene catalog, character rigs, world designs, music arrangements or sound designs are included.

Outputs live under `films/<slug>/output/`. For the English example preview: `example.en.preview.mp4`, an `.srt` file and a JSON manifest. Add `--format 9:16` for portrait; `--lang all` renders every declared language. Render each format separately.

## Create a film from your idea

```bash
npm run film -- new my-film
# Write brief.json; replace modules/message.js with your own code.
# Point script.json beats at your modules, using "use": "./your-module".
npm run film -- sketch my-film
npm run film -- check my-film
npm run review -- --film my-film --lang all --format all
npm run preview -- --film my-film
```

`brief.json` records the desired content and constraints. You or your agent write film-local modules and explicit beats in `script.json`. `sketch` compiles those beats into `film.json` and `shots.md`; it requires an existing module for every `use`. It does not choose a stock scene or invent visuals from a prose brief. If `film.json` already exists, it writes `film.draft.json`; `--force` explicitly replaces the current film.

After watching a preview:

```bash
npm run film -- approve my-film
npm run render -- --film my-film
```

A final render requires a matching approval. Editing film data, assets, recordings or pipeline source invalidates it. `--force` explicitly bypasses the local review gate. See [AGENTS.md](AGENTS.md) for the workflow an agent should follow.

## Define your modules

A shot can be any deterministic 2D/3D content you implement. Film-local references use `"type": "./my-shot"`; your shared modules use `"type": "my-shot"`.

```js
// films/my-film/modules/my-shot.js
export const meta = {
  kind: 'shot',
  about: 'Describe your scene.',
  tags: ['custom', 'scene'],
  params: { text: ['string', true, 'Text to display'] },
  example: { type: './my-shot', hold: 4, text: 'Hello' },
};
export default function create(ctx, clip) {
  return {
    update(t, alpha) {
      ctx.hud.text(clip.text, ctx.W / 2, ctx.H / 2, {
        family: 'sans-serif', size: 48 * ctx.u,
        align: 'center', color: '#ffffff', alpha,
      });
    },
  };
}
```

Use the block in a script beat with `"use": "./my-shot"`, or directly in `film.json` with `"type": "./my-shot"`. Metadata enables validation and discovery. You can add persistent layers, camera control and asynchronous preparation through the same contract. [docs/EXTENDING.md](docs/EXTENDING.md) describes these interfaces and how to implement media playback.

Once your own block is reusable, run `npm run film -- promote my-film my-shot`. It copies the block into `src/library/modules/`; switch references explicitly when you want to use that shared copy. `find`, `show`, `catalog` and `lint` operate on the library **you build**. Styles and sound registries are empty extension points, not bundled content.

## Save your assets for reuse

```bash
npm run assets -- add brand-v1 /path/to/your/materials --license "Owned by me" --source "Original materials"
npm run assets -- list
npm run assets -- import my-film brand-v1
```

`add` ingests a file or folder into the local `assets/library/`, recording paths, attribution/license notes and SHA-256 checksums. `import` verifies and copies a snapshot into `films/my-film/assets/brand-v1/`. Existing collections/imports are never overwritten; use a new id for a revised version.

The command prints paths for your modules to load with `ctx.loadImage`, `ctx.loadJSON`, `ctx.asset` or your chosen Three.js loader. Images and clips have no stock rendering module: you implement their composition and playback. Video ingestion extracts numbered 30fps JPEG frames plus `clip.json`; select frames from `t` rather than relying on real-time video seeking. Fonts and 3D/data files can also be stored; you supply the corresponding loader or font configuration.

For film-only assets use `npm run film -- ingest my-film /path/to/materials`. Ingestion can resize images and does not preserve the source clip's audio; keep backed-up originals and add audio separately. Read [docs/ASSETS.md](docs/ASSETS.md).

Your library, user film folders, models, generated files and credentials are ignored by Git. Shared source in `src/library/` is tracked. Deliberately sharing a film or library asset requires reviewing its contents and changing the ignore rules. `.gitignore` is not a backup or access control system.

## Audio, subtitles and fonts

The pipeline mixes supplied audio, user-defined generators and optional narration. It has **no built-in music or sound catalog**. Music defaults to `none`; use a file or a generator command:

```json
{ "music": { "engine": "file", "src": "assets/brand-v1/music.wav" } }
```

A `command` music engine accepts `cmd: ["program", "{plan}", "{out}", "{seed}"]`; `{duration}` is also available. The plan includes shot timing, optional `sections` and the seed. You supply the generator and ensure its reproducibility. A module can queue `ctx.cue(time, "file", { file: "assets/click.wav" })`, or a named function from its own `sounds.py`. Custom sounds register in `META` and return finite mono/stereo numpy arrays at 48 kHz; initialize randomness from the cue's `seed`. The mixer reports unknown cue kinds as errors.

For optional local Piper narration:

```bash
.venv/bin/python -m pip install -r requirements-tts.txt
npm run doctor -- --tts
```

Set `"voice": { "engine": "piper", "seed": 7 }`. Default English/Polish model names are configured in `src/engine/lang.js`; weights download separately into `.voices/`. Review the selected model's current terms. Alternatives are your recordings with `voice.engine: "files"` or a local `command` adapter. `"voice": "none"` keeps text subtitles without speech.

`languages: ["en", "pl"]` supports localized values `{ "en": "Hello", "pl": "Cześć" }` and a shared timeline fitted to the longest narration. Formats are `16:9`, `9:16`, `1:1`, `4:5`, with per-shot overrides. `subtitles: true`, `"srt"` or `false` selects burned-in/sidecar output. Mastering targets −14 LUFS and ≤ −1 dBTP, subject to the input's dynamics; inspect actual measurements in the manifest.

No font files are bundled. Use system fonts, or provide `fonts: [{ "family": "MyFont", "src": "assets/my-font.woff2", "weight": 400 }]` in your film and select that family in your module. For subtitle layout, `style.subtitle.family` selects the family. Use the same exact font files/environment for reproducibility.

## Determinism and checks

Frames are requested at `t = frame / fps`. Derive complete module state from `t`, including for out-of-order seeks. Use `rng(seed)` / `hash` from `src/lib/util.js`; external audio generators must manage their own seeds. Neutral defaults add no soundtrack, backdrop, camera drift or automatic decorative overlays.

```bash
npm run test:unit    # asset snapshots, approval inputs, defaults and new → sketch → check
npm run test:quick   # units + registry/film validation + audio/subtitle checks
npm test             # also compare sampled frames across fresh browsers and shuffled seeks
npm run test:frames -- --film my-film
npm run snap:update  # explicitly establish a local visual baseline for example
npm run snap         # compare local baselines; missing baseline fails
```

Repeatability is scoped to the same pinned environment. OS, GPU, Chrome, system fonts, model files and encoder versions can change results. Manifests intentionally include a changing creation timestamp. The frame test samples shot midpoints and cannot prove every possible frame or custom module. See [docs/DETERMINISM.md](docs/DETERMINISM.md).

## Platform configuration and license

- `CHROME_PATH`: browser executable.
- `PYTHON`: interpreter; otherwise local Unix/Windows virtualenv paths, then system Python.
- `CHROME_ANGLE`: graphics backend, default `metal` on macOS and `gl` elsewhere.
- FFmpeg and FFprobe must be on `PATH`.

Windows/Linux fallbacks are starting points for adaptation, not validated support. Shell commands above use macOS syntax. Custom modules, sound functions and command adapters execute locally; run trusted project configs.

Code is [MIT](LICENSE). Dependencies, external tools, voice models and your own resources have separate terms: [THIRD_PARTY.md](THIRD_PARTY.md). Importing an asset records your notes and does not grant rights to it.
