# Third-party components

The repository's MIT license covers project code. Installed dependencies and user-supplied media retain their own terms.

| Component | Inclusion |
| --- | --- |
| Three.js, Puppeteer Core | Installed by npm; versions fixed by package-lock.json. Refer to each distribution's LICENSE. |
| numpy, scipy, Pillow | Installed from requirements.txt; refer to their distribution licenses. |
| Chrome/Chromium, FFmpeg | Installed separately; not redistributed here. Features and terms depend on the user's distribution/build. |
| Piper, ONNX Runtime | Optional installation through requirements-tts.txt. Piper is a separate GPL tool; not bundled. |
| Voice model weights | Downloaded separately into the ignored .voices/ directory. Review model-card and dataset terms for the selected version. |
| System fonts | Supplied by the user's OS; exact appearance may vary. No font files are redistributed here. |

No media, font files, character rigs, world designs, finished scene modules, music arrangements or sound designs are bundled. The message/progress-bar module is a newly written minimal contract example.

Default English/Polish voice model names are convenience settings, not current rights verification. Archive exact model/configuration hashes and review their terms before distributing narrated results.

Record source, terms and attribution for user media in asset collection metadata or brief.json. Adding a file to the registry does not grant rights to use or distribute it.
