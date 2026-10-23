import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { schemaSqlPath } from "./paths.js";

let cached: { path: string; db: Database.Database } | null = null;

export function getDatabase(dbPath: string): Database.Database {
  if (cached !== null && cached.path === dbPath) {
    return cached.db;
  }
  if (cached !== null) {
    const previous = cached;
    cached = null;
    previous.db.close();
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(readFileSync(schemaSqlPath, "utf8"));
  cached = { path: dbPath, db };
  return db;
}

export function checkDatabase(dbPath: string): { ok: boolean; error?: string } {
  try {
    const db = getDatabase(dbPath);
    db.prepare("SELECT 1 AS one").get();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function closeDatabase(): void {
  if (cached !== null) {
    const current = cached;
    cached = null;
    current.db.close();
  }
}
