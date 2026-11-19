import { z } from "zod";

/**
 * Reusable room/container layout grid. Slots are zero-based and stored against
 * stable ids (never names). Columns are deliberately capped at 5 for safety,
 * and rows at 20.
 */
export const MIN_GRID_ROWS = 1;
export const MAX_GRID_ROWS = 20;
export const MIN_GRID_COLUMNS = 1;
export const MAX_GRID_COLUMNS = 5;

const gridRowsSchema = z.number().int().min(MIN_GRID_ROWS).max(MAX_GRID_ROWS);
const gridColumnsSchema = z.number().int().min(MIN_GRID_COLUMNS).max(MAX_GRID_COLUMNS);
const gridSlotSchema = z.number().int().min(0);

/** Dimensions and view options sent by the grid settings API. */
export const GridSettingsSchema = z.object({
  rows: gridRowsSchema,
  columns: gridColumnsSchema,
  hideEmptySlots: z.boolean().optional(),
});
export type GridSettings = z.infer<typeof GridSettingsSchema>;

/**
 * Persisted grid metadata. `positions` is keyed by stable id. `hideEmptySlots`
 * is a view-only preference: it never renumbers, moves, or drops positions.
 */
export const GridLayoutSchema = z.object({
  rows: gridRowsSchema,
  columns: gridColumnsSchema,
  positions: z.record(z.string(), gridSlotSchema),
  hideEmptySlots: z.boolean().optional(),
});
export type GridLayout = z.infer<typeof GridLayoutSchema>;

/**
 * Persisted grid fields must never make `loadDoc` fail. Corrupt or missing
 * metadata degrades to "no grid" instead of rejecting the whole inventory.
 */
export const GridLayoutDocSchema = GridLayoutSchema.nullish()
  .transform((value) => value ?? undefined)
  .catch(undefined)
  .optional();

/** Generic move body used by shared grid helpers/tests. */
export const GridMoveBodySchema = z.object({
  itemId: z.string().min(1),
  slot: gridSlotSchema,
});
export type GridMoveBody = z.infer<typeof GridMoveBodySchema>;

/** Room-grid move body. */
export const RoomGridMoveBodySchema = z.object({
  roomId: z.string().min(1),
  slot: gridSlotSchema,
});
export type RoomGridMoveBody = z.infer<typeof RoomGridMoveBodySchema>;

/** Container-grid move body. */
export const ContainerGridMoveBodySchema = z.object({
  containerId: z.string().min(1),
  slot: gridSlotSchema,
});
export type ContainerGridMoveBody = z.infer<typeof ContainerGridMoveBodySchema>;

export function gridCapacity(rows: number, columns: number): number {
  return rows * columns;
}

/** Returns the first free zero-based slot inside `capacity`, or null when full. */
export function nextFreeGridSlot(positions: Record<string, number>, capacity: number): number | null {
  const used = new Set(Object.values(positions));
  for (let slot = 0; slot < capacity; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

/**
 * Checks whether every currently stored position fits a grid of the given
 * dimensions. Returns a human-readable problem, or null when it fits. Never
 * renumbers or drops positions; used to reject unsafe shrinks.
 */
export function gridPositionsFitProblem(
  positions: Record<string, number>,
  rows: number,
  columns: number,
): string | null {
  const capacity = gridCapacity(rows, columns);
  const owners = new Map<number, string>();
  for (const [id, slot] of Object.entries(positions)) {
    if (!Number.isInteger(slot) || slot < 0) {
      return `item "${id}" has invalid slot ${slot}`;
    }
    if (slot >= capacity) {
      return `item "${id}" uses slot ${slot} but a ${rows}x${columns} grid ends at ${capacity - 1}`;
    }
    const owner = owners.get(slot);
    if (owner !== undefined) {
      return `slot ${slot} is claimed by both "${owner}" and "${id}"`;
    }
    owners.set(slot, id);
  }
  return null;
}

/**
 * Moves `itemId` to `slot`. When the target is occupied the two items swap;
 * when the moving item was unpositioned the previous occupant becomes
 * unpositioned. Always returns a new map.
 */
export function moveGridItem(
  positions: Readonly<Record<string, number>>,
  itemId: string,
  slot: number,
): Record<string, number> {
  const next: Record<string, number> = { ...positions };
  const occupant = Object.keys(next).find((id) => id !== itemId && next[id] === slot);
  const previous = next[itemId];
  if (occupant !== undefined) {
    if (previous === undefined) {
      delete next[occupant];
    } else {
      next[occupant] = previous;
    }
  }
  next[itemId] = slot;
  return next;
}

/** Removes an item's position, returning a new map. Unknown ids are a no-op. */
export function removeGridItem(
  positions: Readonly<Record<string, number>>,
  itemId: string,
): Record<string, number> {
  const next: Record<string, number> = { ...positions };
  delete next[itemId];
  return next;
}

/**
 * Assigns sequential row-major slots to items in array order. Items beyond
 * `capacity` stay unpositioned so a full grid never blocks creation.
 */
export function autoAssignGridPositions(itemIds: readonly string[], capacity: number): Record<string, number> {
  const positions: Record<string, number> = {};
  let slot = 0;
  for (const id of itemIds) {
    if (slot >= capacity) break;
    if (Object.prototype.hasOwnProperty.call(positions, id)) continue;
    positions[id] = slot;
    slot += 1;
  }
  return positions;
}

/**
 * Preserves every existing position and assigns currently unpositioned items,
 * in array order, to the first free slots inside `capacity`. Existing slots are
 * never renumbered. Returns a new map; no-op when every item is already placed.
 */
export function fillFreeGridSlots(
  itemIds: readonly string[],
  positions: Readonly<Record<string, number>>,
  capacity: number,
): Record<string, number> {
  const next: Record<string, number> = { ...positions };
  for (const id of itemIds) {
    if (Object.prototype.hasOwnProperty.call(next, id)) continue;
    const slot = nextFreeGridSlot(next, capacity);
    if (slot === null) break;
    next[id] = slot;
  }
  return next;
}

/**
 * Returns a new array ordered by grid slot. Unpositioned items keep their
 * relative order and are placed after every positioned item. Ties fall back to
 * the original array order for determinism.
 */
export function sortByGridSlot<T extends { id: string }>(
  items: readonly T[],
  positions: Readonly<Record<string, number>> | null | undefined,
): T[] {
  if (positions === undefined || positions === null) {
    return [...items];
  }
  const positioned: Array<{ item: T; slot: number; order: number }> = [];
  const unpositioned: Array<{ item: T; order: number }> = [];
  items.forEach((item, order) => {
    const slot = positions[item.id];
    if (slot === undefined) {
      unpositioned.push({ item, order });
    } else {
      positioned.push({ item, slot, order });
    }
  });
  positioned.sort((a, b) => a.slot - b.slot || a.order - b.order);
  return [...positioned.map((entry) => entry.item), ...unpositioned.map((entry) => entry.item)];
}
