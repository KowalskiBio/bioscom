import type Database from "better-sqlite3";
import type { Chemical, Container, InventoryTree, Room, Shelf } from "@bioscom/shared";
import { loadDoc } from "./doc.js";

interface LocationRow {
  id: string;
  group_id: string;
  parent_id: string | null;
  kind: string;
  name: string;
  description: string | null;
  container_type: string | null;
  emoji: string | null;
  color: string | null;
  rack_name: string | null;
  box_name: string | null;
  parent_shelf_id: string | null;
  is_range_shelf: number | null;
  range_start: string | null;
  range_end: string | null;
  owner_group_id: string | null;
  owner_group_name: string | null;
  rack_positions: string | null;
  sort_index: number | null;
}

interface StockJoinRow {
  id: string;
  location_id: string;
  position: string | null;
  custom_position: string | null;
  shelf_override: string | null;
  current_quantity: number | null;
  quantity_unit: string | null;
  concentration: number | null;
  concentration_unit: string | null;
  note: string | null;
  barcode: string | null;
  status: string;
  container_type: string | null;
  material_name: string;
  type_key: string;
  material_attributes: string;
  material_description: string | null;
  lot_code: string | null;
  origin_type: string | null;
  received_at: number | null;
  prepared_at: number | null;
  prepared_by: string | null;
  expires_at: number | null;
  product_id: string | null;
  manufacturer_name: string | null;
  supplier_name: string | null;
  catalog_number: string | null;
  product_name: string | null;
  variant: string | null;
}

export interface ParityIssue {
  kind: "missing-in-doc" | "missing-in-relational" | "different";
  entity: "room" | "container" | "shelf" | "chemical";
  id: string;
  detail?: string;
}

function chemFromRow(row: StockJoinRow): Chemical {
  const attributes = JSON.parse(row.material_attributes) as Record<string, unknown>;
  const legacyFields =
    attributes.legacy_fields !== null && typeof attributes.legacy_fields === "object"
      ? (attributes.legacy_fields as Record<string, unknown>)
      : {};
  const { legacy_fields: _drop, ...rest } = attributes;
  const out: Record<string, unknown> = {
    ...legacyFields,
    id: row.id,
    name: row.material_name,
  };
  if (rest.cas_number !== undefined && typeof rest.cas_number === "string") {
    out.cas = rest.cas_number;
    delete rest.cas_number;
  }
  if (rest.molecular_formula !== undefined && typeof rest.molecular_formula === "string") {
    out.formula = rest.molecular_formula;
    delete rest.molecular_formula;
  }
  if (row.current_quantity !== null) out.quantity = row.current_quantity;
  if (row.quantity_unit !== null) out.unit = row.quantity_unit;
  if (row.concentration !== null) out.concentration = row.concentration;
  if (row.concentration_unit !== null) out.concUnit = row.concentration_unit;
  if (row.position !== null) out.position = row.position;
  if (row.custom_position !== null) out.customPosition = row.custom_position;
  if (row.shelf_override !== null) out._shelfOverride = row.shelf_override;
  if (row.note !== null) out.note = row.note;
  if (row.barcode !== null) out.barcode = row.barcode;
  if (row.type_key !== "chemical") out.type = row.type_key;
  if (Object.keys(rest).length > 0) out.attributes = rest;
  if (row.product_id !== null) {
    out.product = {
      ...(row.manufacturer_name !== null ? { manufacturer: row.manufacturer_name } : {}),
      ...(row.supplier_name !== null ? { supplier: row.supplier_name } : {}),
      ...(row.catalog_number !== null ? { catalogNumber: row.catalog_number } : {}),
      ...(row.product_name !== null ? { productName: row.product_name } : {}),
      ...(row.variant !== null ? { variant: row.variant } : {}),
    };
  }
  if (
    row.lot_code !== null ||
    (row.origin_type !== null && row.origin_type !== "unknown") ||
    row.received_at !== null ||
    row.prepared_at !== null ||
    row.prepared_by !== null ||
    row.expires_at !== null
  ) {
    out.batchInfo = {
      ...(row.lot_code !== null ? { lotCode: row.lot_code } : {}),
      ...(row.origin_type !== null && row.origin_type !== "unknown" ? { originType: row.origin_type } : {}),
      ...(row.received_at !== null ? { receivedAt: row.received_at } : {}),
      ...(row.prepared_at !== null ? { preparedAt: row.prepared_at } : {}),
      ...(row.prepared_by !== null ? { preparedBy: row.prepared_by } : {}),
      ...(row.expires_at !== null ? { expiresAt: row.expires_at } : {}),
    } as Chemical["batchInfo"];
  }
  return out as Chemical;
}

function shelfFromRow(sh: LocationRow, chemicals: StockJoinRow[]): Shelf {
  const shelf: Shelf = {
    id: sh.id,
    name: sh.name,
    chemicals: chemicals
      .filter((ch) => ch.location_id === sh.id)
      .map(chemFromRow),
  };
  if (sh.color !== null) shelf.color = sh.color;
  if (sh.parent_shelf_id !== null) shelf.parentShelfId = sh.parent_shelf_id;
  if (sh.box_name !== null) shelf.boxName = sh.box_name;
  if (sh.rack_name !== null) shelf.rackName = sh.rack_name;
  if (sh.is_range_shelf === 1) shelf.isRangeShelf = true;
  if (sh.range_start !== null) shelf.rangeStart = sh.range_start;
  if (sh.range_end !== null) shelf.rangeEnd = sh.range_end;
  return shelf;
}

export function assembleInventoryFromRelational(db: Database.Database, groupId: string): InventoryTree {
  const locations = db
    .prepare("SELECT * FROM locations WHERE group_id = ? ORDER BY sort_index, id")
    .all(groupId) as LocationRow[];
  const shares = db
    .prepare("SELECT container_location_id, group_id FROM container_shares")
    .all() as Array<{ container_location_id: string; group_id: string }>;
  const sharesByContainer = new Map<string, string[]>();
  for (const share of shares) {
    const list = sharesByContainer.get(share.container_location_id) ?? [];
    list.push(share.group_id);
    sharesByContainer.set(share.container_location_id, list);
  }
  const stocks = db
    .prepare(
      `SELECT s.*, m.name AS material_name, m.type_key AS type_key, m.attributes AS material_attributes,
              NULL AS material_description,
              b.lot_code, b.origin_type, b.received_at, b.prepared_at, b.prepared_by, b.expires_at,
              p.id AS product_id, p.manufacturer_name, p.supplier_name, p.catalog_number, p.product_name, p.variant
       FROM stocks s
       JOIN batches b ON b.id = s.batch_id
       JOIN materials m ON m.id = b.material_id
       LEFT JOIN products p ON p.id = b.product_id
       WHERE s.group_id = ?`,
    )
    .all(groupId) as StockJoinRow[];

  const rooms: Room[] = [];
  for (const room of locations.filter((l) => l.kind === "room")) {
    const containers: Container[] = locations
      .filter((l) => l.kind === "container" && l.parent_id === room.id)
      .map((cont) => {
        const shelves: Shelf[] = locations
          .filter((l) => l.kind === "shelf" && l.parent_id === cont.id)
          .sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0))
          .map((sh) => shelfFromRow(sh, stocks));
        const container: Container = {
          id: cont.id,
          name: cont.name,
          type: (cont.container_type ?? "cabinet") as Container["type"],
          shelves,
          sharedWithGroupIds: sharesByContainer.get(cont.id) ?? [],
        };
        if (cont.description !== null) container.description = cont.description;
        if (cont.emoji !== null) container.emoji = cont.emoji;
        if (cont.rack_positions !== null) {
          container.rackPositions = JSON.parse(cont.rack_positions) as Record<string, number>;
        }
        if (cont.owner_group_id !== null) container.ownerGroupId = cont.owner_group_id;
        if (cont.owner_group_name !== null) container.ownerGroupName = cont.owner_group_name;
        return container;
      });
    const roomOut: Room = {
      id: room.id,
      name: room.name,
      containers,
    };
    if (room.description !== null) roomOut.description = room.description;
    rooms.push(roomOut);
  }
  return {
    rooms,
    assetRooms: [],
    assets: [],
    protocols: [],
  } as unknown as InventoryTree;
}

function canonicalTree(tree: InventoryTree): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const room of tree.rooms) {
    map.set(`room:${room.id}`, { name: room.name, description: room.description ?? null });
    for (const cont of room.containers ?? []) {
      map.set(`container:${cont.id}`, {
        roomId: room.id,
        name: cont.name,
        type: cont.type,
        description: cont.description ?? null,
        emoji: cont.emoji ?? null,
        sharedWithGroupIds: [...(cont.sharedWithGroupIds ?? [])].sort(),
        ownerGroupId: cont.ownerGroupId ?? null,
        ownerGroupName: cont.ownerGroupName ?? null,
        rackPositions: cont.rackPositions ?? null,
      });
      for (const shelf of cont.shelves ?? []) {
        map.set(`shelf:${shelf.id}`, {
          containerId: cont.id,
          name: shelf.name,
          color: shelf.color ?? null,
          parentShelfId: shelf.parentShelfId ?? null,
          boxName: shelf.boxName ?? null,
          rackName: shelf.rackName ?? null,
          isRangeShelf: shelf.isRangeShelf ?? null,
          rangeStart: shelf.rangeStart ?? null,
          rangeEnd: shelf.rangeEnd ?? null,
        });
        for (const ch of shelf.chemicals ?? []) {
          map.set(`chemical:${ch.id}`, {
            shelfId: shelf.id,
            name: ch.name ?? "",
            cas: ch.cas ?? null,
            formula: ch.formula ?? null,
            quantity: ch.quantity ?? null,
            unit: ch.unit ?? null,
            concentration: ch.concentration ?? null,
            concUnit: ch.concUnit ?? null,
            position: ch.position ?? null,
            customPosition: ch.customPosition ?? null,
            _shelfOverride: ch._shelfOverride ?? null,
            note: ch.note ?? null,
            barcode: ch.barcode ?? null,
            type: ch.type ?? "chemical",
            attributes: ch.attributes ?? null,
            product: ch.product ?? null,
            batchInfo: ch.batchInfo ?? null,
          });
        }
      }
    }
  }
  return map;
}

function normalizeBatchInfo(bi: unknown): Record<string, unknown> {
  if (bi === null || typeof bi !== "object" || Array.isArray(bi)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bi as Record<string, unknown>)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out;
}

function recordsEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "object" && a !== null && !Array.isArray(a) && typeof b === "object" && b !== null && !Array.isArray(b)) {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    for (const key of keys) {
      if (key === "batchInfo") {
        if (!recordsEqual(normalizeBatchInfo(ra[key]), normalizeBatchInfo(rb[key]))) return false;
        continue;
      }
      if (!recordsEqual(ra[key], rb[key])) return false;
    }
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  if (a === undefined || a === null || a === "") {
    return b === undefined || b === null || b === "";
  }
  return a === b;
}

export function checkParity(db: Database.Database, groupId: string): ParityIssue[] {
  const { tree: docTree } = loadDoc(db, groupId);
  const assembled = assembleInventoryFromRelational(db, groupId);
  const docMap = canonicalTree(docTree);
  const relMap = canonicalTree(assembled);
  const issues: ParityIssue[] = [];

  for (const [key, docValue] of docMap) {
    const relValue = relMap.get(key);
    const [entity, id] = key.split(":") as [ParityIssue["entity"], string];
    if (relValue === undefined) {
      issues.push({ kind: "missing-in-relational", entity, id });
    } else if (!recordsEqual(docValue, relValue)) {
      issues.push({ kind: "different", entity, id, detail: `${JSON.stringify(docValue).slice(0, 160)} != ${JSON.stringify(relValue).slice(0, 160)}` });
    }
  }
  for (const key of relMap.keys()) {
    if (!docMap.has(key)) {
      const [entity, id] = key.split(":") as [ParityIssue["entity"], string];
      issues.push({ kind: "missing-in-doc", entity, id });
    }
  }
  return issues;
}

export function ensureParityChecked(db: Database.Database, groupIds?: string[]): ParityIssue[] {
  const ids = groupIds ?? (db.prepare("SELECT group_id FROM group_inventory_docs").all() as Array<{ group_id: string }>).map((r) => r.group_id);
  const issues: ParityIssue[] = [];
  for (const groupId of ids) {
    try {
      issues.push(...checkParity(db, groupId).map((issue) => ({ ...issue, detail: `[${groupId}] ${issue.detail ?? ""}`.trim() })));
    } catch (error) {
      issues.push({
        kind: "different",
        entity: "room",
        id: groupId,
        detail: `parity crashed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return issues;
}
