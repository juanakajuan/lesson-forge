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
                                           Draft with Claude, then loop validate -> lint -> critique -> revise`;

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
      const rounds = Number(values.rounds);
      if (!Number.isInteger(rounds) || rounds < 1) throw new Error("--rounds must be a positive integer");
      const { generateLesson } = await import("./generate.ts");
      const modelOptions = values.model === undefined ? {} : { model: values.model };
      let spent = 0;
      let model: LessonModel;
      if (values.backend === "claude-code") {
        const { createClaudeCodeModel } = await import("./claude-code-model.ts");
        model = createClaudeCodeModel({ ...modelOptions, onCost: (usd) => (spent += usd) });
      } else if (values.backend === "api") {
        const { createAnthropicModel } = await import("./anthropic-model.ts");
        model = createAnthropicModel(modelOptions);
      } else {
        throw new Error(`--backend must be claude-code or api, got "${values.backend}"`);
      }
      const result = await generateLesson({ topic: values.topic, audience: values.audience, notes: values.notes ?? null }, model, {
        maxRounds: rounds,
        minCriticScore: 4,
        onRound: (r) => {
          const scores = r.scores === null ? "" : ` scores=${JSON.stringify(r.scores)}`;
          console.error(`round ${r.round}: ${r.issues.length} issue(s)${scores}`);
          for (const i of r.issues) console.error(`  (${i.source}) ${i.text}`);
        },
      });
      if (spent > 0) console.error(`reported cost: $${spent.toFixed(2)}`);
      if (!result.ok) {
        await writeOut(`${values.out}.failed.json`, JSON.stringify(result.lastDraft, null, 2));
        console.error(`gave up after ${rounds} round(s)`);
        process.exit(1);
      }
      await writeOut(values.out, JSON.stringify(result.lesson, null, 2));
      return;
    }
  }
  console.error(USAGE);
  process.exit(2);
}

await main();
