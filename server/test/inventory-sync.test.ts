import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { getDatabase, closeDatabase } from "../src/db.js";
import { ensureBackfilled, syncGroupInventoryDocument, type GroupSyncReport } from "../src/inventory/sync.js";

let db: Database.Database;
let dir: string;

function insertDoc(groupId: string, tree: unknown): void {
  db.prepare("INSERT OR REPLACE INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)").run(
    groupId,
    JSON.stringify(tree),
  );
}

function one<T>(sql: string, ...params: unknown[]): T {
  return db.prepare(sql).get(...params) as T;
}
function all<T>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

const FIXTURE_A = {
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
                  supplierHint: "Sigma legacy note",
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
              chemicals: [{ id: "ch-2", name: "Anti-GAPDH hand-entered" }],
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

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "bioscom-sync-test-"));
  db = getDatabase(join(dir, "test.db"));
  insertDoc("group-a", FIXTURE_A);
  insertDoc("group-b", { rooms: [] });
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-c', '{{not json', 0)").run();
});

afterAll(() => {
  closeDatabase();
});

describe("inventory backfill", () => {
  let reports: GroupSyncReport[];

  it("runs over all docs, reports per group and skips corrupt docs", () => {
    reports = ensureBackfilled(db);
    expect(reports.length).toBe(3);
    const byId = Object.fromEntries(reports.map((r) => [r.groupId, r]));
    expect(byId["group-a"]!.ok).toBe(true);
    expect(byId["group-b"]!.ok).toBe(true);
    expect(byId["group-c"]!.ok).toBe(false);
    expect(byId["group-c"]!.anomaly).toContain("corrupt");
  });

  it("creates relational locations preserving ids, types, order and metadata", () => {
    expect(all<{ id: string }>("SELECT id FROM locations WHERE group_id='group-a' AND kind='room'").map((r) => r.id)).toEqual([
      "room-1",
      "room-2",
    ]);
    const cont = one<{ kind: string; parent_id: string; container_type: string; emoji: string; sort_index: number }>(
      "SELECT * FROM locations WHERE id='fr-1'",
    );
    expect(cont.kind).toBe("container");
    expect(cont.parent_id).toBe("room-1");
    expect(cont.container_type).toBe("fridge");
    expect(cont.sort_index).toBe(1);
    const shelfA = one<{ is_range_shelf: number | null; range_start: string; range_end: string }>(
      "SELECT * FROM locations WHERE id='shelf-a'",
    );
    expect(shelfA.is_range_shelf).toBe(1);
    expect(shelfA.range_start).toBe("A");
    expect(shelfA.range_end).toBe("M");
    const shelfDf = one<{ rack_name: string; box_name: string; color: string }>(
      "SELECT * FROM locations WHERE id='shelf-df'",
    );
    expect(shelfDf.rack_name).toBe("A");
    expect(shelfDf.box_name).toBe("1");
    const df = one<{ rack_positions: string }>("SELECT * FROM locations WHERE id='df-1'");
    expect(JSON.parse(df.rack_positions)).toEqual({ A: 8, B: 4 });
    const share = one<{ container_location_id: string; group_id: string }>(
      "SELECT * FROM container_shares WHERE container_location_id='cab-1' AND group_id='group-b'",
    );
    expect(share).toBeDefined();
  });

  it("creates material+batch+stock per chemical with descriptors, positions and legacy extras", () => {
    const stocks = all<{ id: string }>("SELECT id FROM stocks WHERE group_id='group-a'").map((r) => r.id);
    expect(stocks.sort()).toEqual(["ch-1", "ch-2", "ch-3"]);
    const mat = one<{ name: string; type_key: string; attributes: string }>(
      "SELECT * FROM materials WHERE id='m-ch-1'",
    );
    expect(mat.type_key).toBe("chemical");
    const attrs = JSON.parse(mat.attributes) as Record<string, unknown>;
    expect(attrs.cas_number).toBe("77-86-1");
    expect(attrs.molecular_formula).toBe("C4H11NO3");
    expect((attrs.legacy_fields as Record<string, unknown>).supplierHint).toBe("Sigma legacy note");
    const batch = one<{ id: string; material_id: string; origin_type: string; lot_code: string | null }>(
      "SELECT * FROM batches WHERE id='b-ch-1'",
    );
    expect(batch.material_id).toBe("m-ch-1");
    expect(batch.origin_type).toBe("unknown");
    expect(batch.lot_code).toBeNull();
    const stock = one<{
      batch_id: string;
      location_id: string;
      position: string;
      custom_position: string;
      shelf_override: string;
      current_quantity: number;
      quantity_unit: string;
      concentration: number;
      concentration_unit: string;
      note: string;
      status: string;
    }>("SELECT * FROM stocks WHERE id='ch-1'");
    expect(stock.batch_id).toBe("b-ch-1");
    expect(stock.location_id).toBe("shelf-a");
    expect(stock.position).toBe("A1");
    expect(stock.custom_position).toBe("CP-9");
    expect(stock.shelf_override).toBe("SO-3");
    expect(stock.current_quantity).toBe(250);
    expect(stock.concentration_unit).toBe("M");
    expect(stock.status).toBe("available");
    const ch2 = one<{ current_quantity: number | null; position: string | null }>(
      "SELECT * FROM stocks WHERE id='ch-2'",
    );
    expect(ch2.current_quantity).toBeNull();
    const map = one<{ material_id: string; batch_id: string; stock_id: string }>(
      "SELECT * FROM legacy_chemical_map WHERE group_id='group-a' AND chemical_id='ch-1'",
    );
    expect(map.material_id).toBe("m-ch-1");
    expect(map.stock_id).toBe("ch-1");
  });

  it("reconcile report counts match between doc and db", () => {
    const report = syncGroupInventoryDocument(db, "group-a", FIXTURE_A as never);
    expect(report.ok).toBe(true);
    expect(report.rooms).toEqual({ doc: 2, db: 2 });
    expect(report.containers).toEqual({ doc: 3, db: 3 });
    expect(report.shelves).toEqual({ doc: 4, db: 4 });
    expect(report.chemicals).toEqual({ doc: 3, db: 3 });
  });

  it("is idempotent on rerun (no duplicates); corrupt docs keep re-reporting", () => {
    const before = {
      stocks: one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks").n,
      locations: one<{ n: number }>("SELECT COUNT(*) AS n FROM locations").n,
      materials: one<{ n: number }>("SELECT COUNT(*) AS n FROM materials").n,
      map: one<{ n: number }>("SELECT COUNT(*) AS n FROM legacy_chemical_map").n,
    };
    const rerun = ensureBackfilled(db);
    expect(rerun.length).toBe(1);
    expect(rerun[0]!.groupId).toBe("group-c");
    expect(rerun[0]!.ok).toBe(false);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks").n).toBe(before.stocks);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM locations").n).toBe(before.locations);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM materials").n).toBe(before.materials);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM legacy_chemical_map").n).toBe(before.map);
    syncGroupInventoryDocument(db, "group-a", FIXTURE_A as never);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks").n).toBe(before.stocks);
  });

  it("prunes map-owned rows removed from the doc but keeps user-created ones", () => {
    db.prepare("INSERT INTO materials (id, group_id, type_key, name, created_at, updated_at) VALUES ('m-user-x','group-a','primer','User made',1,1)").run();
    interface LooseShelf { id: string; name: string; }
    interface LooseContainer { id: string; shelves: LooseShelf[]; }
    interface LooseRoom { containers: LooseContainer[]; }
    const trimmed = JSON.parse(JSON.stringify(FIXTURE_A)) as { rooms: LooseRoom[] };
    const room1 = trimmed.rooms[0]!;
    room1.containers = room1.containers.filter((c) => c.id !== "fr-1");
    room1.containers[0]!.shelves = room1.containers[0]!.shelves.filter((s) => s.id !== "shelf-b");
    const report = syncGroupInventoryDocument(db, "group-a", trimmed as never);
    expect(report.ok).toBe(true);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks WHERE id='ch-1'").n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks WHERE id='ch-2'").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM materials WHERE id='m-ch-2'").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM batches WHERE id='b-ch-2'").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM legacy_chemical_map WHERE group_id='group-a' AND chemical_id='ch-2'").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM locations WHERE id='fr-1'").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM locations WHERE id='shelf-c'").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM locations WHERE id='shelf-b'").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM materials WHERE id='m-user-x'").n).toBe(1);
  });
});
