---
name: verify-expr
description: "Check that lesson expressions in src/expr.ts keep the documented precedence and the JavaScript operator values, inside a stated bound. Use when a change touches parseExpr, evaluate, freeVariables, tokenize, or a numeric answer or widget goal that depends on them."
---

# Verify lesson expressions

## Property

A lesson expression has the same number as JavaScript's operators for that grammar: `^` groups to the right, a leading minus binds tighter than `^`, `*` and `/` bind tighter than `+` and `-`, and `+`, `-`, `*`, and `/` group to the left.

## Harm

A wrong number marks a numeric answer correct or wrong, and a simulation goal can succeed at the wrong slider position.

## When a change needs this check

Run it when the diff touches any of these:

- `src/expr.ts` — `tokenize`, `parseExpr`, `evaluate`, `freeVariables`, `FUNCTIONS`, `CONSTANTS`
- `src/lint.ts` — `compile`, `numeric-answer-computes`, `goalSatisfied`, `widget-valid` expression checks
- `src/runtime/blocks.ts` — `numericGrader`
- `src/runtime/widgets.ts` — `compile`, `safeEval`, `goalChecker`

If the diff does not touch those, say so and stop. Do not treat a passing run on unchanged code as proof of an unrelated edit.

## Command

From the repository root, on Node 24 or newer:

```bash
npm run verify:expr
```

That runs `node --test verify/expr-properties.test.ts`. Confirmed with Node v26.11.1. The run is seeded and finishes in well under a second. There is no separate tool to install. No model checker or proof assistant that developers can install here checks this TypeScript directly, so the check runs the real `parseExpr` and `evaluate` on generated inputs.

## What is in scope

The grammar in the comment above `sum` in `src/expr.ts`:

- Every `a^b^c` with `a`, `b`, and `c` integers from 0 through 4, compared with JavaScript `a ** b ** c`.
- Every `-${a}^${b}` with `a` from 0 through 6 and `b` from 0 through 4, compared with `-(a ** b)`.
- Every `a+b*c` and `a-b-c` with `a`, `b`, and `c` integers from -6 through 6.
- Every `a/b/c` with `a`, `b`, and `c` integers from 1 through 6, compared with left-grouped JavaScript division.
- 40 fully parenthesized trees from seed `20261021`, depth at most 3. Leaves are integers from -8 through 8, `x` (bound to 3), or `pi`. Operators are `+`, `-`, `*`, `/`, `^`, unary minus, and calls `abs`, `floor`, and `sqrt`. A divisor is an integer from 1 through 8. A power's exponent is an integer from 0 through 3. A `sqrt` argument is an integer from 0 through 9. The value must be finite and must be the same bits as folding that tree with `+`, `-`, `*`, `/`, `**`, unary minus, and `Math.abs`, `Math.floor`, or `Math.sqrt`.
- `freeVariables` on `pi + e`, on `pi + x + e`, and on those 40 trees with seed `20261022`. `pi` and `e` are not free. `x` is free.
- `parseExpr` returns `{ ok: false }` for `""`, `"2 +"`, `"foo(1)"`, `"1 & 2"`, `"(("`, `"^"`, `"sin("`, and `"1+"`, and it does not throw on 30 short strings from seed `20261023`.
- `sin`, `cos`, `tan`, `sqrt`, `abs`, `exp`, `ln`, `log10`, `floor`, and `round` on the literal calls in the test, compared with the `Math` function of the same name. `ln` is `Math.log`. `e` in `ln(e)` is `Math.E`.
- `1/0` and `0/0` are not finite. `evaluate` of `y` with an empty environment throws.

## What is out of scope

A pass covers those inputs, not every string and not the whole app. It does not cover learner number parsing, answer tolerance, slider-grid search in `goalReachable`, markdown, or the browser. It does not prove the functions for every numeric input, only the listed calls. Very large powers may be `Infinity` on both sides; that does not test a finite result.

## How to read a failure

The test prints the source string.

- `2^3^2` is 64, or any `a^b^c` disagrees with `a ** b ** c`, while `2^(3^2)` is still 512: power in `parseExpr` is grouping to the left. The code changed. The fix belongs in `power` in `src/expr.ts`.
- A fully parenthesized source disagrees with the operator fold, and `node -e` with the same operators agrees with the fold: `evaluate` or parenthesis parsing is wrong.
- `node -e` disagrees with the fold: the fold in `verify/expr-properties.test.ts` is wrong. That is a modeling error. Do not change `src/expr.ts` to match a bad fold.
- `-${a}^${b}` equals `(-a) ** b` for an even `b`: the leading minus is binding looser than power.
- `freeVariables` reports `pi` or `e`, or drops `x`: constant handling in `freeVariables` changed.
- `1/0` is finite: `numeric-answer-computes` in `src/lint.ts` would accept a division by zero as an answer. Keep the non-finite result unless the linter rule is changed in the same edit and the new rule is stated here.

Do not weaken a comparison to make the command pass. Do not change product code unless the user asks. Report a current failure as a finding, with the source string and the two numbers.

## Coverage record

| Check | File | Functions |
| --- | --- | --- |
| Precedence and values | `src/expr.ts` | `parseExpr`, `evaluate`, `tokenize` |
| Function dispatch | `src/expr.ts` | `evaluate`, `FUNCTIONS` |
| Constants and free names | `src/expr.ts` | `freeVariables`, `CONSTANTS` |
| Rejection and divide by zero | `src/expr.ts` | `parseExpr`, `evaluate` |

Sync commit: `fc9bd0f0d6651054a4f608b03df38b841e461721`

That commit is the last one at which this skill was confirmed to describe `src/expr.ts`. When a later commit changes a file in the table, treat the check as stale even if the command still passes. Read the functions again. Move the sync commit forward only after you confirm that the grammar, the bounds, and the failure notes still describe the code at the new commit. If the code's grammar changed on purpose, update the property sentences and the test in the same edit, then move the commit.
