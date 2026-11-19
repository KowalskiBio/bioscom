import type { InventoryTree } from "@bioscom/shared";

/** The browser build infers the persisted grid contract from InventoryTree. */
export type GridLayout = NonNullable<InventoryTree["roomGrid"]>;
export type GridSettings = Pick<GridLayout, "rows" | "columns" | "hideEmptySlots">;

export const MAX_GRID_ROWS = 20;
export const MAX_GRID_COLUMNS = 5;

export function gridCapacity(settings: GridSettings): number {
  return settings.rows * settings.columns;
}
