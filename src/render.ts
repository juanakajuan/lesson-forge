import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import type { Lesson } from "./schema.ts";

const RUNTIME_ENTRY = new URL("./runtime/main.ts", import.meta.url).pathname;
const STYLES = new URL("./runtime/styles.css", import.meta.url).pathname;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}

/** Produces one self-contained HTML file: runtime, styles, and lesson data inlined. */
export async function renderLesson(lesson: Lesson): Promise<string> {
  const [bundle, css] = await Promise.all([
    build({ entryPoints: [RUNTIME_ENTRY], bundle: true, write: false, minify: true, format: "iife", target: "es2022", legalComments: "none" }),
    readFile(STYLES, "utf8"),
  ]);
  const js = bundle.outputFiles[0]?.text;
  if (js === undefined) throw new Error("esbuild produced no output");
  // Escape "<" so lesson text cannot close the script tag.
  const data = JSON.stringify(lesson).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(lesson.title)}</title>
<style>${css}</style>
</head>
<body>
<main id="app"></main>
<script type="application/json" id="lesson-data">${data}</script>
<script>${js.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
}

/** A landing page that links each rendered lesson. */
export async function renderIndex(entries: readonly { slug: string; lesson: Lesson }[]): Promise<string> {
  const css = await readFile(STYLES, "utf8");
  const cards = entries
    .map(
      ({ slug, lesson }) => `<a class="block lesson-card" href="${encodeURIComponent(slug)}.html">
<h2>${escapeHtml(lesson.title)}</h2>
<p class="audience">${escapeHtml(lesson.audience)}</p>
<p class="card-meta">${lesson.objectives.length} objectives · ${lesson.blocks.length} blocks · ${lesson.blocks.filter((b) => b.kind === "check" || b.kind === "simulation").length} interactions</p>
</a>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>lesson-forge</title>
<style>${css}
.lesson-card { display: block; color: inherit; text-decoration: none; }
.lesson-card:hover { border-color: var(--accent); }
.lesson-card h2 { margin: 0 0 4px; font-size: 1.2rem; }
.lesson-card .audience { margin: 0 0 8px; }
.card-meta { margin: 0; font-size: 0.85rem; color: var(--muted); }
.intro a { color: var(--accent); }
</style>
</head>
<body>
<main id="app">
<header class="lesson-header">
<h1>lesson-forge</h1>
<p class="audience intro">Interactive lessons written by an AI as schema-checked JSON and rendered by tested components. <a href="https://github.com/juanakajuan/lesson-forge">Source on GitHub</a>.</p>
</header>
${cards}
</main>
</body>
</html>
`;
}
