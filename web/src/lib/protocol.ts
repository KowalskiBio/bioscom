import DOMPurify from "dompurify";
import { marked } from "marked";

export const MAX_PROTOCOL_TAGS = 24;
export const PROTOCOL_COLUMNS_STORAGE_KEY = "bioscom-protocol-columns";

export type ProtocolColumnCount = 1 | 2 | 3 | 4;

export function parseProtocolTags(input: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const entry of input.split(",")) {
    const tag = entry.trim();
    if (tag === "") continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length === MAX_PROTOCOL_TAGS) break;
  }

  return tags;
}

/** Convert raw GitHub-flavored Markdown to HTML safe for Svelte's {@html}. */
export function renderProtocolMarkdown(content: string): string {
  const rendered = marked.parse(content, {
    async: false,
    breaks: true,
    gfm: true,
  });
  return DOMPurify.sanitize(rendered, {
    FORBID_ATTR: ["style"],
    FORBID_TAGS: ["style"],
    USE_PROFILES: { html: true },
  });
}

/**
 * Build a compact card summary as text, never as markup. Sanitizing before
 * reading text nodes also ensures discarded script/style contents cannot leak
 * into the excerpt.
 */
export function protocolContentExcerpt(content: string, maxWords = 36, maxCharacters = 240): string {
  const template = document.createElement("template");
  template.innerHTML = renderProtocolMarkdown(content);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textParts: string[] = [];
  while (walker.nextNode()) {
    textParts.push(walker.currentNode.nodeValue ?? "");
  }
  const text = textParts.join(" ").replace(/\s+/g, " ").trim();
  if (text === "") return "";

  const words = text.split(" ");
  let excerpt = words.slice(0, maxWords).join(" ");
  let truncated = words.length > maxWords;
  if (excerpt.length > maxCharacters) {
    excerpt = excerpt.slice(0, maxCharacters + 1).replace(/\s+\S*$/, "").trim();
    if (excerpt.length > maxCharacters) excerpt = excerpt.slice(0, maxCharacters).trim();
    truncated = true;
  }
  return truncated ? `${excerpt.replace(/[\s.,;:!?]+$/, "")}…` : excerpt;
}

export function normalizeProtocolColumnCount(value: unknown): ProtocolColumnCount {
  const count = typeof value === "number" ? value : Number(value);
  return count === 2 || count === 3 || count === 4 ? count : 1;
}

export function readProtocolColumnCount(): ProtocolColumnCount {
  try {
    return normalizeProtocolColumnCount(localStorage.getItem(PROTOCOL_COLUMNS_STORAGE_KEY));
  } catch {
    return 1;
  }
}

export function storeProtocolColumnCount(count: ProtocolColumnCount): void {
  try {
    localStorage.setItem(PROTOCOL_COLUMNS_STORAGE_KEY, String(count));
  } catch {
    // The visual selection still works when storage is blocked or full.
  }
}
