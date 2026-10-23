import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { reportsDir } from "./paths.js";
import { loadSource } from "./source.js";
import { asRecord, collectTreeEntities, type TreeEntities } from "./walk.js";

const BASELINE: Record<string, number> = {
  groups: 4,
  users: 10,
  rooms: 10,
  containers: 25,
  shelves: 133,
  chemicals: 264,
  assetRooms: 8,
  assets: 43,
  protocols: 90,
  history: 1391,
  backups: 64,
};

interface Violation {
  check: string;
  detail: string;
}

function recordCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") return Object.keys(value).length;
  return value === undefined || value === null ? 0 : 1;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function main(): void {
  const { values } = parseArgs({
    options: {
      check: { type: "boolean" },
      legacy: { type: "string" },
      dir: { type: "string" },
    },
  });
  const source = loadSource({ legacy: values.legacy, dir: values.dir });
  const violations: Violation[] = [];
  const lines: string[] = [];

  const groupsRecord = asRecord(source.paths.groups);
  const groupIds = new Set(Object.keys(groupsRecord));
  const groupName = (gid: string): string => {
    const raw = asRecord(groupsRecord[gid]).name;
    return typeof raw === "string" ? raw : "(unnamed)";
  };

  const totals: Record<keyof TreeEntities, number> = {
    rooms: 0,
    containers: 0,
    shelves: 0,
    chemicals: 0,
    assetRooms: 0,
    assets: 0,
    protocols: 0,
    instruments: 0,
    notices: 0,
    printCatalog: 0,
    printRequests: 0,
  };
  const perGroup: Array<{ gid: string; counts: TreeEntities }> = [];
  const sharedOwnerCounts = new Map<string, number>();

  const walkDoc = (gid: string, doc: unknown, perGroupRow: boolean): void => {
    const counts = collectTreeEntities(doc);
    for (const key of Object.keys(totals) as Array<keyof TreeEntities>) {
      totals[key] += counts[key].length;
    }
    if (perGroupRow) {
      perGroup.push({ gid, counts });
    }
    for (const container of counts.containers) {
      const owner = asRecord(container).ownerGroupId;
      if (typeof owner === "string" && owner !== "" && owner !== gid) {
        sharedOwnerCounts.set(owner, (sharedOwnerCounts.get(owner) ?? 0) + 1);
      }
    }
  };

  const inventoryDocIds: string[] = [];
  for (const [gid, doc] of Object.entries(asRecord(source.paths.inventories))) {
    inventoryDocIds.push(gid);
    walkDoc(gid, doc, true);
  }
  if (source.paths.inventory !== undefined) {
    walkDoc("(standalone inventory)", source.paths.inventory, false);
  }

  let oldest: number | null = null;
  let newest: number | null = null;
  let historyEntries = 0;
  for (const entries of Object.values(asRecord(source.paths.history))) {
    for (const entry of Object.values(asRecord(entries))) {
      const timestamp = asRecord(entry).timestamp;
      historyEntries += 1;
      if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
        if (oldest === null || timestamp < oldest) oldest = timestamp;
        if (newest === null || timestamp > newest) newest = timestamp;
      }
    }
  }

  let backupsTotal = 0;
  for (const entries of Object.values(asRecord(source.paths.backups))) {
    backupsTotal += recordCount(entries);
  }

  for (const [uid, raw] of Object.entries(asRecord(source.paths.users))) {
    const groupId = asRecord(raw).groupId;
    if (typeof groupId === "string" && groupId !== "" && !groupIds.has(groupId)) {
      violations.push({ check: "users→groups", detail: `user ${uid} references missing group ${groupId}` });
    }
  }
  for (const [owner, count] of sharedOwnerCounts) {
    if (!groupIds.has(owner)) {
      violations.push({
        check: "sharedContainers→groups",
        detail: `${count} shared container(s) owned by missing group ${owner}`,
      });
    }
  }
  const inventoryDocSet = new Set(inventoryDocIds);
  for (const gid of inventoryDocIds) {
    if (!groupIds.has(gid)) {
      violations.push({ check: "inventories→groups", detail: `inventory doc without groups entry: ${gid}` });
    }
  }
  for (const gid of groupIds) {
    if (!inventoryDocSet.has(gid)) {
      violations.push({ check: "groups→inventories", detail: `group without inventory doc: ${gid}` });
    }
  }
  for (const gid of Object.keys(asRecord(source.paths.backups))) {
    if (!groupIds.has(gid)) {
      violations.push({ check: "backups→groups", detail: `backups stored for missing group: ${gid}` });
    }
  }

  lines.push("# BioSCom export report");
  lines.push("");
  lines.push(`Source: ${source.origin}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Per-path record counts");
  lines.push("");
  lines.push("| path | records |");
  lines.push("| --- | ---: |");
  for (const [path, value] of Object.entries(source.paths)) {
    lines.push(`| ${path} | ${recordCount(value)} |`);
  }
  if (source.missing.length > 0) {
    lines.push("");
    lines.push(`Missing/empty paths (skipped): ${source.missing.join(", ")}`);
  }
  lines.push("");
  lines.push("## Counts vs stale baseline (floor, not truth — below baseline is flagged)");
  lines.push("");
  lines.push("| metric | actual | baseline | verdict |");
  lines.push("| --- | ---: | ---: | --- |");
  const metrics: Array<[string, number]> = [
    ["groups", groupIds.size],
    ["users", recordCount(source.paths.users)],
    ["rooms", totals.rooms],
    ["containers", totals.containers],
    ["shelves", totals.shelves],
    ["chemicals", totals.chemicals],
    ["assetRooms", totals.assetRooms],
    ["assets", totals.assets],
    ["protocols", totals.protocols],
    ["history", historyEntries],
    ["backups", backupsTotal],
  ];
  for (const [metric, actual] of metrics) {
    const baseline = BASELINE[metric];
    if (baseline === undefined) continue;
    lines.push(`| ${metric} | ${actual} | ${baseline} | ${actual >= baseline ? "ok" : "BELOW BASELINE"} |`);
  }
  lines.push("");
  lines.push("## Per-group tree counts");
  lines.push("");
  lines.push("| group | rooms | containers | shelves | chemicals | assets | assetRooms | protocols |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of perGroup) {
    const c = row.counts;
    lines.push(
      `| ${groupName(row.gid)} (${row.gid}) | ${c.rooms.length} | ${c.containers.length} | ${c.shelves.length} | ${c.chemicals.length} | ${c.assets.length} | ${c.assetRooms.length} | ${c.protocols.length} |`,
    );
  }
  lines.push("");
  lines.push("## History range");
  lines.push("");
  lines.push(`Entries: ${historyEntries}`);
  lines.push(`Oldest: ${oldest === null ? "n/a" : `${iso(oldest)} (${oldest})`}`);
  lines.push(`Newest: ${newest === null ? "n/a" : `${iso(newest)} (${newest})`}`);
  lines.push("");
  lines.push("## Invariant checks");
  lines.push("");
  if (violations.length === 0) {
    lines.push("All invariants green: users→groups, sharedContainers→groups, inventories↔groups, backups→groups.");
  } else {
    lines.push(`**${violations.length} violation(s):**`);
    lines.push("");
    for (const violation of violations) {
      lines.push(`- [${violation.check}] ${violation.detail}`);
    }
  }
  lines.push("");

  mkdirSync(reportsDir, { recursive: true });
  const reportFile = join(reportsDir, "export-report.md");
  writeFileSync(reportFile, `${lines.join("\n")}\n`);

  console.log(`Report written to ${reportFile}`);
  console.log(`Groups: ${groupIds.size} · inventory docs: ${inventoryDocIds.length} · history entries: ${historyEntries}`);
  console.log(
    `Tree totals: ${totals.rooms} rooms · ${totals.containers} containers · ${totals.shelves} shelves · ${totals.chemicals} chemicals · ${totals.assets} assets · ${totals.protocols} protocols`,
  );
  if (violations.length === 0) {
    console.log("Invariants: all green");
  } else {
    console.error(`INVARIANT VIOLATIONS (${violations.length}):`);
    for (const violation of violations) {
      console.error(`  [${violation.check}] ${violation.detail}`);
    }
  }
  if (values.check) {
    process.exit(violations.length === 0 ? 0 : 1);
  }
}

main();
