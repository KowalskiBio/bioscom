import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { ensureBackfilled } from "../inventory/sync.js";
import { ensureParityChecked } from "../inventory/assemble.js";
import { serverDir } from "../paths.js";

const migrationsDir = join(serverDir, "src", "db", "migrations");
const migrationPattern = /^migration_(\d+).*\.sql$/;

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
  if (pending.length === 0) {
    return [];
  }

  const insert = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );
  const apply = db.transaction((migration: AppliedMigration) => {
    db.exec(readFileSync(join(migrationsDir, migration.name), "utf8"));
    insert.run(migration.version, migration.name, Date.now());
  });

  const newlyApplied: AppliedMigration[] = [];
  for (const migration of pending) {
    apply(migration);
    newlyApplied.push(migration);
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
