import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_COLOR_IDS,
  HIGHLIGHT_COLOR_OPTIONS,
  HighlightColorSchema,
  HighlightColorSettingSchema,
  OKABE_ITO_HIGHLIGHTS,
  highlightCssValue,
} from "../src/index.js";

describe("highlight color schema", () => {
  it("accepts every allowed id", () => {
    for (const id of HIGHLIGHT_COLOR_IDS) {
      expect(HighlightColorSchema.parse(id)).toBe(id);
    }
  });

  it("rejects unknown values", () => {
    expect(HighlightColorSchema.safeParse("purple").success).toBe(false);
    expect(HighlightColorSchema.safeParse("").success).toBe(false);
    expect(HighlightColorSchema.safeParse(null).success).toBe(false);
    expect(HighlightColorSchema.safeParse(undefined).success).toBe(false);
  });

  it("normalizes invalid document values to undefined", () => {
    expect(HighlightColorSettingSchema.parse("purple")).toBeUndefined();
    expect(HighlightColorSettingSchema.parse("")).toBeUndefined();
    expect(HighlightColorSettingSchema.parse(42)).toBeUndefined();
    expect(HighlightColorSettingSchema.parse(undefined)).toBeUndefined();
  });

  it("keeps explicit null and valid document values", () => {
    expect(HighlightColorSettingSchema.parse(null)).toBeNull();
    for (const id of HIGHLIGHT_COLOR_IDS) {
      expect(HighlightColorSettingSchema.parse(id)).toBe(id);
    }
  });
});

describe("highlightCssValue", () => {
  it("maps undefined to legacy default styling", () => {
    expect(highlightCssValue(undefined)).toBeUndefined();
  });

  it("maps explicit no-color states to an empty string", () => {
    expect(highlightCssValue(null)).toBe("");
    expect(highlightCssValue("none")).toBe("");
  });

  it("maps every palette id to its exact Okabe-Ito hex value", () => {
    for (const id of HIGHLIGHT_COLOR_IDS) {
      if (id === "none") continue;
      expect(highlightCssValue(id)).toBe(OKABE_ITO_HIGHLIGHTS[id]);
    }
    expect(highlightCssValue("black")).toBe("#000000");
    expect(highlightCssValue("orange")).toBe("#E69F00");
    expect(highlightCssValue("skyBlue")).toBe("#56B4E9");
    expect(highlightCssValue("bluishGreen")).toBe("#009E73");
    expect(highlightCssValue("yellow")).toBe("#F0E442");
    expect(highlightCssValue("blue")).toBe("#0072B2");
    expect(highlightCssValue("vermillion")).toBe("#D55E00");
    expect(highlightCssValue("reddishPurple")).toBe("#CC79A7");
  });
});

describe("highlight color options", () => {
  it("lists every stored id in order with human-readable labels", () => {
    expect(HIGHLIGHT_COLOR_OPTIONS.map((option) => option.value)).toEqual([...HIGHLIGHT_COLOR_IDS]);
    expect(HIGHLIGHT_COLOR_OPTIONS.map((option) => option.label)).toEqual([
      "No highlight",
      "Black",
      "Orange",
      "Sky blue",
      "Bluish green",
      "Yellow",
      "Blue",
      "Vermillion",
      "Reddish purple",
    ]);
  });
});
