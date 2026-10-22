import * as z from "zod";
import { generateLesson, type Brief, type GenerateOptions, type LessonModel, type Round } from "./generate.ts";
import type { RoundRecord, RunRecord } from "./eval-summary.ts";

export const TopicsSchema = z
  .array(
    z.object({
      topic: z.string().min(1),
      audience: z.string().min(1),
      notes: z.string().nullable().default(null),
    }),
  )
  .min(1);

export type EvalOptions = {
  readonly runs: number;
  readonly generate: Omit<GenerateOptions, "onRound">;
  /** Monotonic clock in milliseconds. */
  readonly now: () => number;
  /** Cumulative model spend in USD, or null when the backend reports none. */
  readonly spentUsd: () => number | null;
  readonly onRun?: (record: RunRecord, done: readonly RunRecord[]) => void | Promise<void>;
};

export function toRoundRecord(round: Round): RoundRecord {
  const rulesOf = (severity: "error" | "warning"): string[] => [
    ...new Set(round.findings.filter((f) => f.severity === severity).map((f) => f.rule)),
  ];
  return {
    round: round.round,
    schemaFailed: round.issues.some((i) => i.source === "schema"),
    lintErrors: rulesOf("error"),
    lintWarnings: rulesOf("warning"),
    criticIssues: round.issues.filter((i) => i.source === "critic").length,
  };
}

async function runOne(brief: Brief, run: number, model: LessonModel, options: EvalOptions): Promise<RunRecord> {
  const rounds: RoundRecord[] = [];
  const start = options.now();
  const spentBefore = options.spentUsd();
  const finish = (outcome: RunRecord["outcome"], error: string | null): RunRecord => {
    const spentAfter = options.spentUsd();
    return {
      topic: brief.topic,
      audience: brief.audience,
      run,
      outcome,
      error,
      rounds,
      wallMs: options.now() - start,
      costUsd: spentBefore === null || spentAfter === null ? null : spentAfter - spentBefore,
    };
  };
  try {
    const result = await generateLesson(brief, model, { ...options.generate, onRound: (r) => rounds.push(toRoundRecord(r)) });
    return finish(result.ok ? "clean" : "exhausted", null);
  } catch (error) {
    return finish("error", error instanceof Error ? error.message : String(error));
  }
}

/** Runs the generate pipeline `runs` times per brief, in sequence. A model error ends that run, not the eval. */
export async function runEval(briefs: readonly Brief[], model: LessonModel, options: EvalOptions): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  for (const brief of briefs) {
    for (let run = 1; run <= options.runs; run++) {
      const record = await runOne(brief, run, model, options);
      records.push(record);
      await options.onRun?.(record, records);
    }
  }
  return records;
}
