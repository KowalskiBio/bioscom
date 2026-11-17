import type Database from "better-sqlite3";
import { InventoryTreeSchema, type InventoryTree } from "@bioscom/shared";
import { markSynced, syncGroupInventoryDocument } from "./sync.js";

type RawRecord = Record<string, unknown>;

export interface RoomRegistryAnomaly {
  /** Non-sensitive lab/group identifier only; never document contents. */
  groupId: string;
  reason: string;
}

export interface RoomRegistryUnresolvedReference {
  /** Non-sensitive lab/group identifier only; never document contents. */
  groupId: string;
  reason: string;
}

export interface RoomRegistryMigrationReport {
  groupsScanned: number;
  /** Groups whose JSON document was actually updated. */
  groupsChanged: number;
  assetsReassigned: number;
  /** Assets left on an unresolved legacy AssetRoom pointer. */
  assetsPending: number;
  assetRoomsMappedByLink: number;
  assetRoomsMappedByName: number;
  assetRoomsAmbiguous: number;
  assetRoomsUnmatched: number;
  instrumentsChanged: number;
  instrumentsLinkedByName: number;
  instrumentsKept: number;
  instrumentsCleared: number;
  instrumentsAmbiguous: number;
  /**
   * Instrument references whose target/owner document could not be read or
   * validated. These rows are intentionally left exactly as they were.
   */
  instrumentsUnresolved: number;
  /** Ambiguous name matches that were intentionally left unassigned. */
  pendingAmbiguous: number;
  anomalies: RoomRegistryAnomaly[];
  unresolved: RoomRegistryUnresolvedReference[];
}

interface RoomIndex {
  ids: Set<string>;
  byName: Map<string, string[]>;
}

interface AssetRoomResolution {
  targetRoomId: string | null;
  via: "linked" | "name" | "none";
  ambiguous: boolean;
}

interface AssetAssociationCounts {
  changed: boolean;
  assetsReassigned: number;
  assetsPending: number;
  mappedByLink: number;
  mappedByName: number;
  ambiguous: number;
  unmatched: number;
}

interface GroupMigrationResult {
  ok: boolean;
  changed: boolean;
  index: RoomIndex | null;
  counts: AssetAssociationCounts;
  reason?: string;
}

interface InstrumentRow {
  id: string;
  owner_lab_id: string | null;
  room_group_id: string | null;
  room_id: string | null;
  location: string | null;
}

interface InstrumentUpdate {
  id: string;
  roomGroupId: string | null;
  roomId: string | null;
}

interface InstrumentDecision {
  update: InstrumentUpdate | null;
  linkedByName: boolean;
  kept: boolean;
  cleared: boolean;
  ambiguous: boolean;
  /** Set when the row must be preserved because a needed document is unknown. */
  unresolvedGroupId: string | null;
  unresolvedReason: string | null;
}

function unresolvedDecision(groupId: string, reason: string): InstrumentDecision {
  return {
    update: null,
    linkedByName: false,
    kept: false,
    cleared: false,
    ambiguous: false,
    unresolvedGroupId: groupId,
    unresolvedReason: reason,
  };
}

function unchangedDecision(): InstrumentDecision {
  return {
    update: null,
    linkedByName: false,
    kept: false,
    cleared: false,
    ambiguous: false,
    unresolvedGroupId: null,
    unresolvedReason: null,
  };
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Inventory arrays may be RTDB-style maps as well as real arrays. Return the
 * original mutated records in either shape so legacy metadata survives.
 */
function collectionItems(value: unknown): RawRecord[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (isRecord(value)) {
    return Object.values(value).filter(isRecord);
  }
  return [];
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : value;
}

/** Normalisation used only for legacy textual name matching. */
function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "" ? null : normalized;
}

function buildRoomIndex(rawRooms: unknown): RoomIndex {
  const ids = new Set<string>();
  const byName = new Map<string, string[]>();
  for (const room of collectionItems(rawRooms)) {
    const id = nonEmptyString(room.id);
    if (id === null) continue;
    ids.add(id);
    const name = normalizeName(room.name);
    if (name === null) continue;
    const matches = byName.get(name) ?? [];
    matches.push(id);
    byName.set(name, matches);
  }
  return { ids, byName };
}

function resolveAssetRoom(assetRoom: RawRecord, index: RoomIndex): AssetRoomResolution {
  const linkedRoomId = nonEmptyString(assetRoom.linkedRoomId);
  if (linkedRoomId !== null && index.ids.has(linkedRoomId)) {
    return { targetRoomId: linkedRoomId, via: "linked", ambiguous: false };
  }
  const name = normalizeName(assetRoom.name);
  if (name === null) {
    return { targetRoomId: null, via: "none", ambiguous: false };
  }
  const matches = index.byName.get(name) ?? [];
  if (matches.length === 1) {
    return { targetRoomId: matches[0]!, via: "name", ambiguous: false };
  }
  return { targetRoomId: null, via: "none", ambiguous: matches.length > 1 };
}

/**
 * `markSynced` normally relies on `ensureBackfilled` to have created this table
 * first. The migration runs before that boot step, so create the same table
 * idempotently here and keep document+mirror version state consistent.
 */
function ensureSyncStateTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_sync_state (
    group_id TEXT PRIMARY KEY,
    doc_version INTEGER NOT NULL DEFAULT 0,
    synced_at INTEGER NOT NULL DEFAULT 0
  )`);
}

function parseDocument(
  rawText: string,
): { ok: true; raw: RawRecord; tree: InventoryTree } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
  if (!isRecord(raw)) {
    return { ok: false, reason: "document root is not an object" };
  }
  const parsed = InventoryTreeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "document does not match inventory schema" };
  }
  return { ok: true, raw, tree: parsed.data };
}

function migrateAssetAssociations(raw: RawRecord, index: RoomIndex): AssetAssociationCounts {
  const counts: AssetAssociationCounts = {
    changed: false,
    assetsReassigned: 0,
    assetsPending: 0,
    mappedByLink: 0,
    mappedByName: 0,
    ambiguous: 0,
    unmatched: 0,
  };

  const resolutions = new Map<string, AssetRoomResolution>();
  for (const assetRoom of collectionItems(raw.assetRooms)) {
    const resolution = resolveAssetRoom(assetRoom, index);
    const assetRoomId = nonEmptyString(assetRoom.id);
    if (assetRoomId !== null) {
      resolutions.set(assetRoomId, resolution);
    }
    if (resolution.via === "linked") {
      counts.mappedByLink += 1;
      continue;
    }
    if (resolution.via === "name") {
      counts.mappedByName += 1;
      // Persist the exact unique match as an explicit link. This is the only
      // AssetRoom field the migration is allowed to add/change; names and all
      // other legacy metadata stay intact.
      if (assetRoom.linkedRoomId !== resolution.targetRoomId) {
        assetRoom.linkedRoomId = resolution.targetRoomId;
        counts.changed = true;
      }
      continue;
    }
    if (resolution.ambiguous) {
      counts.ambiguous += 1;
    } else {
      counts.unmatched += 1;
    }
  }

  for (const asset of collectionItems(raw.assets)) {
    const legacyRoomId = nonEmptyString(asset.roomId);
    if (legacyRoomId === null) continue;
    const resolution = resolutions.get(legacyRoomId);
    if (resolution === undefined) {
      // Not a legacy AssetRoom pointer (already canonical or unknown): leave it.
      continue;
    }
    if (resolution.targetRoomId === null) {
      // Intentionally left pending with its original deprecated pointer.
      counts.assetsPending += 1;
      continue;
    }
    if (asset.roomId !== resolution.targetRoomId) {
      asset.roomId = resolution.targetRoomId;
      counts.assetsReassigned += 1;
      counts.changed = true;
    }
  }

  return counts;
}

function emptyCounts(): AssetAssociationCounts {
  return {
    changed: false,
    assetsReassigned: 0,
    assetsPending: 0,
    mappedByLink: 0,
    mappedByName: 0,
    ambiguous: 0,
    unmatched: 0,
  };
}

/**
 * Update one group document inside its own transaction. A failure rolls back
 * only that group's document write, mirror sync, version and history state.
 */
function migrateGroupDocument(db: Database.Database, groupId: string): GroupMigrationResult {
  const run = db.transaction((): GroupMigrationResult => {
    const row = db
      .prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = ?")
      .get(groupId) as { tree: string; version: number } | undefined;
    if (row === undefined) {
      return { ok: false, changed: false, index: null, counts: emptyCounts(), reason: "inventory document missing" };
    }
    const parsed = parseDocument(row.tree);
    if (!parsed.ok) {
      return { ok: false, changed: false, index: null, counts: emptyCounts(), reason: parsed.reason };
    }

    const index = buildRoomIndex(parsed.raw.rooms);
    const counts = migrateAssetAssociations(parsed.raw, index);
    if (!counts.changed) {
      return { ok: true, changed: false, index, counts };
    }

    const typed = InventoryTreeSchema.safeParse(parsed.raw);
    if (!typed.success) {
      throw new Error("migration produced an invalid inventory document");
    }
    const nextVersion = row.version + 1;
    db.prepare("UPDATE group_inventory_docs SET tree = ?, version = ? WHERE group_id = ?").run(
      JSON.stringify(parsed.raw),
      nextVersion,
      groupId,
    );
    syncGroupInventoryDocument(db, groupId, typed.data);
    markSynced(db, groupId, nextVersion);
    return { ok: true, changed: true, index, counts };
  });

  try {
    return run();
  } catch (error) {
    console.error(
      `[room-registry-migration] group ${groupId} update failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, changed: false, index: null, counts: emptyCounts(), reason: "inventory document update failed" };
  }
}

function matchLocation(location: string | null, index: RoomIndex | null): { roomId: string | null; ambiguous: boolean } {
  if (index === null) return { roomId: null, ambiguous: false };
  const name = normalizeName(location);
  if (name === null) return { roomId: null, ambiguous: false };
  const matches = index.byName.get(name) ?? [];
  if (matches.length === 1) return { roomId: matches[0]!, ambiguous: false };
  return { roomId: null, ambiguous: matches.length > 1 };
}

function decideInstrument(row: InstrumentRow, indexes: Map<string, RoomIndex | null>): InstrumentDecision {
  const ownerLabId = nonEmptyString(row.owner_lab_id);
  const roomGroupId = nonEmptyString(row.room_group_id);
  const roomId = nonEmptyString(row.room_id);
  const hasCompletePair = roomGroupId !== null && roomId !== null;

  if (hasCompletePair) {
    const targetIndex = indexes.get(roomGroupId);
    if (targetIndex === undefined || targetIndex === null) {
      // The target document is missing/corrupt/schema-invalid or failed its
      // mirror sync. Missing is unknown, not proof that the room was deleted.
      // Preserve the pair exactly and never fall through to stale/null logic.
      return unresolvedDecision(roomGroupId, "instrument target document unavailable");
    }
    if (targetIndex.ids.has(roomId)) {
      // Valid explicit pair, including an intentionally allowed owner-null or
      // superadmin cross-group pointer. The owning lab's document is irrelevant.
      return {
        update: null,
        linkedByName: false,
        kept: true,
        cleared: false,
        ambiguous: false,
        unresolvedGroupId: null,
        unresolvedReason: null,
      };
    }
    // The readable target document affirmatively does not contain the room:
    // the pair is genuinely stale. It may only be replaced by a safe name
    // match in the instrument's own owning lab, never across labs.
    if (ownerLabId !== null) {
      const ownerIndex = indexes.get(ownerLabId);
      if (ownerIndex === undefined || ownerIndex === null) {
        return unresolvedDecision(ownerLabId, "instrument owner document unavailable");
      }
      const match = matchLocation(row.location, ownerIndex);
      if (match.roomId !== null) {
        return {
          update: { id: row.id, roomGroupId: ownerLabId, roomId: match.roomId },
          linkedByName: true,
          kept: false,
          cleared: false,
          ambiguous: false,
          unresolvedGroupId: null,
          unresolvedReason: null,
        };
      }
      if (match.ambiguous) {
        return {
          update: { id: row.id, roomGroupId: null, roomId: null },
          linkedByName: false,
          kept: false,
          cleared: true,
          ambiguous: true,
          unresolvedGroupId: null,
          unresolvedReason: null,
        };
      }
    }
    return {
      update: { id: row.id, roomGroupId: null, roomId: null },
      linkedByName: false,
      kept: false,
      cleared: true,
      ambiguous: false,
      unresolvedGroupId: null,
      unresolvedReason: null,
    };
  }

  // Half-pair or no pair. A name match is only allowed inside the owning lab
  // and is never inferred from an owner name. Null owner stays unassigned.
  let ambiguous = false;
  if (ownerLabId !== null) {
    const ownerIndex = indexes.get(ownerLabId);
    if (ownerIndex === undefined || ownerIndex === null) {
      if (roomGroupId !== null || roomId !== null) {
        // Do not collapse a half-pair when the owning lab document is unknown.
        return unresolvedDecision(ownerLabId, "instrument owner document unavailable");
      }
      return unchangedDecision();
    }
    const match = matchLocation(row.location, ownerIndex);
    ambiguous = match.ambiguous;
    if (match.roomId !== null) {
      return {
        update: { id: row.id, roomGroupId: ownerLabId, roomId: match.roomId },
        linkedByName: true,
        kept: false,
        cleared: false,
        ambiguous: false,
        unresolvedGroupId: null,
        unresolvedReason: null,
      };
    }
  }

  if (roomGroupId === null && roomId === null) {
    // Already unassigned; no write and no history.
    return {
      update: null,
      linkedByName: false,
      kept: false,
      cleared: false,
      ambiguous,
      unresolvedGroupId: null,
      unresolvedReason: null,
    };
  }
  return {
    update: { id: row.id, roomGroupId: null, roomId: null },
    linkedByName: false,
    kept: false,
    cleared: true,
    ambiguous,
    unresolvedGroupId: null,
    unresolvedReason: null,
  };
}

function blankReport(): RoomRegistryMigrationReport {
  return {
    groupsScanned: 0,
    groupsChanged: 0,
    assetsReassigned: 0,
    assetsPending: 0,
    assetRoomsMappedByLink: 0,
    assetRoomsMappedByName: 0,
    assetRoomsAmbiguous: 0,
    assetRoomsUnmatched: 0,
    instrumentsChanged: 0,
    instrumentsLinkedByName: 0,
    instrumentsKept: 0,
    instrumentsCleared: 0,
    instrumentsAmbiguous: 0,
    instrumentsUnresolved: 0,
    pendingAmbiguous: 0,
    anomalies: [],
    unresolved: [],
  };
}

interface HistoryAccumulator {
  assets: number;
  instruments: number;
}

function addHistory(
  history: Map<string, HistoryAccumulator>,
  groupId: string,
  change: Partial<HistoryAccumulator>,
): void {
  if (groupId === "") return;
  const current = history.get(groupId) ?? { assets: 0, instruments: 0 };
  current.assets += change.assets ?? 0;
  current.instruments += change.instruments ?? 0;
  history.set(groupId, current);
}

/**
 * One-time, idempotent canonical-room migration (SQL version 0011).
 *
 * The existing `tree.rooms` collection is the only physical-room registry.
 * This function converts legacy metadata references in place and never adds,
 * renames or deletes physical rooms, assets, stock, barcodes or notes.
 */
export function runRoomRegistryMigration(db: Database.Database): RoomRegistryMigrationReport {
  // Direct replay (after operator remediation) must be atomic exactly like the
  // normal startup path, where runMigrations already wraps this call in its
  // 0011 transaction. Per-group work becomes savepoints; a late failure such as
  // a history insert rolls back every document, mirror, sync-state, instrument
  // and history write instead of leaving a silent no-op retry behind.
  const execute = db.transaction(performRoomRegistryMigration);
  return execute(db);
}

function performRoomRegistryMigration(db: Database.Database): RoomRegistryMigrationReport {
  ensureSyncStateTable(db);
  const report = blankReport();
  const history = new Map<string, HistoryAccumulator>();
  const indexes = new Map<string, RoomIndex | null>();

  const docs = db.prepare("SELECT group_id FROM group_inventory_docs ORDER BY group_id").all() as Array<{
    group_id: string;
  }>;
  for (const doc of docs) {
    report.groupsScanned += 1;
    const result = migrateGroupDocument(db, doc.group_id);
    if (!result.ok) {
      report.anomalies.push({ groupId: doc.group_id, reason: result.reason ?? "unknown error" });
    } else {
      indexes.set(doc.group_id, result.index);
      const counts = result.counts;
      report.assetsReassigned += counts.assetsReassigned;
      report.assetsPending += counts.assetsPending;
      report.assetRoomsMappedByLink += counts.mappedByLink;
      report.assetRoomsMappedByName += counts.mappedByName;
      report.assetRoomsAmbiguous += counts.ambiguous;
      report.assetRoomsUnmatched += counts.unmatched;
      if (result.changed) {
        report.groupsChanged += 1;
        addHistory(history, doc.group_id, { assets: counts.assetsReassigned });
      }
      if (counts.ambiguous > 0 || counts.assetsPending > 0) {
        console.warn(
          `[room-registry-migration] group ${doc.group_id}: ${counts.ambiguous} ambiguous asset room(s), ${counts.assetsPending} pending asset(s) left unassigned`,
        );
      }
    }
  }

  const instruments = db
    .prepare("SELECT id, owner_lab_id, room_group_id, room_id, location FROM instruments ORDER BY id")
    .all() as InstrumentRow[];
  const updatesByGroup = new Map<string, InstrumentUpdate[]>();
  const reportedUnresolved = new Set<string>();
  for (const instrument of instruments) {
    const decision = decideInstrument(instrument, indexes);
    if (decision.unresolvedGroupId !== null) {
      report.instrumentsUnresolved += 1;
      const reason = decision.unresolvedReason ?? "instrument reference unresolved";
      const key = `${decision.unresolvedGroupId}\u0000${reason}`;
      if (!reportedUnresolved.has(key)) {
        reportedUnresolved.add(key);
        report.unresolved.push({ groupId: decision.unresolvedGroupId, reason });
      }
    }
    if (decision.kept) report.instrumentsKept += 1;
    if (decision.linkedByName) report.instrumentsLinkedByName += 1;
    if (decision.cleared) report.instrumentsCleared += 1;
    if (decision.ambiguous) report.instrumentsAmbiguous += 1;
    if (decision.update === null) continue;
    report.instrumentsChanged += 1;
    const groupKey =
      nonEmptyString(instrument.owner_lab_id) ??
      nonEmptyString(instrument.room_group_id) ??
      "";
    const groupUpdates = updatesByGroup.get(groupKey) ?? [];
    groupUpdates.push(decision.update);
    updatesByGroup.set(groupKey, groupUpdates);
  }

  const updateInstrument = db.prepare(
    "UPDATE instruments SET room_group_id = ?, room_id = ? WHERE id = ?",
  );
  for (const [groupKey, updates] of updatesByGroup) {
    const apply = db.transaction((): void => {
      for (const update of updates) {
        updateInstrument.run(update.roomGroupId, update.roomId, update.id);
      }
    });
    try {
      apply();
      addHistory(history, groupKey, { instruments: updates.length });
    } catch (error) {
      console.error(
        `[room-registry-migration] instrument group ${groupKey || "<unowned>"} update failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      report.anomalies.push({
        groupId: groupKey || "<unowned>",
        reason: "instrument link update failed",
      });
    }
  }

  const insertHistory = db.prepare(
    "INSERT INTO history (group_id, timestamp, user_name, action) VALUES (?, ?, ?, ?)",
  );
  for (const [groupId, change] of history) {
    const parts: string[] = [];
    if (change.assets > 0) parts.push(`${change.assets} asset(s)`);
    if (change.instruments > 0) parts.push(`${change.instruments} instrument(s)`);
    if (parts.length === 0) continue;
    insertHistory.run(
      groupId,
      Date.now(),
      "system",
      `Room registry migration 0011: mapped ${parts.join(", ")}`,
    );
  }

  report.pendingAmbiguous = report.assetRoomsAmbiguous + report.instrumentsAmbiguous;
  if (report.anomalies.length > 0) {
    console.warn(
      `[room-registry-migration] ${report.anomalies.length} anomaly(ies): ${JSON.stringify(report.anomalies)}`,
    );
  }
  return report;
}
