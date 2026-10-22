import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import type { LessonModel } from "./generate.ts";
import { formatFinding, lint } from "./lint.ts";
import { LessonSchema, type Lesson } from "./schema.ts";

const USAGE = `lesson-forge <command>

  check <lesson.json>                      Validate the schema and run the pedagogy linter
  render <lesson.json> -o <out.html>       Check, then build a self-contained HTML lesson
  site <dir...> -o <out-dir>               Render every lesson JSON in the dirs plus an index page
  generate --topic <t> --audience <a> -o <lesson.json> [--notes <n>] [--model <id>] [--rounds <n>]
           [--backend claude-code|api]     claude-code (default) uses your Claude Code login; api needs ANTHROPIC_API_KEY
                                           Draft with Claude, then loop validate -> lint -> critique -> revise
  eval --topics <topics.json> -o <report.json> [--runs <n>] [--model <id>] [--rounds <n>] [--backend claude-code|api]
                                           Run generate on each topic n times and summarize clean rate, rounds, and lint failures`;

async function loadLesson(path: string): Promise<Lesson> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  const parsed = LessonSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) console.error(`[schema] ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    process.exit(1);
  }
  return parsed.data;
}

function reportLint(lesson: Lesson): boolean {
  const findings = lint(lesson);
  for (const f of findings) console.error(formatFinding(f));
  const errors = findings.filter((f) => f.severity === "error").length;
  console.error(`${errors} error(s), ${findings.length - errors} warning(s)`);
  return errors === 0;
}

async function writeOut(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  console.error(`wrote ${path}`);
}

type ModelHandle = { readonly model: LessonModel; readonly spentUsd: () => number | null };

async function createModel(backend: string, modelId: string | undefined): Promise<ModelHandle> {
  const modelOptions = modelId === undefined ? {} : { model: modelId };
  if (backend === "claude-code") {
    const { createClaudeCodeModel } = await import("./claude-code-model.ts");
    let spent = 0;
    return { model: createClaudeCodeModel({ ...modelOptions, onCost: (usd) => (spent += usd) }), spentUsd: () => spent };
  }
  if (backend === "api") {
    const { createAnthropicModel } = await import("./anthropic-model.ts");
    return { model: createAnthropicModel(modelOptions), spentUsd: () => null };
  }
  throw new Error(`--backend must be claude-code or api, got "${backend}"`);
}

function positiveInt(value: string | undefined, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`);
  return n;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      topic: { type: "string" },
      audience: { type: "string" },
      notes: { type: "string" },
      model: { type: "string" },
      rounds: { type: "string", default: "4" },
      backend: { type: "string", default: "claude-code" },
      topics: { type: "string" },
      runs: { type: "string", default: "1" },
    },
  });
  const [command, file] = positionals;

  switch (command) {
    case "check": {
      if (file === undefined) break;
      process.exit(reportLint(await loadLesson(file)) ? 0 : 1);
    }
    case "render": {
      if (file === undefined || values.out === undefined) break;
      const lesson = await loadLesson(file);
      if (!reportLint(lesson)) process.exit(1);
      const { renderLesson } = await import("./render.ts");
      await writeOut(values.out, await renderLesson(lesson));
      return;
    }
    case "site": {
      const dirs = positionals.slice(1);
      if (dirs.length === 0 || values.out === undefined) break;
      const { readdir } = await import("node:fs/promises");
      const { join, basename } = await import("node:path");
      const { renderLesson, renderIndex } = await import("./render.ts");
      const entries: { slug: string; lesson: Lesson }[] = [];
      for (const dir of dirs) {
        for (const name of (await readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
          const lesson = await loadLesson(join(dir, name));
          console.error(`${name}:`);
          if (!reportLint(lesson)) process.exit(1);
          entries.push({ slug: basename(name, ".json"), lesson });
        }
      }
      for (const { slug, lesson } of entries) await writeOut(join(values.out, `${slug}.html`), await renderLesson(lesson));
      await writeOut(join(values.out, "index.html"), await renderIndex(entries));
      return;
    }
    case "generate": {
      if (values.topic === undefined || values.audience === undefined || values.out === undefined) break;
      const rounds = positiveInt(values.rounds, "--rounds");
      const { generateLesson } = await import("./generate.ts");
      const { model, spentUsd } = await createModel(values.backend, values.model);
      const result = await generateLesson({ topic: values.topic, audience: values.audience, notes: values.notes ?? null }, model, {
        maxRounds: rounds,
        minCriticScore: 4,
        onRound: (r) => {
          const scores = r.scores === null ? "" : ` scores=${JSON.stringify(r.scores)}`;
          console.error(`round ${r.round}: ${r.issues.length} issue(s)${scores}`);
          for (const i of r.issues) console.error(`  (${i.source}) ${i.text}`);
        },
      });
      const spent = spentUsd();
      if (spent !== null) console.error(`reported cost: $${spent.toFixed(2)}`);
      if (!result.ok) {
        await writeOut(`${values.out}.failed.json`, JSON.stringify(result.lastDraft, null, 2));
        console.error(`gave up after ${rounds} round(s)`);
        process.exit(1);
      }
      await writeOut(values.out, JSON.stringify(result.lesson, null, 2));
      return;
    }
    case "eval": {
      if (values.topics === undefined || values.out === undefined) break;
      const out = values.out;
      const { TopicsSchema, runEval } = await import("./eval.ts");
      const { summarize, formatSummary } = await import("./eval-summary.ts");
      const topics = TopicsSchema.parse(JSON.parse(await readFile(values.topics, "utf8")));
      const runs = positiveInt(values.runs, "--runs");
      const maxRounds = positiveInt(values.rounds, "--rounds");
      const { model, spentUsd } = await createModel(values.backend, values.model);
      const config = { topics: values.topics, runs, maxRounds, minCriticScore: 4, backend: values.backend, model: values.model ?? null };
      const total = topics.length * runs;
      const records = await runEval(topics, model, {
        runs,
        generate: { maxRounds, minCriticScore: config.minCriticScore },
        now: () => performance.now(),
        spentUsd,
        onRun: async (r, done) => {
          const rules = [...new Set(r.rounds.flatMap((round) => round.lintErrors))].join(", ") || "none";
          console.error(`[${done.length}/${total}] ${r.topic} (run ${r.run}): ${r.outcome} in ${r.rounds.length} round(s), ${(r.wallMs / 1000).toFixed(0)}s, lint errors: ${rules}${r.error === null ? "" : `\n  ${r.error}`}`);
          // Write after each run, so a crash keeps the finished runs.
          await mkdir(dirname(out), { recursive: true });
          await writeFile(out, JSON.stringify({ config, summary: summarize(done), runs: done }, null, 2));
        },
      });
      const summary = summarize(records);
      console.log(formatSummary(summary));
      await writeOut(out, JSON.stringify({ config, summary, runs: records }, null, 2));
      return;
    }
  }
  console.error(USAGE);
  process.exit(2);
}

await main();
