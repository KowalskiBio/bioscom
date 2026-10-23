import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export const serverDir = join(moduleDir, "..");
export const repoRoot = join(serverDir, "..");
export const schemaSqlPath = join(serverDir, "src", "db", "schema.sql");
export const webDistDir = join(repoRoot, "web", "dist");
export const defaultDbPath = join(repoRoot, "bioscom.db");
export const envFile = join(serverDir, ".env");
