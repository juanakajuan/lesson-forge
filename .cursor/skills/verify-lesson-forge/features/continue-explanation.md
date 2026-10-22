# Continue an explanation

Continue lets a learner leave the opening explanation and see the next block. On the slope-intercept lesson, the next block is the line simulation: two sliders and the prompt that asks which slider tilts the line.

## Sub-features

- `continue-from-intro` removes the opening Continue control and reveals the next block.
- `continue-shows-sliders` shows the slope slider and the intercept slider.

## How to get to it (user POV)

- Open the rendered slope-intercept lesson.
- Choose `Continue` under the opening explanation.

## Driving it with lf-verify

Preconditions:

- `LF_VERIFY_HOME` is a new directory whose path contains `lesson-forge-verify`.
- The page is a fresh render of `examples/slope-intercept.json`.
- `node .cursor/skills/verify-lesson-forge/lf-verify.mjs doctor` prints `instance: up` and `title: Lines: slope and intercept`.
- The page is still on the opening explanation. A snapshot contains `button "Continue"` and does not contain `slider "slope m"`.

- **Record the start.** Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser snapshot --aria --path verify-evidence/continue-explanation/before.aria.txt` and `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser screenshot --path verify-evidence/continue-explanation/before.png`. The snapshot contains `heading "Lines: slope and intercept"` and `button "Continue"`, and it does not contain `slider "slope m"`.
- **Continue.** Choose `Continue`. Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser click --role button --name "Continue"`. The command prints `clicked button "Continue"`.
- **Next block.** Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser snapshot --aria --path verify-evidence/continue-explanation/after.aria.txt` and `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser screenshot --path verify-evidence/continue-explanation/after.png`. The snapshot still contains `heading "Lines: slope and intercept"`. It also contains `slider "slope m"`, `slider "intercept b"`, and the text `Move each slider on its own.`
- **Proof.** Keep the before snapshot, the click transcript, the after snapshot, and both screenshots. The before file has no slope slider. The after file has the slope slider and the prompt. Save the click transcript with `| tee verify-evidence/continue-explanation/click.txt`.

## Gotchas

- This recipe clicks `Continue` once. A second click leaves the simulation. That is a different step.
- The opening explanation stays on the page. The proof is the new slider, not the disappearance of the introduction text.
- The simulation in this lesson has no goal, so another `Continue` button is present after the click. Do not require the name `Continue` to vanish.
- A different lesson can put a check or a worked example first. If `button "Continue"` is missing, stop and report that precondition. Do not click a different button and call this feature verified.
