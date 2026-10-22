import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileGoal, goalMet, nearestSolution, type SliderValues } from "../src/goal.ts";
import { LessonSchema, type Lesson, type Slider } from "../src/schema.ts";

function load(path: string): Lesson {
  return LessonSchema.parse(JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")));
}

const lessons = [load("../examples/slope-intercept.json"), load("../lessons/compound-interest.json")];

function initialValues(sliders: readonly Slider[]): SliderValues {
  return Object.fromEntries(sliders.map((s) => [s.name, s.initial]));
}

test("nearestSolution from the initial sliders meets each shipped goal", () => {
  const goals = lessons.flatMap((lesson) =>
    lesson.blocks.flatMap((block) => (block.kind === "simulation" && block.goal !== null ? [{ id: block.id, goal: block.goal, sliders: block.widget.sliders }] : [])),
  );
  assert.equal(goals.length, 4);
  for (const { id, goal, sliders } of goals) {
    const compiled = compileGoal(goal, sliders);
    assert.equal(compiled.ok, true, id);
    if (!compiled.ok) continue;
    const initial = initialValues(sliders);
    assert.equal(goalMet(compiled.goal, initial), false, id);
    const solution = nearestSolution(compiled.goal, initial);
    assert.equal(solution.kind, "found", id);
    if (solution.kind !== "found") continue;
    assert.equal(goalMet(compiled.goal, solution.values), true, id);
  }
});

test("a second slider state also meets make-slope-two", () => {
  const lesson = lessons[0];
  assert.ok(lesson);
  const block = lesson.blocks.find((b) => b.id === "make-slope-two");
  assert.ok(block && block.kind === "simulation" && block.goal !== null);
  const compiled = compileGoal(block.goal, block.widget.sliders);
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  const other: SliderValues = { x1: -5, y1: -5, x2: -4, y2: -3 };
  assert.equal(goalMet(compiled.goal, other), true);
  assert.deepEqual(nearestSolution(compiled.goal, other), { kind: "found", values: other });
  const revealed = nearestSolution(compiled.goal, initialValues(block.widget.sliders));
  assert.equal(revealed.kind, "found");
  if (revealed.kind !== "found") return;
  assert.notDeepEqual(revealed.values, other);
});
