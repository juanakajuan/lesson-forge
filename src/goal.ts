import { evaluate, freeVariables, parseExpr, type Env, type Expr } from "./expr.ts";
import type { Goal, Slider } from "./schema.ts";

export const MAX_GRID_POINTS = 20_000;

const compiledGoal = Symbol("compiledGoal");

export type CompiledGoal = {
  readonly [compiledGoal]: true;
  readonly sliders: readonly Slider[];
  readonly conditions: readonly { readonly expr: Expr; readonly target: number; readonly tolerance: number }[];
};

export type SliderValues = Readonly<Record<string, number>>;

function compileExpr(src: string, allowed: ReadonlySet<string>): { expr: Expr } | { error: string } {
  const parsed = parseExpr(src);
  if (!parsed.ok) return { error: `expression "${src}" does not parse: ${parsed.error}` };
  const unknown = [...freeVariables(parsed.expr)].filter((v) => !allowed.has(v));
  if (unknown.length > 0) {
    const allowedList = allowed.size > 0 ? [...allowed].join(", ") : "none";
    return { error: `expression "${src}" uses unknown variables ${unknown.join(", ")} (allowed: ${allowedList})` };
  }
  return { expr: parsed.expr };
}

export function compileGoal(
  goal: Goal,
  sliders: readonly Slider[],
): { ok: true; goal: CompiledGoal } | { ok: false; error: string } {
  const allowed = new Set(sliders.map((s) => s.name));
  const conditions = [];
  for (const c of goal.conditions) {
    const compiled = compileExpr(c.expr, allowed);
    if ("error" in compiled) return { ok: false, error: compiled.error };
    conditions.push({ expr: compiled.expr, target: c.target, tolerance: c.tolerance });
  }
  return { ok: true, goal: { [compiledGoal]: true, sliders, conditions } };
}

function safeEval(expr: Expr, env: Env): number {
  try {
    return evaluate(expr, env);
  } catch {
    return Number.NaN;
  }
}

export function goalMet(goal: CompiledGoal, values: Env): boolean {
  return goal.conditions.every((c) => {
    const value = safeEval(c.expr, values);
    return Number.isFinite(value) && Math.abs(value - c.target) <= c.tolerance;
  });
}

function stepDecimals(step: number): number {
  return (String(step).split(".")[1] ?? "").length;
}

function roundToStep(value: number, step: number): number {
  const factor = 10 ** stepDecimals(step);
  return Math.round(value * factor) / factor;
}

function axisValues(slider: Slider): readonly number[] {
  const count = Math.floor((slider.max - slider.min) / slider.step + 1e-9) + 1;
  return Array.from({ length: count }, (_, i) => roundToStep(slider.min + i * slider.step, slider.step));
}

export function gridSize(goal: CompiledGoal): number {
  return goal.sliders.reduce((n, slider) => n * axisValues(slider).length, 1);
}

export type GoalSearch =
  | { readonly kind: "found"; readonly values: SliderValues }
  | { readonly kind: "absent" }
  | { readonly kind: "too-large" };

export function nearestSolution(goal: CompiledGoal, near: SliderValues): GoalSearch {
  if (gridSize(goal) > MAX_GRID_POINTS) return { kind: "too-large" };
  const axes = goal.sliders.map(axisValues);
  const current: Record<string, number> = {};
  let best: SliderValues | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  const visit = (depth: number): void => {
    const slider = goal.sliders[depth];
    const axis = axes[depth];
    if (slider === undefined || axis === undefined) {
      if (!goalMet(goal, current)) return;
      let distance = 0;
      for (const s of goal.sliders) {
        const value = current[s.name];
        const from = near[s.name];
        if (value === undefined || from === undefined) return;
        const span = s.max - s.min;
        const norm = (value - from) / span;
        distance += norm * norm;
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { ...current };
      }
      return;
    }
    for (const value of axis) {
      current[slider.name] = value;
      visit(depth + 1);
    }
  };

  visit(0);
  return best === null ? { kind: "absent" } : { kind: "found", values: best };
}
