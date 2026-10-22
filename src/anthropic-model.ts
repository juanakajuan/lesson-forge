import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { CritiqueSchema, type Critique, type Issue, type LessonModel } from "./generate.ts";
import { AUTHOR_SYSTEM, CRITIC_SYSTEM, draftPrompt, revisePrompt } from "./prompts.ts";
import { LessonSchema, type Lesson } from "./schema.ts";

const DEFAULT_MODEL = "claude-opus-5-5";

export function createAnthropicModel(options: { model?: string } = {}): LessonModel {
  const client = new Anthropic();
  const model = options.model ?? DEFAULT_MODEL;

  async function call(system: string, messages: Anthropic.Beta.BetaMessageParam[], schema: z.ZodType): Promise<unknown> {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 64000,
      system,
      messages,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: zodOutputFormat(schema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new Error(`Model refused: ${message.stop_details?.explanation ?? "no explanation"}`);
    if (message.stop_reason === "max_tokens") throw new Error("Model output hit max_tokens before the lesson was complete");
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    // Return the raw JSON: the pipeline owns validation, so schema errors become revision feedback, not crashes.
    const parsed: unknown = JSON.parse(text);
    return parsed;
  }

  return {
    draft: (brief) => call(AUTHOR_SYSTEM, [{ role: "user", content: draftPrompt(brief) }], LessonSchema),

    revise: (brief, previous, issues: readonly Issue[]) =>
      call(
        AUTHOR_SYSTEM,
        [
          { role: "user", content: draftPrompt(brief) },
          { role: "assistant", content: JSON.stringify(previous) },
          { role: "user", content: revisePrompt(issues) },
        ],
        LessonSchema,
      ),

    critique: async (lesson: Lesson): Promise<Critique> => {
      const raw = await call(CRITIC_SYSTEM, [{ role: "user", content: JSON.stringify(lesson, null, 2) }], CritiqueSchema);
      return CritiqueSchema.parse(raw);
    },
  };
}
