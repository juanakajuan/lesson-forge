# Render a lesson

Render lets an author turn a clean lesson file into one HTML file a learner can open. The file contains the lesson title and the lesson data.

## Sub-features

- `render-clean` writes HTML for `examples/slope-intercept.json`.
- `render-keeps-title` puts the lesson title in the HTML title and shows the same title as the page heading after serve.

## How to get to it (user POV)

- Run `npm run lf -- render examples/slope-intercept.json -o slope-intercept.html` from the repository root.
- Open the HTML file in a browser.

## Driving it with lf-verify

Preconditions:

- `LF_VERIFY_HOME` is a new directory whose path contains `lesson-forge-verify`.
- `node .cursor/skills/verify-lesson-forge/lf-verify.mjs doctor` prints `toolchain: ok`.
- `examples/slope-intercept.json` is the lesson under test.

- **Render.** Write the lesson into this run's home. Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs render examples/slope-intercept.json`. Exit code `0`. Stderr contains `0 error(s), 0 warning(s)` and a `wrote` line whose path ends with `/out/slope-intercept.html` under `LF_VERIFY_HOME`.
- **File contents.** Read that HTML file before cleanup. It contains `<title>Lines: slope and intercept</title>` and `id="lesson-data"`.
- **Open it.** Start the browser on that file. Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs serve`. Wait for a line that starts with `ready http://127.0.0.1:` and ends with `/slope-intercept.html`. Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs doctor`. Doctor prints `instance: up` and `title: Lines: slope and intercept`.
- **Proof.** Save the render transcript with `| tee verify-evidence/render-lesson/render.txt` before cleanup. Save the heading with `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser snapshot --aria --path verify-evidence/render-lesson/page.aria.txt` and `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser screenshot --path verify-evidence/render-lesson/page.png`. The snapshot contains `heading "Lines: slope and intercept"`. The screenshot shows that title.

## Gotchas

- Cleanup deletes `LF_VERIFY_HOME`, including the HTML file. Copy the transcript and the snapshot out first.
- A lesson that fails the linter exits `1` and does not write HTML. Do not serve a missing file and call the render verified.
- The repository directories `out/` and `_site/` are not this run. Render through the helper so the file lands in the home.
