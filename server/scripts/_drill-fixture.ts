/**
 * Tier-2 fixture builder — creates a scratch bioscom.db that exercises every
 * anomaly class of probe-integrity / slot-census / restore-drill.
 *
 * Two groups are seeded:
 *   tier2-ok   — one room/cabinet/shelf with a synced chemical, one healthy
 *                root deep freezer (rack R1 slot 0, box (R1,1), one vial)
 *   tier2-bad  — a deliberately broken freezer: duplicate rack slots (A/X -> 0),
 *                a box on an unknown rack (ZZ), two shelves claiming the same
 *                (A,1) box, two vials colliding at position A1 of that box,
 *                a dangling sharedWithGroupIds entry, plus informational
 *                leftovers (loose shelf, direct chemical, legacy nested freezer)
 *
 * Both docs are backfilled so the mirror starts converged; pass --drift to
 * additionally delete one material row from tier2-ok, which parity MUST flag.
 *
 * Usage:
 *   npm exec tsx scripts/_drill-fixture.ts -- --out <dir> [--drift]
 *   prints the fixture DB path on stdout (last line) for scripting.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDatabase, closeDatabase } from "../src/db.js";
import { ensureBackfilled } from "../src/inventory/sync.js";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const outDir = resolve(arg("--out") ?? join(process.cwd(), ".tier2-fixture"));
const drift = process.argv.includes("--drift");
mkdirSync(outDir, { recursive: true });
const dbPath = join(outDir, "bioscom.db");

const db = getDatabase(dbPath);

const now = Date.now();
const insertGroup = db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)");
const insertDoc = db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)");

const treeOk = {
  rooms: [
    {
      id: "room-ok",
      name: "OK Lab",
      containers: [
        {
          id: "cab-ok",
          name: "Solvent cabinet",
          type: "cabinet",
          sharedWithGroupIds: [],
          shelves: [
            { id: "shelf-ok", name: "Top", chemicals: [{ id: "chem-ok-1", name: "Acetonitrile HPLC", cas: "75-05-8", quantity: 4, unit: "L" }] },
          ],
        },
      ],
    },
  ],
  deepFreezers: [
    {
      id: "frz-ok",
      name: "-80 OK",
      type: "deepfreezer",
      sharedWithGroupIds: [],
      rackPositions: { R1: 0 },
      shelves: [
        { id: "box-ok-1", name: "Rack R1 / Box 1", rackName: "R1", boxName: "1", chemicals: [{ id: "chem-ok-vial", name: "Ctrl plasmid", position: "A1" }] },
      ],
    },
  ],
  assetRooms: [],
  assets: [],
  protocols: [],
};

const treeBad = {
  rooms: [
    {
      id: "room-bad",
      name: "Legacy Lab",
      containers: [
        { id: "frz-legacy", name: "-70 Legacy (nested)", type: "deepfreezer", sharedWithGroupIds: [], shelves: [] },
      ],
    },
  ],
  deepFreezers: [
    {
      id: "frz-bad",
      name: "-80 BAD",
      type: "deepfreezer",
      sharedWithGroupIds: ["ghost-group"],
      rackPositions: { A: 0, B: 1, X: 0 },
      shelves: [
        {
          id: "box-bad-1a",
          name: "Rack A / Box 1",
          rackName: "A",
          boxName: "1",
          chemicals: [
            { id: "chem-bad-v1", name: "Vial one", position: "A1" },
            { id: "chem-bad-v2", name: "Vial two", position: "A1" },
          ],
        },
        { id: "box-bad-1b", name: "Rack A / Box 1 (dup)", rackName: "A", boxName: "1", chemicals: [] },
        { id: "box-bad-zz", name: "Rack ZZ / Box 1", rackName: "ZZ", boxName: "1", chemicals: [] },
        { id: "shelf-loose", name: "Old loose shelf", chemicals: [] },
      ],
      chemicals: [{ id: "chem-bad-direct", name: "Loose dry ice" }],
    },
  ],
  assetRooms: [],
  assets: [],
  protocols: [],
};

const seed = db.transaction(() => {
  db.prepare("DELETE FROM groups WHERE id IN ('tier2-ok', 'tier2-bad')").run();
  insertGroup.run("tier2-ok", "Tier2 OK", "T2OK01", now);
  insertGroup.run("tier2-bad", "Tier2 BAD", "T2BAD1", now);
  insertDoc.run("tier2-ok", JSON.stringify(treeOk));
  insertDoc.run("tier2-bad", JSON.stringify(treeBad));
});
seed();

const synced = ensureBackfilled(db);
console.log(`fixture: backfilled ${synced.length} group(s): ${synced.map((s) => `${s.groupId}(${s.ok ? "ok" : s.anomaly})`).join(", ")}`);

if (drift) {
  const deleted = db.prepare("DELETE FROM stocks WHERE group_id = 'tier2-ok'").run().changes;
  const renamed = db.prepare("UPDATE materials SET name = 'TAMPERED-NAME' WHERE id = 'm-chem-bad-v1'").run().changes;
  console.log(`fixture: drift planted — deleted ${deleted} stocks row(s) from tier2-ok, renamed ${renamed} material(s) in tier2-bad (docs untouched)`);
}

closeDatabase();
console.log(dbPath);
