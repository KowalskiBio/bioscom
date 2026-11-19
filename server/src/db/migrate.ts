import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { ensureBackfilled } from "../inventory/sync.js";
import { ensureParityChecked } from "../inventory/assemble.js";
import { runRoomRegistryMigration } from "../inventory/roomRegistryMigration.js";
import { serverDir } from "../paths.js";

const migrationsDir = join(serverDir, "src", "db", "migrations");
const migrationPattern = /^migration_(\d+).*\.sql$/;
const ROOM_REGISTRY_VERSION = 11;

/**
 * Version 0011 is the only migration with a paired JavaScript step. The step
 * runs inside the same transaction that records the SQL version, so either
 * both are registered or neither is. It is therefore replayed exactly once and
 * never runs again on a normal startup.
 */
function runPairedMigrationStep(db: Database.Database, version: number): void {
  if (version === ROOM_REGISTRY_VERSION) {
    runRoomRegistryMigration(db);
  }
}

export function ensureInventoryDocs(db: Database.Database): void {
  const missing = db
    .prepare(
      "SELECT id FROM groups WHERE id NOT IN (SELECT group_id FROM group_inventory_docs)",
    )
    .all() as Array<{ id: string }>;
  if (missing.length === 0) {
    return;
  }
  const emptyTree = JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] });
  const insert = db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)");
  for (const group of missing) {
    insert.run(group.id, emptyTree);
    console.log(`[inventory-cleanup] created missing inventory document for group ${group.id}`);
  }
}

export function stripLegacyEmbeddedBarcodeImages(db: Database.Database): void {  const rows = db
    .prepare("SELECT group_id, tree FROM group_inventory_docs")
    .all() as Array<{ group_id: string; tree: string }>;
  const update = db.prepare("UPDATE group_inventory_docs SET tree = ? WHERE group_id = ?");
  for (const row of rows) {
    if (!row.tree.includes("barcodeImg")) {
      continue;
    }
    const tree = JSON.parse(row.tree) as { assets?: Array<Record<string, unknown> | null> };
    let changed = false;
    for (const asset of tree.assets ?? []) {
      if (asset !== null && typeof asset === "object" && "barcodeImg" in asset) {
        delete asset.barcodeImg;
        changed = true;
      }
    }
    if (changed) {
      const cleaned = JSON.stringify(tree);
      update.run(cleaned, row.group_id);
      console.log(
        `[inventory-cleanup] removed embedded barcode images from group ${row.group_id} (${row.tree.length} -> ${cleaned.length} bytes)`,
      );
    }
  }
}

export interface AppliedMigration {
  version: number;
  name: string;
}

export function runMigrations(db: Database.Database): AppliedMigration[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`,
  );

  const migrations: AppliedMigration[] = [];
  for (const name of readdirSync(migrationsDir)) {
    const match = migrationPattern.exec(name);
    if (match === null) {
      continue;
    }
    const version = Number(match[1]);
    if (!Number.isInteger(version)) {
      continue;
    }
    migrations.push({ version, name });
  }
  migrations.sort((a, b) => a.version - b.version || a.name.localeCompare(b.name));

  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map(
      (row) => row.version,
    ),
  );
  const pending = migrations.filter((migration) => !applied.has(migration.version));
  const insert = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );
  const apply = db.transaction((migration: AppliedMigration) => {
    db.exec(readFileSync(join(migrationsDir, migration.name), "utf8"));
    runPairedMigrationStep(db, migration.version);
    insert.run(migration.version, migration.name, Date.now());
  });

  const newlyApplied: AppliedMigration[] = [];
  for (const migration of pending) {
    apply(migration);
    newlyApplied.push(migration);
  }

  try {
    ensureInventoryDocs(db);
    stripLegacyEmbeddedBarcodeImages(db);
  } catch (error) {
    console.error(
      `[inventory-cleanup] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const reports = ensureBackfilled(db);
    const anomalies = reports.filter((r) => !r.ok);
    if (reports.length > 0 || anomalies.length > 0) {
      console.log(
        `[inventory-backfill] synced ${reports.length} group(s), anomalies: ${anomalies.length}${anomalies.length > 0 ? " :: " + JSON.stringify(anomalies) : ""}`,
      );
    }
  } catch (error) {
    console.error(
      `[inventory-backfill] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const issues = ensureParityChecked(db);
    if (issues.length > 0) {
      console.error(`[inventory-parity] ${issues.length} mismatch(es): ${JSON.stringify(issues.slice(0, 20))}`);
    }
  } catch (error) {
    console.error(`[inventory-parity] failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return newlyApplied;
}
