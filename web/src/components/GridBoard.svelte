<script lang="ts" generics="Item extends { id: string; name: string }">
  import { tick } from "svelte";
  import type { Snippet } from "svelte";

  type Grid = {
    rows: number;
    columns: number;
    positions: Record<string, number>;
    hideEmptySlots?: boolean;
  };

  type Slot = {
    index: number;
    item: Item | undefined;
  };

  type VisualRow = {
    index: number;
    slots: Slot[];
  };

  type Props = {
    boardId: string;
    title: string;
    items: Item[];
    grid: Grid;
    canWrite: boolean;
    itemLabel: string;
    overflowLabel: string;
    onMove: (itemId: string, slot: number) => void | Promise<void>;
    onOpen: (item: Item) => void;
    card: Snippet<[Item]>;
  };

  let {
    boardId,
    title,
    items,
    grid,
    canWrite,
    itemLabel,
    overflowLabel,
    onMove,
    onOpen,
    card,
  }: Props = $props();

  const MAX_VISIBLE_COLUMNS = 5;
  const rowCount = $derived(normalizeDimension(grid.rows));
  const columnCount = $derived(normalizeDimension(grid.columns));
  const visibleColumns = $derived(Math.min(columnCount, MAX_VISIBLE_COLUMNS));
  const slotCount = $derived(rowCount * columnCount);
  const hideEmptySlots = $derived(grid.hideEmptySlots === true);

  let boardElement: HTMLElement;
  let draggedItemId = $state<string | null>(null);
  let dropTargetSlot = $state<number | null>(null);

  const placement = $derived.by(() => {
    const bySlot = new Map<number, Item>();
    const overflow: Item[] = [];

    for (const item of items) {
      const position = grid.positions[item.id];
      if (
        typeof position === "number" &&
        Number.isInteger(position) &&
        position >= 0 &&
        position < slotCount &&
        !bySlot.has(position)
      ) {
        bySlot.set(position, item);
      } else {
        // Invalid, out-of-bounds, and colliding positions remain available in
        // the overflow strip rather than disappearing from the board.
        overflow.push(item);
      }
    }

    return { bySlot, overflow };
  });

  const slots: Slot[] = $derived.by(() =>
    Array.from({ length: slotCount }, (_, index) => ({
      index,
      item: placement.bySlot.get(index),
    })),
  );

  const visualRows: VisualRow[] = $derived.by(() => {
    const result: VisualRow[] = [];
    for (let index = 0; index < slots.length; index += visibleColumns) {
      const rowSlots = slots.slice(index, index + visibleColumns);
      const visibleSlots = hideEmptySlots ? rowSlots.filter((slot) => slot.item !== undefined) : rowSlots;
      if (!hideEmptySlots || visibleSlots.length > 0) {
        result.push({ index: Math.floor(index / visibleColumns), slots: visibleSlots });
      }
    }
    return result;
  });

  function normalizeDimension(value: number): number {
    return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
  }

  function openLabel(item: Item): string {
    return `Open ${itemLabel.toLowerCase()} ${item.name}`;
  }

  function slotLabel(slot: number, item: Item | undefined): string {
    return `${title}, slot ${slot + 1}: ${item ? item.name : "empty"}`;
  }

  async function moveItem(itemId: string, targetSlot: number, restoreFocus = false): Promise<void> {
    if (
      !canWrite ||
      !Number.isInteger(targetSlot) ||
      targetSlot < 0 ||
      targetSlot >= slotCount ||
      grid.positions[itemId] === targetSlot ||
      !items.some((item) => item.id === itemId) ||
      (hideEmptySlots && !placement.bySlot.has(targetSlot))
    ) {
      return;
    }

    try {
      await onMove(itemId, targetSlot);
    } finally {
      if (restoreFocus) {
        await tick();
        const candidates = boardElement?.querySelectorAll<HTMLElement>("[data-grid-item-id]");
        const movedItem = candidates
          ? Array.from(candidates).find((element) => element.dataset.gridItemId === itemId)
          : undefined;
        movedItem?.focus();
      }
    }
  }

  function movementTarget(currentSlot: number | undefined, key: string): number | null {
    if (slotCount === 0) return null;
    if (currentSlot === undefined) {
      return !hideEmptySlots || placement.bySlot.has(0) ? 0 : null;
    }

    const column = currentSlot % visibleColumns;
    let target: number | null = null;

    switch (key) {
      case "ArrowLeft":
        target = column > 0 ? currentSlot - 1 : null;
        break;
      case "ArrowRight":
        target = column < visibleColumns - 1 && currentSlot + 1 < slotCount
          ? currentSlot + 1
          : null;
        break;
      case "ArrowUp":
        target = currentSlot >= visibleColumns ? currentSlot - visibleColumns : null;
        break;
      case "ArrowDown":
        target = currentSlot + visibleColumns < slotCount
          ? currentSlot + visibleColumns
          : null;
        break;
    }

    // Hidden empty cells are not drop targets. Moving into one would make the
    // moved item invisible, so only occupied cells remain keyboard targets.
    if (target !== null && hideEmptySlots && !placement.bySlot.has(target)) return null;
    return target;
  }

  function handleItemKeydown(event: KeyboardEvent, item: Item, slot: number | undefined): void {
    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (canWrite && event.ctrlKey && arrows.includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const target = movementTarget(slot, event.key);
      if (target !== null && target !== slot) {
        void moveItem(item.id, target, true);
      }
      return;
    }

    if (
      (event.key === "Enter" || event.key === " ") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      onOpen(item);
    }
  }

  function startDrag(event: DragEvent, item: Item): void {
    if (!canWrite) {
      event.preventDefault();
      return;
    }

    draggedItemId = item.id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
      event.dataTransfer.setData(
        "application/x-bioscom-grid-item",
        JSON.stringify({ boardId, itemId: item.id }),
      );
    }
  }

  function endDrag(): void {
    draggedItemId = null;
    dropTargetSlot = null;
  }

  function allowDrop(event: DragEvent, slot: number): void {
    if (!canWrite) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dropTargetSlot = slot;
  }

  function leaveDropTarget(event: DragEvent, slot: number): void {
    const currentTarget = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && currentTarget.contains(event.relatedTarget)) return;
    if (dropTargetSlot === slot) dropTargetSlot = null;
  }

  function droppedItemId(event: DragEvent): string | null {
    const payload = event.dataTransfer?.getData("application/x-bioscom-grid-item");
    if (payload) {
      try {
        const parsed = JSON.parse(payload) as { boardId?: unknown; itemId?: unknown };
        if (parsed.boardId !== boardId || typeof parsed.itemId !== "string") return null;
        return parsed.itemId;
      } catch {
        return null;
      }
    }

    return draggedItemId ?? event.dataTransfer?.getData("text/plain") ?? null;
  }

  function dropItem(event: DragEvent, slot: number): void {
    if (!canWrite) return;
    event.preventDefault();
    const itemId = droppedItemId(event);
    endDrag();
    if (itemId && items.some((item) => item.id === itemId)) {
      void moveItem(itemId, slot);
    }
  }
</script>

{#snippet boardItem(item: Item, slot: number | undefined)}
  <div
    class="grid-item"
    class:dragging={draggedItemId === item.id}
    role="button"
    tabindex="0"
    draggable={canWrite}
    data-grid-item-id={item.id}
    aria-label={openLabel(item)}
    aria-keyshortcuts={canWrite
      ? "Enter Space Control+ArrowLeft Control+ArrowRight Control+ArrowUp Control+ArrowDown"
      : "Enter Space"}
    onclick={() => onOpen(item)}
    onkeydown={(event) => handleItemKeydown(event, item, slot)}
    ondragstart={(event) => startDrag(event, item)}
    ondragend={endDrag}
  >
    {@render card(item)}
  </div>
{/snippet}

<section
  class="grid-board"
  id={boardId}
  bind:this={boardElement}
  aria-label={title}
>
  <div class="grid-board-scroll" role="region" aria-label={`${title} slots`}>
    <div
      class="grid-board-grid"
      role="grid"
      aria-label={title}
      aria-rowcount={rowCount}
      aria-colcount={visibleColumns}
      style={`--grid-columns: ${visibleColumns}; --mobile-grid-width: ${Math.max(26, visibleColumns * 12)}rem;`}
    >
      {#each visualRows as row (row.index)}
        <div class="grid-row" role="row" aria-rowindex={row.index + 1}>
          {#each row.slots as slot (slot.index)}
            <div
              class="grid-slot"
              class:occupied={slot.item !== undefined}
              class:drop-target={canWrite && dropTargetSlot === slot.index}
              id={`${boardId}-slot-${slot.index}`}
              role="gridcell"
              tabindex="-1"
              aria-rowindex={row.index + 1}
              aria-colindex={(slot.index % visibleColumns) + 1}
              aria-label={slotLabel(slot.index, slot.item)}
              data-slot-index={slot.index}
              style={`grid-row: ${row.index + 1}; grid-column: ${(slot.index % visibleColumns) + 1};`}
              ondragover={(event) => allowDrop(event, slot.index)}
              ondragleave={(event) => leaveDropTarget(event, slot.index)}
              ondrop={(event) => dropItem(event, slot.index)}
            >
              {#if slot.item}
                {@render boardItem(slot.item, slot.index)}
              {:else}
                <div class="empty-slot">
                  <span class="empty-slot-number" aria-hidden="true">
                    {String(slot.index + 1).padStart(2, "0")}
                  </span>
                  <span>Empty slot</span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>

  {#if placement.overflow.length > 0}
    <section class="grid-overflow" aria-labelledby={`${boardId}-overflow-title`}>
      <div class="grid-overflow-header">
        <h3 id={`${boardId}-overflow-title`}>{overflowLabel}</h3>
        <span class="grid-overflow-count" aria-label={`${placement.overflow.length} unplaced items`}>
          {placement.overflow.length}
        </span>
      </div>
      <div class="grid-overflow-items">
        {#each placement.overflow as item (item.id)}
          {@render boardItem(item, undefined)}
        {/each}
      </div>
    </section>
  {/if}
</section>

<style>
  .grid-board {
    min-width: 0;
    margin-bottom: 1.25rem;
    color: var(--text-primary);
  }

  .grid-board-scroll {
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 3px;
    margin: -3px;
    overscroll-behavior-inline: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--border-light) transparent;
  }

  .grid-board-grid {
    display: grid;
    grid-template-columns: repeat(var(--grid-columns), minmax(0, 1fr));
    gap: 0.8rem;
    min-width: 0;
  }

  .grid-row {
    display: contents;
  }

  .grid-slot {
    position: relative;
    display: flex;
    align-self: stretch;
    min-width: 0;
    min-height: 10rem;
    padding: 0.45rem;
    border: 1px dashed var(--border-light);
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.018);
    transition: border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
  }

  .grid-slot.occupied {
    border-style: solid;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
  }

  .grid-slot.drop-target {
    border-color: var(--accent-blue);
    background: rgba(14, 165, 233, 0.09);
    box-shadow: inset 0 0 0 1px var(--accent-blue), 0 0 20px rgba(14, 165, 233, 0.12);
  }

  .empty-slot {
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 8.8rem;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    color: var(--text-muted);
    font-size: 0.72rem;
    text-align: center;
  }

  .empty-slot-number {
    color: var(--text-secondary);
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    opacity: 0.7;
  }

  .grid-item {
    display: block;
    align-self: stretch;
    width: 100%;
    height: 100%;
    min-width: 0;
    border-radius: var(--radius-lg);
    cursor: pointer;
    outline: none;
    transition: transform var(--transition-fast), opacity var(--transition-fast);
    -webkit-user-drag: element;
  }

  .grid-item > :global(.card) {
    height: 100%;
  }

  .grid-item:hover {
    transform: translateY(-2px);
  }

  .grid-item:focus-visible {
    outline: 3px solid var(--accent-blue);
    outline-offset: 3px;
  }

  .grid-item.dragging {
    opacity: 0.42;
    transform: scale(0.985);
  }

  .grid-overflow {
    margin-top: 1.15rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--border-subtle);
  }

  .grid-overflow-header {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-bottom: 0.65rem;
  }

  .grid-overflow-header h3 {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .grid-overflow-count {
    display: inline-flex;
    min-width: 1.35rem;
    min-height: 1.35rem;
    align-items: center;
    justify-content: center;
    padding: 0 0.35rem;
    border: 1px solid var(--border-light);
    border-radius: 999px;
    color: var(--text-secondary);
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
  }

  .grid-overflow-items {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(13.5rem, 100%), 1fr));
    gap: 0.8rem;
  }

  :global(body[data-design="original"]) .grid-slot.drop-target {
    border-style: solid;
  }

  :global(body[data-design="original"]) .grid-overflow {
    background: linear-gradient(90deg, rgba(14, 165, 233, 0.025), transparent 70%);
  }

  :global(body[data-design="bauhaus"]) .grid-overflow-header h3 {
    font-family: var(--bauhaus-font-display);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.075em;
  }

  :global(body[data-design="bauhaus"]) .grid-slot,
  :global(body[data-design="bauhaus"]) .grid-slot.occupied {
    border: 2px dashed #6e6759;
    border-radius: 0;
    background: rgba(255, 255, 255, 0.38);
  }

  :global(body[data-design="bauhaus"]) .grid-slot.occupied {
    border-style: solid;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
  }

  :global(body[data-design="bauhaus"]) .grid-slot.drop-target {
    border-style: solid;
    border-color: #de2c1e;
    background: #f0b62b;
    box-shadow: 4px 4px 0 #de2c1e;
  }

  :global(body[data-design="bauhaus"]) .grid-item {
    border-radius: 0;
    transition: opacity 120ms linear;
  }

  :global(body[data-design="bauhaus"]) .grid-item:hover {
    transform: none;
  }

  :global(body[data-design="bauhaus"]) .empty-slot,
  :global(body[data-design="bauhaus"]) .empty-slot-number {
    color: #3a3630;
    font-family: var(--bauhaus-font-mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(body[data-design="bauhaus"]) .grid-overflow {
    padding-top: 0.75rem;
    border-top: 3px solid #171512;
    background: none;
  }

  :global(body[data-design="bauhaus"]) .grid-overflow-count {
    border: 2px solid #171512;
    border-radius: 50%;
    background: #1d4fa2;
    color: #ffffff;
    font-family: var(--bauhaus-font-mono);
  }

  @media (max-width: 390px) {
    .grid-board-grid {
      min-width: var(--mobile-grid-width);
      gap: 0.65rem;
    }

    .grid-board-scroll {
      padding-bottom: 0.75rem;
    }

    .grid-slot {
      min-height: 9rem;
    }

    .empty-slot {
      min-height: 7.8rem;
    }

    .grid-overflow-items {
      grid-template-columns: repeat(auto-fill, minmax(min(12rem, 100%), 1fr));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .grid-slot,
    .grid-item {
      transition: none;
    }

    .grid-item:hover,
    .grid-item.dragging {
      transform: none;
    }
  }
</style>
