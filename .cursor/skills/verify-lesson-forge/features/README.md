# lesson-forge verification map

This directory is the maintained source for verifying the user-facing behavior of lesson-forge. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Run from the repository root on Node 24 or newer, after `npm install`.
- Set `LF_VERIFY_HOME=/tmp/lesson-forge-verify-$RUN_ID` to a new directory for this run.
- Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs doctor` and require `toolchain: ok`.
- For a browser recipe, render or build the site into that home, run `serve`, and require `instance: up` with the title of the page you opened.
- Never drive an instance that was not started by this verification run.
- Do not run `generate`.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer role and accessible name over CSS selectors or screen coordinates.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Run browser and CLI actions through `node .cursor/skills/verify-lesson-forge/lf-verify.mjs`.
- Save proof under `verify-evidence/` before cleanup. The folder name is the feature id, for example `verify-evidence/continue-explanation/`. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with the lesson title or the site heading visible.
- CLI proof includes the command, stdout, stderr, and exit code.
- Render proof includes the `wrote` line and the title inside the HTML file, copied out before cleanup deletes the home.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with lf-verify` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Check a lesson](./check-lesson.md) covers a clean example and the usage error.
- [Render a lesson](./render-lesson.md) covers writing one self-contained HTML file.
- [Continue an explanation](./continue-explanation.md) covers the learner moving from the first explanation to the next block.
- [Answer a multiple-choice question](./answer-multiple-choice.md) covers the intercept question in the slope-intercept lesson.
- [Build a site](./build-site.md) covers the index page that links rendered lessons.
