import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LessonSchema } from "../src/schema.ts";
import { generateLesson, type Critique, type Issue, type LessonModel } from "../src/generate.ts";

const good: unknown = JSON.parse(readFileSync(new URL("../examples/slope-intercept.json", import.meta.url), "utf8"));
const brief = { topic: "slope", audience: "grade 8", notes: null };
const passing: Critique = { scores: { correctness: 5, clarity: 4, cognitiveLoad: 4, interactivity: 5, misconceptionCoverage: 4 }, fixes: [] };

function scripted(drafts: unknown[], critiques: Critique[]): LessonModel & { revisions: (readonly Issue[])[] } {
  const revisions: (readonly Issue[])[] = [];
  const next = <T>(queue: T[], what: string): T => {
    const item = queue.shift();
    if (item === undefined) throw new Error(`stub ran out of ${what}`);
    return item;
  };
  return {
    revisions,
    draft: async () => next(drafts, "drafts"),
    revise: async (_brief, _previous, issues) => {
      revisions.push(issues);
      return next(drafts, "drafts");
    },
    critique: async () => next(critiques, "critiques"),
  };
}

test("schema and lint failures go back to the model until the lesson is clean", async () => {
  const noRecap = LessonSchema.parse(good);
  noRecap.blocks.pop();
  const model = scripted([{ title: "x" }, noRecap, good], [passing]);

  const result = await generateLesson(brief, model, { maxRounds: 4, minCriticScore: 4 });

  assert.equal(result.ok, true);
  assert.equal(result.rounds.length, 3);
  assert.ok(model.revisions[0]?.every((i) => i.source === "schema"));
  assert.ok(model.revisions[1]?.some((i) => i.source === "lint" && i.text.includes("ends-with-recap")));
});

test("a low critic score triggers a revision with the critic's fixes", async () => {
  const weak: Critique = { scores: { ...passing.scores, clarity: 2 }, fixes: [{ blockId: "intro", instruction: "Shorten the intro" }] };
  const model = scripted([good, good], [weak, passing]);

  const result = await generateLesson(brief, model, { maxRounds: 3, minCriticScore: 4 });

  assert.equal(result.ok, true);
  assert.ok(model.revisions[0]?.some((i) => i.text.includes("Shorten the intro")));
});

test("gives up after maxRounds and returns the last draft", async () => {
  const model = scripted([{}, {}], []);

  const result = await generateLesson(brief, model, { maxRounds: 2, minCriticScore: 4 });

  assert.equal(result.ok, false);
  assert.equal(result.rounds.length, 2);
});
