import * as z from "zod";

// Structural shape only. Pedagogy rules live in lint.ts so each failure gets
// a fix-oriented message the generator can act on.

const Id = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .describe("kebab-case identifier, unique within the lesson");

const Markdown = z.string().min(1).describe("Markdown. Use **bold** and `code`; no raw HTML.");

export const HintSchema = Markdown.nullable().describe(
  "Shown on request after a missed attempt. Point at the first reasoning step. Do not give the answer or slider values. null only for recall objectives.",
);

const Identifier = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
  .describe("Variable name usable inside expressions");

const ExprSource = z
  .string()
  .min(1)
  .describe("Arithmetic expression: + - * / ^, parentheses, sin cos tan sqrt abs exp ln log10 floor round, constants pi e");

export const ObjectiveSchema = z.object({
  id: Id,
  text: z.string().min(1).describe('Observable outcome, phrased "Learner can ..."'),
  level: z.enum(["recall", "apply", "analyze"]),
});

const ChoiceSchema = z.object({
  text: z.string().min(1),
  correct: z.boolean(),
  feedback: z.string().min(1).describe("Shown after the learner picks this choice. Explain why it is right or wrong."),
  misconception: z
    .string()
    .nullable()
    .describe("For a wrong choice: the specific misconception that leads a learner here. null for the correct choice."),
});

const McqSchema = z.object({
  type: z.literal("mcq"),
  stem: Markdown,
  choices: z.array(ChoiceSchema).min(2).max(5),
});

const NumericSchema = z.object({
  type: z.literal("numeric"),
  stem: Markdown,
  answerExpr: ExprSource.describe("Expression that computes the answer from the numbers in the stem, e.g. (9-3)/(4-1). No variables."),
  tolerance: z.number().min(0),
  unit: z.string().nullable(),
  feedbackCorrect: z.string().min(1),
  feedbackWrong: z.string().min(1).describe("Shown on a wrong answer. Point at the step to re-check, do not reveal the answer."),
});

const OrderSchema = z.object({
  type: z.literal("order"),
  stem: Markdown,
  items: z.array(z.string().min(1)).min(3).max(7).describe("Items in the correct order. The renderer shuffles them."),
  feedback: z.string().min(1),
});

export const CheckItemSchema = z.discriminatedUnion("type", [McqSchema, NumericSchema, OrderSchema]);

const SliderSchema = z.object({
  name: Identifier,
  label: z.string().min(1),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  initial: z.number(),
});

const FunctionPlotSchema = z.object({
  type: z.literal("functionPlot"),
  expr: ExprSource.describe("y as a function of x and the slider names, e.g. m*x + b"),
  sliders: z.array(SliderSchema).min(1).max(3),
  xMin: z.number(),
  xMax: z.number(),
  yMin: z.number(),
  yMax: z.number(),
  markers: z
    .array(z.object({ x: z.number(), y: z.number(), label: z.string().nullable() }))
    .max(6)
    .describe("Fixed points drawn on the plot, e.g. the points a goal asks the line to pass through"),
});

const FormulaExplorerSchema = z.object({
  type: z.literal("formulaExplorer"),
  sliders: z.array(SliderSchema).min(1).max(4),
  outputs: z
    .array(
      z.object({
        label: z.string().min(1),
        expr: ExprSource.describe("Expression over the slider names"),
        unit: z.string().nullable(),
        decimals: z.number().int().min(0).max(6),
      }),
    )
    .min(1)
    .max(4),
});

export const WidgetSchema = z.discriminatedUnion("type", [FunctionPlotSchema, FormulaExplorerSchema]);

const GoalSchema = z.object({
  description: z.string().min(1).describe("What the learner must achieve with the sliders"),
  conditions: z
    .array(
      z.object({
        expr: ExprSource.describe("Expression over slider names"),
        target: z.number(),
        tolerance: z.number().positive(),
      }),
    )
    .min(1),
  feedbackSuccess: z.string().min(1),
  hint: HintSchema,
});

const ExplainBlock = z.object({
  kind: z.literal("explain"),
  id: Id,
  objectiveIds: z.array(Id).min(1),
  markdown: Markdown,
});

const WorkedExampleBlock = z.object({
  kind: z.literal("workedExample"),
  id: Id,
  objectiveIds: z.array(Id).min(1),
  problem: Markdown,
  steps: z.array(Markdown).min(2).max(8).describe("Revealed one at a time"),
});

const CheckBlock = z.object({
  kind: z.literal("check"),
  id: Id,
  objectiveId: Id,
  item: CheckItemSchema,
  hint: HintSchema,
});

const SimulationBlock = z.object({
  kind: z.literal("simulation"),
  id: Id,
  objectiveIds: z.array(Id).min(1),
  prompt: Markdown,
  widget: WidgetSchema,
  goal: GoalSchema.nullable().describe("A goal turns the simulation into an assessed interaction"),
});

const RecapBlock = z.object({
  kind: z.literal("recap"),
  id: Id,
  points: z.array(z.string().min(1)).min(2).max(6),
});

export const BlockSchema = z.discriminatedUnion("kind", [
  ExplainBlock,
  WorkedExampleBlock,
  CheckBlock,
  SimulationBlock,
  RecapBlock,
]);

export const LessonSchema = z.object({
  title: z.string().min(1),
  audience: z.string().min(1).describe("Who the lesson is for and what they already know"),
  objectives: z.array(ObjectiveSchema).min(1).max(5),
  blocks: z.array(BlockSchema).min(3).max(30),
});

export type Lesson = z.infer<typeof LessonSchema>;
export type Objective = z.infer<typeof ObjectiveSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type BlockKind = Block["kind"];
export type BlockOf<K extends BlockKind> = Extract<Block, { kind: K }>;
export type CheckItem = z.infer<typeof CheckItemSchema>;
export type Widget = z.infer<typeof WidgetSchema>;
export type Slider = Widget["sliders"][number];
export type Goal = NonNullable<BlockOf<"simulation">["goal"]>;

export type Assessment = {
  readonly objectiveIds: readonly string[];
  readonly hint: string | null;
};

export function assessment(block: Block): Assessment | null {
  if (block.kind === "check") return { objectiveIds: [block.objectiveId], hint: block.hint };
  if (block.kind === "simulation" && block.goal !== null) return { objectiveIds: block.objectiveIds, hint: block.goal.hint };
  return null;
}
