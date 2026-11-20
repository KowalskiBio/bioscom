import { describe, expect, it } from "vitest";
import {
  MAX_PROTOCOL_TAGS,
  normalizeProtocolColumnCount,
  parseProtocolTags,
} from "../src/lib/protocol";

describe("protocol form values", () => {
  it("trims tags, removes empty entries and duplicates case-insensitively", () => {
    expect(parseProtocolTags(" buffer, assay, BUFFER, , protein,assay,  DNA extraction  ")).toEqual([
      "buffer",
      "assay",
      "protein",
      "DNA extraction",
    ]);
  });

  it("returns an empty tag array so edits can clear all tags", () => {
    expect(parseProtocolTags("")).toEqual([]);
    expect(parseProtocolTags(" , ,   , ")).toEqual([]);
  });

  it("keeps the first 24 unique tags", () => {
    const input = Array.from({ length: 30 }, (_, index) => `tag-${index + 1}`).join(", ");
    const parsed = parseProtocolTags(input);
    expect(parsed).toHaveLength(MAX_PROTOCOL_TAGS);
    expect(parsed[0]).toBe("tag-1");
    expect(parsed.at(-1)).toBe("tag-24");
  });
});

describe("protocol column preference", () => {
  it("accepts only whole values from 1 through 4 and defaults invalid values to one", () => {
    expect(normalizeProtocolColumnCount(1)).toBe(1);
    expect(normalizeProtocolColumnCount("2")).toBe(2);
    expect(normalizeProtocolColumnCount(3)).toBe(3);
    expect(normalizeProtocolColumnCount("4")).toBe(4);
    for (const invalid of [null, undefined, "", "0", "5", "2.5", "not-a-number"]) {
      expect(normalizeProtocolColumnCount(invalid)).toBe(1);
    }
  });
});
