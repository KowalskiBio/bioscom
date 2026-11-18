import { fileURLToPath } from "node:url";
import { getDatabase, closeDatabase } from "../src/db.js";
import { ensureBackfilled } from "../src/inventory/sync.js";

const dbPath = fileURLToPath(new URL("../../bioscom.db", import.meta.url));
const db = getDatabase(dbPath);
const reports = ensureBackfilled(db);
console.log(JSON.stringify(reports, null, 2));
closeDatabase();
