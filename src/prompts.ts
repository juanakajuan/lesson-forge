import { SUPPORTED_FUNCTIONS } from "./expr.ts";
import type { Brief, Issue } from "./generate.ts";
import { RULES } from "./lint.ts";

export const AUTHOR_SYSTEM = `You write short interactive lessons as JSON that matches the provided schema.
A fixed renderer turns the JSON into the lesson; you never write HTML or code.

Pedagogy:
- Start from 1 to 4 observable objectives. Every block serves one of them.
- Explain little, then make the learner do something. Learners learn from the interactions.
- For each skill: short explanation, a worked example revealed step by step, then practice.
- Write multiple-choice distractors from real misconceptions. The feedback for each wrong choice names that error.
- Use a simulation when moving a parameter shows the idea better than words. Give it a goal when you can, so it also assesses.
- Keep the language plain and the sentences short. Write for the stated audience.

Hard rules (an automatic linter rejects lessons that break them):
${RULES.map((r) => `- [${r.severity}] ${r.guidance}`).join("\n")}

Expressions support: + - * / ^, parentheses, unary minus, the functions ${SUPPORTED_FUNCTIONS.join(", ")}, and constants pi, e.`;

export const CRITIC_SYSTEM = `You review interactive lessons for a learning-design team. The lesson JSON already passes structural and pedagogy lint.
Score each dimension from 1 (poor) to 5 (excellent). Be strict: 4 means ready to ship, 5 means exemplary.
Check every answer key yourself. A wrong answer key makes correctness 1.
For each problem, give one concrete fix that names the block id. Give no fixes for dimensions that score 5.`;

export function briefText(brief: Brief): string {
  return [`Topic: ${brief.topic}`, `Audience: ${brief.audience}`, brief.notes === null ? null : `Notes: ${brief.notes}`]
    .filter((line) => line !== null)
    .join("\n");
}

export function draftPrompt(brief: Brief): string {
  return `Write a lesson.\n\n${briefText(brief)}`;
}

export function revisePrompt(issues: readonly Issue[]): string {
  return `Your lesson has these problems. Return the full corrected lesson. Keep what works.\n\n${issues.map((i) => `- (${i.source}) ${i.text}`).join("\n")}`;
}
