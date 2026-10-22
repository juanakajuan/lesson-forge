# Answer a multiple-choice question

Answer a multiple-choice question lets a learner choose one option, submit it, and see feedback. On the slope-intercept lesson, the first question asks where `y = 3x − 2` crosses the y-axis. The correct choice is `(0, −2)`. A correct first try reveals the next explanation.

## Sub-features

- `mcq-reach` shows the intercept question after the opening explanation and the first simulation.
- `mcq-correct` marks `(0, −2)` correct and reveals the slope explanation.
- `mcq-empty` asks for an answer when Check is used with nothing selected.

## How to get to it (user POV)

- Open the rendered slope-intercept lesson.
- Choose `Continue` on the opening explanation.
- Choose `Continue` on the line simulation.
- Choose a choice, then choose `Check`.

## Driving it with lf-verify

Preconditions:

- `LF_VERIFY_HOME` is a new directory whose path contains `lesson-forge-verify`.
- The page is a fresh render of `examples/slope-intercept.json`.
- `node .cursor/skills/verify-lesson-forge/lf-verify.mjs doctor` prints `instance: up` and `title: Lines: slope and intercept`.
- No choice has been selected and Check has not been used.

- **Leave the introduction.** Choose `Continue`. Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser click --role button --name "Continue"`. The snapshot command `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser snapshot --aria --path verify-evidence/answer-multiple-choice/simulation.aria.txt` contains `slider "slope m"`.
- **Leave the simulation.** Choose `Continue` again. Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser click --role button --name "Continue"`. A snapshot contains the stem text `Where does the line` and `button "Check"`. It does not contain `button "Hint"`.
- **Empty submit.** Choose `Check` before a choice. Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser click --role button --name "Check"`. A snapshot contains `status "Answer first."` and still contains `button "Check"`.
- **Correct choice.** Choose `(0, −2)`. Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser click --role radio --name "(0, −2)"`. Then run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser click --role button --name "Check"`.
- **Result.** Run `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser snapshot --aria --path verify-evidence/answer-multiple-choice/correct.aria.txt` and `node .cursor/skills/verify-lesson-forge/lf-verify.mjs browser screenshot --path verify-evidence/answer-multiple-choice/correct.png`. The snapshot contains `status` text that starts with `Right.` and the next explanation text `Slope compares`. The screenshot shows the lesson title.
- **Proof.** Keep the simulation snapshot, the correct snapshot, and the screenshot. The correct snapshot is the resulting state after the Check click.

## Gotchas

- Choices are shuffled on each page load. Click the choice by its text. Do not click the first radio.
- The minus signs in `(0, −2)` and in the stem are the Unicode minus `−`, not a hyphen.
- `Hint` appears after a wrong answer. `Show answer` appears after a second wrong answer. Neither is on the untouched question. A run that answers wrong has not proved the correct path.
- `Answer first.` does not count as an attempt. The button stays `Check`, not `Check again`.
- This recipe is only the intercept question in `examples/slope-intercept.json`. The numeric question and the ordering question are different blocks. Do not report them as verified from this path.
