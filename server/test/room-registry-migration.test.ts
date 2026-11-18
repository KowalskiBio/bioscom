import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { runRoomRegistryMigration } from "../src/inventory/roomRegistryMigration.js";
import { schemaSqlPath, serverDir } from "../src/paths.js";

const migrationsDir = join(serverDir, "src", "db", "migrations");
const migrationPattern = /^migration_(\d+).*\.sql$/;

type Rec = Record<string, unknown>;
interface Tree {
  rooms: Rec[];
  deepFreezers?: Rec[];
  assetRooms: Rec[];
  assets: Rec[];
  protocols?: Rec[];
  futureRoot?: Rec;
}

let tempDir = "";
let db: Database.Database;

function applyMigrationsThrough(maxVersion: number): void {
  db.exec(readFileSync(schemaSqlPath, "utf8"));
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)",
  );
  const insert = db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)");
  const files = readdirSync(migrationsDir)
    .map((name) => {
      const match = migrationPattern.exec(name);
      return match === null ? null : { name, version: Number(match[1]) };
    })
    .filter((entry): entry is { name: string; version: number } => entry !== null)
    .sort((a, b) => a.version - b.version || a.name.localeCompare(b.name));
  for (const file of files) {
    if (file.version > maxVersion) continue;
    db.exec(readFileSync(join(migrationsDir, file.name), "utf8"));
    insert.run(file.version, file.name, Date.now());
  }
}

function insertDoc(groupId: string, tree: Tree | string): void {
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)").run(
    groupId,
    typeof tree === "string" ? tree : JSON.stringify(tree),
  );
}

function insertInstrument(
  id: string,
  ownerLabId: string | null,
  roomGroupId: string | null,
  roomId: string | null,
  location: string | null,
): void {
  db.prepare(
    "INSERT INTO instruments (id, source, group_id, name, owner_lab_id, room_group_id, room_id, location) VALUES (?, 'shared', NULL, ?, ?, ?, ?, ?)",
  ).run(id, id, ownerLabId, roomGroupId, roomId, location);
}

function readRaw(groupId: string): { raw: string; version: number } {
  const row = db.prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = ?").get(groupId) as {
    tree: string;
    version: number;
  };
  return { raw: row.tree, version: row.version };
}

function readDoc(groupId: string): { raw: string; version: number; tree: Tree } {
  const row = db.prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = ?").get(groupId) as {
    tree: string;
    version: number;
  };
  return { raw: row.tree, version: row.version, tree: JSON.parse(row.tree) as Tree };
}

function readInstrument(id: string): {
  ownerLabId: string | null;
  roomGroupId: string | null;
  roomId: string | null;
  location: string | null;
} {
  return db
    .prepare(
      "SELECT owner_lab_id AS ownerLabId, room_group_id AS roomGroupId, room_id AS roomId, location FROM instruments WHERE id = ?",
    )
    .get(id) as { ownerLabId: string | null; roomGroupId: string | null; roomId: string | null; location: string | null };
}

function find(tree: Tree, collection: "assetRooms" | "assets", id: string): Rec {
  const found = tree[collection].find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`missing ${collection}:${id}`);
  return found;
}

function history(groupId: string): Array<{ user_name: string; action: string }> {
  return db
    .prepare("SELECT user_name, action FROM history WHERE group_id = ? ORDER BY id")
    .all(groupId) as Array<{ user_name: string; action: string }>;
}

function indexNames(table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function count(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function tableExists(name: string): boolean {
  return (
    db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined
  );
}

function syncState(groupId: string): { docVersion: number; syncedAt: number } | undefined {
  if (!tableExists("inventory_sync_state")) return undefined;
  return db
    .prepare("SELECT doc_version AS docVersion, synced_at AS syncedAt FROM inventory_sync_state WHERE group_id = ?")
    .get(groupId) as { docVersion: number; syncedAt: number } | undefined;
}

function seed(): string {
  const corruptRaw = "{this is not valid json";
  insertDoc("group-a", {
    rooms: [
      {
        id: "room-a-main",
        name: "Main Lab",
        containers: [
          {
            id: "cont-a",
            name: "Cabinet A",
            type: "cabinet",
            shelves: [
              { id: "shelf-a", name: "Shelf 1", chemicals: [{ id: "chem-a", name: "Salt", barcode: "STOCK-BC", note: "keep-note" }] },
            ],
          },
        ],
      },
      { id: "room-a-case", name: "Cold Room", containers: [] },
      { id: "room-a-twin-1", name: "Twin Room", containers: [] },
      { id: "room-a-twin-2", name: " twin room ", containers: [] },
    ],
    deepFreezers: [{ id: "df-a", name: "Root Freezer", type: "deepfreezer", shelves: [] }],
    assetRooms: [
      { id: "ar-explicit", name: "Anything", linkedRoomId: "room-a-main" },
      { id: "ar-name", name: "  cold room  " },
      { id: "ar-ambiguous", name: "Twin Room" },
      { id: "ar-blank", name: "   " },
      { id: "ar-missing", name: "Absent Room" },
      { id: "ar-badlink", name: "Cold Room", linkedRoomId: "ghost-room" },
    ],
    assets: [
      { id: "asset-explicit", name: "A1", model: "M1", barcode: "DUP-BC", roomId: "ar-explicit", extra: "keep" },
      { id: "asset-name", name: "A2", barcode: "DUP-BC", roomId: "ar-name" },
      { id: "asset-ambiguous", name: "A3", barcode: "AMBIG-BC", roomId: "ar-ambiguous" },
      { id: "asset-blank", name: "A4", roomId: "ar-blank" },
      { id: "asset-missing", name: "A5", roomId: "ar-missing" },
      { id: "asset-badlink", name: "A6", roomId: "ar-badlink" },
      { id: "asset-canonical", name: "A7", barcode: "CANON-BC", roomId: "room-a-main" },
    ],
    protocols: [{ id: "p1", title: "Keep", content: "keep" }],
    futureRoot: { keep: true, nested: [1, 2] },
  });
  insertDoc("group-b", {
    rooms: [{ id: "room-b-main", name: "Main Lab", containers: [] }],
    deepFreezers: [],
    assetRooms: [{ id: "ar-b", name: "Main Lab" }],
    assets: [{ id: "asset-b", name: "B1", barcode: "B-BC", roomId: "ar-b" }],
    protocols: [],
  });
  insertDoc("group-corrupt", corruptRaw);

  insertInstrument("inst-explicit-valid", "group-a", "group-a", "room-a-main", "keep location");
  insertInstrument("inst-cross-valid", "group-a", "group-b", "room-b-main", "cross location");
  insertInstrument("inst-name-no-pair", "group-a", null, null, "  COLD room ");
  insertInstrument("inst-half", "group-b", "group-b", null, "main lab");
  insertInstrument("inst-null-owner", null, null, null, "Main Lab");
  insertInstrument("inst-stale", "group-a", "group-a", "ghost-room", "Main Lab");
  insertInstrument("inst-ambiguous", "group-a", null, null, "Twin Room");
  insertInstrument("inst-stale-cross", "group-a", "group-b", "ghost-b", "Absent");
  insertInstrument("inst-local-only", "group-b", null, null, "Cold Room");
  return corruptRaw;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "bioscom-room-registry-migration-"));
  db = new Database(join(tempDir, "test.db"));
  applyMigrationsThrough(10);
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("one-time canonical room registry migration", () => {
  it("maps unique same-group names, keeps explicit links, and reports pending ambiguity", () => {
    const corruptRaw = seed();
    const beforeA = readDoc("group-a");
    const beforeB = readDoc("group-b");

    const report = runRoomRegistryMigration(db);

    const afterA = readDoc("group-a");
    const afterB = readDoc("group-b");
    const afterCorrupt = readRaw("group-corrupt");

    expect(afterA.version).toBe(1);
    expect(afterB.version).toBe(1);
    expect(afterCorrupt.version).toBe(0);
    expect(afterCorrupt.raw).toBe(corruptRaw);
    expect(report.anomalies).toContainEqual({ groupId: "group-corrupt", reason: "invalid JSON" });
    expect(report.groupsChanged).toBe(2);
    expect(report.assetsReassigned).toBe(4);
    expect(report.assetsPending).toBe(3);
    expect(report.assetRoomsMappedByLink).toBe(1);
    expect(report.assetRoomsMappedByName).toBe(3);
    expect(report.assetRoomsAmbiguous).toBe(1);
    expect(report.assetRoomsUnmatched).toBe(2);
    expect(report.instrumentsLinkedByName).toBe(3);
    expect(report.instrumentsKept).toBe(2);
    expect(report.instrumentsCleared).toBe(1);
    expect(report.instrumentsAmbiguous).toBe(1);
    expect(report.pendingAmbiguous).toBe(2);

    // Explicit valid link preferred; missing/invalid links use exactly one name.
    expect(find(afterA.tree, "assetRooms", "ar-explicit").linkedRoomId).toBe("room-a-main");
    expect(find(afterA.tree, "assetRooms", "ar-name").linkedRoomId).toBe("room-a-case");
    expect(find(afterA.tree, "assetRooms", "ar-badlink").linkedRoomId).toBe("room-a-case");
    expect(find(afterA.tree, "assetRooms", "ar-ambiguous").linkedRoomId).toBeUndefined();
    expect(find(afterA.tree, "assetRooms", "ar-blank").linkedRoomId).toBeUndefined();
    expect(find(afterA.tree, "assetRooms", "ar-missing").linkedRoomId).toBeUndefined();

    // Only asset.roomId changes; all other properties and duplicate barcodes stay.
    expect(find(afterA.tree, "assets", "asset-explicit")).toMatchObject({
      name: "A1",
      model: "M1",
      barcode: "DUP-BC",
      roomId: "room-a-main",
      extra: "keep",
    });
    expect(find(afterA.tree, "assets", "asset-name")).toMatchObject({ barcode: "DUP-BC", roomId: "room-a-case" });
    expect(afterA.tree.assets.filter((entry) => entry.barcode === "DUP-BC")).toHaveLength(2);
    expect(find(afterA.tree, "assets", "asset-ambiguous").roomId).toBe("ar-ambiguous");
    expect(find(afterA.tree, "assets", "asset-blank").roomId).toBe("ar-blank");
    expect(find(afterA.tree, "assets", "asset-missing").roomId).toBe("ar-missing");
    expect(find(afterA.tree, "assets", "asset-badlink").roomId).toBe("room-a-case");
    expect(find(afterA.tree, "assets", "asset-canonical").roomId).toBe("room-a-main");

    // Rooms, stock hierarchy, barcodes, notes, protocols and future root stay.
    expect(afterA.tree.rooms.map((room) => room.id)).toEqual(beforeA.tree.rooms.map((room) => room.id));
    expect(afterA.tree.rooms.map((room) => room.name)).toEqual(beforeA.tree.rooms.map((room) => room.name));
    expect(afterA.tree.deepFreezers).toEqual(beforeA.tree.deepFreezers);
    expect(afterA.tree.protocols).toEqual(beforeA.tree.protocols);
    expect(afterA.tree.futureRoot).toEqual({ keep: true, nested: [1, 2] });
    expect(afterA.raw).toContain("keep-note");
    expect(afterA.raw).toContain("STOCK-BC");

    // Same name in another lab resolves only inside its own document.
    expect(find(afterB.tree, "assets", "asset-b").roomId).toBe("room-b-main");
    expect(find(afterB.tree, "assetRooms", "ar-b").linkedRoomId).toBe("room-b-main");

    // Instruments: explicit pairs stay, same-lab names resolve, null owners stay
    // null, dangling pairs clear, and no cross-lab name matching happens.
    expect(readInstrument("inst-explicit-valid")).toEqual({
      ownerLabId: "group-a",
      roomGroupId: "group-a",
      roomId: "room-a-main",
      location: "keep location",
    });
    expect(readInstrument("inst-cross-valid")).toEqual({
      ownerLabId: "group-a",
      roomGroupId: "group-b",
      roomId: "room-b-main",
      location: "cross location",
    });
    expect(readInstrument("inst-name-no-pair")).toEqual({
      ownerLabId: "group-a",
      roomGroupId: "group-a",
      roomId: "room-a-case",
      location: "  COLD room ",
    });
    expect(readInstrument("inst-half")).toEqual({
      ownerLabId: "group-b",
      roomGroupId: "group-b",
      roomId: "room-b-main",
      location: "main lab",
    });
    expect(readInstrument("inst-null-owner")).toEqual({
      ownerLabId: null,
      roomGroupId: null,
      roomId: null,
      location: "Main Lab",
    });
    expect(readInstrument("inst-stale")).toEqual({
      ownerLabId: "group-a",
      roomGroupId: "group-a",
      roomId: "room-a-main",
      location: "Main Lab",
    });
    expect(readInstrument("inst-ambiguous")).toEqual({
      ownerLabId: "group-a",
      roomGroupId: null,
      roomId: null,
      location: "Twin Room",
    });
    expect(readInstrument("inst-stale-cross")).toEqual({
      ownerLabId: "group-a",
      roomGroupId: null,
      roomId: null,
      location: "Absent",
    });
    expect(readInstrument("inst-local-only")).toEqual({
      ownerLabId: "group-b",
      roomGroupId: null,
      roomId: null,
      location: "Cold Room",
    });

    // One migration history row per changed group, none for corrupt/unchanged.
    expect(history("group-a")).toHaveLength(1);
    expect(history("group-a")[0]!.user_name).toBe("system");
    expect(history("group-a")[0]!.action).toContain("Room registry migration 0011");
    expect(history("group-b")).toHaveLength(1);
    expect(history("group-corrupt")).toHaveLength(0);

    // In-memory replay does not move data or bump versions/history.
    const stableA = readDoc("group-a");
    const stableB = readDoc("group-b");
    const replay = runRoomRegistryMigration(db);
    expect(replay.groupsChanged).toBe(0);
    expect(replay.assetsReassigned).toBe(0);
    expect(replay.instrumentsChanged).toBe(0);
    expect(readDoc("group-a")).toEqual(stableA);
    expect(readDoc("group-b")).toEqual(stableB);
    expect(readRaw("group-corrupt").raw).toBe(corruptRaw);
    expect(history("group-a")).toHaveLength(1);
    expect(history("group-b")).toHaveLength(1);
  });

  it("preserves instrument links while target/owner documents are unreadable, then resolves only after repair", () => {
    const corruptRaw = "{still not valid json";
    insertDoc("lab-corrupt", corruptRaw);
    insertDoc("lab-other", {
      rooms: [{ id: "other-room", name: "Repaired Room", containers: [] }],
      deepFreezers: [],
      assetRooms: [],
      assets: [],
      protocols: [],
    });

    insertInstrument("inst-corrupt-pair", "lab-corrupt", "lab-corrupt", "room-stale", "Repaired Room");
    insertInstrument("inst-corrupt-half", "lab-corrupt", "lab-corrupt", null, "Repaired Room");
    insertInstrument("inst-missing-target", "lab-other", "lab-missing", "room-ghost", "Repaired Room");
    insertInstrument("inst-half-owner-missing", "lab-missing-owner", "lab-missing-owner", null, "Repaired Room");

    const before = {
      pair: readInstrument("inst-corrupt-pair"),
      half: readInstrument("inst-corrupt-half"),
      missingTarget: readInstrument("inst-missing-target"),
      halfOwnerMissing: readInstrument("inst-half-owner-missing"),
      corruptRaw: readRaw("lab-corrupt").raw,
    };

    const report = runRoomRegistryMigration(db);
    expect(report.instrumentsUnresolved).toBe(4);
    expect(report.instrumentsChanged).toBe(0);
    expect(report.instrumentsLinkedByName).toBe(0);
    expect(report.instrumentsCleared).toBe(0);
    expect(report.unresolved).toEqual(
      expect.arrayContaining([
        { groupId: "lab-corrupt", reason: "instrument target document unavailable" },
        { groupId: "lab-corrupt", reason: "instrument owner document unavailable" },
        { groupId: "lab-missing", reason: "instrument target document unavailable" },
        { groupId: "lab-missing-owner", reason: "instrument owner document unavailable" },
      ]),
    );

    // Unknown/corrupt targets and owners never fall through to stale/null logic.
    expect(readInstrument("inst-corrupt-pair")).toEqual(before.pair);
    expect(readInstrument("inst-corrupt-half")).toEqual(before.half);
    expect(readInstrument("inst-missing-target")).toEqual(before.missingTarget);
    expect(readInstrument("inst-half-owner-missing")).toEqual(before.halfOwnerMissing);
    expect(readRaw("lab-corrupt").raw).toBe(before.corruptRaw);
    expect(history("lab-corrupt")).toHaveLength(0);
    expect(history("lab-other")).toHaveLength(0);
    expect(history("lab-missing")).toHaveLength(0);
    expect(history("lab-missing-owner")).toHaveLength(0);

    // Repair only the owning lab document with a legitimate unique room. The
    // same helper run may now resolve the two rows from that lab.
    const repaired = {
      rooms: [{ id: "room-repaired", name: "Repaired Room", containers: [] }],
      deepFreezers: [],
      assetRooms: [],
      assets: [],
      protocols: [],
    };
    db.prepare("UPDATE group_inventory_docs SET tree = ? WHERE group_id = 'lab-corrupt'").run(
      JSON.stringify(repaired),
    );

    const replay = runRoomRegistryMigration(db);
    expect(replay.instrumentsUnresolved).toBe(2);
    expect(replay.instrumentsChanged).toBe(2);
    expect(replay.instrumentsLinkedByName).toBe(2);
    expect(replay.instrumentsCleared).toBe(0);
    expect(readInstrument("inst-corrupt-pair")).toEqual({
      ownerLabId: "lab-corrupt",
      roomGroupId: "lab-corrupt",
      roomId: "room-repaired",
      location: "Repaired Room",
    });
    expect(readInstrument("inst-corrupt-half")).toEqual({
      ownerLabId: "lab-corrupt",
      roomGroupId: "lab-corrupt",
      roomId: "room-repaired",
      location: "Repaired Room",
    });
    // Same-named room in another lab is never swapped in; unresolved rows stay
    // exactly as they were.
    expect(readInstrument("inst-missing-target")).toEqual(before.missingTarget);
    expect(readInstrument("inst-half-owner-missing")).toEqual(before.halfOwnerMissing);
    expect(readRaw("lab-corrupt")).toEqual({ raw: JSON.stringify(repaired), version: 0 });
    expect(history("lab-corrupt")).toHaveLength(1);
    expect(history("lab-corrupt")[0]!.user_name).toBe("system");
    expect(history("lab-corrupt")[0]!.action).toContain("Room registry migration 0011");
    expect(history("lab-corrupt")[0]!.action).toContain("2 instrument(s)");
    expect(history("lab-other")).toHaveLength(0);

    // Already-resolved rows are stable; unresolved rows remain only pending.
    const stableHistory = history("lab-corrupt");
    const third = runRoomRegistryMigration(db);
    expect(third.instrumentsChanged).toBe(0);
    expect(third.instrumentsLinkedByName).toBe(0);
    expect(third.instrumentsUnresolved).toBe(2);
    expect(readInstrument("inst-corrupt-pair").roomId).toBe("room-repaired");
    expect(readInstrument("inst-corrupt-half").roomId).toBe("room-repaired");
    expect(readInstrument("inst-missing-target")).toEqual(before.missingTarget);
    expect(readInstrument("inst-half-owner-missing")).toEqual(before.halfOwnerMissing);
    expect(history("lab-corrupt")).toEqual(stableHistory);
    expect(readRaw("lab-corrupt").version).toBe(0);
  });

  it("rolls back every source mutation when a late history insert fails, then retries once", () => {
    insertDoc("lab-rollback", {
      rooms: [
        {
          id: "room-a",
          name: "Target Room",
          containers: [
            {
              id: "cont-1",
              name: "Cabinet",
              type: "cabinet",
              shelves: [{ id: "shelf-1", name: "Shelf", chemicals: [{ id: "chem-1", name: "Salt" }] }],
            },
          ],
        },
      ],
      deepFreezers: [],
      assetRooms: [{ id: "ar-1", name: "Target Room" }],
      assets: [{ id: "asset-1", name: "Asset", roomId: "ar-1" }],
      protocols: [],
    });
    insertInstrument("inst-rollback", "lab-rollback", null, null, "Target Room");

    const before = {
      doc: readDoc("lab-rollback"),
      instrument: readInstrument("inst-rollback"),
      locations: count("locations"),
      stocks: count("stocks"),
      materials: count("materials"),
      chemicalMap: count("legacy_chemical_map"),
      history: count("history"),
      syncState: syncState("lab-rollback"),
      historyTable: tableExists("history"),
    };

    db.exec(`CREATE TRIGGER fail_room_registry_history
      BEFORE INSERT ON history
      BEGIN
        SELECT RAISE(ABORT, 'injected history failure');
      END;`);

    expect(() => runRoomRegistryMigration(db)).toThrow(/injected history failure/);

    // A late failure must roll back the already-computed document/mirror/
    // instrument writes; otherwise an identical retry becomes a silent no-op.
    expect(readDoc("lab-rollback")).toEqual(before.doc);
    expect(readInstrument("inst-rollback")).toEqual(before.instrument);
    expect(count("locations")).toBe(before.locations);
    expect(count("stocks")).toBe(before.stocks);
    expect(count("materials")).toBe(before.materials);
    expect(count("legacy_chemical_map")).toBe(before.chemicalMap);
    expect(count("history")).toBe(before.history);
    expect(syncState("lab-rollback")).toBeUndefined();
    expect(tableExists("history")).toBe(before.historyTable);

    db.exec("DROP TRIGGER fail_room_registry_history");

    const retry = runRoomRegistryMigration(db);
    expect(retry.groupsChanged).toBe(1);
    expect(retry.assetsReassigned).toBe(1);
    expect(retry.instrumentsChanged).toBe(1);
    expect(retry.instrumentsLinkedByName).toBe(1);

    const migrated = readDoc("lab-rollback");
    expect(migrated.version).toBe(1);
    expect(find(migrated.tree, "assetRooms", "ar-1").linkedRoomId).toBe("room-a");
    expect(find(migrated.tree, "assets", "asset-1").roomId).toBe("room-a");
    expect(syncState("lab-rollback")).toMatchObject({ docVersion: 1 });
    expect(count("locations")).toBeGreaterThan(before.locations);
    expect(count("stocks")).toBeGreaterThan(before.stocks);
    expect(count("materials")).toBeGreaterThan(before.materials);
    expect(count("legacy_chemical_map")).toBeGreaterThan(before.chemicalMap);
    expect(readInstrument("inst-rollback")).toEqual({
      ownerLabId: "lab-rollback",
      roomGroupId: "lab-rollback",
      roomId: "room-a",
      location: "Target Room",
    });
    expect(history("lab-rollback")).toHaveLength(1);
    expect(history("lab-rollback")[0]!.user_name).toBe("system");
    expect(history("lab-rollback")[0]!.action).toContain("Room registry migration 0011");

    const stable = {
      doc: readDoc("lab-rollback"),
      instrument: readInstrument("inst-rollback"),
      history: history("lab-rollback"),
      syncState: syncState("lab-rollback"),
    };
    const stableReport = runRoomRegistryMigration(db);
    expect(stableReport.groupsChanged).toBe(0);
    expect(stableReport.assetsReassigned).toBe(0);
    expect(stableReport.instrumentsChanged).toBe(0);
    expect(readDoc("lab-rollback")).toEqual(stable.doc);
    expect(readInstrument("inst-rollback")).toEqual(stable.instrument);
    expect(history("lab-rollback")).toEqual(stable.history);
    expect(syncState("lab-rollback")).toEqual(stable.syncState);
  });

  it("registers version 0011 once at startup, adds indexes, and is silent on replay", () => {
    seed();
    const first = runMigrations(db);
    expect(first.map((migration) => migration.version)).toEqual([11]);
    expect(indexNames("locations")).toContain("idx_locations_group_room_name");
    expect(indexNames("instruments")).toContain("idx_instruments_owner_lab");

    const registration = db
      .prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 11 AND name = 'migration_0011_room_registry.sql'")
      .get() as { n: number };
    expect(registration.n).toBe(1);

    const afterFirst = {
      a: readDoc("group-a"),
      b: readDoc("group-b"),
      corrupt: readRaw("group-corrupt"),
      historyA: history("group-a"),
      historyB: history("group-b"),
      instruments: ["inst-name-no-pair", "inst-stale", "inst-stale-cross"].map(readInstrument),
    };

    expect(runMigrations(db)).toEqual([]);
    expect(readDoc("group-a")).toEqual(afterFirst.a);
    expect(readDoc("group-b")).toEqual(afterFirst.b);
    expect(readRaw("group-corrupt")).toEqual(afterFirst.corrupt);
    expect(history("group-a")).toEqual(afterFirst.historyA);
    expect(history("group-b")).toEqual(afterFirst.historyB);
    expect(["inst-name-no-pair", "inst-stale", "inst-stale-cross"].map(readInstrument)).toEqual(
      afterFirst.instruments,
    );
  });
});
