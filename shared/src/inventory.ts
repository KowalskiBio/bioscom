import { z } from "zod";
import {
  idSchema,
  optionalIdSchema,
  looseTextSchema,
  optionalTextSchema,
  optionalNumberSchema,
  optionalBooleanSchema,
  rtdbArray,
} from "./common.js";
import { GridLayoutDocSchema } from "./grid.js";
import { InstrumentSchema } from "./instrument.js";
import { NoticeSchema } from "./notice.js";
import { PrintCatalogItemSchema, PrintRequestSchema } from "./print.js";

export const ContainerTypeSchema = z.enum(["cabinet", "fridge", "freezer", "crate", "deepfreezer"]);
export const SubContainerTypeSchema = z.enum(["shelf", "door_shelf", "crate", "box"]);
export type SubContainerType = z.infer<typeof SubContainerTypeSchema>;

/**
 * Deep-freezer rack grids are stored as a row/column count. The legacy implicit
 * geometry was a single 32-slot row (8 x 4), so omitted/null dimensions resolve
 * to 8 x 4 and keep every historical slot index meaningful.
 */
export const DEFAULT_RACK_ROWS = 8;
export const DEFAULT_RACK_COLUMNS = 4;
export const MAX_RACK_ROWS = 32;
export const MAX_RACK_COLUMNS = 32;
export const MAX_RACK_SLOTS = MAX_RACK_ROWS * MAX_RACK_COLUMNS;

/**
 * Box shelves are stored at a one-based position inside a rack. Every rack in a
 * deep freezer shares the same shelf capacity (`rackShelves`), which defaults to
 * the historical 13-slot layout when the metadata is missing.
 */
export const DEFAULT_RACK_SHELVES = 13;
export const MAX_RACK_SHELVES = 32;

export interface RackGrid {
  rows: number;
  columns: number;
  capacity: number;
}

function resolveRackDimension(value: number | null | undefined, fallback: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max ? value : fallback;
}

export function resolveRackRows(container: { rackRows?: number | null }): number {
  return resolveRackDimension(container.rackRows, DEFAULT_RACK_ROWS, MAX_RACK_ROWS);
}

export function resolveRackColumns(container: { rackColumns?: number | null }): number {
  return resolveRackDimension(container.rackColumns, DEFAULT_RACK_COLUMNS, MAX_RACK_COLUMNS);
}

export function rackCapacity(container: { rackRows?: number | null; rackColumns?: number | null }): number {
  return resolveRackRows(container) * resolveRackColumns(container);
}

export function resolveRackGrid(container: { rackRows?: number | null; rackColumns?: number | null }): RackGrid {
  const rows = resolveRackRows(container);
  const columns = resolveRackColumns(container);
  return { rows, columns, capacity: rows * columns };
}

/** Returns the first free zero-based slot inside `capacity`, or null when full. */
export function nextFreeRackSlot(positions: Record<string, number>, capacity: number): number | null {
  const used = new Set(Object.values(positions));
  for (let slot = 0; slot < capacity; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

export function resolveRackShelves(container: { rackShelves?: number | null }): number {
  return resolveRackDimension(container.rackShelves, DEFAULT_RACK_SHELVES, MAX_RACK_SHELVES);
}

export interface ShelfPlacement {
  id?: string | null;
  name?: string | null;
  rackName?: string | null;
  boxName?: string | null;
  rackShelf?: number | null;
}

/**
 * Resolves the effective one-based shelf assignment of a box. A stored
 * `rackShelf` always wins; when it is missing, a purely numeric legacy
 * `boxName` ("1", "2", ...) is interpreted as the shelf index. Custom names
 * stay unassigned instead of being renumbered.
 */
export function resolveRackShelfIndex(shelf: { rackShelf?: number | null; boxName?: string | null }): number | null {
  if (shelf.rackShelf !== undefined && shelf.rackShelf !== null) {
    return typeof shelf.rackShelf === "number" && Number.isInteger(shelf.rackShelf) && shelf.rackShelf >= 1
      ? shelf.rackShelf
      : null;
  }
  const boxName = typeof shelf.boxName === "string" ? shelf.boxName.trim() : "";
  if (!/^[1-9]\d*$/.test(boxName)) return null;
  const index = Number(boxName);
  return Number.isInteger(index) ? index : null;
}

/** Returns the first free one-based shelf in `rackName`, or null when full. */
export function nextFreeRackShelf(
  shelves: ReadonlyArray<{ rackName?: string | null; boxName?: string | null; rackShelf?: number | null }>,
  rackName: string,
  capacity: number,
): number | null {
  const used = new Set<number>();
  for (const shelf of shelves) {
    if ((shelf.rackName ?? "") !== rackName) continue;
    const index = resolveRackShelfIndex(shelf);
    if (index !== null) used.add(index);
  }
  for (let index = 1; index <= capacity; index += 1) {
    if (!used.has(index)) return index;
  }
  return null;
}

/**
 * Validates every rack independently against a shared shelf capacity. Boxes
 * with no resolvable index still count toward the rack's quantity but never
 * receive a synthetically invented index.
 */
export function rackShelfFitProblem(shelves: readonly ShelfPlacement[], capacity: number): string | null {
  const racks = new Map<string, ShelfPlacement[]>();
  for (const shelf of shelves) {
    const rackName = shelf.rackName ?? "";
    if (rackName === "") continue;
    const entries = racks.get(rackName) ?? [];
    entries.push(shelf);
    racks.set(rackName, entries);
  }
  for (const [rackName, entries] of racks) {
    if (entries.length > capacity) {
      return `rack "${rackName}" has ${entries.length} boxes but only ${capacity} shelf positions`;
    }
    const owners = new Map<number, string>();
    for (const entry of entries) {
      if (
        entry.rackShelf !== undefined &&
        entry.rackShelf !== null &&
        (!Number.isInteger(entry.rackShelf) || entry.rackShelf < 1)
      ) {
        return `box "${entry.boxName ?? entry.name ?? entry.id ?? "?"}" in rack "${rackName}" has invalid shelf ${entry.rackShelf}`;
      }
      const index = resolveRackShelfIndex(entry);
      if (index === null) continue;
      if (!Number.isInteger(index) || index < 1 || index > capacity) {
        return `box "${entry.boxName ?? entry.name ?? entry.id ?? "?"}" in rack "${rackName}" uses shelf ${index} but capacity is ${capacity}`;
      }
      const label = entry.boxName ?? entry.name ?? entry.id ?? "?";
      const owner = owners.get(index);
      if (owner !== undefined) {
        return `shelf ${index} in rack "${rackName}" is claimed by both "${owner}" and "${label}"`;
      }
      owners.set(index, label);
    }
  }
  return null;
}

/**
 * Checks whether every currently stored placement fits a grid of `capacity`
 * slots. Returns a human-readable problem, or null when the grid fits.
 * Never renumbers or drops placements.
 */
export function rackPositionsFitProblem(positions: Record<string, number>, capacity: number): string | null {
  const owners = new Map<number, string>();
  for (const [name, slot] of Object.entries(positions)) {
    if (!Number.isInteger(slot) || slot < 0) {
      return `rack "${name}" has invalid slot ${slot}`;
    }
    if (slot >= capacity) {
      return `rack "${name}" uses slot ${slot} but a ${capacity}-slot grid ends at ${capacity - 1}`;
    }
    const owner = owners.get(slot);
    if (owner !== undefined) {
      return `slot ${slot} is claimed by both "${owner}" and "${name}"`;
    }
    owners.set(slot, name);
  }
  const rackCount = Object.keys(positions).length;
  if (rackCount > capacity) {
    return `${rackCount} racks cannot fit in ${capacity} slots`;
  }
  return null;
}

export const StockProductSchema = z.looseObject({
  manufacturer: optionalTextSchema,
  supplier: optionalTextSchema,
  catalogNumber: optionalTextSchema,
  productName: optionalTextSchema,
  variant: optionalTextSchema,
});

export const BatchInfoSchema = z.looseObject({
  lotCode: optionalTextSchema,
  originType: z.enum(["purchased", "prepared", "derived", "unknown"]).optional(),
  receivedAt: optionalNumberSchema,
  preparedAt: optionalNumberSchema,
  preparedBy: optionalTextSchema,
  expiresAt: optionalNumberSchema,
});

const ChemicalAttributesDocSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .nullish()
  .catch(undefined);

export const ChemicalSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
  cas: optionalTextSchema,
  formula: optionalTextSchema,
  quantity: optionalNumberSchema,
  unit: optionalTextSchema,
  concentration: optionalNumberSchema,
  concUnit: optionalTextSchema,
  position: optionalTextSchema,
  customPosition: optionalTextSchema,
  _shelfOverride: optionalTextSchema,
  note: optionalTextSchema,
  barcode: optionalTextSchema,
  type: optionalTextSchema,
  attributes: ChemicalAttributesDocSchema,
  product: StockProductSchema.nullish().catch(undefined),
  batchInfo: BatchInfoSchema.nullish().catch(undefined),
});

export const ShelfSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
  type: SubContainerTypeSchema.optional(),
  color: optionalTextSchema,
  parentShelfId: optionalIdSchema,
  boxName: optionalTextSchema,
  rackName: optionalTextSchema,
  rackShelf: z.number().int().min(1).max(MAX_RACK_SHELVES).nullish().catch(undefined),
  isRangeShelf: optionalBooleanSchema,
  rangeStart: optionalTextSchema,
  rangeEnd: optionalTextSchema,
  chemicals: rtdbArray(ChemicalSchema).catch([]),
});

const containerFields = {
  id: idSchema,
  name: looseTextSchema,
  description: optionalTextSchema,
  emoji: optionalTextSchema,
  type: ContainerTypeSchema,
  cabinetMethod: optionalTextSchema,
  customRangeType: optionalTextSchema,
  ownerGroupId: optionalTextSchema,
  ownerGroupName: optionalTextSchema,
  sharedWithGroupId: optionalTextSchema,
  sharedWithGroupIds: rtdbArray(idSchema).catch([]),
  rackRows: z.number().int().min(1).max(MAX_RACK_ROWS).nullish().catch(undefined),
  rackColumns: z.number().int().min(1).max(MAX_RACK_COLUMNS).nullish().catch(undefined),
  rackShelves: z.number().int().min(1).max(MAX_RACK_SHELVES).nullish().catch(undefined),
  rackPositions: z.record(z.string(), z.coerce.number()).nullish().catch(undefined),
  shelves: z.array(ShelfSchema),
  chemicals: rtdbArray(ChemicalSchema).nullish().catch(undefined),
};

export const ContainerSchema = z.looseObject(containerFields);

export const SharedContainerRefSchema = z.looseObject({
  ...containerFields,
  ownerGroupId: idSchema,
});

export const RoomSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
  description: optionalTextSchema,
  containers: rtdbArray(ContainerSchema).catch([]),
  chemicals: rtdbArray(ChemicalSchema).nullish().catch(undefined),
  // Optional doc-only container layout grid for this room. Keyed by stable
  // container ids; corrupt/missing metadata degrades to "no grid".
  containerGrid: GridLayoutDocSchema,
});

export const AssetRoomSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
  // Optional stable link to a physical chemical room in the same group
  // document. Omitted or null keeps the asset room unassigned.
  linkedRoomId: optionalIdSchema,
});

export const AssetSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
  model: optionalTextSchema,
  description: optionalTextSchema,
  barcode: optionalTextSchema,
  barcodeImg: optionalTextSchema,
  roomId: optionalTextSchema,
});

export const ProtocolSchema = z.looseObject({
  id: idSchema,
  title: looseTextSchema,
  content: optionalTextSchema,
});

export const InventoryTreeSchema = z.looseObject({
  rooms: rtdbArray(RoomSchema).catch([]),
  // Optional doc-only room layout grid. Keyed by stable room ids; deep
  // freezers stay in their own rail and are never part of this grid.
  roomGrid: GridLayoutDocSchema,
  deepFreezers: rtdbArray(ContainerSchema).nullish().catch(undefined),
  assetRooms: rtdbArray(AssetRoomSchema).catch([]),
  assets: rtdbArray(AssetSchema).catch([]),
  protocols: rtdbArray(ProtocolSchema).catch([]),
  instruments: rtdbArray(InstrumentSchema).catch([]),
  notices: rtdbArray(NoticeSchema).catch([]),
  printCatalog: rtdbArray(PrintCatalogItemSchema).catch([]),
  printRequests: rtdbArray(PrintRequestSchema).catch([]),
});

export function relocateDeepFreezers(tree: InventoryTree): boolean {
  if (tree.deepFreezers !== undefined && !Array.isArray(tree.deepFreezers)) {
    tree.deepFreezers = undefined;
  }
  let changed = false;
  for (const room of tree.rooms) {
    const freezers = room.containers.filter((cont) => cont.type === "deepfreezer");
    if (freezers.length === 0) continue;
    for (const freezer of freezers) {
      (tree.deepFreezers ??= []).push(freezer);
    }
    room.containers = room.containers.filter((cont) => cont.type !== "deepfreezer");
    changed = true;
  }
  return changed;
}

export const SandboxTreeSchema = InventoryTreeSchema;

export type Chemical = z.infer<typeof ChemicalSchema>;
export type StockProduct = z.infer<typeof StockProductSchema>;
export type BatchInfo = z.infer<typeof BatchInfoSchema>;
export type Shelf = z.infer<typeof ShelfSchema>;
export type Container = z.infer<typeof ContainerSchema>;
export type SharedContainerRef = z.infer<typeof SharedContainerRefSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type AssetRoom = z.infer<typeof AssetRoomSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Protocol = z.infer<typeof ProtocolSchema>;
export type InventoryTree = z.infer<typeof InventoryTreeSchema>;
export type SandboxTree = InventoryTree;
export type ContainerType = z.infer<typeof ContainerTypeSchema>;
