import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { schemaSqlPath } from "./paths.js";

const LEGACY_ADMIN_EMAIL = "505618@muni.cz";

function main(): void {
  const { values } = parseArgs({ options: { db: { type: "string" } } });
  const dbPath = values.db ?? "bioscom.db";
  const db = new Database(dbPath);
  db.exec(readFileSync(schemaSqlPath, "utf8"));
  const row = db
    .prepare("SELECT uid, email, role FROM users WHERE email = ? COLLATE NOCASE")
    .get(LEGACY_ADMIN_EMAIL) as { uid: string; email: string; role: string } | undefined;
  if (row === undefined) {
    console.error(`No user with email ${LEGACY_ADMIN_EMAIL} — import users first (todo 5).`);
    process.exit(2);
  }
  db.prepare("UPDATE users SET role = 'superadmin' WHERE uid = ?").run(row.uid);
  console.log(`Granted superadmin to uid ${row.uid} (${LEGACY_ADMIN_EMAIL}, was ${row.role})`);
  db.close();
}

main();
