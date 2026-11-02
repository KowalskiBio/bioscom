import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { getDatabase, closeDatabase } from "../src/db.js";
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
    const df = assembled.rooms[0]!.containers[2]!;
    expect(df.rackPositions).toEqual({ A: 8, B: 4 });
    expect(df.shelves[0]!.rackName).toBe("A");
    expect(df.shelves[0]!.boxName).toBe("1");
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

  it("returns to parity after resyncing from the doc", () => {
    const tree = buildTree();
    syncGroupInventoryDocument(db, "group-a", tree as never);
    db.prepare("DELETE FROM stocks WHERE id = 'ch-ghost'").run();
    db.prepare("DELETE FROM batches WHERE id = 'b-ghost'").run();
    db.prepare("DELETE FROM materials WHERE id = 'm-ghost'").run();
    expect(checkParity(db, "group-a")).toEqual([]);
  });
});
