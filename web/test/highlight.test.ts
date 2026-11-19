import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HIGHLIGHT_COLOR_OPTIONS,
  highlightCardPresentation,
  highlightForAdd,
  highlightForEdit,
  highlightFormValue,
  type HighlightColorId,
} from "../src/lib/highlight";
import {
  opAddContainer,
  opAddRoom,
  opEditContainer,
  opEditRoom,
} from "../src/lib/ops";
import { clearCurrentGroup, setCurrentGroup } from "../src/lib/stores/currentGroup.svelte";

const palette: Array<[Exclude<HighlightColorId, "none">, string]> = [
  ["black", "#000000"],
  ["orange", "#E69F00"],
  ["skyBlue", "#56B4E9"],
  ["bluishGreen", "#009E73"],
  ["yellow", "#F0E442"],
  ["blue", "#0072B2"],
  ["vermillion", "#D55E00"],
  ["reddishPurple", "#CC79A7"],
];

describe("highlight form and card mapping", () => {
  it("keeps Default distinct from No highlight in form/API values", () => {
    expect(highlightFormValue()).toBe("default");
    expect(highlightFormValue(null)).toBe("default");
    expect(highlightFormValue("invalid-legacy-value")).toBe("default");
    expect(highlightFormValue("none")).toBe("none");
    expect(highlightFormValue("skyBlue")).toBe("skyBlue");

    expect(highlightForAdd("default")).toBeUndefined();
    expect(highlightForAdd("none")).toBe("none");
    expect(highlightForAdd("orange")).toBe("orange");
    expect(highlightForEdit("default")).toBeNull();
    expect(highlightForEdit("none")).toBe("none");
    expect(highlightForEdit("orange")).toBe("orange");
  });

  it("maps every Okabe–Ito selection to its class and exact custom property", () => {
    expect(HIGHLIGHT_COLOR_OPTIONS.map((option) => option.value)).toEqual([
      "none",
      ...palette.map(([value]) => value),
    ]);
    for (const [value, hex] of palette) {
      expect(highlightCardPresentation(value)).toEqual({
        className: "highlight-on",
        style: `--card-highlight: ${hex};`,
      });
    }
  });

  it("only adds highlight-none for the explicit no-highlight state", () => {
    expect(highlightCardPresentation("none")).toEqual({ className: "highlight-none", style: "" });
    for (const value of [undefined, null, "", "invalid-legacy-value"]) {
      expect(highlightCardPresentation(value)).toEqual({ className: "", style: "" });
    }
  });
});

describe("highlight operation payloads", () => {
  let bodies: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    bodies = [];
    setCurrentGroup("highlight-test-lab");
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCurrentGroup();
  });

  it("omits Default from room and container add requests", async () => {
    await opAddRoom("A301", undefined, highlightForAdd("default"));
    await opAddContainer({
      roomId: "room-1",
      name: "Cabinet",
      type: "cabinet",
      highlightColor: highlightForAdd("default"),
    });

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).not.toHaveProperty("highlightColor");
    expect(bodies[1]).not.toHaveProperty("highlightColor");
  });

  it("sends explicit no-highlight and color ids on add requests", async () => {
    await opAddRoom("A301", undefined, highlightForAdd("none"));
    await opAddContainer({
      roomId: "room-1",
      name: "Fridge",
      type: "fridge",
      highlightColor: highlightForAdd("skyBlue"),
    });

    expect(bodies[0]?.highlightColor).toBe("none");
    expect(bodies[1]?.highlightColor).toBe("skyBlue");
  });

  it("uses null for Default and preserves explicit values on edit requests", async () => {
    await opEditRoom("room-1", "A301", "", highlightForEdit("default"));
    await opEditRoom("room-1", "A301", "", highlightForEdit("bluishGreen"));
    await opEditContainer("room-1", "container-1", {
      highlightColor: highlightForEdit("none"),
    });
    await opEditContainer("room-1", "container-1", {
      highlightColor: highlightForEdit("default"),
    });

    expect(bodies.map((body) => body.highlightColor)).toEqual([null, "bluishGreen", "none", null]);
  });
});
