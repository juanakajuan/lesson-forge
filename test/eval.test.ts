import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runEval, TopicsSchema } from "../src/eval.ts";
import { formatSummary, summarize, type RunRecord } from "../src/eval-summary.ts";
import type { Critique, LessonModel } from "../src/generate.ts";
import { LessonSchema } from "../src/schema.ts";

const good: unknown = JSON.parse(readFileSync(new URL("../examples/slope-intercept.json", import.meta.url), "utf8"));
const passing: Critique = { scores: { correctness: 5, clarity: 4, cognitiveLoad: 4, interactivity: 5, misconceptionCoverage: 4 }, fixes: [] };
const briefs = [
  { topic: "slope", audience: "grade 8", notes: null },
  { topic: "rates", audience: "grade 6", notes: null },
];

function run(overrides: Partial<RunRecord>): RunRecord {
  return { topic: "t", audience: "a", run: 1, outcome: "clean", error: null, rounds: [], wallMs: 1000, costUsd: null, ...overrides };
}

function round(n: number, lintErrors: string[], schemaFailed = false): RunRecord["rounds"][number] {
  return { round: n, schemaFailed, lintErrors, lintWarnings: [], criticIssues: 0 };
}

test("summarize counts outcomes, rounds, and rules per run and per round", () => {
  const summary = summarize([
    run({ topic: "a", rounds: [round(1, [], true), round(2, ["ends-with-recap"]), round(3, [])] }),
    run({ topic: "a", run: 2, outcome: "exhausted", rounds: [round(1, ["ends-with-recap", "unique-ids"]), round(2, ["ends-with-recap"])] }),
    run({ topic: "b", outcome: "error", error: "boom", rounds: [round(1, ["unique-ids"])], costUsd: 0.5 }),
  ]);

  assert.equal(summary.runs, 3);
  assert.equal(summary.clean, 1);
  assert.equal(summary.exhausted, 1);
  assert.equal(summary.errors, 1);
  assert.equal(summary.cleanRate, 1 / 3);
  assert.equal(summary.meanRounds, 2.5); // the error run does not count
  assert.equal(summary.meanRoundsToClean, 3);
  assert.equal(summary.schemaFailureRounds, 1);
  assert.equal(summary.totalWallMs, 3000);
  assert.equal(summary.totalCostUsd, 0.5);
  assert.deepEqual(summary.topRules, [
    { rule: "ends-with-recap", runs: 2, rounds: 3 },
    { rule: "unique-ids", runs: 2, rounds: 2 },
  ]);
  assert.deepEqual(
    summary.topics.map((t) => [t.topic, t.clean, t.runs, t.meanRounds]),
    [["a", 1, 2, 2.5], ["b", 0, 1, Number.NaN]],
  );
});

test("summarize of no runs gives NaN rates and the formatter prints dashes", () => {
  const summary = summarize([]);
  assert.ok(Number.isNaN(summary.cleanRate));
  assert.equal(summary.totalCostUsd, null);
  const text = formatSummary(summary);
  assert.ok(text.includes("clean rate -%"));
  assert.ok(text.includes("no lint errors fired"));
});

test("runEval records lint rule ids, schema failures, and model errors for each topic and run", async () => {
  const noRecap = LessonSchema.parse(good);
  noRecap.blocks.pop();
  // Topic 1: schema failure, then a lint error, then clean. Topic 2: the model throws on the draft.
  const drafts: unknown[] = [{ title: "x" }, noRecap, good];
  const model: LessonModel = {
    draft: async (brief) => {
      if (brief.topic === "rates") throw new Error("model down");
      return drafts.shift();
    },
    revise: async () => drafts.shift(),
    critique: async () => passing,
  };
  let clock = 0;

  const records = await runEval(briefs, model, {
    runs: 1,
    generate: { maxRounds: 4, minCriticScore: 4 },
    now: () => (clock += 10),
    spentUsd: () => null,
  });

  assert.deepEqual(records.map((r) => r.outcome), ["clean", "error"]);
  const [first, second] = records;
  assert.deepEqual(first?.rounds.map((r) => [r.schemaFailed, r.lintErrors.includes("ends-with-recap")]), [[true, false], [false, true], [false, false]]);
  assert.equal(first?.wallMs, 10);
  assert.equal(second?.error, "model down");
  assert.equal(second?.rounds.length, 0);
});

test("TopicsSchema fills missing notes with null and rejects an empty list", () => {
  assert.deepEqual(TopicsSchema.parse([{ topic: "t", audience: "a" }]), [{ topic: "t", audience: "a", notes: null }]);
  assert.equal(TopicsSchema.safeParse([]).success, false);
});
