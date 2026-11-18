import type { Chemical, Container, Room, Shelf } from "@bioscom/shared";

export function materialTypeColorClass(type: string | null | undefined): string {
  switch (type) {
    case "chemical":
    case "reagent":
    case "antibody":
    case "primer":
    case "solution":
    case "biological_stock":
      return `material-type-${type}`;
    case "other":
      return "material-type-other";
    default:
      return "material-type-other";
  }
}

const NOTICE_CATEGORY_COLORS = {
  issue: { accent: "#D55E00", rgb: "213, 94, 0", originalText: "#F0B2A6" },
  info: { accent: "#0072B2", rgb: "0, 114, 178", originalText: "#A9C7FF" },
  suggestion: { accent: "#009E73", rgb: "0, 158, 115", originalText: "#ABDDB6" },
  general: { accent: "#999999", rgb: "153, 153, 153", originalText: "#C3CAD4" },
} as const;

type NoticeCategoryPalette = (typeof NOTICE_CATEGORY_COLORS)[keyof typeof NOTICE_CATEGORY_COLORS];

export function noticeCategoryPalette(
  category: string | null | undefined,
  design: "original" | "bauhaus" = "original",
): NoticeCategoryPalette & { tint: string; text: string } {
  const normalized = category?.trim().toLowerCase();
  const colors = normalized === "issue" || normalized === "info" || normalized === "suggestion"
    ? NOTICE_CATEGORY_COLORS[normalized]
    : NOTICE_CATEGORY_COLORS.general;
  return {
    ...colors,
    tint: `rgba(${colors.rgb}, 0.15)`,
    text: design === "bauhaus" ? "#171512" : colors.originalText,
  };
}

export function effectivePosition(
  source: { position?: string | null; customPosition?: string | null } | null | undefined,
): string | null | undefined {
  const customPosition = source?.customPosition;
  if (customPosition !== null && customPosition !== undefined && customPosition.trim() !== "") {
    return customPosition;
  }
  return source?.position;
}

export function computePositions(cont: Container): Record<string, string> {
  const map: Record<string, string> = {};
  for (const sh of cont.shelves ?? []) {
    for (const ch of sh.chemicals ?? []) {
      map[ch.id] = effectivePosition(ch) ?? "—";
    }
  }
  return map;
}

export function countDirectChems(cont: Container): number {
  return (cont.chemicals ?? []).length;
}

export function countChems(cont: Container): number {
  return (
    countDirectChems(cont) +
    (cont.shelves ?? []).reduce((sum, sh) => sum + (sh.chemicals ?? []).length, 0)
  );
}

export function countAllChems(room: Room): number {
  return (
    (room.chemicals ?? []).length +
    (room.containers ?? []).reduce((sum, cont) => sum + countChems(cont), 0)
  );
}

export function getFirstLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export function findRangeShelf(cont: Container, name: string): Shelf | undefined {
  const letter = getFirstLetter(name);
  return (cont.shelves ?? []).find((sh) => {
    if (sh.isRangeShelf !== true) {
      return false;
    }
    const start = (sh.rangeStart ?? "").toUpperCase();
    const end = (sh.rangeEnd ?? "").toUpperCase();
    if (start === "" || end === "") {
      return false;
    }
    if (/^[A-Z]$/.test(start) && /^[A-Z]$/.test(end)) {
      return letter >= start && letter <= end;
    }
    const num = parseInt(letter, 10);
    if (!Number.isNaN(num)) {
      return num >= parseInt(start, 10) && num <= parseInt(end, 10);
    }
    return false;
  });
}

export function normalizeFormula(formula: string | null | undefined): string {
  if (formula === null || formula === undefined || formula === "") {
    return "";
  }
  return formula.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (ch) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(ch)));
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderFormulaHtml(formula: string | null | undefined): string {
  if (formula === null || formula === undefined || formula === "") {
    return "—";
  }
  const norm = normalizeFormula(formula);
  const safe = escapeHtml(norm);
  return safe.replace(/([A-Za-z)\]])(\d+)/g, (_match, pre: string, digits: string) => `${pre}<sub>${digits}</sub>`);
}

export function highlightHtml(text: string, query: string): string {
  if (query === "") {
    return escapeHtml(text);
  }
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) {
    return escapeHtml(text);
  }
  return (
    escapeHtml(text.slice(0, index)) +
    "<mark>" +
    escapeHtml(text.slice(index, index + query.length)) +
    "</mark>" +
    escapeHtml(text.slice(index + query.length))
  );
}

export interface ParsedDeepFreezerShelf {
  rack: string;
  box: string;
}

export function parseDeepFreezerShelf(sh: Shelf | string | null | undefined): ParsedDeepFreezerShelf {
  if (sh === null || sh === undefined) {
    return { rack: "Other", box: "Other" };
  }
  if (typeof sh === "string") {
    const regex = /Rack\s+(.+?)\s*\/\s*Box\s+(.+)/i;
    const match = sh.match(regex);
    if (match !== null) {
      return { rack: match[1]!.trim(), box: match[2]!.trim() };
    }
    const parts = sh.split("/");
    if (parts.length === 2) {
      return { rack: parts[0]!.trim(), box: parts[1]!.trim() };
    }
    return { rack: "Other", box: sh };
  }
  let rack = sh.rackName;
  let box = sh.boxName;
  if (rack === undefined || rack === "" || box === undefined || box === "") {
    const parsed = parseDeepFreezerShelf(sh.name ?? "");
    rack = rack === undefined || rack === "" ? parsed.rack : rack;
    box = box === undefined || box === "" ? parsed.box : box;
  }
  return { rack: rack!.trim(), box: box!.trim() };
}

export function quantityClass(quantity: unknown): string {
  const qty = parseFloat(String(quantity ?? 0)) || 0;
  if (qty <= 0) {
    return "low";
  }
  if (qty < 10) {
    return "medium";
  }
  return "ok";
}

export function sortChems(chems: Chemical[], posMap: Record<string, string>): Chemical[] {
  return [...chems].sort((a, b) => {
    const posA = posMap[a.id] ?? "";
    const posB = posMap[b.id] ?? "";
    return posA.localeCompare(posB, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function chemMatchesQuery(ch: Chemical, queryLower: string): boolean {
  return (
    (ch.name ?? "").toLowerCase().includes(queryLower) ||
    normalizeFormula(ch.formula ?? "").toLowerCase().includes(queryLower) ||
    (ch.cas ?? "").toLowerCase().includes(queryLower)
  );
}

export function countWords(text: string): number {
  if (text.trim() === "") {
    return 0;
  }
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

export function canManageContainerContents(role: string): boolean {
  return role !== "reader";
}

export function stripEmoji(text: string | null | undefined): string {
  if (text === null || text === undefined) {
    return "";
  }
  return text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
