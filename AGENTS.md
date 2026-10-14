# Agent contract: build the user's content

This repository supplies a generation pipeline and an empty shared library. You implement the user's scenes, graphics, characters, worlds, styles and sound generators. The sample message/progress bar is a technical API example, not the intended film content.

## Workflow

1. Run `node tools/film.mjs new <slug>`. Record the user's idea, materials, duration, languages, formats and constraints in brief.json. Inspect the user's supplied media and existing modules if any.
2. Plan the shots. Write your own film-local implementations in `films/<slug>/modules/`, each exporting `meta` and `create(ctx, clip)`. Replace the sample module with content matching the brief. Use shared modules only if the user has already built suitable ones; the initial library is empty.
3. Write explicit `script.json` beats, each with `use: "./module-name"` (or a user-authored shared name). `sketch` compiles these into film.json and shots.md. It does not turn prose into implemented scenes or choose built-in designs.
4. Run `film.mjs check <slug>`; fix missing modules/assets, parameter/translation issues and timing. Check synthesizes optional narration.
5. Run `render/review.mjs --film <slug> --lang all --format all`; inspect sheets and fix issues. Render a preview and let the human inspect it before `film.mjs approve <slug>` and a final render. Explicit user authorization can override this local review workflow.
6. Run relevant tests, including `tools/determinism.mjs --film <slug>` for custom animation. Return MP4/SRT/manifest paths, measured loudness, and any illustrative content or remaining limitations.

Read engine, renderer and audio code when needed to implement or extend the mechanism. Keep other films and the original project untouched.

## Module contract

```js
export const meta = {
  kind: 'shot', // or layer, world
  about: 'Describe what this user-created module does.',
  tags: ['custom', 'scene'],
  params: { text: ['string', true, 'Text'] },
  example: { type: './my-shot', hold: 4, text: 'Hello' },
};
export default function create(ctx, clip) {
  return {
    update(t, alpha) { /* derive the complete visible state from t */ },
    // camera(t, alpha) -> {pos, target, fov}; optional
    // async prepare(t); optional, awaited before capture
  };
}
// Optional validate(clip, film, env) -> string[]
```

`ctx` provides Three.js, scene/camera, HUD primitives and its 2D context, dimensions, `u` scale, style/colors, film/layers, time-based effects, language/format, cue scheduling, module loading, asset URLs, image/JSON loading and projection. `clip` contains params, group, absolute `t0/t1`, hold and alpha(t). See docs/EXTENDING.md for specifics.

Use seeded randomness and full state reconstruction; no Math.random, wall-clock values or accumulated animation state. Persistently shared layers use the same contract. Sound functions belong in the film's sounds.py (or the user's shared registry), have complete META, accept a cue including seed, and return 48 kHz mono/stereo arrays. No stock sound kinds or score engine are provided. Music is none/file/user-command.

## Reuse and publication

Use tools/assets.mjs to store versioned user media and import checked snapshots into films. `film.mjs find/show/catalog` discovers the library the user builds. Promote useful modules/styles/sounds only after review; promotion copies code and preserves film-local references until explicitly changed.

Do not commit user film folders, library assets, rendered output, credentials or downloaded weights by default. Only the minimal technical example and scaffolding belong to the initial public source. Document rights and provenance for resources deliberately shared. Keep macOS testing and cross-platform limitations explicit; never report blocked browser checks as passing.
