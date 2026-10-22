# lesson-forge

A prototype framework that lets an AI write interactive lessons with consistent quality.

The AI does not write UI code. It writes lesson JSON that must match a strict schema. A fixed set of tested components renders the JSON. A pedagogy linter rejects lessons that break the teaching rules, and the error messages tell the model how to fix them.

## Commands

Requires Node 24 or later. Node runs the TypeScript files directly.

```bash
npm install
```

Check a lesson against the schema and the linter:

```bash
npm run lf -- check examples/slope-intercept.json
```

Build a self-contained HTML lesson:

```bash
npm run lf -- render examples/slope-intercept.json -o out/slope-intercept.html
```

Generate a lesson with Claude. The default backend runs `claude -p` and uses your Claude Code login, so you need no API key:

```bash
npm run lf -- generate --topic "Ratios and rates" --audience "Grade 6, knows fractions" -o lessons/ratios.json
```

To call the Anthropic API directly instead, set `ANTHROPIC_API_KEY` and add `--backend api`.

Run the tests and the type check:

```bash
npm test && npm run typecheck
```

## How it works

| Layer | File | Job |
|---|---|---|
| Schema | `src/schema.ts` | Block types: `explain`, `workedExample`, `check` (mcq, numeric, order), `simulation` (functionPlot, formulaExplorer), `recap` |
| Expressions | `src/expr.ts` | Safe arithmetic parser. Numeric answers and widgets use it, so answer keys are computed, not typed |
| Linter | `src/lint.ts` | Pedagogy rules as a registry. Each rule has a `guidance` line that also goes into the generator prompt |
| Generator | `src/generate.ts` | Draft, then validate, lint, critique, revise, until clean or out of rounds |
| Model adapters | `src/claude-code-model.ts`, `src/anthropic-model.ts` | Run `claude -p --json-schema`, or call the API with structured outputs. Both share `src/prompts.ts`. The pipeline still validates every response |
| Renderer | `src/render.ts`, `src/runtime/` | Bundles the runtime and the lesson into one HTML file. Progressive reveal, hints, answer reveal after two tries, per-objective mastery summary |

## Rules the linter enforces

- Every objective is assessed by a check or a simulation with a goal.
- An explain block has at most 150 words.
- At most two passive blocks in a row.
- An `apply` or `analyze` objective gets a worked example before its first assessment.
- A multiple-choice item has exactly one correct choice. Each wrong choice names its misconception.
- A numeric answer is an expression that evaluates to a finite number.
- A simulation goal is reachable on the slider grid and is not met at the start.
- The lesson ends with a recap.

## Add a rule

Add an entry to `RULES` in `src/lint.ts`. Then add a case to `test/lint.test.ts` that breaks the example lesson and expects the rule to fire.

## Add a widget

1. Add a schema variant to `WidgetSchema` in `src/schema.ts`.
2. Add its renderer to `mountWidget` in `src/runtime/widgets.ts`.
3. Add its expression checks to `widgetExpressions` and `widgetVariables` in `src/lint.ts`.
