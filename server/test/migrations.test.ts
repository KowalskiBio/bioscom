import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "../src/db.js";
import { runMigrations } from "../src/db/migrate.js";
import { schemaSqlPath } from "../src/paths.js";

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
    ]) {
      expect(tables.has(table)).toBe(true);
    }

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
    ]);

    const chemFields = JSON.parse(types.find((t) => t.key === "chemical")!.fields) as Array<Record<string, unknown>>;
    expect(chemFields[0]).toMatchObject({ key: "cas_number", dataType: "string", searchable: true });
    const antibodyFields = JSON.parse(types.find((t) => t.key === "antibody")!.fields) as Array<Record<string, unknown>>;
    const host = antibodyFields.find((f) => f.key === "host_species");
    expect(host).toMatchObject({ dataType: "enum" });
    expect(host!.options as string[]).toContain("Rabbit");
  });

  it("applies nothing when run again", () => {
    const db = getDatabase(tempDbPath());
    expect(runMigrations(db)).toEqual([]);
  });

  it("still bootstraps the legacy schema before versioned migrations", () => {
    const path = tempDbPath();
    const raw = new Database(path);
    raw.exec(readFileSync(schemaSqlPath, "utf8"));
    expect(tableNames(raw).has("group_inventory_docs")).toBe(true);
    expect(tableNames(raw).has("materials")).toBe(false);

    const applied = runMigrations(raw);
    expect(applied.map((migration) => migration.version)).toEqual([1, 2, 3]);

    const tables = tableNames(raw);
    expect(tables.has("groups")).toBe(true);
    expect(tables.has("users")).toBe(true);
    expect(tables.has("group_inventory_docs")).toBe(true);
    expect(tables.has("materials")).toBe(true);
    const seeded = raw.prepare("SELECT COUNT(*) AS n FROM material_types").get() as { n: number };
    expect(seeded.n).toBe(7);
    raw.close();
  });

  it("accepts a trial relational insert across the new tables", () => {
    const db = getDatabase(tempDbPath());

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
