import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "../src/db.js";
import { runMigrations } from "../src/db/migrate.js";
import { ensureParityChecked } from "../src/inventory/assemble.js";
import { ensureBackfilled } from "../src/inventory/sync.js";
import { schemaSqlPath, serverDir } from "../src/paths.js";

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-migrations-test-"));
  return join(dir, "test.db");
}

function tableNames(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

afterEach(() => {
  closeDatabase();
});

describe("migration runner", () => {
  it("creates all inventory tables and seeds 7 material types on a fresh database", () => {
    const db = getDatabase(tempDbPath());

    const tables = tableNames(db);
    for (const table of [
      "schema_migrations",
      "material_types",
      "materials",
      "products",
      "batches",
      "locations",
      "container_shares",
      "stocks",
      "batch_inputs",
      "legacy_chemical_map",
      "user_settings",
    ]) {
      expect(tables.has(table)).toBe(true);
    }

    const locationColumns = (db.prepare("PRAGMA table_info(locations)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(locationColumns).toContain("rack_rows");
    expect(locationColumns).toContain("rack_columns");
    expect(locationColumns).toContain("rack_shelves");
    expect(locationColumns).toContain("shelf_index");

    const instrumentColumns = db
      .prepare("PRAGMA table_info(instruments)")
      .all() as Array<{ name: string; notnull: number }>;
    for (const column of ["room_group_id", "room_id"]) {
      const info = instrumentColumns.find((candidate) => candidate.name === column);
      expect(info).toBeDefined();
      expect(info!.notnull).toBe(0);
    }
    const instrumentIndexColumns = (
      db.prepare("PRAGMA index_info(idx_instruments_room_link)").all() as Array<{ name: string; seqno: number }>
    )
      .sort((a, b) => a.seqno - b.seqno)
      .map((column) => column.name);
    expect(instrumentIndexColumns).toEqual(["room_group_id", "room_id"]);

    const types = db
      .prepare("SELECT key, label, schema_version, fields FROM material_types ORDER BY key")
      .all() as Array<{ key: string; label: string; schema_version: number; fields: string }>;
    expect(types.map((type) => type.key).sort()).toEqual([
      "antibody",
      "biological_stock",
      "chemical",
      "other",
      "primer",
      "reagent",
      "solution",
    ]);
    for (const type of types) {
      expect(type.label.length).toBeGreaterThan(0);
      expect(type.schema_version).toBe(1);
      expect(Array.isArray(JSON.parse(type.fields))).toBe(true);
      expect((JSON.parse(type.fields) as unknown[]).length).toBeGreaterThan(0);
    }

    const versions = db
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number; name: string }>;
    expect(versions).toEqual([
      { version: 1, name: "migration_0001.sql" },
      { version: 2, name: "migration_0002_seed_types.sql" },
      { version: 3, name: "migration_0003_canonicalize_type_fields.sql" },
      { version: 4, name: "migration_0004_stock_barcodes.sql" },
      { version: 5, name: "migration_0005_chemical_fields_trim.sql" },
      { version: 6, name: "migration_0006_location_rack_grid.sql" },
      { version: 7, name: "migration_0007_location_rack_shelves.sql" },
      { version: 8, name: "migration_0008_user_settings.sql" },
      { version: 9, name: "migration_0009_primer_target_species.sql" },
      { version: 10, name: "migration_0010_instrument_room_links.sql" },
      { version: 11, name: "migration_0011_room_registry.sql" },
    ]);

    const chemFields = JSON.parse(types.find((t) => t.key === "chemical")!.fields) as Array<Record<string, unknown>>;
    expect(chemFields[0]).toMatchObject({ key: "cas_number", dataType: "string", searchable: true });
    const antibodyFields = JSON.parse(types.find((t) => t.key === "antibody")!.fields) as Array<Record<string, unknown>>;
    const host = antibodyFields.find((f) => f.key === "host_species");
    expect(host).toMatchObject({ dataType: "enum" });
    expect(host!.options as string[]).toContain("Rabbit");
    const primerFields = JSON.parse(types.find((t) => t.key === "primer")!.fields) as Array<Record<string, unknown>>;
    expect(primerFields.filter((field) => field.key === "target_species")).toEqual([
      {
        key: "target_species",
        label: "Target species",
        dataType: "string",
        required: false,
        searchable: true,
      },
    ]);
  });

  it("applies nothing when run again", () => {
    const db = getDatabase(tempDbPath());
    expect(runMigrations(db)).toEqual([]);
  });

  it("replays the primer target species migration without duplication or overwriting a custom definition", () => {
    const db = getDatabase(tempDbPath());
    const sql = readFileSync(
      join(serverDir, "src", "db", "migrations", "migration_0009_primer_target_species.sql"),
      "utf8",
    );
    const updatePrimer = db.prepare("UPDATE material_types SET fields = ? WHERE key = 'primer'");
    const primerFields = (): Array<Record<string, unknown>> =>
      JSON.parse(
        (db.prepare("SELECT fields FROM material_types WHERE key = 'primer'").get() as { fields: string }).fields,
      ) as Array<Record<string, unknown>>;

    const existingCustom = [
      { key: "sequence", label: "Custom sequence", dataType: "sequence", required: false },
      { key: "target_species", label: "Custom target label", dataType: "string", required: false },
    ];
    updatePrimer.run(JSON.stringify(existingCustom));
    db.exec(sql);
    expect(primerFields()).toEqual(existingCustom);

    const customWithoutTarget = [
      { key: "sequence", label: "Custom sequence", dataType: "sequence", required: false },
      { key: "lab_notes", label: "Lab notes", dataType: "text", required: false },
    ];
    updatePrimer.run(JSON.stringify(customWithoutTarget));
    db.exec(sql);
    db.exec(sql);

    const fields = primerFields();
    expect(fields.filter((field) => field.key === "target_species")).toHaveLength(1);
    expect(fields.find((field) => field.key === "target_species")).toMatchObject({
      label: "Target species",
      dataType: "string",
      searchable: true,
    });
    expect(fields.find((field) => field.key === "lab_notes")).toMatchObject({ label: "Lab notes" });
    expect(fields.find((field) => field.key === "sequence")).toMatchObject({ label: "Custom sequence" });
  });

  it("still bootstraps the legacy schema before versioned migrations", () => {
    const path = tempDbPath();
    const raw = new Database(path);
    raw.exec(readFileSync(schemaSqlPath, "utf8"));
    expect(tableNames(raw).has("group_inventory_docs")).toBe(true);
    expect(tableNames(raw).has("materials")).toBe(false);

    const applied = runMigrations(raw);
    expect(applied.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    const tables = tableNames(raw);
    expect(tables.has("groups")).toBe(true);
    expect(tables.has("users")).toBe(true);
    expect(tables.has("group_inventory_docs")).toBe(true);
    expect(tables.has("materials")).toBe(true);
    const seeded = raw.prepare("SELECT COUNT(*) AS n FROM material_types").get() as { n: number };
    expect(seeded.n).toBe(7);
    raw.close();
  });

  it("preserves legacy instrument rows when adding optional room link columns", () => {
    const path = tempDbPath();
    const raw = new Database(path);
    raw.exec(readFileSync(schemaSqlPath, "utf8"));
    raw.prepare(
      "INSERT INTO instruments (id, source, group_id, name, location) VALUES (?, 'shared', NULL, ?, ?)",
    ).run("inst-legacy-1", "Legacy HPLC", "Room B302, Desk 4");

    expect(runMigrations(raw).map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    const row = raw
      .prepare(
        "SELECT location, room_group_id AS roomGroupId, room_id AS roomId FROM instruments WHERE id = ?",
      )
      .get("inst-legacy-1") as { location: string; roomGroupId: string | null; roomId: string | null };
    expect(row).toEqual({
      location: "Room B302, Desk 4",
      roomGroupId: null,
      roomId: null,
    });
    raw.close();
  });

  it("re-run of ensureBackfilled re-heals stale inventory docs every single call (T1-3 idempotent boot AGENTS AGENTS reconcile)", () => {
    const db = getDatabase(tempDbPath());
    db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('g1', ?, 1)").run(
      JSON.stringify({
        rooms: [
          {
            id: "r1",
            name: "A",
            containers: [{ id: "c1", name: "B", type: "cabinet", shelves: [{ id: "s1", name: "T", chemicals: [{ id: "chem-1", name: "Legacy salt" }] }] }],
          },
        ],
        assetRooms: [],
        assets: [],
        protocols: [],
      }),
    );

    const firstReports = ensureBackfilled(db);
    expect(firstReports.length).toBe(1);
    expect(firstReports[0]!.ok).toBe(true);
    expect(firstReports[0]!.chemicals).toEqual({ doc: 1, db: 1 });
    expect((db.prepare("SELECT doc_version FROM inventory_sync_state WHERE group_id = 'g1'").get() as { doc_version: number }).doc_version).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM legacy_chemical_map WHERE group_id = 'g1' AND chemical_id = 'chem-1'").get() as { n: number }).n).toBe(1);

    const updated = JSON.parse((db.prepare("SELECT tree FROM group_inventory_docs WHERE group_id = 'g1'").get() as { tree: string }).tree) as {
      rooms: Array<{ containers: Array<{ shelves: Array<{ chemicals: unknown[] }> }> }>;
    };
    updated.rooms[0]!.containers[0]!.shelves[0]!.chemicals = [];
    db.prepare("UPDATE group_inventory_docs SET tree = ?, version = ? WHERE group_id = 'g1'").run(JSON.stringify(updated), 2);

    const secondReports = ensureBackfilled(db);
    expect(secondReports.length).toBe(1);
    expect(secondReports[0]!.ok).toBe(true);
    expect(secondReports[0]!.chemicals).toEqual({ doc: 0, db: 0 });
    expect((db.prepare("SELECT doc_version FROM inventory_sync_state WHERE group_id = 'g1'").get() as { doc_version: number }).doc_version).toBe(2);
    expect((db.prepare("SELECT COUNT(*) AS n FROM legacy_chemical_map WHERE group_id = 'g1' AND chemical_id = 'chem-1'").get() as { n: number }).n).toBe(0);

    const thirdReports = ensureBackfilled(db);
    expect(thirdReports).toEqual([]);
  });

  it("reconciles a changed doc on every boot, even when no migrations are pending", () => {
    const db = getDatabase(tempDbPath());
    db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('g1', ?, 1)").run(
      JSON.stringify({
        rooms: [
          {
            id: "r1",
            name: "A",
            containers: [{ id: "c1", name: "B", type: "cabinet", shelves: [{ id: "s1", name: "T", chemicals: [{ id: "chem-1", name: "Legacy salt" }] }] }],
          },
        ],
        assetRooms: [],
        assets: [],
        protocols: [],
      }),
    );
    ensureBackfilled(db);
    const updated = JSON.parse((db.prepare("SELECT tree FROM group_inventory_docs WHERE group_id = 'g1'").get() as { tree: string }).tree) as {
      rooms: Array<{ containers: Array<{ shelves: Array<{ chemicals: Array<{ name: string }> }> }> }>;
    };
    updated.rooms[0]!.containers[0]!.shelves[0]!.chemicals[0]!.name = "Renamed Legacy salt";
    db.prepare("UPDATE group_inventory_docs SET tree = ?, version = ? WHERE group_id = 'g1'").run(JSON.stringify(updated), 2);

    expect(runMigrations(db)).toEqual([]);
    expect(db.prepare("SELECT name FROM materials WHERE group_id = 'g1' AND id = 'm-chem-1'").get()).toEqual({ name: "Renamed Legacy salt" });
    expect(ensureParityChecked(db)).toEqual([]);
  });

  it("accepts a trial relational insert across the new tables", () => {    const db = getDatabase(tempDbPath());

    db.prepare("INSERT INTO materials (id, group_id, type_key, name) VALUES (?, ?, ?, ?)").run(
      "m-chem-1",
      "group-a",
      "chemical",
      "Hydrochloric acid",
    );
    db.prepare(
      "INSERT INTO products (id, material_id, manufacturer_name, catalog_number) VALUES (?, ?, ?, ?)",
    ).run("p-chem-1", "m-chem-1", "Acme", "H-100");
    db.prepare(
      "INSERT INTO batches (id, material_id, product_id, lot_code) VALUES (?, ?, ?, ?)",
    ).run("b-chem-1", "m-chem-1", "p-chem-1", "LOT-1");
    db.prepare(
      "INSERT INTO locations (id, group_id, kind, name) VALUES (?, ?, ?, ?)",
    ).run("loc-1", "group-a", "shelf", "Shelf A");
    db.prepare(
      "INSERT INTO stocks (id, group_id, batch_id, location_id, current_quantity, quantity_unit) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("chem-1", "group-a", "b-chem-1", "loc-1", 5, "ml");
    db.prepare(
      "INSERT INTO batch_inputs (id, output_batch_id, source_stock_id, quantity_used, unit) VALUES (?, ?, ?, ?, ?)",
    ).run("bi-1", "b-chem-1", "chem-1", 1, "ml");
    db.prepare(
      "INSERT INTO legacy_chemical_map (group_id, chemical_id, material_id, batch_id, stock_id) VALUES (?, ?, ?, ?, ?)",
    ).run("group-a", "chem-1", "m-chem-1", "b-chem-1", "chem-1");

    const joined = db
      .prepare(
        `SELECT m.name AS material, p.catalog_number AS catalog, b.lot_code AS lot, s.current_quantity AS quantity
         FROM stocks s
         JOIN batches b ON b.id = s.batch_id
         JOIN materials m ON m.id = b.material_id
         LEFT JOIN products p ON p.id = b.product_id
         WHERE s.id = ?`,
      )
      .get("chem-1") as { material: string; catalog: string; lot: string; quantity: number };
    expect(joined).toEqual({
      material: "Hydrochloric acid",
      catalog: "H-100",
      lot: "LOT-1",
      quantity: 5,
    });

    expect(runMigrations(db)).toEqual([]);
  });
});
