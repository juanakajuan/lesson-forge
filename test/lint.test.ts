import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluate, parseExpr } from "../src/expr.ts";
import { lint } from "../src/lint.ts";
import { LessonSchema, type Lesson } from "../src/schema.ts";

const example: Lesson = LessonSchema.parse(JSON.parse(readFileSync(new URL("../examples/slope-intercept.json", import.meta.url), "utf8")));

function mutate(fn: (draft: Lesson) => void): Lesson {
  const draft = structuredClone(example);
  fn(draft);
  return LessonSchema.parse(draft);
}

function rulesHit(lesson: Lesson): string[] {
  return [...new Set(lint(lesson).map((f) => f.rule))];
}

function block<K extends Lesson["blocks"][number]["kind"]>(lesson: Lesson, id: string, kind: K): Extract<Lesson["blocks"][number], { kind: K }> {
  const found = lesson.blocks.find((b): b is Extract<Lesson["blocks"][number], { kind: K }> => b.id === id && b.kind === kind);
  assert.ok(found, `example has ${kind} block ${id}`);
  return found;
}

function calc(src: string, env: Record<string, number> = {}): number {
  const parsed = parseExpr(src);
  assert.ok(parsed.ok, `parses: ${src}`);
  return evaluate(parsed.expr, env);
}

test("expressions follow arithmetic precedence", () => {
  assert.equal(calc("(-5 - 5) / (3 - (-2))"), -2);
  assert.equal(calc("2^3^2"), 512);
  assert.equal(calc("-2^2"), -4);
  assert.equal(calc("m*x + b", { m: 2, x: 3, b: -1 }), 5);
  assert.equal(parseExpr("2 +").ok, false);
  assert.equal(parseExpr("foo(1)").ok, false);
});

test("the shipped example is lint-clean", () => {
  assert.deepEqual(lint(example), []);
});

const cases: [rule: string, edit: (l: Lesson) => void][] = [
  ["unique-ids", (l) => { block(l, "rise-over-run", "explain").id = "intro"; }],
  ["objective-refs-exist", (l) => { block(l, "find-intercept", "check").objectiveId = "nope"; }],
  ["objective-assessed", (l) => { l.objectives.push({ id: "extra", text: "Learner can graph", level: "recall" }); }],
  ["explain-word-limit", (l) => { block(l, "intro", "explain").markdown = "word ".repeat(151); }],
  ["interaction-density", (l) => { l.blocks.splice(1, 2); }],
  ["example-before-practice", (l) => { l.blocks = l.blocks.filter((b) => b.id !== "slope-example"); }],
  ["mcq-single-correct", (l) => {
    const item = block(l, "find-intercept", "check").item;
    assert.equal(item.type, "mcq");
    if (item.type === "mcq" && item.choices[1]) item.choices[1].correct = true;
  }],
  ["mcq-diagnostic-distractors", (l) => {
    const item = block(l, "find-intercept", "check").item;
    if (item.type === "mcq" && item.choices[2]) item.choices[2].misconception = null;
  }],
  ["numeric-answer-computes", (l) => {
    const item = block(l, "slope-numeric", "check").item;
    if (item.type === "numeric") item.answerExpr = "1 / 0";
  }],
  ["order-items-distinct", (l) => {
    const item = block(l, "order-steps", "check").item;
    if (item.type === "order") item.items[1] = item.items[0] ?? "";
  }],
  ["widget-valid", (l) => {
    const w = block(l, "explore-line", "simulation").widget;
    if (w.type === "functionPlot") w.expr = "k*x + b";
  }],
  ["goal-reachable-not-trivial", (l) => {
    const goal = block(l, "hit-two-points", "simulation").goal;
    if (goal?.conditions[0]) goal.conditions[0].target = -3.25;
  }],
  ["goal-reachable-not-trivial", (l) => {
    const sim = block(l, "hit-two-points", "simulation");
    for (const s of sim.widget.sliders) s.initial = s.name === "m" ? 2 : -3;
  }],
  ["goal-not-slider-readout", (l) => {
    const goal = block(l, "hit-two-points", "simulation").goal;
    if (goal) goal.conditions = [{ expr: "b", target: -3, tolerance: 0.001 }, { expr: "m", target: 2, tolerance: 0.001 }];
  }],
  ["ends-with-recap", (l) => { l.blocks.pop(); }],
];

for (const [rule, edit] of cases) {
  test(`${rule} catches a broken lesson`, () => {
    assert.ok(rulesHit(mutate(edit)).includes(rule), `expected ${rule}`);
  });
}
