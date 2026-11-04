/**
 * Deep-freeze slot census (Tier-2 verification).
 *
 * Walks every group's inventory document and audits the matrioshka freezer
 * geometry that the location model now enforces at write time:
 *   racks   — freezer.rackPositions maps rack name -> slot index (32-slot grid)
 *   boxes   — freezer.shelves entries with rackName + boxName
 *   vials   — chemicals inside a box shelf, keyed by `position`
 *
 * Anomalies (exit 1): rack slot out of [0,31], duplicate rack slot, box on an
 * unknown rack, duplicate (rack, box) pair, box-slot collision (two vials in
 * the same position of one box), dangling sharedWithGroupIds.
 *
 * Informational (exit stays 0): loose shelves inside a freezer (pre-matrioshka
 * leftovers), chemicals directly on the freezer container (pseudo-room
 * surface), legacy nested freezers that the boot hoist will still relocate.
 *
 * Usage:
 *   npm exec tsx scripts/slot-census.ts -- --db /path/to/bioscom-copy.db [--json]
 *
 * Exit codes: 0 = clean (informational notes allowed), 1 = anomalies, 2 = unreadable.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

const RACK_SLOTS = 32;

interface ChemShape {
  id?: string;
  name?: string;
  position?: string | null;
}
interface ShelfShape {
  id?: string;
  name?: string;
  rackName?: string | null;
  boxName?: string | null;
  chemicals?: ChemShape[] | null;
}
interface ContainerShape {
  id?: string;
  name?: string;
  type?: string;
  rackPositions?: Record<string, number> | null;
  shelves?: ShelfShape[] | null;
  chemicals?: ChemShape[] | null;
  sharedWithGroupIds?: string[] | null;
}
interface TreeShape {
  rooms?: Array<{ name?: string; containers?: ContainerShape[] }>;
  deepFreezers?: ContainerShape[] | null;
}

interface Finding {
  severity: "anomaly" | "info";
  groupId: string;
  freezer: string;
  kind: string;
  detail: string;
}

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const dbPath = resolve(arg("--db") ?? process.env.DB_PATH ?? "bioscom.db");
const asJson = process.argv.includes("--json");

if (!existsSync(dbPath)) {
  console.error(`slot-census: database not found: ${dbPath}`);
  process.exit(2);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const knownGroups = new Set((db.prepare("SELECT id FROM groups").all() as Array<{ id: string }>).map((row) => row.id));
const groupRows = db.prepare("SELECT group_id, tree FROM group_inventory_docs").all() as Array<{ group_id: string; tree: string }>;

const findings: Finding[] = [];
const freezerCount = new Map<string, number>();

function push(groupId: string, freezer: string, severity: Finding["severity"], kind: string, detail: string): void {
  findings.push({ severity, groupId, freezer, kind, detail });
}

for (const row of groupRows) {
  let tree: TreeShape;
  try {
    tree = JSON.parse(row.tree) as TreeShape;
  } catch {
    push(row.group_id, "-", "anomaly", "unparseable-doc", "inventory tree JSON does not parse");
    continue;
  }

  for (const room of tree.rooms ?? []) {
    for (const container of room.containers ?? []) {
      if (container.type === "deepfreezer") {
        push(row.group_id, container.name ?? "?", "info", "hoist-pending", `nested in room "${room.name ?? "?"}" — boot hoist will relocate`);
      }
    }
  }

  for (const freezer of tree.deepFreezers ?? []) {
    const label = freezer.name ?? freezer.id ?? "?";
    freezerCount.set(row.group_id, (freezerCount.get(row.group_id) ?? 0) + 1);

    for (const shared of freezer.sharedWithGroupIds ?? []) {
      if (!knownGroups.has(shared)) {
        push(row.group_id, label, "anomaly", "dangling-share", `sharedWithGroupIds references unknown group "${shared}"`);
      }
    }

    for (const chem of freezer.chemicals ?? []) {
      push(row.group_id, label, "info", "direct-chemical", `"${chem.name ?? chem.id}" sits directly on the freezer (pseudo-room surface)`);
    }

    const racks = freezer.rackPositions ?? {};
    const slotOwners = new Map<number, string>();
    for (const [rackName, slot] of Object.entries(racks)) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= RACK_SLOTS) {
        push(row.group_id, label, "anomaly", "rack-slot-out-of-range", `rack "${rackName}" -> slot ${slot} (valid: 0..${RACK_SLOTS - 1})`);
        continue;
      }
      const owner = slotOwners.get(slot);
      if (owner !== undefined) {
        push(row.group_id, label, "anomaly", "duplicate-rack-slot", `slot ${slot} claimed by both "${owner}" and "${rackName}"`);
      } else {
        slotOwners.set(slot, rackName);
      }
    }

    const boxKeys = new Set<string>();
    for (const shelf of freezer.shelves ?? []) {
      const rackName = shelf.rackName ?? "";
      const boxName = shelf.boxName ?? "";
      if (rackName === "") {
        push(row.group_id, label, "info", "loose-shelf", `shelf "${shelf.name ?? shelf.id}" has no rackName (pre-matrioshka leftover)`);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(racks, rackName)) {
        push(row.group_id, label, "anomaly", "box-on-unknown-rack", `box "${boxName || "?"}" references rack "${rackName}" which has no slot`);
      }
      if (boxName === "") {
        push(row.group_id, label, "info", "rack-shelf-without-box", `shelf "${shelf.name ?? shelf.id}" on rack "${rackName}" carries no boxName`);
        continue;
      }
      const key = `${rackName}/${boxName}`;
      if (boxKeys.has(key)) {
        push(row.group_id, label, "anomaly", "duplicate-box", `two shelves claim ${key}`);
      }
      boxKeys.add(key);

      const slotPositions = new Map<string, string>();
      for (const chem of shelf.chemicals ?? []) {
        const pos = (chem.position ?? "").trim();
        if (pos === "") continue;
        const holder = slotPositions.get(pos);
        if (holder !== undefined) {
          push(row.group_id, label, "anomaly", "box-slot-collision", `${key} position ${pos}: "${holder}" and "${chem.name ?? chem.id}"`);
        } else {
          slotPositions.set(pos, chem.name ?? chem.id ?? "?");
        }
      }
    }
  }
}

const report = {
  db: dbPath,
  groups: groupRows.length,
  deepFreezers: [...freezerCount.values()].reduce((a, b) => a + b, 0),
  anomalies: findings.filter((f) => f.severity === "anomaly"),
  info: findings.filter((f) => f.severity === "info"),
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`slot-census: ${dbPath}`);
  console.log(`  groups: ${report.groups}, root deep freezers: ${report.deepFreezers}`);
  for (const finding of findings) {
    const tag = finding.severity === "anomaly" ? "ANOMALY" : "info";
    console.log(`  [${tag}] ${finding.kind} @ "${finding.freezer}" (${finding.groupId}): ${finding.detail}`);
  }
  if (findings.length === 0) {
    console.log("  clean: every rack slot unique and in range, every box resolves to a rack, no vial collisions");
  }
}

db.close();
process.exit(report.anomalies.length > 0 ? 1 : 0);
