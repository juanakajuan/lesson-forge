import { evaluate, parseExpr, type Env, type Expr } from "../expr.ts";
import type { Goal, Slider, Widget } from "../schema.ts";
import { h } from "./dom.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// Expressions were checked by the linter before render, so a parse failure here is a bug.
function compile(src: string): Expr {
  const parsed = parseExpr(src);
  if (!parsed.ok) throw new Error(`invalid expression "${src}": ${parsed.error}`);
  return parsed.expr;
}

function safeEval(expr: Expr, env: Env): number {
  try {
    return evaluate(expr, env);
  } catch {
    return Number.NaN;
  }
}

function formatNumber(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return "undefined";
  return n.toFixed(decimals).replace("-", "−");
}

function sliderControls(sliders: readonly Slider[], env: Record<string, number>, onChange: () => void): HTMLElement {
  const rows = sliders.map((s) => {
    env[s.name] = s.initial;
    const decimals = (String(s.step).split(".")[1] ?? "").length;
    const value = h("output", { class: "slider-value" }, formatNumber(s.initial, decimals));
    const input = h("input", { type: "range", min: s.min, max: s.max, step: s.step, value: s.initial, "aria-label": s.label });
    input.addEventListener("input", () => {
      const v = Number(input.value);
      env[s.name] = v;
      value.textContent = formatNumber(v, decimals);
      onChange();
    });
    return h("label", { class: "slider" }, h("span", { class: "slider-label" }, s.label), input, value);
  });
  return h("div", { class: "sliders" }, ...rows);
}

/** A 1, 2 or 5 times a power of ten that gives about 6 to 12 grid lines across the range. */
function niceStep(range: number): number {
  const raw = range / 8;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const factor = [1, 2, 5, 10].find((f) => f * magnitude >= raw) ?? 10;
  return factor * magnitude;
}

/** Ticks strictly inside the range, so edge labels are never clipped. */
function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let i = Math.floor(min / step) + 1; i * step < max - step * 1e-9; i++) out.push(Number((i * step).toPrecision(12)));
  return out;
}

function functionPlot(widget: Extract<Widget, { type: "functionPlot" }>, env: Record<string, number>): { el: SVGSVGElement; redraw: () => void } {
  const W = 400;
  const H = 300;
  const expr = compile(widget.expr);
  const sx = (x: number): number => ((x - widget.xMin) / (widget.xMax - widget.xMin)) * W;
  const sy = (y: number): number => H - ((y - widget.yMin) / (widget.yMax - widget.yMin)) * H;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "plot", role: "img", "aria-label": `Plot of y = ${widget.expr}` });

  const xStep = niceStep(widget.xMax - widget.xMin);
  const yStep = niceStep(widget.yMax - widget.yMin);
  const xTicks = ticks(widget.xMin, widget.xMax, xStep);
  const yTicks = ticks(widget.yMin, widget.yMax, yStep);
  for (const x of xTicks) root.append(svg("line", { x1: sx(x), x2: sx(x), y1: 0, y2: H, class: "grid" }));
  for (const y of yTicks) root.append(svg("line", { x1: 0, x2: W, y1: sy(y), y2: sy(y), class: "grid" }));
  root.append(svg("line", { x1: sx(0), x2: sx(0), y1: 0, y2: H, class: "axis" }));
  root.append(svg("line", { x1: 0, x2: W, y1: sy(0), y2: sy(0), class: "axis" }));
  const label = (x: number, y: number, text: string, anchor: "start" | "middle" | "end", cls: string): void => {
    const t = svg("text", { x, y, class: cls, "text-anchor": anchor });
    t.textContent = text;
    root.append(t);
  };
  const xDecimals = Math.max(0, -Math.floor(Math.log10(xStep)));
  const yDecimals = Math.max(0, -Math.floor(Math.log10(yStep)));
  for (const x of xTicks) {
    if (x !== 0) label(sx(x), Math.min(H - 4, Math.max(14, sy(0) + 16)), formatNumber(x, xDecimals), "middle", "tick");
  }
  for (const y of yTicks) {
    if (y !== 0) label(Math.min(W - 4, Math.max(4, sx(0) + 4)), sy(y) - 4, formatNumber(y, yDecimals), "start", "tick");
  }

  const curve = svg("path", { class: "curve", d: "" });
  root.append(curve);

  for (const m of widget.markers) {
    root.append(svg("circle", { cx: sx(m.x), cy: sy(m.y), r: 5, class: "marker" }));
    if (m.label !== null) {
      const nearRight = sx(m.x) > W * 0.7;
      const nearTop = sy(m.y) < 20;
      label(sx(m.x) + (nearRight ? -8 : 8), sy(m.y) + (nearTop ? 18 : -8), m.label, nearRight ? "end" : "start", "marker-label");
    }
  }

  const redraw = (): void => {
    const samples = 240;
    let d = "";
    let penDown = false;
    for (let i = 0; i <= samples; i++) {
      const x = widget.xMin + ((widget.xMax - widget.xMin) * i) / samples;
      const y = safeEval(expr, { ...env, x });
      // Lift the pen far outside the view so asymptotes do not draw vertical lines.
      const visible = Number.isFinite(y) && Math.abs(sy(y)) < H * 10;
      if (visible) {
        d += `${penDown ? "L" : "M"}${sx(x).toFixed(2)},${sy(y).toFixed(2)}`;
        penDown = true;
      } else {
        penDown = false;
      }
    }
    curve.setAttribute("d", d);
  };
  return { el: root, redraw };
}

function formulaOutputs(widget: Extract<Widget, { type: "formulaExplorer" }>, env: Record<string, number>): { el: HTMLElement; redraw: () => void } {
  const rows = widget.outputs.map((o) => ({ spec: o, expr: compile(o.expr), cell: h("td", { class: "output-value" }) }));
  const el = h(
    "table",
    { class: "outputs" },
    h("tbody", {}, ...rows.map((r) => h("tr", {}, h("th", { scope: "row" }, r.spec.label), r.cell))),
  );
  const redraw = (): void => {
    for (const r of rows) {
      const unit = r.spec.unit === null ? "" : ` ${r.spec.unit}`;
      r.cell.textContent = formatNumber(safeEval(r.expr, env), r.spec.decimals) + unit;
    }
  };
  return { el, redraw };
}

export type MountedWidget = { readonly el: HTMLElement; readonly onChange: (listener: (env: Env) => void) => void };

export function mountWidget(widget: Widget): MountedWidget {
  const env: Record<string, number> = {};
  const listeners: ((env: Env) => void)[] = [];
  let view: { el: Element; redraw: () => void } | null = null;
  const changed = (): void => {
    view?.redraw();
    for (const l of listeners) l(env);
  };
  const controls = sliderControls(widget.sliders, env, changed);
  view = widget.type === "functionPlot" ? functionPlot(widget, env) : formulaOutputs(widget, env);
  view.redraw();
  return { el: h("div", { class: `widget widget-${widget.type}` }, view.el, controls), onChange: (l) => listeners.push(l) };
}

export function goalChecker(goal: Goal): (env: Env) => boolean {
  const conditions = goal.conditions.map((c) => ({ expr: compile(c.expr), target: c.target, tolerance: c.tolerance }));
  return (env) => conditions.every((c) => Math.abs(safeEval(c.expr, env) - c.target) <= c.tolerance);
}
