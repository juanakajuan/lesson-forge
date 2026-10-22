---
name: verify-lesson-forge
description: "Drive lesson-forge the way an author or a learner does. Authors use the lf CLI to check, render, and build a site. Learners use the rendered lesson in a browser. Use when a change touches the CLI, the renderer, or the lesson runtime and the proof has to come from the real app."
---

# Verify lesson-forge

The learner surface is a self-contained HTML lesson. The author surface is the `lf` CLI (`check`, `render`, `site`). `generate` calls Claude and can spend money. Do not run `generate` in a verification run.

Run every command from the repository root. The helper is `.cursor/skills/verify-lesson-forge/lf-verify.mjs`.

## Launch

Node 24 or newer is required. Install dependencies once:

```bash
npm install
```

Each run gets its own home. Two runs can proceed at the same time only when each has a different `LF_VERIFY_HOME`.

```bash
export RUN_ID=$(date +%s)-$$
export LF_VERIFY_HOME=/tmp/lesson-forge-verify-$RUN_ID
mkdir -p "$LF_VERIFY_HOME"
node .cursor/skills/verify-lesson-forge/lf-verify.mjs doctor
```

Toolchain ready: doctor prints `toolchain: ok` and `instance: none`.

A browser run then renders into that home and starts Chromium there. Do not open `out/` or `_site/` in the repository. Do not drive a home you did not start.

```bash
node .cursor/skills/verify-lesson-forge/lf-verify.mjs render examples/slope-intercept.json
node .cursor/skills/verify-lesson-forge/lf-verify.mjs serve
```

`serve` stays in the foreground. Ready: a line that starts with `ready http://127.0.0.1:`. The page heading is visible. A port that accepts a connection is not enough.

`serve --page index.html` opens that file from the home `out` directory. After `render` of one lesson, the only file is that lesson, and `serve` opens it with no `--page` flag. After `site`, the default page is `index.html`.

Override the browser binary with `LF_CHROMIUM` when the executable is not `chromium` on `PATH`.

## Doctor

Run doctor before driving, and again whenever a command fails.

```bash
node .cursor/skills/verify-lesson-forge/lf-verify.mjs doctor
```

Doctor is read-only. It checks the Node major version, that `chromium` or `LF_CHROMIUM` exists, that `src/cli.ts` and `node_modules/esbuild` exist, and, when a home has state, that the server pid and the Chromium pid from that state are alive. It then fetches the saved URL and requires HTTP 200 plus header `X-Lesson-Forge-Verify: 1`. It reads the heading in `#app` and requires it to match the title stored at serve time.

Worth driving: `toolchain: ok` and, for a browser recipe, `instance: up` with the URL and title you started. `instance: dead` or `instance: foreign` means stop. Run cleanup, then start a new home. Do not attach to a process you did not start.

## Drive

Prefer the feature file over an improvised path. The helper clicks and fills by role and accessible name.

Stable handles in the rendered lesson:

- `heading` — the lesson title, from the page `h1`
- `progressbar` — `Lesson progress`
- `button` — `Continue` on an explanation, on a simulation with no goal, and after the last worked-example step
- `button` — `Next step (N/M)` while a worked example still has hidden steps
- `button` — `Finish` on the recap
- `button` — `Check`, then `Check again`, `Hint`, and `Show answer` on a check and on a simulation with a goal
- `radio` — the choice text, including its punctuation
- `textbox` — `Your answer` on a numeric check
- `slider` — the slider label from the lesson (`slope m`, `intercept b` on the first simulation of `examples/slope-intercept.json`, and `x₁`, `y₁`, `x₂`, `y₂` on the goal simulation `make-slope-two`)
- `status` — `Goal:` and the goal description on a simulation with a goal, and `Move a slider first.` when Check is used before a slider moves
- `mastery` — one snapshot line for each row of the end summary, as `mastery "Solid: <objective text>"`. The badge is `Solid`, `Review`, or `Not assessed`.
- `button` — `Move "Compute the slope m = (y₂ − y₁) ÷ (x₂ − x₁)" up` and the matching `down` button on the ordering check in `examples/slope-intercept.json`. Other items use the same `Move "` + item text + `" up` name.
- `status` — the feedback text after Check, or `Answer first.` when Check is used with an empty answer

Commands:

```bash
node .cursor/skills/verify-lesson-forge/lf-verify.mjs check examples/slope-intercept.json
node .cursor/skills/verify-lesson-forge/lf-verify.mjs render examples/slope-intercept.json
node .cursor/skills/verify-lesson-forge/lf-verify.mjs site examples
node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser click --role button --name "Continue"
node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser fill --role textbox --name "Your answer" --value "-2"
node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser fill --role slider --name "slope m" --value "2" --last
node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser reload
node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser snapshot --aria --path verify-evidence/continue-explanation/after.aria.txt
node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser screenshot --path verify-evidence/continue-explanation/after.png
```

`fill` on a slider sets the value and sends the `input` event, as a drag does. `--last` selects the last match in page order. Use it when an earlier block has a control with the same role and name. Without `--last`, two matches are an error.

`reload` loads the page again with no learner state and waits for the lesson heading. Use it to start a new scenario on the same instance.

`check` with no file argument is the usage path. Exit code `2` and the usage text on stderr.

CLI exit codes from `src/cli.ts`: `0` clean, `1` schema or linter errors, `2` usage. The helper prints `command:`, `exit:`, `--- stderr ---`, and `--- stdout ---`, then exits with the same code.

## Evidence

Write proof under `verify-evidence/` from the repository root. Use the feature id as the folder name, for example `verify-evidence/continue-explanation/`. Cleanup does not remove that directory. `.gitignore` lists `verify-evidence/`, so the proof stays on disk and out of git.

- Exercise the real author command or the real lesson page. Do not call `lint`, `renderLesson`, or `renderBlock` from a unit test and call that the proof.
- Record the action and the resulting state. A final screenshot without the prior state is not enough.
- CLI proof is the command, stdout, stderr, and exit code. Save them with `tee` into the evidence directory before cleanup.
- Render and site also write files under `$LF_VERIFY_HOME/out`. That directory is deleted by cleanup. Copy the stderr `wrote` line, and confirm the HTML title, before cleanup.
- Browser proof is an ARIA snapshot and a PNG screenshot. The lesson title or the site heading `lesson-forge` has to be visible in the screenshot.
- A check that changes the page (a correct answer reveals the next block) needs the status text and the next block in the snapshot.
- `generate` is out of scope. It is not a dry-run. It calls Claude.

## Cleanup

```bash
node .cursor/skills/verify-lesson-forge/lf-verify.mjs cleanup
```

Cleanup sends `SIGTERM` to the server pid and the Chromium pid stored in `$LF_VERIFY_HOME/state.json`, then `SIGKILL` if they are still alive, then deletes `$LF_VERIFY_HOME`. It does not kill by process name. It does not delete `verify-evidence/`.

Run cleanup after a failed attempt too, so a broken run does not keep the port or the browser. Then confirm the evidence files are still in `verify-evidence/`.

## Helpers

The helper is executable:

```bash
node .cursor/skills/verify-lesson-forge/lf-verify.mjs --help
```

Feature recipes and the evidence paths are in `features/README.md`.
