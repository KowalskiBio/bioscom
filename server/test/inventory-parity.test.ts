import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { getDatabase, closeDatabase } from "../src/db.js";
import { DEFAULT_RACK_COLUMNS, DEFAULT_RACK_ROWS, resolveRackGrid } from "@bioscom/shared";
import { syncGroupInventoryDocument } from "../src/inventory/sync.js";
import { assembleInventoryFromRelational, checkParity, ensureParityChecked } from "../src/inventory/assemble.js";

let db: Database.Database;

function buildTree() {
  return {
    rooms: [
      {
        id: "room-1",
        name: "Alpha",
        description: "first room",
        containers: [
          {
            id: "cab-1",
            name: "Cabinet 1",
            type: "cabinet",
            emoji: "🗄️",
            description: "wood",
            sharedWithGroupIds: ["group-b"],
            shelves: [
              {
                id: "shelf-a",
                name: "A",
                isRangeShelf: true,
                rangeStart: "A",
                rangeEnd: "M",
                chemicals: [
                  {
                    id: "ch-1",
                    name: "Tris base",
                    cas: "77-86-1",
                    formula: "C4H11NO3",
                    quantity: 250,
                    unit: "g",
                    concentration: 1,
                    concUnit: "M",
                    position: "A1",
                    customPosition: "CP-9",
                    _shelfOverride: "SO-3",
                    note: "molecular grade",
                    supplierHint: "Sigma",
                  },
                ],
              },
              { id: "shelf-b", name: "B", chemicals: [] },
            ],
          },
          {
            id: "fr-1",
            name: "Fridge 1",
            type: "fridge",
            sharedWithGroupIds: [],
            shelves: [
              {
                id: "shelf-c",
                name: "C",
                color: "#ff0000",
                chemicals: [
                  {
                    id: "ch-2",
                    name: "Anti-GAPDH",
                    type: "antibody",
                    attributes: { target: "GAPDH", host_species: "Rabbit" },
                    product: { manufacturer: "Sigma", catalogNumber: "AB-001" },
                    batchInfo: { lotCode: "LOT-77", originType: "purchased", expiresAt: 1893456000000 },
                    quantity: 80,
                    unit: "uL",
                  },
                ],
              },
            ],
          },
          {
            id: "df-1",
            name: "Deep Freezer",
            type: "deepfreezer",
            sharedWithGroupIds: [],
            rackPositions: { A: 8, B: 4 },
            shelves: [
              {
                id: "shelf-df",
                name: "Rack A / Box 1",
                rackName: "A",
                boxName: "1",
                color: "#3b82f6",
                chemicals: [{ id: "ch-3", name: "E. coli DH5a stock", position: "A1" }],
              },
            ],
          },
        ],
      },
      { id: "room-2", name: "Empty room", containers: [] },
    ],
  };
}

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-parity-test-"));
  db = getDatabase(join(dir, "test.db"));
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-a', ?, 0)").run(
    JSON.stringify(buildTree()),
  );
});

afterAll(() => {
  closeDatabase();
});

describe("relational assembly ↔ document parity", () => {
  it("a freshly synced tree reassembles to full parity", () => {
    const tree = buildTree();
    syncGroupInventoryDocument(db, "group-a", tree as never);
    expect(checkParity(db, "group-a")).toEqual([]);
  });

  it("round-trip preserves chemical descriptors, product, batchInfo and legacy extras", () => {
    const assembled = assembleInventoryFromRelational(db, "group-a");
    const shelf = assembled.rooms[0]!.containers[0]!.shelves[0]!;
    const tris = shelf.chemicals[0]!;
    expect(tris.cas).toBe("77-86-1");
    expect(tris.formula).toBe("C4H11NO3");
    expect(tris.quantity).toBe(250);
    expect(tris.customPosition).toBe("CP-9");
    expect((tris as unknown as Record<string, unknown>).supplierHint).toBe("Sigma");
    const fr = assembled.rooms[0]!.containers[1]!.shelves[0]!.chemicals[0]!;
    expect(fr.type).toBe("antibody");
    expect(fr.attributes).toMatchObject({ target: "GAPDH", host_species: "Rabbit" });
    expect(fr.product).toMatchObject({ manufacturer: "Sigma", catalogNumber: "AB-001" });
    expect(fr.batchInfo).toMatchObject({ lotCode: "LOT-77", originType: "purchased", expiresAt: 1893456000000 });
    const df = assembled.deepFreezers?.[0];
    expect(df).toBeDefined();
    expect(df!.rackPositions).toEqual({ A: 8, B: 4 });
    expect(df!.shelves[0]!.rackName).toBe("A");
    expect(df!.shelves[0]!.boxName).toBe("1");
  });

  it("round-trips custom grid dimensions and normalizes legacy defaults on both sides", () => {
    const tree = buildTree() as unknown as { rooms: Array<{ containers: Array<Record<string, unknown>> }> };
    const df = tree.rooms[0]!.containers[2]!;
    df.rackRows = 4;
    df.rackColumns = 8;
    db.prepare("INSERT OR REPLACE INTO group_inventory_docs (group_id, tree, version) VALUES ('group-a', ?, 1)").run(
      JSON.stringify(tree),
    );
    syncGroupInventoryDocument(db, "group-a", tree as never);
    const row = db.prepare("SELECT rack_rows, rack_columns FROM locations WHERE id = 'df-1'").get() as {
      rack_rows: number | null;
      rack_columns: number | null;
    };
    expect(row).toEqual({ rack_rows: 4, rack_columns: 8 });
    const assembled = assembleInventoryFromRelational(db, "group-a");
    expect(assembled.deepFreezers?.[0]?.rackRows).toBe(4);
    expect(assembled.deepFreezers?.[0]?.rackColumns).toBe(8);
    expect(checkParity(db, "group-a")).toEqual([]);

    const legacy = buildTree();
    db.prepare("INSERT OR REPLACE INTO group_inventory_docs (group_id, tree, version) VALUES ('group-a', ?, 2)").run(
      JSON.stringify(legacy),
    );
    syncGroupInventoryDocument(db, "group-a", legacy as never);
    const legacyAssembled = assembleInventoryFromRelational(db, "group-a");
    const legacyFreezer = legacyAssembled.deepFreezers?.[0]!;
    expect(legacyFreezer.rackRows).toBeUndefined();
    expect(legacyFreezer.rackColumns).toBeUndefined();
    expect(resolveRackGrid(legacyFreezer)).toEqual({
      rows: DEFAULT_RACK_ROWS,
      columns: DEFAULT_RACK_COLUMNS,
      capacity: DEFAULT_RACK_ROWS * DEFAULT_RACK_COLUMNS,
    });
    expect(checkParity(db, "group-a")).toEqual([]);
  });

  it("normalizes legacy rack shelf metadata without rewriting relational NULLs", () => {
    const legacy = buildTree();
    db.prepare("INSERT OR REPLACE INTO group_inventory_docs (group_id, tree, version) VALUES ('group-a', ?, 3)").run(
      JSON.stringify(legacy),
    );
    syncGroupInventoryDocument(db, "group-a", legacy as never);

    const row = db
      .prepare("SELECT rack_shelves, shelf_index FROM locations WHERE id = 'df-1'")
      .get() as { rack_shelves: number | null; shelf_index: number | null };
    expect(row).toEqual({ rack_shelves: null, shelf_index: null });
    const boxRow = db
      .prepare("SELECT rack_shelves, shelf_index FROM locations WHERE id = 'shelf-df'")
      .get() as { rack_shelves: number | null; shelf_index: number | null };
    expect(boxRow).toEqual({ rack_shelves: null, shelf_index: null });

    const assembled = assembleInventoryFromRelational(db, "group-a");
    const freezer = assembled.deepFreezers?.[0]!;
    expect(freezer.rackShelves).toBe(13);
    expect(freezer.shelves[0]!.rackShelf).toBe(1);
    expect(freezer.shelves[0]!.boxName).toBe("1");
    expect(checkParity(db, "group-a")).toEqual([]);
  });

  it("round-trips rack shelves and assignment while leaving custom box names unindexed", () => {
    const tree = buildTree() as unknown as {
      rooms: Array<{ containers: Array<Record<string, unknown>> }>;
    };
    const df = tree.rooms[0]!.containers[2]!;
    df.rackShelves = 5;
    const shelves = df.shelves as Array<Record<string, unknown>>;
    shelves[0]!.rackShelf = 4;
    shelves[0]!.boxName = "custom-A";
    shelves.push({ id: "shelf-df-2", name: "Rack A / Box X", rackName: "A", boxName: "custom-B", chemicals: [] });
    db.prepare("INSERT OR REPLACE INTO group_inventory_docs (group_id, tree, version) VALUES ('group-a', ?, 4)").run(
      JSON.stringify(tree),
    );
    syncGroupInventoryDocument(db, "group-a", tree as never);

    const assembled = assembleInventoryFromRelational(db, "group-a");
    const freezer = assembled.deepFreezers?.[0]!;
    expect(freezer.rackShelves).toBe(5);
    expect(freezer.shelves.map((shelf) => shelf.rackShelf)).toEqual([4, undefined]);
    expect(freezer.shelves.map((shelf) => shelf.boxName)).toEqual(["custom-A", "custom-B"]);
    const rows = db
      .prepare("SELECT shelf_index FROM locations WHERE id IN ('shelf-df', 'shelf-df-2') ORDER BY id")
      .all() as Array<{ shelf_index: number | null }>;
    expect(rows.map((entry) => entry.shelf_index)).toEqual([4, null]);
    expect(checkParity(db, "group-a")).toEqual([]);
  });

  it("flags tampered relational rows as mismatches", () => {
    db.prepare("DELETE FROM stocks WHERE id = 'ch-1'").run();
    const issues = checkParity(db, "group-a");
    expect(issues.some((i) => i.kind === "missing-in-relational" && i.entity === "chemical" && i.id === "ch-1")).toBe(true);
    db.prepare("UPDATE locations SET name = 'Tampered' WHERE id = 'cab-1'").run();
    const renamed = checkParity(db, "group-a");
    expect(renamed.some((i) => i.kind === "different" && i.entity === "container" && i.id === "cab-1")).toBe(true);
    db.prepare("INSERT INTO materials (id, group_id, type_key, name, created_at, updated_at) VALUES ('m-ghost','group-a','chemical','Ghost',1,1)").run();
    db.prepare("INSERT INTO batches (id, material_id, created_at, updated_at) VALUES ('b-ghost','m-ghost',1,1)").run();
    db.prepare(
      "INSERT INTO stocks (id, group_id, batch_id, location_id, created_at, updated_at) VALUES ('ch-ghost','group-a','b-ghost','shelf-a',1,1)",
    ).run();
    const withGhost = checkParity(db, "group-a");
    expect(withGhost.some((i) => i.kind === "missing-in-doc" && i.entity === "chemical" && i.id === "ch-ghost")).toBe(true);
    expect(ensureParityChecked(db).length).toBeGreaterThan(0);
  });

  it("legacy nested deepfreezers are relocated to root peers with parity intact", () => {
    db.prepare("DELETE FROM stocks WHERE id = 'ch-ghost'").run();
    db.prepare("DELETE FROM batches WHERE id = 'b-ghost'").run();
    db.prepare("DELETE FROM materials WHERE id = 'm-ghost'").run();
    const nested = buildTree();
    db.prepare("INSERT OR REPLACE INTO group_inventory_docs (group_id, tree, version) VALUES ('group-a', ?, 31)").run(
      JSON.stringify(nested),
    );
    db.prepare("UPDATE inventory_sync_state SET doc_version = 31 WHERE group_id = 'group-a'").run();
    syncGroupInventoryDocument(db, "group-a", nested as never);
    const rootFreezer = db
      .prepare("SELECT id, parent_id FROM locations WHERE id = 'df-1' AND parent_id IS NULL")
      .get() as { id: string; parent_id: string | null } | undefined;
    expect(rootFreezer).toBeDefined();
    expect(rootFreezer!.parent_id).toBeNull();
    const reportDetail = assembleInventoryFromRelational(db, "group-a");
    expect(reportDetail.deepFreezers?.map((c) => c.id)).toEqual(["df-1"]);
    expect(reportDetail.rooms[0]!.containers.map((c) => c.id)).toEqual(["cab-1", "fr-1"]);
    expect(checkParity(db, "group-a")).toEqual([]);
  });

  it("returns to parity after resyncing from the doc", () => {
    const tree = buildTree();
    syncGroupInventoryDocument(db, "group-a", tree as never);
    db.prepare("DELETE FROM stocks WHERE id = 'ch-ghost'").run();
    db.prepare("DELETE FROM batches WHERE id = 'b-ghost'").run();
    db.prepare("DELETE FROM materials WHERE id = 'm-ghost'").run();
    expect(checkParity(db, "group-a")).toEqual([]);
  });
});
