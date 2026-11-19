<script lang="ts">
  import { untrack } from "svelte";
  import {
    DEFAULT_RACK_COLUMNS,
    DEFAULT_RACK_ROWS,
    DEFAULT_RACK_SHELVES,
    MAX_RACK_COLUMNS,
    MAX_RACK_ROWS,
    MAX_RACK_SHELVES,
  } from "@bioscom/shared";
  import { theme } from "../../lib/theme.svelte";
  import HighlightColorSelect from "./HighlightColorSelect.svelte";
  import type { HighlightFormValue } from "../../lib/highlight";

  interface RackSlotOption {
    value: number;
    label: string;
  }

  let {
    form,
    kind,
    showSlotPicker = false,
    slotOptions = [],
    slotLabel = "Slot",
    slotHint = "",
    showRackGrid = false,
    showShelfCount = false,
    showHighlightPicker = false,
  }: {
    form: {
      name: string;
      description?: string;
      emoji?: string;
      highlightColor?: HighlightFormValue;
      color?: string;
      slot?: number | null;
      rackRows?: number | null;
      rackColumns?: number | null;
      rackShelves?: number | null;
    };
    kind: "container" | "shelf" | "box" | "color" | "slot" | "rack-grid" | "rack-shelves";
    showSlotPicker?: boolean;
    slotOptions?: RackSlotOption[];
    slotLabel?: string;
    slotHint?: string;
    showRackGrid?: boolean;
    showShelfCount?: boolean;
    showHighlightPicker?: boolean;
  } = $props();

  const design = $derived(theme.design);
  let rows = $state<number | null>(untrack(() => form.rackRows ?? DEFAULT_RACK_ROWS));
  let columns = $state<number | null>(untrack(() => form.rackColumns ?? DEFAULT_RACK_COLUMNS));
  let shelfCount = $state<number | null>(untrack(() => form.rackShelves ?? DEFAULT_RACK_SHELVES));

  $effect(() => {
    form.rackRows = rows;
    form.rackColumns = columns;
    form.rackShelves = shelfCount;
  });
</script>

{#if kind === "container"}
  <div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="c-name" bind:value={form.name}></div>
  <div class="form-group"><label class="form-label">Description</label><input class="form-input" id="c-desc" bind:value={form.description}></div>
  <div class="form-group"><label class="form-label">Emoji Icon (optional)</label><input class="form-input" id="c-emoji" placeholder={design === "bauhaus" ? "optional icon" : "e.g. 🧪 or 🥶"} bind:value={form.emoji}></div>
  {#if showHighlightPicker}<HighlightColorSelect id="c-edit-highlight" bind:value={form.highlightColor} />{/if}
{:else if kind === "color"}
  <div class="form-group"><label class="form-label">Box Color *</label><input type="color" class="form-input" id="f-color" style="height: 2.5rem; cursor: pointer; padding: 0.2rem;" bind:value={form.color}></div>
{:else if kind === "shelf" || kind === "box"}
    <div class="form-group"><label class="form-label" for="f-sn">{showSlotPicker && kind === "shelf" ? "Rack name" : kind === "shelf" ? "Shelf name" : "Box name"} *</label><input class="form-input" id="f-sn" bind:value={form.name}></div>
{/if}

{#if showSlotPicker}
  <div class="form-group">
    <label class="form-label" for="f-rack-slot">{slotLabel} *</label>
    <select class="form-select" id="f-rack-slot" bind:value={form.slot} disabled={slotOptions.length === 0}>
      {#if slotOptions.length === 0}<option value={0}>No free slots</option>{/if}
      {#each slotOptions as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
    {#if slotHint !== ""}<p class="form-hint">{slotHint}</p>{/if}
  </div>
{/if}

{#if showRackGrid || kind === "rack-grid"}
  <div class="form-group">
    <label class="form-label" for="rack-rows">Rows *</label>
    <input class="form-input" id="rack-rows" type="number" min="1" max={MAX_RACK_ROWS} step="1" required bind:value={rows}>
  </div>
  <div class="form-group">
    <label class="form-label" for="rack-columns">Columns *</label>
    <input class="form-input" id="rack-columns" type="number" min="1" max={MAX_RACK_COLUMNS} step="1" required bind:value={columns}>
  </div>
  <p class="form-hint" id="rack-capacity">Capacity: {(rows ?? 0) * (columns ?? 0)} slots · Slots read left to right, top to bottom.</p>
{/if}

{#if showShelfCount || kind === "rack-shelves"}
  <div class="form-group">
    <label class="form-label" for="rack-shelves">Shelves per rack *</label>
    <input class="form-input" id="rack-shelves" type="number" min="1" max={MAX_RACK_SHELVES} step="1" required bind:value={shelfCount}>
    <p class="form-hint" id="rack-shelf-capacity">Each rack has {shelfCount ?? 0} shelf positions · Shelf positions use one-based numbers.</p>
  </div>
{/if}
