import assert from "node:assert/strict";
import { test } from "node:test";
import { offers, outcome, start, step } from "../src/runtime/attempt.ts";

test("first correct grade with the hint not shown is solid", () => {
  const available = step(start(true), { type: "graded", correct: true });
  assert.deepEqual(outcome(available), { kind: "met", firstTry: true });
  assert.equal(offers(available), null);

  const noHint = step(start(false), { type: "graded", correct: true });
  assert.deepEqual(outcome(noHint), { kind: "met", firstTry: true });

  const ignored = step(step(start(true), { type: "hint" }), { type: "graded", correct: true });
  assert.deepEqual(outcome(ignored), { kind: "met", firstTry: true });
});

test("a hint, then a correct grade, is review", () => {
  let state = step(start(true), { type: "graded", correct: false });
  const missed = offers(state);
  assert.ok(missed);
  assert.equal(missed.hint, true);
  assert.equal(missed.submitLabel, "Check again");
  state = step(state, { type: "hint" });
  const hinted = offers(state);
  assert.ok(hinted);
  assert.equal(hinted.hint, false);
  state = step(state, { type: "graded", correct: true });
  assert.deepEqual(outcome(state), { kind: "met", firstTry: false });
});

test("two misses, then reveal, is review and holds the answer", () => {
  let state = step(start(true), { type: "graded", correct: false });
  const once = offers(state);
  assert.ok(once);
  assert.equal(once.reveal, false);
  assert.equal(outcome(step(state, { type: "reveal", answer: "too soon" })), null);
  state = step(state, { type: "graded", correct: false });
  const twice = offers(state);
  assert.ok(twice);
  assert.equal(twice.reveal, true);
  const answer = "x₁ = 0, y₁ = 0, x₂ = 1, y₂ = 2";
  state = step(state, { type: "reveal", answer });
  assert.deepEqual(outcome(state), { kind: "revealed", answer });
});

test("a second event on a finished attempt does not change the outcome", () => {
  const solid = step(start(true), { type: "graded", correct: true });
  assert.deepEqual(outcome(step(solid, { type: "graded", correct: false })), outcome(solid));
  assert.deepEqual(outcome(step(solid, { type: "reveal", answer: "later" })), outcome(solid));

  let review = start(false);
  review = step(review, { type: "graded", correct: false });
  review = step(review, { type: "graded", correct: false });
  review = step(review, { type: "reveal", answer: "72 ÷ 8 = 9" });
  const done = outcome(review);
  assert.deepEqual(done, { kind: "revealed", answer: "72 ÷ 8 = 9" });
  assert.deepEqual(outcome(step(review, { type: "reveal", answer: "other" })), done);
  assert.deepEqual(outcome(step(review, { type: "graded", correct: true })), done);
});
