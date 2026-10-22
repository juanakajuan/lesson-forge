import DOMPurify from "dompurify";
import { marked } from "marked";

type Attrs = Record<string, string | number | boolean | EventListener>;
type Child = Node | string | null;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") el.addEventListener(key.replace(/^on/, ""), value);
    else if (typeof value === "boolean") el.toggleAttribute(key, value);
    else el.setAttribute(key, String(value));
  }
  for (const child of children) if (child !== null) el.append(child);
  return el;
}

export function markdown(src: string, inline = false): HTMLElement {
  const html = inline ? marked.parseInline(src, { async: false }) : marked.parse(src, { async: false });
  const el = h(inline ? "span" : "div", { class: "md" });
  el.innerHTML = DOMPurify.sanitize(html);
  return el;
}

export function button(label: string, onClick: () => void, variant: "primary" | "secondary" = "primary"): HTMLButtonElement {
  return h("button", { type: "button", class: `btn btn-${variant}`, onclick: onClick }, label);
}

export function feedback(kind: "correct" | "wrong" | "info", content: Node | string): HTMLElement {
  return h("div", { class: `feedback feedback-${kind}`, role: "status" }, content);
}
