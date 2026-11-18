/**
 * Offline parity probe for a copied bioscom.db (Tier-2 verification).
 *
 * Never mutates: opens the database read-only and answers three questions —
 *   1. do the mirrored relational tables exist at all?
 *   2. does every group document match its relational mirror (parity)?
 *   3. are there legacy nested deep freezers still waiting for the boot hoist,
 *      and/or orphaned mirror rows pointing at unknown groups?
 *
 * Usage:
 *   npm exec tsx scripts/probe-integrity.ts -- --db /path/to/bioscom-copy.db [--json]
 *
 * Exit codes: 0 = clean, 1 = parity/orphan issues found, 2 = structural gap
 * (mirror never initialized / database unreadable).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { ensureParityChecked } from "../src/inventory/assemble.js";

const MIRROR_TABLES = ["materials", "products", "batches", "stocks", "locations", "legacy_chemical_map", "inventory_sync_state"];

interface GroupRow {
  group_id: string;
  tree: string;
  version: number;
}

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const dbPath = resolve(arg("--db") ?? process.env.DB_PATH ?? "bioscom.db");
const asJson = process.argv.includes("--json");

if (!existsSync(dbPath)) {
  console.error(`probe-integrity: database not found: ${dbPath}`);
  process.exit(2);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const existing = new Set(
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name),
);
const missingMirror = MIRROR_TABLES.filter((table) => !existing.has(table));

const groupRows = db.prepare("SELECT group_id, tree, version FROM group_inventory_docs").all() as GroupRow[];

interface HoistPending {
  groupId: string;
  freezerName: string;
  roomName: string;
}

const hoistPending: HoistPending[] = [];
const unparseableDocs: string[] = [];

interface TreeShape {
  rooms?: Array<{ name?: string; containers?: Array<{ name?: string; type?: string }> }>;
}

for (const row of groupRows) {
  let tree: TreeShape;
  try {
    tree = JSON.parse(row.tree) as TreeShape;
  } catch {
    unparseableDocs.push(row.group_id);
    continue;
  }
  for (const room of tree.rooms ?? []) {
    for (const container of room.containers ?? []) {
      if (container.type === "deepfreezer") {
        hoistPending.push({ groupId: row.group_id, freezerName: container.name ?? "?", roomName: room.name ?? "?" });
      }
    }
  }
}

interface Finding {
  kind: string;
  detail?: string;
}
const findings: Finding[] = [];
let parityIssues: ReturnType<typeof ensureParityChecked> = [];

if (missingMirror.length > 0) {
  for (const table of missingMirror) {
    findings.push({ kind: "mirror-uninitialized", detail: `missing table: ${table}` });
  }
} else {
  parityIssues = ensureParityChecked(db);
  const orphanCounts = (
    [
      ["materials", "SELECT COUNT(*) AS n FROM materials WHERE group_id NOT IN (SELECT group_id FROM group_inventory_docs)"],
      ["products", "SELECT COUNT(*) AS n FROM products WHERE material_id NOT IN (SELECT id FROM materials)"],
      ["batches", "SELECT COUNT(*) AS n FROM batches WHERE material_id NOT IN (SELECT id FROM materials)"],
      ["stocks", "SELECT COUNT(*) AS n FROM stocks WHERE group_id NOT IN (SELECT group_id FROM group_inventory_docs) OR batch_id NOT IN (SELECT id FROM batches)"],
      ["locations", "SELECT COUNT(*) AS n FROM locations WHERE group_id NOT IN (SELECT group_id FROM group_inventory_docs)"],
    ] as const
  )
    .map(([table, sql]) => ({ table, n: (db.prepare(sql).get() as { n: number }).n }))
    .filter((row) => row.n > 0);
  for (const row of orphanCounts) {
    findings.push({ kind: "orphan-mirror-rows", detail: `${row.table}: ${row.n} row(s) with unknown group_id` });
  }
  for (const groupId of unparseableDocs) {
    findings.push({ kind: "unparseable-doc", detail: `group ${groupId}: tree JSON does not parse` });
  }
}

const report = {
  db: dbPath,
  groups: groupRows.length,
  mirrorReady: missingMirror.length === 0,
  parity: { ok: parityIssues.length === 0, issues: parityIssues },
  hoistPending,
  findings,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`probe-integrity: ${dbPath}`);
  console.log(`  groups: ${groupRows.length}, mirror: ${report.mirrorReady ? "ready" : "UNINITIALIZED"}`);
  for (const issue of parityIssues) {
    console.log(`  PARITY ${issue.kind} ${issue.entity}:${issue.id} ${issue.detail ?? ""}`.trim());
  }
  for (const hoist of hoistPending) {
    console.log(`  hoist-pending: "${hoist.freezerName}" still nested in room "${hoist.roomName}" (group ${hoist.groupId}) — heals at next boot`);
  }
  for (const finding of findings) {
    console.log(`  ${finding.kind}: ${finding.detail ?? ""}`);
  }
  if (report.mirrorReady && parityIssues.length === 0 && findings.length === 0) {
    console.log("  clean: parity ok on all groups, no orphan mirror rows");
  }
}

db.close();

if (missingMirror.length > 0) process.exit(2);
if (parityIssues.length > 0 || findings.some((f) => f.kind !== "hoist-pending")) process.exit(1);
process.exit(0);
