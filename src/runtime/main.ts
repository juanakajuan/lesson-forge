import { LessonSchema, type Lesson } from "../schema.ts";
import { renderBlock, type Outcome } from "./blocks.ts";
import { h } from "./dom.ts";

type Mastery = Map<string, boolean>;

function recordOutcome(mastery: Mastery, outcome: Outcome): void {
  if (outcome.firstTry === null) return;
  for (const id of outcome.objectiveIds) {
    // An objective counts as mastered only if every assessment of it was right on the first try.
    mastery.set(id, (mastery.get(id) ?? true) && outcome.firstTry);
  }
}

function summary(lesson: Lesson, mastery: Mastery): HTMLElement {
  const rows = lesson.objectives.map((o) => {
    const state = mastery.get(o.id);
    const label = state === true ? "Solid" : state === false ? "Review" : "Not assessed";
    const cls = state === true ? "solid" : state === false ? "review" : "none";
    return h("li", { class: `mastery-row mastery-${cls}` }, h("span", { class: "mastery-badge" }, label), h("span", {}, o.text));
  });
  return h("section", { class: "block block-summary" }, h("h2", {}, "How it went"), h("ul", { class: "mastery" }, ...rows));
}

function mount(lesson: Lesson, root: HTMLElement): void {
  const mastery: Mastery = new Map();
  const bar = h("div", { class: "progress-fill" });
  const flow = h("div", { class: "flow" });
  root.replaceChildren(
    h("div", { class: "progress", role: "progressbar", "aria-label": "Lesson progress" }, bar),
    h("header", { class: "lesson-header" }, h("h1", {}, lesson.title), h("p", { class: "audience" }, lesson.audience)),
    flow,
  );

  const reveal = (index: number): void => {
    bar.style.width = `${(index / lesson.blocks.length) * 100}%`;
    const block = lesson.blocks[index];
    if (block === undefined) {
      flow.append(summary(lesson, mastery));
      return;
    }
    const el = renderBlock(block, {
      complete: (outcome) => {
        recordOutcome(mastery, outcome);
        reveal(index + 1);
      },
    });
    flow.append(el);
    if (index > 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  reveal(0);
}

const dataEl = document.getElementById("lesson-data");
const root = document.getElementById("app");
if (dataEl === null || root === null) throw new Error("lesson page is missing #lesson-data or #app");
const parsed: unknown = JSON.parse(dataEl.textContent ?? "null");
mount(LessonSchema.parse(parsed), root);
