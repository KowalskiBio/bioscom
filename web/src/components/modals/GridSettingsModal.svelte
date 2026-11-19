<script lang="ts">
  import { closeModal } from "../../lib/modal.svelte";
  import { gridCapacity, MAX_GRID_COLUMNS, MAX_GRID_ROWS, type GridSettings } from "../../lib/grid";

  let {
    gridName,
    itemLabel,
    itemCount,
    initialRows = 1,
    initialColumns = 3,
    initialHideEmptySlots = false,
    onSave,
    onUseDefaultView,
  }: {
    gridName: "Room grid" | "Container grid";
    itemLabel: "rooms" | "containers";
    itemCount: number;
    initialRows?: number;
    initialColumns?: number;
    initialHideEmptySlots?: boolean;
    onSave: (settings: GridSettings) => Promise<boolean>;
    onUseDefaultView?: () => Promise<boolean>;
  } = $props();

  let rows = $state(initialRows);
  let columns = $state(initialColumns);
  let hideEmptySlots = $state(initialHideEmptySlots);
  let saving = $state(false);
  let restoringDefault = $state(false);
  let error = $state("");

  const capacity = $derived.by(() => {
    const rowCount = Number(rows);
    const columnCount = Number(columns);
    if (!Number.isFinite(rowCount) || !Number.isFinite(columnCount) || rowCount < 1 || columnCount < 1) {
      return 0;
    }
    return gridCapacity({ rows: Math.floor(rowCount), columns: Math.floor(columnCount) });
  });

  function validDimension(value: number, minimum: number, maximum: number): boolean {
    return Number.isInteger(value) && value >= minimum && value <= maximum;
  }

  async function save(): Promise<void> {
    if (saving || restoringDefault) return;
    const rowCount = Number(rows);
    const columnCount = Number(columns);
    if (!validDimension(rowCount, 1, MAX_GRID_ROWS)) {
      error = `Rows must be a whole number from 1 to ${MAX_GRID_ROWS}.`;
      return;
    }
    if (!validDimension(columnCount, 1, MAX_GRID_COLUMNS)) {
      error = `Columns must be a whole number from 1 to ${MAX_GRID_COLUMNS}.`;
      return;
    }

    error = "";
    saving = true;
    const saved = await onSave({ rows: rowCount, columns: columnCount, hideEmptySlots });
    saving = false;
    if (saved) closeModal();
  }

  async function useDefaultView(): Promise<void> {
    if (onUseDefaultView === undefined || saving || restoringDefault) return;

    error = "";
    restoringDefault = true;
    try {
      const restored = await onUseDefaultView();
      if (restored) closeModal();
    } finally {
      restoringDefault = false;
    }
  }
</script>

<form class="grid-settings" aria-label={`${gridName} settings`} aria-busy={saving || restoringDefault} onsubmit={(event) => { event.preventDefault(); void save(); }}>
  <p class="grid-settings-intro">Choose the board size. The server assigns positions automatically; there are no positions to edit here.</p>
  <p class="form-hint grid-settings-movement" id="grid-movement-help">On the board, drag items to a slot, or focus an item and press Ctrl + an arrow key to move it. Press Enter or Space to open it.</p>

  <div class="grid-settings-dimensions">
    <div class="form-group">
      <label class="form-label" for="grid-rows">Rows</label>
      <input
        class="form-input"
        id="grid-rows"
        name="rows"
        type="number"
        min="1"
        max={MAX_GRID_ROWS}
        step="1"
        required
        aria-describedby="grid-rows-help"
        bind:value={rows}
        oninput={() => error = ""}
      >
      <p class="form-hint" id="grid-rows-help">From 1 to {MAX_GRID_ROWS} rows.</p>
    </div>
    <div class="form-group">
      <label class="form-label" for="grid-columns">Columns</label>
      <input
        class="form-input"
        id="grid-columns"
        name="columns"
        type="number"
        min="1"
        max={MAX_GRID_COLUMNS}
        step="1"
        required
        aria-describedby="grid-columns-help"
        bind:value={columns}
        oninput={() => error = ""}
      >
      <p class="form-hint grid-column-safety" id="grid-columns-help"><strong>For safety, columns are hard-capped at {MAX_GRID_COLUMNS}.</strong> Wider layouts are not accepted.</p>
    </div>
  </div>

  <div class="grid-display-option">
    <label class="grid-display-toggle" for="grid-hide-empty">
      <input
        id="grid-hide-empty"
        name="hideEmptySlots"
        type="checkbox"
        aria-describedby="grid-hide-empty-help"
        disabled={saving || restoringDefault}
        bind:checked={hideEmptySlots}
      >
      <span>Hide empty slots</span>
    </label>
    <p class="form-hint" id="grid-hide-empty-help">Hiding empty slots does not move or renumber placed items; their original grid positions stay unchanged.</p>
  </div>

  <div class="grid-capacity-hint" id="grid-capacity-hint">
    <span>{itemCount} existing {itemLabel}</span>
    <strong>{capacity} {capacity === 1 ? "slot" : "slots"}</strong>
  </div>
  <p class="form-hint">
    {#if itemCount > capacity}
      This size leaves {itemCount - capacity} {itemCount - capacity === 1 ? "item" : "items"} unplaced on a new grid. When resizing, save is rejected if a placed item would fall outside the new bounds.
    {:else}
      Existing positions stay unchanged when you resize. A shrink is rejected if a placed item would no longer fit.
    {/if}
  </p>

  {#if onUseDefaultView !== undefined}
    <div class="grid-default-view">
      <p class="form-hint" id="grid-default-view-help">Returns to the default Cabinet/Fridge/Freezer columns. Containers are not deleted.</p>
      <button
        class="btn-secondary grid-default-view-button"
        id="grid-settings-use-default"
        type="button"
        aria-describedby="grid-default-view-help"
        disabled={saving || restoringDefault}
        onclick={() => void useDefaultView()}
      >{restoringDefault ? "Restoring…" : "Use default view"}</button>
    </div>
  {/if}

  {#if error !== ""}
    <p class="grid-settings-error" id="grid-settings-error" role="alert">{error}</p>
  {/if}

  <div class="grid-settings-actions">
    <button class="btn-secondary" id="grid-settings-cancel" type="button" disabled={saving || restoringDefault} onclick={() => closeModal()}>Cancel</button>
    <button class="btn-primary" id="grid-settings-save" type="submit" disabled={saving || restoringDefault}>{saving ? "Saving…" : "Save"}</button>
  </div>
</form>

<style>
  .grid-settings-intro {
    color: var(--text-secondary);
    font-size: 0.9rem;
    margin-bottom: 1.25rem;
  }
  .grid-settings-movement {
    margin: -0.75rem 0 1.25rem;
    line-height: 1.5;
  }
  .grid-settings-dimensions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }
  .grid-settings-dimensions :global(.form-group) {
    min-width: 0;
  }
  .grid-column-safety {
    color: var(--text-secondary);
  }
  .grid-column-safety strong {
    color: var(--text-primary);
  }
  .grid-display-option {
    margin-top: 1rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.025);
  }
  .grid-display-toggle {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    color: var(--text-primary);
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }
  .grid-display-toggle input {
    width: 1.1rem;
    height: 1.1rem;
    flex: 0 0 auto;
    margin: 0;
    accent-color: var(--accent-blue);
    cursor: pointer;
  }
  .grid-display-option .form-hint {
    margin: 0.35rem 0 0 1.75rem;
    line-height: 1.5;
  }
  .grid-capacity-hint {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 1rem 0 0.5rem;
    padding: 0.75rem 0;
    border-top: 1px solid var(--border-subtle);
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    font-size: 0.85rem;
  }
  .grid-capacity-hint strong {
    color: var(--accent-blue);
    white-space: nowrap;
  }
  .grid-settings-error {
    margin-top: 1rem;
    padding: 0.65rem 0.75rem;
    border-left: 3px solid var(--accent-red);
    background: rgba(239, 68, 68, 0.08);
    color: var(--accent-red);
    font-size: 0.85rem;
  }
  .grid-default-view {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1.25rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--border-subtle);
  }
  .grid-default-view .form-hint {
    max-width: 25rem;
    margin: 0;
    line-height: 1.5;
  }
  .grid-default-view-button {
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .grid-settings-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.5rem;
  }
  :global(body[data-design="bauhaus"]) .grid-display-option {
    border: 2px solid #171512;
    border-radius: 0;
    background: #ffffff;
  }
  :global(body[data-design="bauhaus"]) .grid-display-option .form-hint {
    color: #6e6759;
  }
  :global(body[data-design="bauhaus"]) .grid-capacity-hint {
    border-top: 2px solid #171512;
    border-bottom: 2px solid #171512;
    font-family: var(--bauhaus-font-mono);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  :global(body[data-design="bauhaus"]) .grid-column-safety strong,
  :global(body[data-design="bauhaus"]) .grid-capacity-hint strong {
    color: #1d4fa2;
  }
  :global(body[data-design="bauhaus"]) .grid-settings-error {
    border: 2px solid #de2c1e;
    background: #ffffff;
    color: #de2c1e;
  }
  :global(body[data-design="bauhaus"]) .grid-default-view {
    border-top: 2px solid #171512;
  }
  :global(body[data-design="bauhaus"]) .grid-default-view .form-hint {
    color: #3a3630;
  }
  @media (max-width: 480px) {
    .grid-settings-dimensions {
      grid-template-columns: 1fr;
    }
    .grid-capacity-hint {
      align-items: flex-start;
      flex-direction: column;
      gap: 0.25rem;
    }
    .grid-default-view {
      align-items: stretch;
      flex-direction: column;
    }
    .grid-default-view-button {
      justify-content: center;
    }
  }
</style>
