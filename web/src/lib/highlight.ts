import {
  HIGHLIGHT_COLOR_OPTIONS,
  highlightCssValue,
  type HighlightColorId,
} from "@bioscom/shared";

export { HIGHLIGHT_COLOR_OPTIONS, highlightCssValue };
export type { HighlightColorId };

/** The extra form-only value keeps legacy styling distinct from explicit removal. */
export type HighlightFormValue = "default" | HighlightColorId;

export interface HighlightCardPresentation {
  className: "highlight-on" | "highlight-none" | "";
  style: string;
}

function isHighlightColorId(value: unknown): value is HighlightColorId {
  return typeof value === "string" && HIGHLIGHT_COLOR_OPTIONS.some((option) => option.value === value);
}

export function highlightFormValue(value?: unknown): HighlightFormValue {
  return isHighlightColorId(value) ? value : "default";
}

/** Add requests omit Default so the backend can apply its normal default behavior. */
export function highlightForAdd(value: HighlightFormValue): HighlightColorId | undefined {
  return value === "default" ? undefined : value;
}

/** Update requests use null to clear a previous setting and restore legacy styling. */
export function highlightForEdit(value: HighlightFormValue): HighlightColorId | null {
  return value === "default" ? null : value;
}

export function highlightCardPresentation(value?: unknown): HighlightCardPresentation {
  if (value === "none") {
    return { className: "highlight-none", style: "" };
  }
  // Null, omitted, and invalid historical values are legacy/default styling.
  // Only the persisted "none" id explicitly removes a stripe.
  if (!isHighlightColorId(value)) {
    return { className: "", style: "" };
  }
  const color = highlightCssValue(value);
  if (color === undefined || color === null || color === "") {
    return { className: "", style: "" };
  }
  return { className: "highlight-on", style: `--card-highlight: ${color};` };
}
