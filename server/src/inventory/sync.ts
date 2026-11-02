import type Database from "better-sqlite3";
import { InventoryTreeSchema, validateAttributes as validateMaterialAttributes, type Chemical, type InventoryTree } from "@bioscom/shared";
import { loadDoc } from "./doc.js";

const KNOWN_CHEMICAL_KEYS = new Set([
  "id",
  "name",
  "cas",
  "formula",
  "quantity",
  "unit",
  "concentration",
  "concUnit",
  "position",
  "customPosition",
  "_shelfOverride",
  "note",
  "barcode",
  "type",
  "attributes",
  "product",
  "lotCode",
  "originType",
  "expiresAt",
  "receivedAt",
  "preparedAt",
  "preparedBy",
  "batchInfo",
]);

interface Count {
  doc: number;
  db: number;
}

export interface GroupSyncReport {
  groupId: string;
  ok: boolean;
  anomaly?: string;
  rooms: Count;
  containers: Count;
  shelves: Count;
  chemicals: Count;
}

function legacyFields(ch: Chemical): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const raw = ch as unknown as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (KNOWN_CHEMICAL_KEYS.has(key)) continue;
    if (raw[key] === undefined) continue;
    out[key] = raw[key];
  }
  return out;
}

function chemicalTypeKey(ch: Chemical): string {
  return typeof ch.type === "string" && ch.type.trim() !== "" ? ch.type : "chemical";
}

function chemicalAttributes(ch: Chemical): Record<string, unknown> {
  const type = chemicalTypeKey(ch);
  const source: Record<string, unknown> = { ...(ch.attributes ?? {}) };
  if (type === "chemical") {
    if (ch.cas !== undefined && ch.cas !== null && ch.cas !== "") source.cas_number = ch.cas;
    if (ch.formula !== undefined && ch.formula !== null && ch.formula !== "") source.molecular_formula = ch.formula;
  }
  const legacy = legacyFields(ch);
  if (Object.keys(legacy).length > 0) source.legacy_fields = legacy;
  const validation = validateMaterialAttributes(type, source);
  return validation.ok ? (validation.value as Record<string, unknown>) : source;
}

interface LocationInsert {
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
  sort_index: number;
}

const UPSERT_LOCATION_SQL = `
INSERT INTO locations (id, group_id, parent_id, kind, name, description, container_type, emoji, color,
  rack_name, box_name, parent_shelf_id, is_range_shelf, range_start, range_end, owner_group_id,
  owner_group_name, rack_positions, sort_index, created_at, updated_at)
VALUES (@id, @group_id, @parent_id, @kind, @name, @description, @container_type, @emoji, @color,
  @rack_name, @box_name, @parent_shelf_id, @is_range_shelf, @range_start, @range_end, @owner_group_id,
  @owner_group_name, @rack_positions, @sort_index, @created_at, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  group_id = excluded.group_id, parent_id = excluded.parent_id, kind = excluded.kind,
  name = excluded.name, description = excluded.description, container_type = excluded.container_type,
  emoji = excluded.emoji, color = excluded.color, rack_name = excluded.rack_name,
  box_name = excluded.box_name, parent_shelf_id = excluded.parent_shelf_id,
  is_range_shelf = excluded.is_range_shelf, range_start = excluded.range_start,
  range_end = excluded.range_end, owner_group_id = excluded.owner_group_id,
  owner_group_name = excluded.owner_group_name, rack_positions = excluded.rack_positions,
  sort_index = excluded.sort_index, updated_at = excluded.updated_at`;

const UPSERT_MATERIAL_SQL = `
INSERT INTO materials (id, group_id, type_key, name, description, attributes, created_at, updated_at, archived_at)
VALUES (@id, @group_id, @type_key, @name, @description, @attributes, @created_at, @updated_at, NULL)
ON CONFLICT(id) DO UPDATE SET
  group_id = excluded.group_id, type_key = excluded.type_key, name = excluded.name,
  description = excluded.description, attributes = excluded.attributes, updated_at = excluded.updated_at`;

const UPSERT_BATCH_SQL = `
INSERT INTO batches (id, material_id, product_id, lot_code, origin_type, received_at, prepared_at,
  prepared_by, expires_at, attributes, created_at, updated_at)
VALUES (@id, @material_id, @product_id, @lot_code, @origin_type, @received_at, @prepared_at,
  @prepared_by, @expires_at, '{}', @created_at, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  product_id = excluded.product_id, lot_code = excluded.lot_code, origin_type = excluded.origin_type,
  received_at = excluded.received_at, prepared_at = excluded.prepared_at,
  prepared_by = excluded.prepared_by, expires_at = excluded.expires_at,
  updated_at = excluded.updated_at`;

const UPSERT_PRODUCT_SQL = `
INSERT INTO products (id, material_id, manufacturer_name, supplier_name, catalog_number, product_name,
  variant, attributes, created_at, updated_at)
VALUES (@id, @material_id, @manufacturer_name, @supplier_name, @catalog_number, @product_name,
  @variant, '{}', @created_at, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  manufacturer_name = excluded.manufacturer_name, supplier_name = excluded.supplier_name,
  catalog_number = excluded.catalog_number, product_name = excluded.product_name,
  variant = excluded.variant, updated_at = excluded.updated_at`;

function productFieldsPresent(ch: Chemical): boolean {
  if (ch.product === undefined || ch.product === null) return false;
  const p = ch.product as Record<string, unknown>;
  return ["manufacturer", "supplier", "catalogNumber", "productName", "variant"].some(
    (key) => typeof p[key] === "string" && (p[key] as string).trim() !== "",
  );
}

const UPSERT_STOCK_SQL = `
INSERT INTO stocks (id, group_id, batch_id, location_id, position, custom_position, shelf_override,
  current_quantity, quantity_unit, concentration, concentration_unit, note, barcode, status, container_type,
  created_at, updated_at)
VALUES (@id, @group_id, @batch_id, @location_id, @position, @custom_position, @shelf_override,
  @current_quantity, @quantity_unit, @concentration, @concentration_unit, @note, @barcode, 'available', NULL,
  @created_at, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  group_id = excluded.group_id, batch_id = excluded.batch_id, location_id = excluded.location_id,
  position = excluded.position, custom_position = excluded.custom_position,
  shelf_override = excluded.shelf_override, current_quantity = excluded.current_quantity,
  quantity_unit = excluded.quantity_unit, concentration = excluded.concentration,
  concentration_unit = excluded.concentration_unit, note = excluded.note,
  barcode = excluded.barcode, status = excluded.status, updated_at = excluded.updated_at`;

function countChemsInTree(tree: InventoryTree): { rooms: number; containers: number; shelves: number; chemicals: number } {
  let containers = 0;
  let shelves = 0;
  let chemicals = 0;
  for (const room of tree.rooms) {
    containers += (room.containers ?? []).length;
    for (const cont of room.containers ?? []) {
      shelves += (cont.shelves ?? []).length;
      for (const shelf of cont.shelves ?? []) {
        chemicals += (shelf.chemicals ?? []).length;
      }
    }
  }
  return { rooms: tree.rooms.length, containers, shelves, chemicals };
}

export function syncGroupInventoryDocument(db: Database.Database, groupId: string, tree: InventoryTree): GroupSyncReport {
  const now = Date.now();
  const upsertLocation = db.prepare(UPSERT_LOCATION_SQL);
  const upsertMaterial = db.prepare(UPSERT_MATERIAL_SQL);
  const upsertBatch = db.prepare(UPSERT_BATCH_SQL);
  const upsertProduct = db.prepare(UPSERT_PRODUCT_SQL);
  const deleteOrphanProduct = db.prepare(
    "DELETE FROM products WHERE id = ? AND NOT EXISTS (SELECT 1 FROM batches WHERE product_id = ?)",
  );
  const upsertStock = db.prepare(UPSERT_STOCK_SQL);
  const insertShare = db.prepare(
    "INSERT OR IGNORE INTO container_shares (container_location_id, group_id) VALUES (?, ?)",
  );
  const deleteShares = db.prepare("DELETE FROM container_shares WHERE container_location_id = ?");
  const upsertMap = db.prepare(
    `INSERT OR IGNORE INTO legacy_chemical_map (group_id, chemical_id, material_id, batch_id, stock_id, migrated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const existingMapRows = db
    .prepare("SELECT chemical_id, material_id FROM legacy_chemical_map WHERE group_id = ?")
    .all(groupId) as Array<{ chemical_id: string; material_id: string }>;
  const materialResolution = new Map<string, string>(existingMapRows.map((row) => [row.chemical_id, row.material_id]));

  const docLocationIds = new Set<string>();
  const docChemicalIds = new Set<string>();
  tree.rooms.forEach((room, roomIndex) => {
    const roomLocation: LocationInsert = {
      id: room.id,
      group_id: groupId,
      parent_id: null,
      kind: "room",
      name: room.name ?? "",
      description: room.description ?? null,
      container_type: null,
      emoji: null,
      color: null,
      rack_name: null,
      box_name: null,
      parent_shelf_id: null,
      is_range_shelf: null,
      range_start: null,
      range_end: null,
      owner_group_id: null,
      owner_group_name: null,
      rack_positions: null,
      sort_index: roomIndex,
    };
    upsertLocation.run({ ...roomLocation, created_at: now, updated_at: now });
    docLocationIds.add(room.id);

    (room.containers ?? []).forEach((cont, contIndex) => {
      upsertLocation.run({
        id: cont.id,
        group_id: groupId,
        parent_id: room.id,
        kind: "container",
        name: cont.name ?? "",
        description: cont.description ?? null,
        container_type: cont.type,
        emoji: cont.emoji ?? null,
        color: null,
        rack_name: null,
        box_name: null,
        parent_shelf_id: null,
        is_range_shelf: null,
        range_start: null,
        range_end: null,
        owner_group_id: cont.ownerGroupId ?? null,
        owner_group_name: cont.ownerGroupName ?? null,
        rack_positions: cont.rackPositions ? JSON.stringify(cont.rackPositions) : null,
        sort_index: contIndex,
        created_at: now,
        updated_at: now,
      } satisfies LocationInsert & { created_at: number; updated_at: number });
      docLocationIds.add(cont.id);
      deleteShares.run(cont.id);
      for (const targetGroupId of cont.sharedWithGroupIds ?? []) {
        insertShare.run(cont.id, targetGroupId);
      }

      (cont.shelves ?? []).forEach((shelf, shelfIndex) => {
        upsertLocation.run({
          id: shelf.id,
          group_id: groupId,
          parent_id: cont.id,
          kind: "shelf",
          name: shelf.name ?? "",
          description: null,
          container_type: null,
          emoji: null,
          color: shelf.color ?? null,
          rack_name: shelf.rackName ?? null,
          box_name: shelf.boxName ?? null,
          parent_shelf_id: shelf.parentShelfId ?? null,
          is_range_shelf: shelf.isRangeShelf === true ? 1 : null,
          range_start: shelf.rangeStart ?? null,
          range_end: shelf.rangeEnd ?? null,
          owner_group_id: null,
          owner_group_name: null,
          rack_positions: null,
          sort_index: shelfIndex,
          created_at: now,
          updated_at: now,
        } satisfies LocationInsert & { created_at: number; updated_at: number });
        docLocationIds.add(shelf.id);

        for (const ch of shelf.chemicals ?? []) {
          docChemicalIds.add(ch.id);
          const derivedMaterialId = `m-${ch.id}`;
          const materialId = materialResolution.get(ch.id) ?? derivedMaterialId;
          const batchId = `b-${ch.id}`;
          const productId = `p-${ch.id}`;
          const hasProduct = productFieldsPresent(ch);
          if (materialId === derivedMaterialId) {
            upsertMaterial.run({
              id: materialId,
              group_id: groupId,
              type_key: chemicalTypeKey(ch),
              name: ch.name ?? "",
              description: null,
              attributes: JSON.stringify(chemicalAttributes(ch)),
              created_at: now,
              updated_at: now,
            });
          }
          if (hasProduct) {
            upsertProduct.run({
              id: productId,
              material_id: materialId,
              manufacturer_name: ch.product?.manufacturer ?? null,
              supplier_name: ch.product?.supplier ?? null,
              catalog_number: ch.product?.catalogNumber ?? null,
              product_name: ch.product?.productName ?? null,
              variant: ch.product?.variant ?? null,
              created_at: now,
              updated_at: now,
            });
          }
          const batchInfo = ch.batchInfo;
          upsertBatch.run({
            id: batchId,
            material_id: materialId,
            product_id: hasProduct ? productId : null,
            lot_code: batchInfo?.lotCode ?? null,
            origin_type: batchInfo?.originType ?? "unknown",
            received_at: batchInfo?.receivedAt ?? null,
            prepared_at: batchInfo?.preparedAt ?? null,
            prepared_by: batchInfo?.preparedBy ?? null,
            expires_at: batchInfo?.expiresAt ?? null,
            created_at: now,
            updated_at: now,
          });
          if (!hasProduct) {
            deleteOrphanProduct.run(productId, productId);
          }
          upsertStock.run({
            id: ch.id,
            group_id: groupId,
            batch_id: batchId,
            location_id: shelf.id,
            position: ch.position ?? null,
            custom_position: ch.customPosition ?? null,
            shelf_override: ch._shelfOverride ?? null,
            current_quantity: typeof ch.quantity === "number" && Number.isFinite(ch.quantity) ? ch.quantity : null,
            quantity_unit: ch.unit ?? null,
            concentration: typeof ch.concentration === "number" && Number.isFinite(ch.concentration) ? ch.concentration : null,
            concentration_unit: ch.concUnit ?? null,
            note: ch.note ?? null,
            barcode: typeof ch.barcode === "string" && ch.barcode.trim() !== "" ? ch.barcode.trim() : null,
            created_at: now,
            updated_at: now,
          });
          upsertMap.run(groupId, ch.id, materialId, batchId, ch.id, now);
        }
      });
    });
  });

  const existingRows = db
    .prepare("SELECT chemical_id, material_id, batch_id, stock_id FROM legacy_chemical_map WHERE group_id = ?")
    .all(groupId) as Array<{ chemical_id: string; material_id: string; batch_id: string; stock_id: string }>;
  const staleRows = existingRows.filter((row) => !docChemicalIds.has(row.chemical_id));
  const deleteStock = db.prepare("DELETE FROM stocks WHERE id = ?");
  const deleteBatch = db.prepare("DELETE FROM batches WHERE id = ?");
  const deleteMaterial = db.prepare("DELETE FROM materials WHERE id = ?");
  const deleteMapRow = db.prepare("DELETE FROM legacy_chemical_map WHERE group_id = ? AND chemical_id = ?");
  const deleteInputsByStock = db.prepare("DELETE FROM batch_inputs WHERE source_stock_id = ?");
  const deleteInputsByBatch = db.prepare("DELETE FROM batch_inputs WHERE output_batch_id = ?");
  const countMapReferences = db.prepare("SELECT COUNT(*) AS n FROM legacy_chemical_map WHERE material_id = ?");
  const staleBatchIds = new Set<string>();
  const candidateMaterialIds = new Set<string>();
  for (const stale of staleRows) {
    deleteInputsByStock.run(stale.stock_id);
    deleteInputsByBatch.run(stale.batch_id);
    deleteStock.run(stale.stock_id);
    staleBatchIds.add(stale.batch_id);
    candidateMaterialIds.add(stale.material_id);
    deleteMapRow.run(groupId, stale.chemical_id);
  }
  for (const batchId of staleBatchIds) {
    deleteBatch.run(batchId);
  }
  for (const materialId of candidateMaterialIds) {
    const referenced = (countMapReferences.get(materialId) as { n: number }).n > 0;
    if (!referenced) {
      deleteMaterial.run(materialId);
    }
  }

  const dbLocations = db
    .prepare("SELECT id FROM locations WHERE group_id = ?")
    .all(groupId) as Array<{ id: string }>;
  const deleteLocation = db.prepare("DELETE FROM locations WHERE id = ?");
  const deleteSharesByLocation = db.prepare("DELETE FROM container_shares WHERE container_location_id = ?");
  for (const loc of dbLocations) {
    if (docLocationIds.has(loc.id)) continue;
    deleteSharesByLocation.run(loc.id);
    deleteLocation.run(loc.id);
  }

  const counts = countChemsInTree(tree);
  const dbCounts = {
    rooms: (db.prepare("SELECT COUNT(*) AS n FROM locations WHERE group_id = ? AND kind = 'room'").get(groupId) as { n: number }).n,
    containers: (db.prepare("SELECT COUNT(*) AS n FROM locations WHERE group_id = ? AND kind = 'container'").get(groupId) as { n: number }).n,
    shelves: (db.prepare("SELECT COUNT(*) AS n FROM locations WHERE group_id = ? AND kind = 'shelf'").get(groupId) as { n: number }).n,
    chemicals: (db.prepare("SELECT COUNT(*) AS n FROM stocks WHERE group_id = ?").get(groupId) as { n: number }).n,
  };

  const reconciled =
    dbCounts.rooms === counts.rooms &&
    dbCounts.containers === counts.containers &&
    dbCounts.shelves === counts.shelves &&
    dbCounts.chemicals === counts.chemicals;

  return {
    groupId,
    ok: reconciled,
    rooms: { doc: counts.rooms, db: dbCounts.rooms },
    containers: { doc: counts.containers, db: dbCounts.containers },
    shelves: { doc: counts.shelves, db: dbCounts.shelves },
    chemicals: { doc: counts.chemicals, db: dbCounts.chemicals },
  };
}

export function syncGroupInventory(db: Database.Database, groupId: string): GroupSyncReport {
  const { tree } = loadDoc(db, groupId);
  return syncGroupInventoryDocument(db, groupId, tree);
}

export function markSynced(db: Database.Database, groupId: string, docVersion: number): void {
  db.prepare(
    `INSERT INTO inventory_sync_state (group_id, doc_version, synced_at) VALUES (?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET doc_version = excluded.doc_version, synced_at = excluded.synced_at`,
  ).run(groupId, docVersion, Date.now());
}

function ensureSyncStateTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_sync_state (
    group_id TEXT PRIMARY KEY,
    doc_version INTEGER NOT NULL DEFAULT 0,
    synced_at INTEGER NOT NULL DEFAULT 0
  )`);
}

export function ensureBackfilled(db: Database.Database): GroupSyncReport[] {
  ensureSyncStateTable(db);
  const staleDocs = db
    .prepare(
      `SELECT d.group_id, d.version FROM group_inventory_docs d
       LEFT JOIN inventory_sync_state s ON s.group_id = d.group_id
       WHERE COALESCE(s.doc_version, -1) != COALESCE(d.version, 0)`,
    )
    .all() as Array<{ group_id: string; version: number }>;
  if (staleDocs.length === 0) return [];

  const reports: GroupSyncReport[] = [];
  const runOne = db.transaction((groupId: string, version: number): GroupSyncReport => {
    try {
      const row = db.prepare("SELECT tree FROM group_inventory_docs WHERE group_id = ?").get(groupId) as
        | { tree: string }
        | undefined;
      if (row === undefined) {
        return { groupId, ok: false, anomaly: "inventory document missing", rooms: zeroCount(), containers: zeroCount(), shelves: zeroCount(), chemicals: zeroCount() };
      }
      let raw: unknown;
      try {
        raw = JSON.parse(row.tree);
      } catch {
        return { groupId, ok: false, anomaly: "inventory document corrupt (json)", rooms: zeroCount(), containers: zeroCount(), shelves: zeroCount(), chemicals: zeroCount() };
      }
      const parsed = InventoryTreeSchema.safeParse(raw);
      if (!parsed.success) {
        return { groupId, ok: false, anomaly: "inventory document corrupt (zod)", rooms: zeroCount(), containers: zeroCount(), shelves: zeroCount(), chemicals: zeroCount() };
      }
      const report = syncGroupInventoryDocument(db, groupId, parsed.data);
      markSynced(db, groupId, version);
      return report;
    } catch (error) {
      return {
        groupId,
        ok: false,
        anomaly: `sync crashed: ${error instanceof Error ? error.message : String(error)}`,
        rooms: zeroCount(),
        containers: zeroCount(),
        shelves: zeroCount(),
        chemicals: zeroCount(),
      };
    }
  });
  for (const doc of staleDocs) {
    reports.push(runOne(doc.group_id, doc.version));
  }
  return reports;
}

function zeroCount(): Count {
  return { doc: 0, db: 0 };
}
