import { z } from "zod";

/**
 * Okabe–Ito colorblind-safe palette used for optional card highlights/stripes.
 * The ids are stored verbatim in the inventory document, so values may never
 * change without a migration.
 */
export const OKABE_ITO_HIGHLIGHTS = {
  black: "#000000",
  orange: "#E69F00",
  skyBlue: "#56B4E9",
  bluishGreen: "#009E73",
  yellow: "#F0E442",
  blue: "#0072B2",
  vermillion: "#D55E00",
  reddishPurple: "#CC79A7",
} as const;

export const HIGHLIGHT_COLOR_IDS = [
  "none",
  "black",
  "orange",
  "skyBlue",
  "bluishGreen",
  "yellow",
  "blue",
  "vermillion",
  "reddishPurple",
] as const;

export type HighlightColorId = typeof HIGHLIGHT_COLOR_IDS[number];
export type HighlightColor = Exclude<HighlightColorId, "none">;

export const HighlightColorSchema = z.enum(HIGHLIGHT_COLOR_IDS);

/**
 * Document-level setting: omitted/null/invalid historical values degrade to
 * `undefined` (legacy default styling), while `"none"` explicitly disables the
 * highlight. Note that `.nullish()` keeps an explicit `null` as `null`; the
 * API layer uses `HighlightColorSchema` directly where it must distinguish
 * "reset" from "unset".
 */
export const HighlightColorSettingSchema = HighlightColorSchema.nullish().catch(undefined);

/**
 * Maps a stored highlight id onto a CSS color value.
 * - `undefined` -> `undefined` (legacy/default styling)
 * - `null` or `"none"` -> `""` (explicitly no color)
 * - any palette id -> its exact Okabe–Ito hex value
 */
export function highlightCssValue(value?: HighlightColorId | null): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "none") return "";
  return OKABE_ITO_HIGHLIGHTS[value];
}

/** Human-readable options for pickers, including the explicit "no color" state. */
export const HIGHLIGHT_COLOR_OPTIONS: Array<{ value: "none" | HighlightColor; label: string }> = [
  { value: "none", label: "No highlight" },
  { value: "black", label: "Black" },
  { value: "orange", label: "Orange" },
  { value: "skyBlue", label: "Sky blue" },
  { value: "bluishGreen", label: "Bluish green" },
  { value: "yellow", label: "Yellow" },
  { value: "blue", label: "Blue" },
  { value: "vermillion", label: "Vermillion" },
  { value: "reddishPurple", label: "Reddish purple" },
];
