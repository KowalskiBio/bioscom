import { describe, expect, it } from "vitest";
import {
  ContainerGridMoveBodySchema,
  GridLayoutSchema,
  GridMoveBodySchema,
  GridSettingsSchema,
  InventoryTreeSchema,
  MAX_GRID_COLUMNS,
  MAX_GRID_ROWS,
  RoomGridMoveBodySchema,
  RoomSchema,
  autoAssignGridPositions,
  fillFreeGridSlots,
  gridCapacity,
  gridPositionsFitProblem,
  moveGridItem,
  nextFreeGridSlot,
  removeGridItem,
  sortByGridSlot,
} from "../src/index.js";

describe("grid dimensions", () => {
  it("computes capacity as rows times columns", () => {
    expect(gridCapacity(2, 3)).toBe(6);
    expect(gridCapacity(20, 5)).toBe(100);
  });

  it("rejects settings outside 1..20 rows and 1..5 columns", () => {
    expect(GridSettingsSchema.safeParse({ rows: 1, columns: 1 }).success).toBe(true);
    expect(GridSettingsSchema.safeParse({ rows: MAX_GRID_ROWS, columns: MAX_GRID_COLUMNS }).success).toBe(true);
    expect(GridSettingsSchema.safeParse({ rows: 0, columns: 1 }).success).toBe(false);
    expect(GridSettingsSchema.safeParse({ rows: 21, columns: 1 }).success).toBe(false);
    expect(GridSettingsSchema.safeParse({ rows: 1, columns: 0 }).success).toBe(false);
    expect(GridSettingsSchema.safeParse({ rows: 1, columns: 6 }).success).toBe(false);
    expect(GridSettingsSchema.safeParse({ rows: 1.5, columns: 1 }).success).toBe(false);
    expect(GridSettingsSchema.safeParse({ rows: 1 }).success).toBe(false);
  });
});

describe("hide empty slots setting", () => {
  it("accepts optional booleans in settings and persisted layouts", () => {
    expect(GridSettingsSchema.safeParse({ rows: 1, columns: 1, hideEmptySlots: true }).success).toBe(true);
    expect(GridSettingsSchema.safeParse({ rows: 1, columns: 1, hideEmptySlots: false }).success).toBe(true);
    expect(GridSettingsSchema.parse({ rows: 1, columns: 1 }).hideEmptySlots).toBeUndefined();
    expect(GridLayoutSchema.safeParse({ rows: 1, columns: 1, positions: {}, hideEmptySlots: true }).success).toBe(
      true,
    );
    expect(GridLayoutSchema.parse({ rows: 1, columns: 1, positions: {} }).hideEmptySlots).toBeUndefined();
  });

  it("normalizes hideEmptySlots through inventory tree parsing", () => {
    const tree = InventoryTreeSchema.parse({
      rooms: [
        {
          id: "r1",
          name: "Room",
          containerGrid: { rows: 2, columns: 3, positions: { c1: 2 }, hideEmptySlots: true },
        },
      ],
      roomGrid: { rows: 2, columns: 2, positions: { r1: 1 }, hideEmptySlots: false },
    });
    expect(tree.roomGrid?.hideEmptySlots).toBe(false);
    expect(tree.rooms[0]?.containerGrid?.hideEmptySlots).toBe(true);
    expect(tree.rooms[0]?.containerGrid?.positions).toEqual({ c1: 2 });
  });

  it("degrades corrupt persisted hideEmptySlots to no grid", () => {
    const corruptRoomGrid = InventoryTreeSchema.parse({
      rooms: [],
      roomGrid: { rows: 2, columns: 2, positions: {}, hideEmptySlots: "nope" },
    });
    expect(corruptRoomGrid.roomGrid).toBeUndefined();

    const corruptContainerGrid = InventoryTreeSchema.parse({
      rooms: [
        {
          id: "r1",
          name: "Room",
          containerGrid: { rows: 2, columns: 2, positions: {}, hideEmptySlots: 1 },
        },
      ],
    });
    expect(corruptContainerGrid.rooms[0]?.containerGrid).toBeUndefined();
  });

  it("rejects non-boolean hideEmptySlots values", () => {
    expect(GridSettingsSchema.safeParse({ rows: 1, columns: 1, hideEmptySlots: "yes" }).success).toBe(false);
    expect(GridSettingsSchema.safeParse({ rows: 1, columns: 1, hideEmptySlots: 1 }).success).toBe(false);
    expect(
      GridLayoutSchema.safeParse({ rows: 1, columns: 1, positions: {}, hideEmptySlots: "true" }).success,
    ).toBe(false);
  });
});

describe("nextFreeGridSlot", () => {
  it("returns the first gap and null when full", () => {
    expect(nextFreeGridSlot({ a: 0, b: 2 }, 4)).toBe(1);
    expect(nextFreeGridSlot({ a: 0, b: 1, c: 2, d: 3 }, 4)).toBeNull();
    expect(nextFreeGridSlot({}, 3)).toBe(0);
  });
});

describe("gridPositionsFitProblem", () => {
  it("accepts positions that fit, including sparse slots", () => {
    expect(gridPositionsFitProblem({ a: 0, b: 3 }, 2, 2)).toBeNull();
    expect(gridPositionsFitProblem({}, 1, 1)).toBeNull();
  });

  it("flags out-of-range slots", () => {
    expect(gridPositionsFitProblem({ a: 4 }, 2, 2)).toContain("slot 4");
    expect(gridPositionsFitProblem({ a: 4 }, 2, 2)).toContain("ends at 3");
  });

  it("flags duplicate and invalid slots", () => {
    expect(gridPositionsFitProblem({ a: 1, b: 1 }, 2, 2)).toContain("claimed by both");
    expect(gridPositionsFitProblem({ a: -1 }, 2, 2)).toContain("invalid slot");
    expect(gridPositionsFitProblem({ a: 1.5 }, 2, 2)).toContain("invalid slot");
  });
});

describe("moveGridItem", () => {
  it("moves to a free slot without mutating the input", () => {
    const before = { a: 0, b: 1 };
    const after = moveGridItem(before, "a", 2);
    expect(after).toEqual({ a: 2, b: 1 });
    expect(before).toEqual({ a: 0, b: 1 });
  });

  it("swaps when the target is occupied", () => {
    expect(moveGridItem({ a: 0, b: 1 }, "a", 1)).toEqual({ a: 1, b: 0 });
  });

  it("moves an unpositioned item into an occupied slot and evicts the occupant", () => {
    expect(moveGridItem({ b: 1 }, "a", 1)).toEqual({ a: 1 });
  });

  it("assigns a previously unpositioned item to a free slot", () => {
    expect(moveGridItem({ b: 1 }, "a", 0)).toEqual({ a: 0, b: 1 });
  });
});

describe("removeGridItem", () => {
  it("removes an id and leaves the input untouched", () => {
    const before = { a: 0, b: 1 };
    expect(removeGridItem(before, "a")).toEqual({ b: 1 });
    expect(removeGridItem(before, "missing")).toEqual({ a: 0, b: 1 });
    expect(before).toEqual({ a: 0, b: 1 });
  });
});

describe("autoAssignGridPositions", () => {
  it("assigns sequential row-major slots in array order", () => {
    expect(autoAssignGridPositions(["a", "b", "c"], 6)).toEqual({ a: 0, b: 1, c: 2 });
  });

  it("leaves overflow items unpositioned instead of failing", () => {
    expect(autoAssignGridPositions(["a", "b", "c"], 2)).toEqual({ a: 0, b: 1 });
    expect(autoAssignGridPositions(["a"], 0)).toEqual({});
  });
});

describe("fillFreeGridSlots", () => {
  it("fills first free slots in item order while preserving existing positions", () => {
    expect(fillFreeGridSlots(["a", "b", "c", "d"], { a: 2 }, 6)).toEqual({ a: 2, b: 0, c: 1, d: 3 });
    expect(fillFreeGridSlots(["a", "b", "c"], { a: 0, b: 2 }, 4)).toEqual({ a: 0, b: 2, c: 1 });
  });

  it("is a no-op when every item is already positioned", () => {
    const before = { a: 0, b: 1 };
    expect(fillFreeGridSlots(["a", "b"], before, 6)).toEqual(before);
    expect(before).toEqual({ a: 0, b: 1 });
  });

  it("stops when capacity is reached and leaves the rest unpositioned", () => {
    expect(fillFreeGridSlots(["a", "b", "c"], { a: 0 }, 2)).toEqual({ a: 0, b: 1 });
    expect(fillFreeGridSlots(["a"], {}, 0)).toEqual({});
  });
});

describe("sortByGridSlot", () => {
  it("orders positioned items by slot and keeps unpositioned items after them", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const sorted = sortByGridSlot(items, { a: 2, c: 0 });
    expect(sorted.map((item) => item.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("returns the array order when no grid positions exist", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(sortByGridSlot(items, undefined).map((item) => item.id)).toEqual(["a", "b"]);
    expect(sortByGridSlot(items, {}).map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("grid document schemas", () => {
  it("accepts persisted room and container grids", () => {
    const tree = InventoryTreeSchema.parse({
      rooms: [{ id: "r1", name: "Room", containerGrid: { rows: 2, columns: 3, positions: { c1: 0, c2: 4 } } }],
      roomGrid: { rows: 2, columns: 2, positions: { r1: 0 } },
    });
    expect(tree.roomGrid).toEqual({ rows: 2, columns: 2, positions: { r1: 0 } });
    expect(tree.rooms[0]?.containerGrid).toEqual({ rows: 2, columns: 3, positions: { c1: 0, c2: 4 } });
  });

  it("degrades missing, null and corrupt grid metadata to no grid", () => {
    const missing = InventoryTreeSchema.parse({ rooms: [] });
    expect(missing.roomGrid).toBeUndefined();

    const nulled = InventoryTreeSchema.parse({ rooms: [], roomGrid: null });
    expect(nulled.roomGrid).toBeUndefined();

    const corruptRows = InventoryTreeSchema.parse({
      rooms: [],
      roomGrid: { rows: 0, columns: 2, positions: {} },
    });
    expect(corruptRows.roomGrid).toBeUndefined();

    const corruptPositions = InventoryTreeSchema.parse({
      rooms: [],
      roomGrid: { rows: 2, columns: 2, positions: { r1: -1 } },
    });
    expect(corruptPositions.roomGrid).toBeUndefined();

    const room = RoomSchema.parse({ id: "r1", name: "Room", containerGrid: { rows: 2 } });
    expect(room.containerGrid).toBeUndefined();
  });

  it("rejects grid layouts with more than five columns or twenty rows", () => {
    expect(GridLayoutSchema.safeParse({ rows: 1, columns: 6, positions: {} }).success).toBe(false);
    expect(GridLayoutSchema.safeParse({ rows: 21, columns: 1, positions: {} }).success).toBe(false);
    expect(GridLayoutSchema.safeParse({ rows: 1, columns: 5, positions: {} }).success).toBe(true);
  });
});

describe("grid move body schemas", () => {
  it("parses room, container and generic move bodies", () => {
    expect(RoomGridMoveBodySchema.safeParse({ roomId: "r1", slot: 0 }).success).toBe(true);
    expect(ContainerGridMoveBodySchema.safeParse({ containerId: "c1", slot: 3 }).success).toBe(true);
    expect(GridMoveBodySchema.safeParse({ itemId: "x", slot: 2 }).success).toBe(true);
  });

  it("rejects negative or fractional slots and missing ids", () => {
    expect(RoomGridMoveBodySchema.safeParse({ roomId: "r1", slot: -1 }).success).toBe(false);
    expect(RoomGridMoveBodySchema.safeParse({ roomId: "r1", slot: 1.5 }).success).toBe(false);
    expect(ContainerGridMoveBodySchema.safeParse({ containerId: "", slot: 0 }).success).toBe(false);
    expect(GridMoveBodySchema.safeParse({ slot: 0 }).success).toBe(false);
  });
});
