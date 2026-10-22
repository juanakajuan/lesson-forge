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
