import * as z from "zod";
import { formatFinding, lint, type Finding } from "./lint.ts";
import { LessonSchema, type Lesson } from "./schema.ts";

export type Brief = {
  readonly topic: string;
  readonly audience: string;
  readonly notes: string | null;
};

const Score = z.number().int().min(1).max(5);

export const CritiqueSchema = z.object({
  scores: z.object({
    correctness: Score.describe("Facts, math, and answer keys are right"),
    clarity: Score.describe("Plain language, one idea per block, right level for the audience"),
    cognitiveLoad: Score.describe("New ideas arrive in small steps, each used before the next"),
    interactivity: Score.describe("Interactions make the learner think, not just click"),
    misconceptionCoverage: Score.describe("Distractors and feedback target the errors real learners make"),
  }),
  fixes: z.array(
    z.object({
      blockId: z.string().nullable(),
      instruction: z.string().min(1).describe("A concrete edit, e.g. 'Replace choice 3 with a distractor for the sign error'"),
    }),
  ),
});

export type Critique = z.infer<typeof CritiqueSchema>;

export const CRITIC_DIMENSIONS = CritiqueSchema.shape.scores.keyof().options;

export type Issue = { readonly source: "schema" | "lint" | "critic"; readonly text: string };

/** The model boundary. Implementations return raw JSON; the pipeline validates it. */
export type LessonModel = {
  draft(brief: Brief): Promise<unknown>;
  revise(brief: Brief, previous: unknown, issues: readonly Issue[]): Promise<unknown>;
  critique(lesson: Lesson): Promise<Critique>;
};

export type Round = {
  readonly round: number;
  readonly issues: readonly Issue[];
  readonly warnings: readonly Finding[];
  readonly scores: Critique["scores"] | null;
};

export type GenerateResult =
  | { readonly ok: true; readonly lesson: Lesson; readonly rounds: readonly Round[] }
  | { readonly ok: false; readonly lastDraft: unknown; readonly rounds: readonly Round[] };

export type GenerateOptions = {
  readonly maxRounds: number;
  readonly minCriticScore: number;
  readonly onRound?: (round: Round) => void;
};

type Assessment = { issues: Issue[]; warnings: Finding[]; scores: Critique["scores"] | null; lesson: Lesson | null };

async function assess(raw: unknown, model: LessonModel, minCriticScore: number): Promise<Assessment> {
  const parsed = LessonSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ source: "schema" as const, text: `${i.path.join(".") || "(root)"}: ${i.message}` }));
    return { issues, warnings: [], scores: null, lesson: null };
  }
  const findings = lint(parsed.data);
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  if (errors.length > 0) {
    return { issues: errors.map((f) => ({ source: "lint", text: formatFinding(f) })), warnings, scores: null, lesson: parsed.data };
  }
  // The critic runs only on lint-clean lessons: no point judging prose that must change anyway.
  const critique = await model.critique(parsed.data);
  const weak = CRITIC_DIMENSIONS.filter((d) => critique.scores[d] < minCriticScore);
  const issues: Issue[] =
    weak.length === 0
      ? []
      : [
          { source: "critic", text: `Scores below ${minCriticScore}: ${weak.map((d) => `${d}=${critique.scores[d]}`).join(", ")}` },
          ...critique.fixes.map((f) => ({ source: "critic" as const, text: `${f.blockId === null ? "lesson" : `block "${f.blockId}"`}: ${f.instruction}` })),
        ];
  return { issues, warnings, scores: critique.scores, lesson: parsed.data };
}

export async function generateLesson(brief: Brief, model: LessonModel, options: GenerateOptions): Promise<GenerateResult> {
  const rounds: Round[] = [];
  let raw = await model.draft(brief);
  for (let round = 1; round <= options.maxRounds; round++) {
    const result = await assess(raw, model, options.minCriticScore);
    const record: Round = { round, issues: result.issues, warnings: result.warnings, scores: result.scores };
    rounds.push(record);
    options.onRound?.(record);
    if (result.issues.length === 0 && result.lesson !== null) return { ok: true, lesson: result.lesson, rounds };
    if (round < options.maxRounds) raw = await model.revise(brief, raw, result.issues);
  }
  return { ok: false, lastDraft: raw, rounds };
}
