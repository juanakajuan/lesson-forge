/** Pure aggregation of eval runs. No I/O, no model: the runner in eval.ts fills RunRecords. */

export type Outcome = "clean" | "exhausted" | "error";

export type RoundRecord = {
  readonly round: number;
  /** The draft did not parse against the lesson schema. */
  readonly schemaFailed: boolean;
  /** Ids of lint rules that fired with severity error, one entry per rule. */
  readonly lintErrors: readonly string[];
  readonly lintWarnings: readonly string[];
  readonly criticIssues: number;
};

export type RunRecord = {
  readonly topic: string;
  readonly audience: string;
  readonly run: number;
  /** clean: lesson passed every check. exhausted: maxRounds ran out. error: the model call threw. */
  readonly outcome: Outcome;
  readonly error: string | null;
  readonly rounds: readonly RoundRecord[];
  readonly wallMs: number;
  readonly costUsd: number | null;
};

export type RuleCount = {
  readonly rule: string;
  /** Runs where the rule fired as an error in at least one round. */
  readonly runs: number;
  /** Rounds where the rule fired as an error, over all runs. */
  readonly rounds: number;
};

export type TopicSummary = {
  readonly topic: string;
  readonly audience: string;
  readonly runs: number;
  readonly clean: number;
  readonly meanRounds: number;
  readonly meanWallMs: number;
};

export type Summary = {
  readonly runs: number;
  readonly clean: number;
  readonly exhausted: number;
  readonly errors: number;
  readonly cleanRate: number;
  /** Mean revision rounds over runs that did not throw. NaN when every run threw. */
  readonly meanRounds: number;
  /** Mean rounds over clean runs only. NaN when no run was clean. */
  readonly meanRoundsToClean: number;
  readonly schemaFailureRounds: number;
  readonly totalWallMs: number;
  readonly totalCostUsd: number | null;
  readonly topRules: readonly RuleCount[];
  readonly topics: readonly TopicSummary[];
};

function mean(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((a, b) => a + b, 0) / values.length;
}

function countRules(runs: readonly RunRecord[]): RuleCount[] {
  const counts = new Map<string, { runs: number; rounds: number }>();
  for (const run of runs) {
    const seenInRun = new Set<string>();
    for (const round of run.rounds) {
      for (const rule of new Set(round.lintErrors)) {
        const entry = counts.get(rule) ?? { runs: 0, rounds: 0 };
        entry.rounds++;
        if (!seenInRun.has(rule)) entry.runs++;
        seenInRun.add(rule);
        counts.set(rule, entry);
      }
    }
  }
  return [...counts]
    .map(([rule, c]) => ({ rule, ...c }))
    .sort((a, b) => b.runs - a.runs || b.rounds - a.rounds || a.rule.localeCompare(b.rule));
}

function summarizeTopics(runs: readonly RunRecord[]): TopicSummary[] {
  const groups = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const key = JSON.stringify([run.topic, run.audience]);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.values()].flatMap((group) => {
    const [first] = group;
    if (first === undefined) return [];
    return [
      {
        topic: first.topic,
        audience: first.audience,
        runs: group.length,
        clean: group.filter((r) => r.outcome === "clean").length,
        meanRounds: mean(group.filter((r) => r.outcome !== "error").map((r) => r.rounds.length)),
        meanWallMs: mean(group.map((r) => r.wallMs)),
      },
    ];
  });
}

export function summarize(runs: readonly RunRecord[]): Summary {
  const clean = runs.filter((r) => r.outcome === "clean");
  const costs = runs.flatMap((r) => (r.costUsd === null ? [] : [r.costUsd]));
  return {
    runs: runs.length,
    clean: clean.length,
    exhausted: runs.filter((r) => r.outcome === "exhausted").length,
    errors: runs.filter((r) => r.outcome === "error").length,
    cleanRate: runs.length === 0 ? Number.NaN : clean.length / runs.length,
    meanRounds: mean(runs.filter((r) => r.outcome !== "error").map((r) => r.rounds.length)),
    meanRoundsToClean: mean(clean.map((r) => r.rounds.length)),
    schemaFailureRounds: runs.reduce((n, r) => n + r.rounds.filter((round) => round.schemaFailed).length, 0),
    totalWallMs: runs.reduce((n, r) => n + r.wallMs, 0),
    totalCostUsd: costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0),
    topRules: countRules(runs),
    topics: summarizeTopics(runs),
  };
}

function num(value: number, digits: number): string {
  return Number.isNaN(value) ? "-" : value.toFixed(digits);
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: readonly string[]): string => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

export function formatSummary(summary: Summary, topRuleLimit = 5): string {
  const cost = summary.totalCostUsd === null ? "" : `, cost $${summary.totalCostUsd.toFixed(2)}`;
  const totals = [
    `runs ${summary.runs}: ${summary.clean} clean, ${summary.exhausted} exhausted, ${summary.errors} error(s)`,
    `clean rate ${num(summary.cleanRate * 100, 0)}%, mean rounds ${num(summary.meanRounds, 2)} (clean runs ${num(summary.meanRoundsToClean, 2)})`,
    `schema-parse failures ${summary.schemaFailureRounds} round(s), wall time ${(summary.totalWallMs / 1000).toFixed(0)}s${cost}`,
  ].join("\n");
  const topics = table(
    ["topic", "audience", "clean", "mean rounds", "mean wall s"],
    summary.topics.map((t) => [t.topic, t.audience, `${t.clean}/${t.runs}`, num(t.meanRounds, 2), num(t.meanWallMs / 1000, 0)]),
  );
  const rules =
    summary.topRules.length === 0
      ? "no lint errors fired"
      : table(
          ["lint rule", "runs", "rounds"],
          summary.topRules.slice(0, topRuleLimit).map((r) => [r.rule, String(r.runs), String(r.rounds)]),
        );
  return `${totals}\n\n${topics}\n\n${rules}`;
}
