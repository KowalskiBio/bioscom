/**
 * Snapshot-restore drill (Tier-2 verification).
 *
 * Proves the rollback contract end-to-end against a copy of the production
 * database, without ever touching the live file:
 *   1. snapshot  — VACUUM INTO a temp workdir (consistent, WAL-safe)
 *   2. (optional) --tamper — delete all rows from `stocks` of the first group
 *      to fabricate mirror drift
 *   3. boot      — spawn the built server (server/dist/index.js) against the
 *      snapshot on an alternate port and wait for /api/public/groups to answer
 *   4. verify    — run the offline parity check against the snapshot:
 *        --tamper  => parity MUST report issues (detection works)
 *        default   => parity MUST be clean (boot self-heal converged)
 *
 * Usage:
 *   npm exec tsx scripts/restore-drill.ts -- --db bioscom.db [--port 8123] [--tamper] [--keep]
 *
 * Exit codes: 0 = drill passed, 1 = drill failed, 2 = setup problem (missing
 * build, unreadable source DB, port never answered).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ensureParityChecked } from "../src/inventory/assemble.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(scriptDir, "..");
const distEntry = join(serverDir, "dist", "index.js");

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const srcDb = resolve(arg("--db") ?? process.env.DB_PATH ?? "bioscom.db");
const port = Number(arg("--port") ?? 8123);
const tamper = process.argv.includes("--tamper");
const keep = process.argv.includes("--keep");

function fail(code: number, message: string): never {
  console.error(`restore-drill: ${message}`);
  process.exit(code);
}

if (!existsSync(srcDb)) fail(2, `source database not found: ${srcDb}`);
if (!existsSync(distEntry)) fail(2, `server build missing (${distEntry}) — run: npm run build -w server`);
if (!Number.isInteger(port) || port <= 0 || port > 65535) fail(2, `invalid --port ${port}`);

const workdir = mkdtempSync(join(tmpdir(), "bioscom-drill-"));
const snapshotDb = join(workdir, "snapshot.db");
console.log(`restore-drill: workdir ${workdir}`);

// --- 1. snapshot ----------------------------------------------------------
{
  const src = new Database(srcDb, { fileMustExist: true });
  src.pragma("busy_timeout = 10000");
  src.exec(`VACUUM INTO '${snapshotDb.replace(/'/g, "''")}'`);
  src.close();
  console.log(`restore-drill: snapshot written (${srcDb} -> ${snapshotDb})`);
}

function docVersions(dbPath: string): Record<string, number> {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = db.prepare("SELECT group_id, version FROM group_inventory_docs").all() as Array<{ group_id: string; version: number }>;
  db.close();
  return Object.fromEntries(rows.map((row) => [row.group_id, row.version]));
}

const versionsBefore = docVersions(snapshotDb);

// --- 2. optional tamper ---------------------------------------------------
let tamperedGroup: string | null = null;
if (tamper) {
  const db = new Database(snapshotDb);
  const first = db.prepare("SELECT group_id FROM group_inventory_docs ORDER BY group_id LIMIT 1").get() as { group_id: string } | undefined;
  if (first === undefined) fail(2, "no groups in snapshot to tamper with");
  const deleted = db.prepare("DELETE FROM stocks WHERE group_id = ?").run(first.group_id).changes;
  tamperedGroup = first.group_id;
  db.close();
  console.log(`restore-drill: tampered group ${tamperedGroup} — deleted ${deleted} stocks row(s) from the mirror (doc untouched)`);
}

// --- 3. boot against snapshot ---------------------------------------------
let child: ChildProcess | null = null;
let ready = false;
try {
  child = spawn(process.execPath, [distEntry], {
    cwd: serverDir,
    env: {
      ...process.env,
      DB_PATH: snapshotDb,
      PORT: String(port),
      HOST: "127.0.0.1",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "restore-drill",
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("error", (error) => fail(2, `failed to spawn server: ${error.message}`));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/public/groups`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
  }
} finally {
  // --- cleanup: stop the drill server in all paths -------------------------
  if (child !== null && child.exitCode === null) {
    child.kill();
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

if (!ready) fail(2, `server never answered on port ${port} (exited early? check logs above)`);
console.log(`restore-drill: server came up on :${port} and was stopped again`);

// --- 4. verify -------------------------------------------------------------
const versionsAfter = docVersions(snapshotDb);
const healed = Object.entries(versionsAfter).filter(([group, version]) => (versionsBefore[group] ?? -1) < version);
if (healed.length > 0) {
  console.log(`restore-drill: boot rewrote ${healed.length} doc(s) (hoist/heal): ${healed.map(([g]) => g).join(", ")}`);
}

const verifyDb = new Database(snapshotDb, { readonly: true, fileMustExist: true });
const issues = ensureParityChecked(verifyDb);
verifyDb.close();
console.log(`restore-drill: post-boot parity issues: ${issues.length}`);
for (const issue of issues.slice(0, 10)) {
  console.log(`  ${issue.kind} ${issue.entity}:${issue.id} ${issue.detail ?? ""}`.trim());
}

if (!keep) {
  rmSync(workdir, { recursive: true, force: true });
  console.log("restore-drill: workdir removed");
} else {
  console.log(`restore-drill: workdir kept at ${workdir}`);
}

if (tamper) {
  if (issues.length > 0) {
    console.log(`restore-drill: PASS — drift planted in group ${tamperedGroup} was detected by the parity probe`);
    process.exit(0);
  }
  console.error("restore-drill: FAIL — tampered mirror went undetected (parity reports clean)");
  process.exit(1);
}

if (issues.length === 0) {
  console.log("restore-drill: PASS — snapshot boots, server serves, parity is clean");
  process.exit(0);
}
console.error("restore-drill: FAIL — snapshot boots but parity reports drift on an untouched copy");
process.exit(1);
