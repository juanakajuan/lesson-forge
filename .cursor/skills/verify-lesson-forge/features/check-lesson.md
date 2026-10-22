# Check a lesson

Check lets an author validate a lesson file. A clean file exits successfully and reports zero errors. A missing file argument prints usage and does not validate a lesson.

## Sub-features

- `check-clean` accepts `examples/slope-intercept.json`.
- `check-usage` rejects a check command that has no lesson file.

## How to get to it (user POV)

- Run `npm run lf -- check examples/slope-intercept.json` from the repository root.
- Run the same command with no lesson file.

## Driving it with lf-verify

Preconditions:

- `LF_VERIFY_HOME` is a new directory whose path contains `lesson-forge-verify`.
- `node .cursor/skills/verify-lesson-forge/lf-verify.mjs doctor` prints `toolchain: ok`.
- No browser instance is required.

- **Clean lesson.** Check the shipped example. Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs check examples/slope-intercept.json`. Exit code `0`. Stderr contains `0 error(s), 0 warning(s)`. Stdout is empty.
- **Missing file.** Check with no path. Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs check`. Exit code `2`. Stderr contains `lesson-forge <command>` and the `check` line. No HTML file is written.
- **Proof.** Save both transcripts. Run the clean command with `| tee verify-evidence/check-lesson/clean.txt` and the usage command with `| tee verify-evidence/check-lesson/usage.txt`. The files keep the `command:` line, the `exit:` line, and the stderr body after cleanup.

## Gotchas

- Exit code `1` is a schema or linter failure. Exit code `2` is usage. Do not treat them as the same result.
- The helper prints a wrapper transcript around the CLI stderr. Assert the CLI's `0 error(s), 0 warning(s)` line, not only the wrapper's `exit:` line.
- `check` reads the lesson file in place. It does not need the browser, and it does not write under `LF_VERIFY_HOME`.
