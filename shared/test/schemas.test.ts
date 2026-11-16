import { describe, expect, it } from "vitest";
import {
  BackupSchema,
  ContainerSchema,
  DEFAULT_RACK_COLUMNS,
  DEFAULT_RACK_ROWS,
  DEFAULT_RACK_SHELVES,
  MAX_RACK_COLUMNS,
  MAX_RACK_ROWS,
  MAX_RACK_SHELVES,
  AddAssetRoomBodySchema,
  AddDeepFreezerBodySchema,
  AssetRoomSchema,
  EditAssetRoomBodySchema,
  MoveDeepFreezerBoxBodySchema,
  ResizeDeepFreezerBodySchema,
  GameChallengeSchema,
  GroupSchema,
  HistoryEntrySchema,
  InstrumentSchema,
  InventoryTreeSchema,
  LegacyGroupDocSchema,
  NoticeSchema,
  PrintCatalogItemSchema,
  PrintRequestSchema,
  RoomSchema,
  SandboxTreeSchema,
  SharedContainerRefSchema,
  UserSchema,
  nextFreeRackSlot,
  nextFreeRackShelf,
  rackPositionsFitProblem,
  rackShelfFitProblem,
  resolveRackGrid,
  resolveRackShelfIndex,
  resolveRackShelves,
} from "../src/index.js";
import {
  backupFixture,
  cabinetContainerFixture,
  chessChallengeFixture,
  chemicalPositionAA1Fixture,
  frogChallengeFixture,
  groupFixture,
  historyEmailUserFixture,
  historyNameUserFixture,
  instrumentFixture,
  instrumentWithKeyedBookingsFixture,
  inventoryTreeFixture,
  noticeFixture,
  noticeWithKeyedReactionsFixture,
  printCatalogItemFixture,
  printRequestFixture,
  roomFixture,
  roomWithoutContainersFixture,
  sharedContainerFixture,
  userFixtures,
  userWithJunkRoleFixture,
} from "./fixtures.js";

describe("UserSchema", () => {
  it("accepts admin, reader and superadmin profiles", () => {
    for (const user of userFixtures) {
      expect(UserSchema.safeParse(user).success).toBe(true);
    }
  });

  it("falls back to reader for a junk role value", () => {
    const result = UserSchema.parse(userWithJunkRoleFixture);
    expect(result.role).toBe("reader");
  });
});

describe("GroupSchema", () => {
  it("accepts a group with join code and creation time", () => {
    const result = GroupSchema.parse(groupFixture);
    expect(result.joinCode).toBe("BIOS-572");
    expect(result.created).toBe(1779197448211);
  });
});

describe("HistoryEntrySchema", () => {
  it("accepts a user name", () => {
    expect(HistoryEntrySchema.safeParse(historyNameUserFixture).success).toBe(true);
  });

  it("accepts a legacy email fallback as the user field", () => {
    expect(HistoryEntrySchema.safeParse(historyEmailUserFixture).success).toBe(true);
  });
});

describe("ContainerSchema", () => {
  it("rejects a container missing shelves and reports the error path", () => {
    const { shelves: _shelves, ...withoutShelves } = cabinetContainerFixture;
    const result = ContainerSchema.safeParse(withoutShelves);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "shelves")).toBe(true);
    }
  });

  it("preserves unknown legacy fields through passthrough", () => {
    const result = ContainerSchema.parse({
      ...sharedContainerFixture,
      isSharedAsset: true,
      originalRoomName: "Cold Room",
    });
    expect(result.isSharedAsset).toBe(true);
    expect(result.originalRoomName).toBe("Cold Room");
  });

  it("accepts the AA1 sequential box position code", () => {
    const shelf = { id: "shelf-x", name: "Shelf 1", chemicals: [chemicalPositionAA1Fixture] };
    const result = ContainerSchema.safeParse({ ...cabinetContainerFixture, shelves: [shelf] });
    expect(result.success).toBe(true);
  });
});

describe("SharedContainerRefSchema", () => {
  it("accepts a shared container reference addressed by group ids", () => {
    const result = SharedContainerRefSchema.safeParse(sharedContainerFixture);
    expect(result.success).toBe(true);
  });

  it("rejects a shared container reference without an owner group", () => {
    const { ownerGroupId: _owner, ...withoutOwner } = sharedContainerFixture;
    expect(SharedContainerRefSchema.safeParse(withoutOwner).success).toBe(false);
  });
});

describe("InventoryTreeSchema", () => {
  it("parses the full hand-built tree", () => {
    const result = InventoryTreeSchema.parse(inventoryTreeFixture);
    expect(result.rooms).toHaveLength(2);
    expect(result.rooms[1]?.containers).toHaveLength(3);
  });

  it("normalizes an index-keyed legacy rooms object into an array", () => {
    const keyed = { rooms: { "0": roomFixture } };
    const result = InventoryTreeSchema.parse(keyed);
    expect(Array.isArray(result.rooms)).toBe(true);
    expect(result.rooms).toHaveLength(1);
  });

  it("defaults missing collections to empty arrays", () => {
    const result = InventoryTreeSchema.parse({ protocols: [] });
    expect(result.rooms).toEqual([]);
    expect(result.printCatalog).toEqual([]);
  });

  it("keeps cabinet shelf names with en dashes verbatim", () => {
    const result = InventoryTreeSchema.parse(inventoryTreeFixture);
    expect(result.rooms[1]?.containers[0]?.shelves.map((shelf) => shelf.name)).toEqual([
      "Shelf A–D",
      "Shelf E–L",
      "Shelf M–P",
      "Shelf Q–Z",
      "Bottom shelf",
    ]);
  });

  it("parses a sandbox tree with the same schema", () => {
    expect(SandboxTreeSchema.safeParse(inventoryTreeFixture).success).toBe(true);
  });
});

describe("RoomSchema", () => {
  it("tolerates a room without containers", () => {
    const result = RoomSchema.parse(roomWithoutContainersFixture);
    expect(result.containers).toEqual([]);
  });
});

describe("AssetRoomSchema linkedRoomId", () => {
  it("keeps legacy asset rooms without a link", () => {
    const result = AssetRoomSchema.parse({ id: "ar-2", name: "Main Hall" });
    expect(result.linkedRoomId).toBeUndefined();
  });

  it("accepts a stable linked room id and an explicit null", () => {
    expect(AssetRoomSchema.parse({ id: "ar-2", name: "Main Hall", linkedRoomId: "room-1" }).linkedRoomId).toBe(
      "room-1",
    );
    expect(AssetRoomSchema.parse({ id: "ar-2", name: "Main Hall", linkedRoomId: null }).linkedRoomId).toBeNull();
  });
});

describe("asset room body links", () => {
  it("keeps legacy create and update bodies valid", () => {
    expect(AddAssetRoomBodySchema.safeParse({ name: "Main Hall" }).success).toBe(true);
    expect(EditAssetRoomBodySchema.safeParse({ name: "Main Hall" }).success).toBe(true);
  });

  it("accepts a create link and update set/clear without dropping nulls", () => {
    expect(AddAssetRoomBodySchema.safeParse({ name: "Main Hall", linkedRoomId: "room-1" }).success).toBe(true);
    expect(AddAssetRoomBodySchema.safeParse({ name: "Main Hall", linkedRoomId: null }).success).toBe(true);
    expect(EditAssetRoomBodySchema.parse({ linkedRoomId: "room-1" }).linkedRoomId).toBe("room-1");
    expect(EditAssetRoomBodySchema.parse({ linkedRoomId: null }).linkedRoomId).toBeNull();
  });

  it("rejects an empty update and an empty linked id", () => {
    expect(EditAssetRoomBodySchema.safeParse({}).success).toBe(false);
    expect(EditAssetRoomBodySchema.safeParse({ linkedRoomId: "" }).success).toBe(false);
    expect(AddAssetRoomBodySchema.safeParse({ name: "Main Hall", linkedRoomId: "" }).success).toBe(false);
  });
});

describe("deep freezer rack grid helpers", () => {
  it("defaults missing dimensions to the legacy 8x4 32-slot grid", () => {
    expect(resolveRackGrid({})).toEqual({
      rows: DEFAULT_RACK_ROWS,
      columns: DEFAULT_RACK_COLUMNS,
      capacity: 32,
    });
    expect(resolveRackGrid({ rackRows: null, rackColumns: null }).capacity).toBe(32);
  });

  it("preserves valid larger dimensions and accepts the shared maxima", () => {
    expect(resolveRackGrid({ rackRows: 16, rackColumns: 8 })).toEqual({ rows: 16, columns: 8, capacity: 128 });
    expect(resolveRackGrid({ rackRows: MAX_RACK_ROWS, rackColumns: MAX_RACK_COLUMNS }).capacity).toBe(
      MAX_RACK_ROWS * MAX_RACK_COLUMNS,
    );
  });

  it("accepts the container schema with optional rack dimensions", () => {
    const result = ContainerSchema.parse({ ...cabinetContainerFixture, rackRows: 4, rackColumns: 6 });
    expect(result.rackRows).toBe(4);
    expect(result.rackColumns).toBe(6);
  });

  it("finds the first free slot and reports full grids", () => {
    expect(nextFreeRackSlot({ A: 0, B: 2 }, 4)).toBe(1);
    expect(nextFreeRackSlot({ A: 0, B: 1 }, 2)).toBeNull();
  });

  it("reports fit problems without dropping or renumbering placements", () => {
    const positions = { A: 0, B: 3, C: 5 };
    expect(rackPositionsFitProblem(positions, 6)).toBeNull();
    expect(rackPositionsFitProblem(positions, 4)).toContain('rack "C" uses slot 5');
    expect(rackPositionsFitProblem({ A: 0, B: 0 }, 4)).toContain("slot 0 is claimed by both");
    expect(rackPositionsFitProblem({ A: -1 }, 4)).toContain("invalid slot -1");
    expect(positions).toEqual({ A: 0, B: 3, C: 5 });
  });
});

describe("deep freezer rack shelf helpers", () => {
  it("defaults missing shelf counts to 13 and preserves explicit valid values", () => {
    expect(resolveRackShelves({})).toBe(DEFAULT_RACK_SHELVES);
    expect(resolveRackShelves({ rackShelves: null })).toBe(13);
    expect(resolveRackShelves({ rackShelves: 21 })).toBe(21);
    expect(resolveRackShelves({ rackShelves: MAX_RACK_SHELVES })).toBe(MAX_RACK_SHELVES);
    expect(resolveRackShelves({ rackShelves: MAX_RACK_SHELVES + 1 })).toBe(DEFAULT_RACK_SHELVES);
  });

  it("resolves explicit assignments and falls back only for numeric legacy box names", () => {
    expect(resolveRackShelfIndex({ rackShelf: 5, boxName: "1" })).toBe(5);
    expect(resolveRackShelfIndex({ boxName: "7" })).toBe(7);
    expect(resolveRackShelfIndex({ boxName: " 12 " })).toBe(12);
    expect(resolveRackShelfIndex({ boxName: "custom-B" })).toBeNull();
    expect(resolveRackShelfIndex({ boxName: "0" })).toBeNull();
    expect(resolveRackShelfIndex({ rackShelf: 0, boxName: "7" })).toBeNull();
    expect(resolveRackShelfIndex({ rackShelf: null, boxName: "2" })).toBe(2);
  });

  it("finds the first free one-based shelf without borrowing other racks", () => {
    const shelves = [
      { rackName: "A", rackShelf: 1 },
      { rackName: "A", boxName: "2" },
      { rackName: "B", rackShelf: 1 },
    ];
    expect(nextFreeRackShelf(shelves, "A", 3)).toBe(3);
    expect(nextFreeRackShelf(shelves, "B", 3)).toBe(2);
    expect(nextFreeRackShelf(shelves, "A", 2)).toBeNull();
    expect(nextFreeRackShelf([{ rackName: "A", boxName: "custom" }], "A", 1)).toBe(1);
  });

  it("validates shelf fit per rack, counting unindexed boxes toward quantity", () => {
    const perRack = [
      { rackName: "A", rackShelf: 1 },
      { rackName: "A", rackShelf: 2 },
      { rackName: "B", rackShelf: 1 },
      { rackName: "B", rackShelf: 2 },
    ];
    expect(rackShelfFitProblem(perRack, 2)).toBeNull();
    expect(rackShelfFitProblem(perRack, 1)).toContain('rack "A" has 2 boxes');

    expect(rackShelfFitProblem([{ rackName: "A", rackShelf: 4 }], 3)).toContain("uses shelf 4");
    expect(rackShelfFitProblem([{ rackName: "A", rackShelf: 0 }], 3)).toContain("has invalid shelf 0");
    expect(rackShelfFitProblem([{ rackName: "A", rackShelf: 1.5 }], 3)).toContain("has invalid shelf 1.5");
    expect(
      rackShelfFitProblem(
        [
          { rackName: "A", rackShelf: 2 },
          { rackName: "A", boxName: "2" },
        ],
        3,
      ),
    ).toContain("claimed by both");
    expect(
      rackShelfFitProblem(
        [
          { rackName: "A", boxName: "custom-1" },
          { rackName: "A", boxName: "custom-2" },
        ],
        1,
      ),
    ).toContain("2 boxes");
    expect(
      rackShelfFitProblem(
        [
          { rackName: "A", boxName: "custom-1" },
          { rackName: "A", rackShelf: 1 },
        ],
        2,
      ),
    ).toBeNull();
  });

  it("accepts rackShelves on freezer create/resize and requires a one-based move shelf", () => {
    expect(AddDeepFreezerBodySchema.safeParse({ name: "DF", rackShelves: 13 }).success).toBe(true);
    expect(AddDeepFreezerBodySchema.safeParse({ name: "DF", rackShelves: 0 }).success).toBe(false);
    expect(AddDeepFreezerBodySchema.safeParse({ name: "DF", rackShelves: MAX_RACK_SHELVES + 1 }).success).toBe(false);
    expect(ResizeDeepFreezerBodySchema.safeParse({ rackRows: 2, rackColumns: 2, rackShelves: 5 }).success).toBe(true);
    expect(ResizeDeepFreezerBodySchema.safeParse({ rackRows: 2, rackColumns: 2 }).success).toBe(true);
    expect(MoveDeepFreezerBoxBodySchema.safeParse({ shelf: 1 }).success).toBe(true);
    expect(MoveDeepFreezerBoxBodySchema.safeParse({ shelf: 0 }).success).toBe(false);
    expect(MoveDeepFreezerBoxBodySchema.safeParse({}).success).toBe(false);
  });

  it("accepts rackShelves and rackShelf on the container schema", () => {
    const parsed = ContainerSchema.parse({
      ...cabinetContainerFixture,
      rackShelves: 5,
      shelves: [{ id: "box-1", name: "Box", rackName: "A", boxName: "1", rackShelf: 4 }],
    });
    expect(parsed.rackShelves).toBe(5);
    expect(parsed.shelves[0]!.rackShelf).toBe(4);
  });
});

describe("BackupSchema", () => {
  it("keeps the raw snapshot payload", () => {
    const result = BackupSchema.parse(backupFixture);
    expect(result.timestamp).toBe(1760000099999);
    expect(result.data).toEqual({ rooms: [], assets: [], protocols: [] });
  });
});

describe("NoticeSchema", () => {
  it("parses a notice with a reactions array", () => {
    const result = NoticeSchema.parse(noticeFixture);
    expect(result.reactions).toHaveLength(1);
    expect(result.reactions[0]?.text).toBe("👍");
  });

  it("normalizes push-keyed reactions into an array", () => {
    const result = NoticeSchema.parse(noticeWithKeyedReactionsFixture);
    expect(result.reactions).toHaveLength(1);
    expect(result.reactions[0]?.id).toBe("react-1");
  });
});

describe("InstrumentSchema", () => {
  it("parses bookings stored as an array", () => {
    const result = InstrumentSchema.parse(instrumentFixture);
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0]?.date).toBe("2026-05-21");
  });

  it("normalizes push-keyed bookings into an array", () => {
    const result = InstrumentSchema.parse(instrumentWithKeyedBookingsFixture);
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0]?.startTime).toBe("09:00");
  });
});

describe("print schemas", () => {
  it("parses catalog items and requests including Czech strings", () => {
    expect(PrintCatalogItemSchema.parse(printCatalogItemFixture).name).toBe("Stojan na zkumavky");
    expect(PrintRequestSchema.parse(printRequestFixture).status).toBe("rejected");
  });
});

describe("GameChallengeSchema", () => {
  it("parses a completed frog quiz", () => {
    const result = GameChallengeSchema.parse(frogChallengeFixture);
    expect(result.gameType).toBe("frog");
    expect(result.frogScores?.["uid-reader-1"]).toBe(5);
  });

  it("parses an active biochemical chess game with board state", () => {
    const result = GameChallengeSchema.parse(chessChallengeFixture);
    expect(result.gameType).toBe("chess");
    expect(result.turn).toBe("white");
    expect(result.board?.[0]).toEqual(["r", "n", "b", "q", "k", "b", "", "r"]);
  });

  it("rejects a challenge without a game type", () => {
    const { gameType: _type, ...withoutType } = frogChallengeFixture;
    expect(GameChallengeSchema.safeParse(withoutType).success).toBe(false);
  });
});

describe("LegacyGroupDocSchema", () => {
  it("defaults every collection to an empty array on junk input", () => {
    const result = LegacyGroupDocSchema.parse({ junk: true });
    expect(result.rooms).toEqual([]);
    expect(result.instruments).toEqual([]);
  });
});
