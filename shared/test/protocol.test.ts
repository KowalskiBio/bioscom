import { describe, expect, it } from "vitest";
import {
  AddProtocolBodySchema,
  EditProtocolBodySchema,
  ProtocolSchema,
  ProtocolTagsBodySchema,
} from "../src/index.js";

describe("ProtocolSchema metadata", () => {
  it("keeps legacy protocols with only id, title and content", () => {
    const result = ProtocolSchema.parse({ id: "p-1", title: "Legacy", content: "# Legacy\n\nBody" });
    expect(result.description).toBeUndefined();
    expect(result.tags).toBeUndefined();
    expect(result.content).toBe("# Legacy\n\nBody");
  });

  it("accepts optional description and tags and trims tag whitespace", () => {
    const result = ProtocolSchema.parse({
      id: "p-2",
      title: "Rich",
      description: "Short summary",
      tags: [" lab ", "protocol"],
      content: "## Steps\n\n1. Do it",
    });
    expect(result.description).toBe("Short summary");
    expect(result.tags).toEqual(["lab", "protocol"]);
    expect(result.content).toBe("## Steps\n\n1. Do it");
  });

  it("normalizes keyed legacy tag records into an array", () => {
    const result = ProtocolSchema.parse({
      id: "p-3",
      title: "Keyed",
      tags: { a: "one", b: "two" },
    });
    expect(result.tags).toEqual(["one", "two"]);
  });

  it("degrades malformed tags to undefined without rejecting the protocol", () => {
    for (const tags of [["ok", ""], ["ok", "x".repeat(51)], [123], "not-an-array", 42]) {
      const result = ProtocolSchema.parse({ id: "p-4", title: "Bad tags", tags, content: "keep" });
      expect(result.tags).toBeUndefined();
      expect(result.content).toBe("keep");
    }
  });

  it("keeps an explicit null tag value safe for legacy documents", () => {
    const result = ProtocolSchema.parse({ id: "p-5", title: "Null tags", tags: null });
    expect(result.tags).toBeNull();
  });
});

describe("ProtocolTagsBodySchema", () => {
  it("accepts trimmed non-empty tags and an empty array", () => {
    expect(ProtocolTagsBodySchema.parse([])).toEqual([]);
    expect(ProtocolTagsBodySchema.parse([" lab ", "protocol"])).toEqual(["lab", "protocol"]);
    expect(ProtocolTagsBodySchema.safeParse([undefined]).success).toBe(false);
  });

  it("rejects blank, oversized and too many tags", () => {
    expect(ProtocolTagsBodySchema.safeParse([""]).success).toBe(false);
    expect(ProtocolTagsBodySchema.safeParse(["   "]).success).toBe(false);
    expect(ProtocolTagsBodySchema.safeParse(["x".repeat(51)]).success).toBe(false);
    expect(ProtocolTagsBodySchema.safeParse(Array.from({ length: 24 }, (_, i) => `t${i}`)).success).toBe(true);
    expect(ProtocolTagsBodySchema.safeParse(Array.from({ length: 25 }, (_, i) => `t${i}`)).success).toBe(false);
  });
});

describe("protocol body schemas", () => {
  it("accepts description, tags and content on create and preserves markdown whitespace", () => {
    const content = "\n# Title\n\n- item\n\n";
    const result = AddProtocolBodySchema.parse({
      title: "New",
      description: "Summary",
      tags: ["a", "b"],
      content,
    });
    expect(result.description).toBe("Summary");
    expect(result.tags).toEqual(["a", "b"]);
    expect(result.content).toBe(content);
  });

  it("enforces description and content length limits", () => {
    expect(AddProtocolBodySchema.safeParse({ title: "T", description: "x".repeat(1001) }).success).toBe(false);
    expect(AddProtocolBodySchema.safeParse({ title: "T", content: "x".repeat(8001) }).success).toBe(false);
    expect(AddProtocolBodySchema.safeParse({ title: "T", content: "x".repeat(8000) }).success).toBe(true);
  });

  it("rejects oversized tag lists on create and edit", () => {
    const tooMany = Array.from({ length: 25 }, (_, i) => `t${i}`);
    expect(AddProtocolBodySchema.safeParse({ title: "T", tags: tooMany }).success).toBe(false);
    expect(EditProtocolBodySchema.safeParse({ tags: tooMany }).success).toBe(false);
  });

  it("lets edit clear description and tags and rejects an empty update", () => {
    expect(EditProtocolBodySchema.safeParse({ description: "" }).success).toBe(true);
    expect(EditProtocolBodySchema.safeParse({ tags: [] }).success).toBe(true);
    expect(EditProtocolBodySchema.safeParse({ content: "" }).success).toBe(true);
    expect(EditProtocolBodySchema.safeParse({}).success).toBe(false);
  });
});
