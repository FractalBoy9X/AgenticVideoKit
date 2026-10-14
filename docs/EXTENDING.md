# Implement your content

The pipeline does not supply a catalog of finished scenes. Start from the user's brief, build the needed modules, and compose them on the timeline. The shared library is initially empty; it grows from your own work.

## Data flow

```text
brief + your modules + your media
              ↓
       explicit script beats
              ↓ sketch
       film.json + shots.md
              ↓ check / review
          preview video
              ↓ human review / approve
       MP4 + subtitles + manifest
```

`new` copies the minimal technical example so a fresh project is executable immediately. Replace that example, not the engine, to implement the intended film. Keep each project in `films/<slug>/`; shared code goes in `src/library/` only when you choose to reuse it.

## Runtime contract

A film-local `modules/x.js` is referenced as `./x`, a shared `src/library/modules/x.js` as `x`. Export `meta` with kind, about, tags, params and an example. `create(ctx, clip)` runs once and returns an instance:

- `update(t, alpha)` draws/reconstructs the current state; required for visible clips.
- `camera(t, alpha)` optionally returns `{ pos: [x,y,z], target: [x,y,z], fov, near?, far? }`.
- `async prepare(t)` optionally loads the exact assets required at this time and is awaited before capture.
- A module's optional `validate(clip, film, env)` returns errors for the CLI validator.

`ctx` includes `THREE`, scene, camera, `hud` (`text`, `measure`, `line`, `circle`, `rect` and `hud.g` for direct Canvas calls), W/H, u, colors/style, film, shots/layers, effects, language/locale/format, `cue`, `load`, `asset`, `loadImage`, `loadJSON` and `project`. `u` equals the shorter frame dimension divided by 1080. Each clip includes its params, group, t0/t1/hold and alpha(t).

A layer/world uses this same contract and lives across multiple shots. Film layer `from`/`to` may be shot ids or seconds; z determines whether it draws before or after shots. You supply geometry, materials, rig definitions and any helper APIs exposed by the layer instance. No models, rigs, worlds or procedural scenery are shipped.

## Your media module

`ctx.loadImage("assets/collection/photo.png")` returns an ImageBitmap. Load it during creation, then use `ctx.hud.g.drawImage(...)` in update, setting globalAlpha inside save/restore. You choose framing, movement, annotations and layout.

An ingested clip folder contains `clip.json` and `00001.jpg`, `00002.jpg`, etc. Load metadata in create. In `prepare(t)`, derive the index from `Math.floor((t - clip.t0) * metadata.fps)`, clamp to `[0, frames - 1]`, and await the corresponding numbered image. Draw it in update. Decide explicitly whether your clip freezes, loops or ends; recompute state for every seek and avoid depending on a previous frame.

For fonts, add a film `fonts` array with family, film-relative src and optional weight/style. The engine loads these before constructing scenes. Specify the family in HUD calls or layoutText options; `style.subtitle.family` configures subtitles. Keep the exact font file in your film's assets for repeatable typography.

## Your audio

A module may queue `ctx.cue(absoluteTime, "file", {file: "assets/click.wav", gain: 0.5})`. Narration uses the reserved `voice` cue internally. Other kinds must be registered as functions in a film or shared `sounds.py` META registry. They receive a cue dict including seed and return finite 48 kHz mono or stereo numpy arrays. Initialize random generators from the supplied seed; use no global evolving RNG state. Unknown kinds fail instead of being silently ignored. `typingCues` queues a user-defined `key` sound; implement it before using this convenience helper.

Music defaults to none. Supply a file, or a command adapter with an explicit seed. The command receives a JSON plan containing duration, shot structure and optional user-defined sections. Music generation itself is yours to implement. Audio assembly and loudness mastering are pipeline services; there are no default arrangements or sound designs.

## Reuse your work

Use `film.mjs find/show/catalog` to search your shared code. `film.mjs promote <slug> <module>` copies a metadata-complete local block into the library. Film references remain local until you explicitly switch them. Promotion copies underscore-prefixed helper imports recursively and adjusts standard helper paths; review the resulting imports for more complex modules. `promote <slug> style` stores an inline style, and `promote <slug> sound:<kind>` copies a sound generator plus helper functions.

Default style is neutral: black background, white text, fixed camera, no automatic soundtrack, decorations, bloom, grain or vignette. Inline style fields can configure rendering effects, colors and subtitles. Defaults are mechanics, not a film design.

## Checks

Run `check`, inspect a review sheet and a preview, then run `node tools/determinism.mjs --film <slug>`. Custom animation must reconstruct the same complete frame at arbitrary t. It should work after jumping forward and backward and after opening a fresh browser. Baseline comparisons are optional and require explicit initial acceptance with `render/snap.mjs --film <slug> --update`.

MacOS is the tested platform for the source pipeline. For Linux/Windows start with doctor and the documented path/graphics overrides, then verify real output before claiming support.
