import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export const migrateDir = join(moduleDir, "..");
export const repoRoot = join(migrateDir, "..");
export const dumpsDir = join(migrateDir, "dumps");
export const reportsDir = join(migrateDir, "reports");
export const envFile = join(migrateDir, ".env");
export const schemaSqlPath = join(repoRoot, "server", "src", "db", "schema.sql");
export const defaultLegacyExportPath = join(repoRoot, "migration", "bioscom-db-export.json");

export const RTDB_PATHS = [
  "users",
  "groups",
  "inventories",
  "history",
  "backups",
  "lastBackupTime",
  "shared_notices",
  "shared_instruments",
  "shared_print_catalog",
  "shared_print_requests",
  "game_challenges",
  "inventory",
  "inventory_sandbox",
  "empty_sandbox_placeholder",
] as const;

export type RtdbPath = (typeof RTDB_PATHS)[number];
