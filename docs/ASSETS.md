# Personal assets and reusable blocks

There are two distinct libraries:

- `assets/library/<id>/`: your local media, a catalog and SHA-256 checksums. Ignored by Git.
- `src/library/`: your reusable source code, styles, sound generators and custom rigs (initially empty). Tracked by Git.

## Media lifecycle

1. Keep originals in your own backed-up folder. `materials/` is ignored if you prefer an in-repo inbox.
2. `node tools/assets.mjs add product-v1 /path/to/media --license "Owned by me" --source "Original shoot"` imports a file or folder. Ids use lowercase letters, digits and hyphens.
3. `node tools/assets.mjs list` lists stored collections.
4. `node tools/assets.mjs import my-film product-v1` makes a verified independent copy in the film.
5. Read the printed `files[].file` paths, then load them from your own modules or use file music references in `film.json`.
6. For a revision, add `product-v2` and import it separately. Imports refuse existing destination folders. Deleting a library collection later does not remove existing film copies.

`add` stores normalized media, not a backup of original input files. Images wider than 3840px may be resized. Videos become 30fps JPEG sequences up to 1920px wide, plus `clip.json` with FPS and dimensions. Your module can select these fixed frames deterministically without seeking a video decoder during rendering. Audio is stored separately. Font and 3D/data files are stored without conversion; you supply their loaders. Recognized reference formats include text, JSON, CSV, HTML and PDF; the pipeline does not automatically turn documents into scenes.

The inherited ingestion walker includes nested folders up to three directory levels below the selected root and ignores hidden files. Review `index.json` and reported skipped files after importing. Use separate, clearly named collections to avoid filename collisions. The registry avoids storing an absolute source path; its `from` entries are relative names. The `--source` note is your explicit attribution text and can contain whatever you choose to record.

Each saved collection has `asset.json` with license/source notes, paths and SHA-256 hashes over normalized files. Hash verification detects edits to stored files before copying them. A film import preserves those notes and prints paths relative to the film directory. The full film approval hash also includes imported media, recordings and pipeline sources. It does not pin external executables or remote model availability.

For film-only assets, `node tools/film.mjs ingest my-film /path/to/media` writes directly to `films/my-film/assets/`. Re-ingesting there can replace matching generated clips/files, so keep originals and use the versioned library workflow when preserving revisions matters.

## Sharing

User films, library media, generated audio/video and voice weights are excluded from the default repository. To deliberately share a selected film, review its content and terms, remove outputs/caches, and adjust the ignore rules. A still regression baseline contains rendered pixels and can reveal private content; only commit it intentionally.

Do not put credentials in source, film configs, command arrays or attribution notes. Local custom code and external commands run with the permissions of the process. Keep these configs trusted.
