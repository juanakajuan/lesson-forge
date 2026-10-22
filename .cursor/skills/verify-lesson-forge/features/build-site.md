# Build a site

Build a site lets an author render every lesson in a directory and open an index that links them. The index heading is `lesson-forge`. Each lesson title is a heading on that page.

## Sub-features

- `site-index` writes `index.html` and one HTML file per lesson JSON.
- `site-lists-lesson` shows the slope-intercept title on the index.

## How to get to it (user POV)

- Run `npm run lf -- site examples -o site` from the repository root.
- Open `index.html` in a browser.

## Driving it with lf-verify

Preconditions:

- `LF_VERIFY_HOME` is a new directory whose path contains `lesson-forge-verify`.
- `node .cursor/skills/verify-lesson-forge/lf-verify.mjs doctor` prints `toolchain: ok`.
- `examples/` contains `slope-intercept.json` and that file is lint-clean.

- **Build.** Render the examples directory. Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs site examples`. Exit code `0`. Stderr contains `0 error(s), 0 warning(s)` and `wrote` lines for `slope-intercept.html` and `index.html` under `LF_VERIFY_HOME/out`.
- **Index file.** Read `index.html` before cleanup. It contains `<title>lesson-forge</title>` and `Lines: slope and intercept`.
- **Open the index.** Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs serve --page index.html`. Wait for a line that starts with `ready http://127.0.0.1:` and ends with `/index.html`. Doctor prints `instance: up` and `title: lesson-forge`.
- **Proof.** Save the build transcript with `| tee verify-evidence/build-site/site.txt`. Save `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser snapshot --aria --path verify-evidence/build-site/index.aria.txt` and `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser screenshot --path verify-evidence/build-site/index.png`. The snapshot contains `heading "lesson-forge"` and `heading "Lines: slope and intercept"`. The screenshot shows `lesson-forge`.

## Gotchas

- If any lesson in the directory fails the linter, the command exits `1` and writes no index. Do not pass a directory of draft lessons and expect a partial site.
- The link's accessible name is the whole card, not the title alone. Use the heading `Lines: slope and intercept` as the proof. Do not click a link named only with the title.
- `site examples lessons` also builds `lessons/`. This recipe passes only `examples`. A run that uses a different directory has not verified this entry point.
- Cleanup deletes the generated site. Save the transcript and the snapshot first.
