import { evaluate, freeVariables, parseExpr, type Env, type Expr } from "./expr.ts";
import { assessedObjectives, isAssessment, type Block, type Goal, type Lesson, type Slider, type Widget } from "./schema.ts";

export type Severity = "error" | "warning";

export type Finding = {
  readonly rule: string;
  readonly severity: Severity;
  readonly blockId: string | null;
  readonly message: string;
};

export type Rule = {
  readonly id: string;
  readonly severity: Severity;
  /** One-line statement of the rule. Also sent to the generator as guidance. */
  readonly guidance: string;
  readonly check: (lesson: Lesson) => Iterable<Omit<Finding, "rule" | "severity">>;
};

const MAX_EXPLAIN_WORDS = 150;
const MAX_PASSIVE_RUN = 2;
const MAX_GRID_POINTS = 20_000;

const PASSIVE_KINDS: ReadonlySet<Block["kind"]> = new Set(["explain", "workedExample", "recap"]);

function wordCount(markdown: string): number {
  return markdown.split(/\s+/).filter((w) => w.length > 0).length;
}

function compile(src: string, allowed: ReadonlySet<string>): { expr: Expr } | { error: string } {
  const parsed = parseExpr(src);
  if (!parsed.ok) return { error: `expression "${src}" does not parse: ${parsed.error}` };
  const unknown = [...freeVariables(parsed.expr)].filter((v) => !allowed.has(v));
  if (unknown.length > 0) {
    const allowedList = allowed.size > 0 ? [...allowed].join(", ") : "none";
    return { error: `expression "${src}" uses unknown variables ${unknown.join(", ")} (allowed: ${allowedList})` };
  }
  return { expr: parsed.expr };
}

function widgetVariables(widget: Widget): Set<string> {
  const names = new Set(widget.sliders.map((s) => s.name));
  if (widget.type === "functionPlot") names.add("x");
  return names;
}

function widgetExpressions(widget: Widget): string[] {
  return widget.type === "functionPlot" ? [widget.expr] : widget.outputs.map((o) => o.expr);
}

function sliderValues(slider: Slider): number[] {
  const count = Math.floor((slider.max - slider.min) / slider.step + 1e-9) + 1;
  return Array.from({ length: count }, (_, i) => slider.min + i * slider.step);
}

function goalSatisfied(conditions: readonly { expr: Expr; target: number; tolerance: number }[], env: Env): boolean {
  return conditions.every((c) => Math.abs(evaluate(c.expr, env) - c.target) <= c.tolerance);
}

/** Search the slider grid. Returns whether the goal is reachable, or null when the grid is too large to search. */
function goalReachable(sliders: readonly Slider[], conditions: readonly { expr: Expr; target: number; tolerance: number }[]): boolean | null {
  const axes = sliders.map(sliderValues);
  const total = axes.reduce((n, a) => n * a.length, 1);
  if (total > MAX_GRID_POINTS) return null;
  const env: Record<string, number> = {};
  const search = (depth: number): boolean => {
    const axis = axes[depth];
    const slider = sliders[depth];
    if (axis === undefined || slider === undefined) return goalSatisfied(conditions, env);
    for (const v of axis) {
      env[slider.name] = v;
      if (search(depth + 1)) return true;
    }
    return false;
  };
  return search(0);
}

function compileGoal(goal: Goal, sliders: readonly Slider[]): { conditions: { expr: Expr; target: number; tolerance: number }[] } | { error: string } {
  const allowed = new Set(sliders.map((s) => s.name));
  const conditions = [];
  for (const c of goal.conditions) {
    const compiled = compile(c.expr, allowed);
    if ("error" in compiled) return compiled;
    conditions.push({ expr: compiled.expr, target: c.target, tolerance: c.tolerance });
  }
  return { conditions };
}

export const RULES: readonly Rule[] = [
  {
    id: "unique-ids",
    severity: "error",
    guidance: "Every objective id and block id is unique.",
    *check(lesson) {
      const seen = new Set<string>();
      for (const id of [...lesson.objectives.map((o) => o.id), ...lesson.blocks.map((b) => b.id)]) {
        if (seen.has(id)) yield { blockId: id, message: `Id "${id}" is used more than once. Rename one of them.` };
        seen.add(id);
      }
    },
  },
  {
    id: "objective-refs-exist",
    severity: "error",
    guidance: "Blocks reference only objective ids declared in `objectives`.",
    *check(lesson) {
      const known = new Set(lesson.objectives.map((o) => o.id));
      for (const block of lesson.blocks) {
        const refs = block.kind === "check" ? [block.objectiveId] : "objectiveIds" in block ? block.objectiveIds : [];
        for (const ref of refs) {
          if (!known.has(ref)) {
            yield { blockId: block.id, message: `References unknown objective "${ref}". Use one of: ${[...known].join(", ")}.` };
          }
        }
      }
    },
  },
  {
    id: "objective-assessed",
    severity: "error",
    guidance: "Every objective is assessed by at least one check or goal-based simulation.",
    *check(lesson) {
      const assessed = new Set(lesson.blocks.flatMap(assessedObjectives));
      for (const o of lesson.objectives) {
        if (!assessed.has(o.id)) {
          yield { blockId: null, message: `Objective "${o.id}" is never assessed. Add a check block or a simulation with a goal for it.` };
        }
      }
    },
  },
  {
    id: "explain-word-limit",
    severity: "error",
    guidance: `An explain block has at most ${MAX_EXPLAIN_WORDS} words. Split longer explanations around an interaction.`,
    *check(lesson) {
      for (const block of lesson.blocks) {
        if (block.kind !== "explain") continue;
        const words = wordCount(block.markdown);
        if (words > MAX_EXPLAIN_WORDS) {
          yield {
            blockId: block.id,
            message: `Has ${words} words (limit ${MAX_EXPLAIN_WORDS}). Cut it, or split it into two explain blocks with a check between them.`,
          };
        }
      }
    },
  },
  {
    id: "interaction-density",
    severity: "error",
    guidance: `At most ${MAX_PASSIVE_RUN} passive blocks (explain, workedExample, recap) in a row before the learner does something.`,
    *check(lesson) {
      let run: string[] = [];
      for (const block of lesson.blocks) {
        if (block.kind === "simulation" || block.kind === "check") {
          run = [];
          continue;
        }
        if (!PASSIVE_KINDS.has(block.kind)) continue;
        run.push(block.id);
        if (run.length === MAX_PASSIVE_RUN + 1 && block.kind !== "recap") {
          yield {
            blockId: block.id,
            message: `Blocks ${run.join(", ")} are ${run.length} passive blocks in a row. Insert a check or simulation before "${block.id}".`,
          };
        }
      }
    },
  },
  {
    id: "example-before-practice",
    severity: "error",
    guidance: "An objective with level apply or analyze gets a workedExample before its first assessment.",
    *check(lesson) {
      for (const o of lesson.objectives) {
        if (o.level === "recall") continue;
        const firstAssessment = lesson.blocks.findIndex((b) => assessedObjectives(b).includes(o.id));
        if (firstAssessment === -1) continue;
        const hasExample = lesson.blocks
          .slice(0, firstAssessment)
          .some((b) => b.kind === "workedExample" && b.objectiveIds.includes(o.id));
        if (!hasExample) {
          const blockId = lesson.blocks[firstAssessment]?.id ?? null;
          yield { blockId, message: `Objective "${o.id}" (${o.level}) is assessed before any workedExample covers it. Add a workedExample before "${blockId}".` };
        }
      }
    },
  },
  {
    id: "mcq-single-correct",
    severity: "error",
    guidance: "A multiple-choice item has exactly one correct choice.",
    *check(lesson) {
      for (const block of lesson.blocks) {
        if (block.kind !== "check" || block.item.type !== "mcq") continue;
        const correct = block.item.choices.filter((c) => c.correct).length;
        if (correct !== 1) yield { blockId: block.id, message: `Has ${correct} correct choices. Mark exactly one choice correct.` };
      }
    },
  },
  {
    id: "mcq-diagnostic-distractors",
    severity: "error",
    guidance: "Each wrong choice names the misconception behind it and has its own feedback.",
    *check(lesson) {
      for (const block of lesson.blocks) {
        if (block.kind !== "check" || block.item.type !== "mcq") continue;
        const feedbacks = new Set<string>();
        for (const [i, choice] of block.item.choices.entries()) {
          if (!choice.correct && (choice.misconception === null || choice.misconception.trim() === "")) {
            yield { blockId: block.id, message: `Wrong choice ${i + 1} ("${choice.text}") has no misconception. Name the error that leads a learner to pick it.` };
          }
          const key = choice.feedback.trim().toLowerCase();
          if (feedbacks.has(key)) yield { blockId: block.id, message: `Choice ${i + 1} repeats another choice's feedback. Write feedback specific to this choice.` };
          feedbacks.add(key);
        }
      }
    },
  },
  {
    id: "numeric-answer-computes",
    severity: "error",
    guidance: "A numeric item's answerExpr is a variable-free expression that evaluates to a finite number.",
    *check(lesson) {
      for (const block of lesson.blocks) {
        if (block.kind !== "check" || block.item.type !== "numeric") continue;
        const compiled = compile(block.item.answerExpr, new Set());
        if ("error" in compiled) {
          yield { blockId: block.id, message: `answerExpr: ${compiled.error}.` };
          continue;
        }
        const value = evaluate(compiled.expr, {});
        if (!Number.isFinite(value)) yield { blockId: block.id, message: `answerExpr evaluates to ${value}. Fix the computation.` };
      }
    },
  },
  {
    id: "order-items-distinct",
    severity: "error",
    guidance: "Items in an ordering task are all different.",
    *check(lesson) {
      for (const block of lesson.blocks) {
        if (block.kind !== "check" || block.item.type !== "order") continue;
        if (new Set(block.item.items).size !== block.item.items.length) {
          yield { blockId: block.id, message: "Has duplicate items, so the order is ambiguous. Make every item distinct." };
        }
      }
    },
  },
  {
    id: "widget-valid",
    severity: "error",
    guidance: "Widget sliders have min < max, initial inside the range, and unique names; expressions use only slider names (and x for plots).",
    *check(lesson) {
      for (const block of lesson.blocks) {
        if (block.kind !== "simulation") continue;
        const { widget } = block;
        const names = widget.sliders.map((s) => s.name);
        if (new Set(names).size !== names.length) yield { blockId: block.id, message: "Slider names repeat. Give each slider a unique name." };
        for (const s of widget.sliders) {
          if (s.min >= s.max) yield { blockId: block.id, message: `Slider "${s.name}" has min ${s.min} >= max ${s.max}.` };
          if (s.initial < s.min || s.initial > s.max) yield { blockId: block.id, message: `Slider "${s.name}" initial ${s.initial} is outside [${s.min}, ${s.max}].` };
          if ((s.max - s.min) / s.step > 1000) yield { blockId: block.id, message: `Slider "${s.name}" has more than 1000 steps. Increase step.` };
        }
        if (widget.type === "functionPlot") {
          if (widget.xMin >= widget.xMax || widget.yMin >= widget.yMax) {
            yield { blockId: block.id, message: "Plot range is empty. Set xMin < xMax and yMin < yMax." };
          }
          for (const m of widget.markers) {
            if (m.x < widget.xMin || m.x > widget.xMax || m.y < widget.yMin || m.y > widget.yMax) {
              yield { blockId: block.id, message: `Marker (${m.x}, ${m.y}) is outside the plot range. Widen the range or move the marker.` };
            }
          }
        }
        const allowed = widgetVariables(widget);
        for (const src of widgetExpressions(widget)) {
          const compiled = compile(src, allowed);
          if ("error" in compiled) yield { blockId: block.id, message: `${compiled.error}.` };
        }
      }
    },
  },
  {
    id: "goal-reachable-not-trivial",
    severity: "error",
    guidance: "A simulation goal is reachable on the slider grid and is not already met at the initial slider values.",
    *check(lesson) {
      for (const block of lesson.blocks) {
        if (block.kind !== "simulation" || block.goal === null) continue;
        const compiled = compileGoal(block.goal, block.widget.sliders);
        if ("error" in compiled) {
          yield { blockId: block.id, message: `Goal ${compiled.error}.` };
          continue;
        }
        const initial = Object.fromEntries(block.widget.sliders.map((s) => [s.name, s.initial]));
        if (goalSatisfied(compiled.conditions, initial)) {
          yield { blockId: block.id, message: "Goal is already met at the initial slider values. Change the initial values or the target." };
        }
        const reachable = goalReachable(block.widget.sliders, compiled.conditions);
        if (reachable === false) {
          yield { blockId: block.id, message: "No slider position on the step grid meets the goal. Adjust the target, tolerance, or slider ranges/steps." };
        }
      }
    },
  },
  {
    id: "goal-not-slider-readout",
    severity: "error",
    guidance: "A simulation goal needs reasoning: at least one condition is a computed expression, not just a slider name the learner sets to a given number.",
    *check(lesson) {
      for (const block of lesson.blocks) {
        if (block.kind !== "simulation" || block.goal === null) continue;
        const readsOnlySliders = block.goal.conditions.every((c) => {
          const parsed = parseExpr(c.expr);
          return parsed.ok && parsed.expr.kind === "var";
        });
        if (readsOnlySliders) {
          yield {
            blockId: block.id,
            message: "Every goal condition is a bare slider value, so the learner only moves a slider to a number. Make the goal a computed result the learner must reason toward, or remove the goal.",
          };
        }
      }
    },
  },
  {
    id: "ends-with-recap",
    severity: "error",
    guidance: "The last block is a recap.",
    *check(lesson) {
      const last = lesson.blocks.at(-1);
      if (last !== undefined && last.kind !== "recap") yield { blockId: last.id, message: "The lesson does not end with a recap block. Add one." };
    },
  },
  {
    id: "first-assessment-early",
    severity: "warning",
    guidance: "The learner meets the first interaction within the first three blocks.",
    *check(lesson) {
      const first = lesson.blocks.findIndex((b) => b.kind === "simulation" || isAssessment(b));
      if (first > 2) yield { blockId: lesson.blocks[first]?.id ?? null, message: "The first interaction comes late. Move an interaction earlier." };
    },
  },
  {
    id: "check-has-hint",
    severity: "warning",
    guidance: "Checks for apply/analyze objectives carry a hint.",
    *check(lesson) {
      const levels = new Map(lesson.objectives.map((o) => [o.id, o.level]));
      for (const block of lesson.blocks) {
        if (block.kind === "check" && block.hint === null && levels.get(block.objectiveId) !== "recall") {
          yield { blockId: block.id, message: "Has no hint. Add a hint that points at the first step." };
        }
      }
    },
  },
];

export function lint(lesson: Lesson, rules: readonly Rule[] = RULES): Finding[] {
  return rules.flatMap((rule) => [...rule.check(lesson)].map((f) => ({ ...f, rule: rule.id, severity: rule.severity })));
}

export function formatFinding(f: Finding): string {
  const where = f.blockId === null ? "lesson" : `block "${f.blockId}"`;
  return `[${f.severity}] ${f.rule} @ ${where}: ${f.message}`;
}
