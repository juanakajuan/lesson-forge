import { evaluate, parseExpr } from "../expr.ts";
import { compileGoal, goalMet, nearestSolution, type CompiledGoal, type SliderValues } from "../goal.ts";
import { assessment, type Block, type BlockOf, type CheckItem, type Goal } from "../schema.ts";
import { offers, outcome, start, step, type Attempt, type AttemptEvent } from "./attempt.ts";
import { button, feedback, h, markdown } from "./dom.ts";
import { mountWidget, type MountedWidget } from "./widgets.ts";

/** firstTry is null for blocks that do not assess anything. */
export type Outcome = { readonly objectiveIds: readonly string[]; readonly firstTry: boolean | null };

export type BlockContext = { readonly complete: (outcome: Outcome) => void };

function continueButton(ctx: BlockContext, label = "Continue"): HTMLButtonElement {
  const btn = button(label, () => {
    btn.remove();
    ctx.complete({ objectiveIds: [], firstTry: null });
  });
  return btn;
}

function explain(block: BlockOf<"explain">, ctx: BlockContext): HTMLElement {
  return h("section", { class: "block block-explain" }, markdown(block.markdown), continueButton(ctx));
}

function workedExample(block: BlockOf<"workedExample">, ctx: BlockContext): HTMLElement {
  const list = h("ol", { class: "steps" });
  const actions = h("div", { class: "actions" });
  let shown = 0;
  const next = (): void => {
    const step = block.steps[shown];
    if (step === undefined) return;
    list.append(h("li", { class: "step" }, markdown(step)));
    shown++;
    actions.replaceChildren(shown < block.steps.length ? button(`Next step (${shown}/${block.steps.length})`, next, "secondary") : continueButton(ctx));
  };
  next();
  return h("section", { class: "block block-example" }, h("div", { class: "eyebrow" }, "Worked example"), markdown(block.problem), list, actions);
}

function recap(block: BlockOf<"recap">, ctx: BlockContext): HTMLElement {
  return h(
    "section",
    { class: "block block-recap" },
    h("div", { class: "eyebrow" }, "Recap"),
    h("ul", {}, ...block.points.map((p) => h("li", {}, markdown(p, true)))),
    continueButton(ctx, "Finish"),
  );
}

function simulation(block: BlockOf<"simulation">, ctx: BlockContext): HTMLElement {
  const widget = mountWidget(block.widget);
  const { goal } = block;
  if (goal === null) return h("section", { class: "block block-sim" }, markdown(block.prompt), widget.el, continueButton(ctx));
  const compiled = compileGoal(goal, block.widget.sliders);
  if (!compiled.ok) throw new Error(`goal on "${block.id}": ${compiled.error}`);
  const assessed = assessment(block);
  if (assessed === null) throw new Error(`block "${block.id}" does not assess`);
  const goalLine = feedback("info", markdown(`**Goal:** ${goal.description}`, true));
  return assess(
    {
      sectionClass: "block block-sim",
      body: [markdown(block.prompt), widget.el, goalLine],
      grader: goalGrader(goal, compiled.goal, widget),
      hint: goal.hint,
      objectiveIds: assessed.objectiveIds,
    },
    ctx,
  );
}

type Grader = {
  readonly input: HTMLElement | null;
  readonly emptyMessage: string;
  readonly grade: () => { readonly correct: boolean; readonly message: string } | null;
  readonly reveal: () => string;
};

function mcqGrader(item: Extract<CheckItem, { type: "mcq" }>, name: string): Grader {
  // Authors (and models) tend to list the correct choice first, so never show the authored order.
  const choices = shuffled(item.choices);
  const radios = choices.map((c, i) => h("input", { type: "radio", name, value: i }));
  const input = h(
    "fieldset",
    { class: "choices" },
    ...choices.map((c, i) => h("label", { class: "choice" }, radios[i] ?? null, markdown(c.text, true))),
  );
  return {
    input,
    emptyMessage: "Answer first.",
    grade: () => {
      const picked = radios.findIndex((r) => r.checked);
      const choice = choices[picked];
      return choice === undefined ? null : { correct: choice.correct, message: choice.feedback };
    },
    reveal: () => item.choices.find((c) => c.correct)?.text ?? "",
  };
}

// A unit with no letters ("$", "€") reads before the number; "km" or "%" style units read after.
function withUnit(value: string, unit: string | null): string {
  if (unit === null) return value;
  return /\p{L}|%/u.test(unit) ? `${value} ${unit}` : `${unit}${value}`;
}

function parseLearnerNumber(input: string): number {
  let raw = input.trim().replace(/[−–]/g, "-").replace(/[^\d.,\-]/g, "");
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) raw = raw.replace(/,/g, "");
  else raw = raw.replace(",", ".");
  return raw === "" ? Number.NaN : Number(raw);
}

function numericGrader(item: Extract<CheckItem, { type: "numeric" }>): Grader {
  const parsed = parseExpr(item.answerExpr);
  if (!parsed.ok) throw new Error(`invalid answerExpr: ${parsed.error}`);
  const answer = evaluate(parsed.expr, {});
  const field = h("input", { type: "text", inputmode: "decimal", class: "numeric-input", "aria-label": "Your answer", autocomplete: "off" });
  const unitEl = item.unit === null ? null : h("span", { class: "unit" }, item.unit);
  const unitFirst = item.unit !== null && withUnit("", item.unit) === item.unit;
  const input = h("div", { class: "numeric" }, unitFirst ? unitEl : null, field, unitFirst ? null : unitEl);
  const decimals = Math.min(4, Math.max(0, Math.ceil(-Math.log10(item.tolerance || 1e-4))));
  return {
    input,
    emptyMessage: "Answer first.",
    grade: () => {
      if (field.value.trim() === "") return null;
      const value = parseLearnerNumber(field.value);
      if (Number.isNaN(value)) return { correct: false, message: "Enter a number." };
      const correct = Math.abs(value - answer) <= item.tolerance;
      return { correct, message: correct ? item.feedbackCorrect : item.feedbackWrong };
    },
    reveal: () =>
      withUnit(answer.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace("-", "−"), item.unit),
  };
}

function swap<T>(items: T[], i: number, j: number): void {
  const a = items[i];
  const b = items[j];
  if (a === undefined || b === undefined) return;
  items[i] = b;
  items[j] = a;
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  // Retry until the order differs, so the task never starts solved.
  do {
    for (let i = out.length - 1; i > 0; i--) {
      swap(out, i, Math.floor(Math.random() * (i + 1)));
    }
  } while (out.every((v, i) => v === items[i]));
  return out;
}

function orderGrader(item: Extract<CheckItem, { type: "order" }>): Grader {
  let current = shuffled(item.items);
  const list = h("ol", { class: "order-list" });
  const render = (): void => {
    list.replaceChildren(
      ...current.map((text, i) =>
        h(
          "li",
          { class: "order-item" },
          h("span", { class: "order-text" }, text),
          h("span", { class: "order-buttons" }, moveButton(i, -1, "↑", `Move "${text}" up`), moveButton(i, 1, "↓", `Move "${text}" down`)),
        ),
      ),
    );
  };
  const moveButton = (i: number, delta: -1 | 1, label: string, aria: string): HTMLButtonElement => {
    const target = i + delta;
    const btn = h("button", { type: "button", class: "icon-btn", "aria-label": aria, disabled: target < 0 || target >= current.length }, label);
    btn.addEventListener("click", () => {
      const next = [...current];
      swap(next, i, target);
      current = next;
      render();
    });
    return btn;
  };
  render();
  return {
    input: list,
    emptyMessage: "Answer first.",
    grade: () => {
      const correct = current.every((v, i) => v === item.items[i]);
      return { correct, message: correct ? item.feedback : "Not yet. Look at which step needs the result of another step." };
    },
    reveal: () => item.items.map((t, i) => `${i + 1}. ${t}`).join("  "),
  };
}

function sameValues(a: SliderValues, b: SliderValues): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function formatSlider(value: number, step: number): string {
  if (!Number.isFinite(value)) return "undefined";
  const decimals = (String(step).split(".")[1] ?? "").length;
  return value.toFixed(decimals).replace("-", "−");
}

function goalGrader(goal: Goal, compiled: CompiledGoal, widget: MountedWidget): Grader {
  let lastAnswered = widget.values();
  return {
    input: null,
    emptyMessage: "Move a slider first.",
    grade: () => {
      const values = widget.values();
      if (sameValues(values, lastAnswered)) return null;
      lastAnswered = values;
      if (goalMet(compiled, values)) return { correct: true, message: goal.feedbackSuccess };
      return { correct: false, message: `Not yet. ${goal.description}` };
    },
    reveal: () => {
      const solution = nearestSolution(compiled, widget.values());
      if (solution.kind !== "found") throw new Error(solution.kind === "too-large" ? "goal grid is too large to search" : "no slider position meets the goal");
      widget.setValues(solution.values);
      const readouts = compiled.sliders
        .map((slider) => {
          const value = solution.values[slider.name];
          if (value === undefined) throw new Error(`missing slider ${slider.name}`);
          return `${slider.label} = ${formatSlider(value, slider.step)}`;
        })
        .join(", ");
      return `${readouts}\n\n${goal.feedbackSuccess}`;
    },
  };
}

function assess(
  spec: {
    readonly sectionClass: string;
    readonly body: readonly HTMLElement[];
    readonly grader: Grader;
    readonly hint: string | null;
    readonly objectiveIds: readonly string[];
  },
  ctx: BlockContext,
): HTMLElement {
  let state: Attempt = start(spec.hint !== null);
  const { grader } = spec;
  const actions = h("div", { class: "actions" });
  const hintSlot = h("div", {});
  const status = h("div", { class: "check-status" });

  function paint(): void {
    const offered = offers(state);
    if (offered === null) {
      actions.replaceChildren();
      return;
    }
    const buttons: HTMLButtonElement[] = [];
    buttons.push(button(offered.submitLabel, submit));
    if (offered.hint) buttons.push(button("Hint", showHint, "secondary"));
    if (offered.reveal) buttons.push(button("Show answer", showAnswer, "secondary"));
    actions.replaceChildren(...buttons);
  }

  function dispatch(event: AttemptEvent): void {
    const before = outcome(state);
    state = step(state, event);
    const after = outcome(state);
    if (before === null && after !== null) {
      grader.input?.querySelectorAll("input, button").forEach((el) => el.setAttribute("disabled", ""));
      actions.replaceChildren();
      ctx.complete({ objectiveIds: spec.objectiveIds, firstTry: after.kind === "met" && after.firstTry });
      return;
    }
    paint();
  }

  function submit(): void {
    const result = grader.grade();
    if (result === null) {
      status.replaceChildren(feedback("info", grader.emptyMessage));
      return;
    }
    status.replaceChildren(feedback(result.correct ? "correct" : "wrong", markdown(result.message, true)));
    dispatch({ type: "graded", correct: result.correct });
  }

  function showHint(): void {
    if (spec.hint === null) return;
    hintSlot.replaceChildren(feedback("info", markdown(spec.hint, true)));
    dispatch({ type: "hint" });
  }

  function showAnswer(): void {
    const answer = grader.reveal();
    status.replaceChildren(feedback("info", markdown(`**Answer:** ${answer}`)));
    dispatch({ type: "reveal", answer });
  }

  paint();
  return h("section", { class: spec.sectionClass }, ...spec.body, grader.input, actions, hintSlot, status);
}

function check(block: BlockOf<"check">, ctx: BlockContext): HTMLElement {
  const { item } = block;
  const grader = item.type === "mcq" ? mcqGrader(item, block.id) : item.type === "numeric" ? numericGrader(item) : orderGrader(item);
  const assessed = assessment(block);
  if (assessed === null) throw new Error(`block "${block.id}" does not assess`);
  return assess(
    { sectionClass: "block block-check", body: [markdown(item.stem)], grader, hint: block.hint, objectiveIds: assessed.objectiveIds },
    ctx,
  );
}

export function renderBlock(block: Block, ctx: BlockContext): HTMLElement {
  switch (block.kind) {
    case "explain":
      return explain(block, ctx);
    case "workedExample":
      return workedExample(block, ctx);
    case "check":
      return check(block, ctx);
    case "simulation":
      return simulation(block, ctx);
    case "recap":
      return recap(block, ctx);
  }
}
