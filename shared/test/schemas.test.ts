import { describe, expect, it } from "vitest";
import {
  BackupSchema,
  ContainerSchema,
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
