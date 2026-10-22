import { spawn } from "node:child_process";
import * as z from "zod";
import { CritiqueSchema, type LessonModel } from "./generate.ts";
import { AUTHOR_SYSTEM, CRITIC_SYSTEM, draftPrompt, revisePrompt } from "./prompts.ts";
import { LessonSchema } from "./schema.ts";

// The fields of `claude -p --output-format json` this adapter reads.
const ResultEnvelope = z.object({
  is_error: z.boolean(),
  subtype: z.string(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  total_cost_usd: z.number().optional(),
});

const LESSON_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(LessonSchema, { io: "input", target: "draft-07" }));
const CRITIQUE_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(CritiqueSchema, { io: "input", target: "draft-07" }));

function runClaude(args: readonly string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
    });
    child.stdin.end(stdin);
  });
}

export function createClaudeCodeModel(options: { model?: string; onCost?: (usd: number) => void } = {}): LessonModel {
  async function call(system: string, prompt: string, jsonSchema: string): Promise<unknown> {
    const args = [
      "-p",
      "--output-format", "json",
      "--json-schema", jsonSchema,
      "--system-prompt", system,
      "--tools", "",
      "--setting-sources", "",
      "--no-session-persistence",
      ...(options.model === undefined ? [] : ["--model", options.model]),
    ];
    const envelope = ResultEnvelope.parse(JSON.parse(await runClaude(args, prompt)));
    if (envelope.total_cost_usd !== undefined) options.onCost?.(envelope.total_cost_usd);
    if (envelope.is_error) throw new Error(`claude -p failed (${envelope.subtype}): ${envelope.result ?? "no message"}`);
    if (envelope.structured_output === undefined) throw new Error("claude -p returned no structured_output");
    return envelope.structured_output;
  }

  return {
    draft: (brief) => call(AUTHOR_SYSTEM, draftPrompt(brief), LESSON_JSON_SCHEMA),
    revise: (brief, previous, issues) =>
      call(AUTHOR_SYSTEM, `${draftPrompt(brief)}\n\nYour previous lesson:\n${JSON.stringify(previous)}\n\n${revisePrompt(issues)}`, LESSON_JSON_SCHEMA),
    critique: async (lesson) => CritiqueSchema.parse(await call(CRITIC_SYSTEM, JSON.stringify(lesson, null, 2), CRITIQUE_JSON_SCHEMA)),
  };
}
