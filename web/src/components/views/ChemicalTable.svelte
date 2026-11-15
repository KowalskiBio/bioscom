<script lang="ts">
  import type { Snippet } from "svelte";
  import { materialTypeLabels, type Chemical } from "@bioscom/shared";
  import {
    chemicalConcentrationText,
    chemicalDateText,
    chemicalDescriptorText,
    chemicalFormulaSource,
    chemicalLegacyStatusText,
    chemicalNoteText,
    chemicalProductText,
    chemicalTableModel,
    type ChemicalTableColumn,
    type ChemicalTableLayout,
  } from "../../lib/chemicalColumns";
  import {
    highlightHtml,
    materialTypeColorClass,
    quantityClass,
    renderFormulaHtml,
    stripEmoji,
  } from "../../lib/inventoryUtils";
  import { theme } from "../../lib/theme.svelte";

  let {
    items,
    columns,
    layout = "detail",
    legacy = false,
    query = "",
    posMap = {},
    canAdjust = true,
    fridgePositions = false,
    tableId,
    ariaLabel,
    locationText,
    onOpenLocation,
    onAdjust,
    actions,
  }: {
    items: Chemical[];
    columns: readonly string[];
    layout?: ChemicalTableLayout;
    legacy?: boolean;
    query?: string;
    posMap?: Record<string, string>;
    canAdjust?: boolean;
    fridgePositions?: boolean;
    tableId?: string;
    ariaLabel?: string;
    locationText?: (ch: Chemical) => string;
    onOpenLocation?: (ch: Chemical) => void;
    onAdjust?: (ch: Chemical, delta: number) => void;
    actions: Snippet<[Chemical]>;
  } = $props();

  const labels = materialTypeLabels();
  const design = $derived(theme.design);
  const model = $derived(chemicalTableModel(columns, layout, legacy));

  function displayText(value: string): string {
    return design === "bauhaus" ? stripEmoji(value) : value;
  }

  function positionText(ch: Chemical): string {
    return posMap[ch.id] ?? ch.customPosition ?? ch.position ?? "—";
  }

  function rowLocationText(ch: Chemical): string {
    return locationText?.(ch) ?? "—";
  }

  function cellText(ch: Chemical, column: ChemicalTableColumn): string {
    switch (column.kind) {
      case "type":
        return labels[ch.type ?? "chemical"] ?? ch.type ?? "chemical";
      case "position":
        return positionText(ch);
      case "location":
        return rowLocationText(ch);
      case "unit":
        return ch.unit ?? "pcs";
      case "concentration":
        return chemicalConcentrationText(ch);
      case "descriptor":
        return column.field === undefined ? "—" : chemicalDescriptorText(ch, column.field);
      case "manufacturer":
        return chemicalProductText(ch.product?.manufacturer);
      case "catalog_number":
        return chemicalProductText(ch.product?.catalogNumber);
      case "lot":
        return chemicalProductText(ch.batchInfo?.lotCode);
      case "received":
        return chemicalDateText(ch.batchInfo?.receivedAt);
      case "expires":
        return chemicalDateText(ch.batchInfo?.expiresAt);
      case "status":
        return chemicalLegacyStatusText(ch);
      case "note":
        return displayText(chemicalNoteText(ch));
      default:
        return "—";
    }
  }

  function numericColumn(column: ChemicalTableColumn): boolean {
    return column.kind === "concentration" || column.kind === "received" || column.kind === "expires" ||
      column.kind === "catalog_number" || column.kind === "lot" ||
      (column.kind === "descriptor" && (column.field?.dataType === "number" || column.field?.dataType === "sequence"));
  }
</script>

<table
  id={tableId}
  class={layout === "room" ? "detail-table chemical-preference-table" : "chemicals-table chemical-preference-table"}
  aria-label={ariaLabel}
  style={`min-width: ${model.minWidth}px;`}
>
  <thead>
    <tr>
      {#each model.columns as column (column.id)}
        <th
          class={column.className}
          data-column={column.id}
          data-preference={column.preferenceKey}
          style={`${column.width === undefined ? "" : `width: ${column.width}px;`} ${column.kind === "actions" ? layout === "room" ? "text-align: right;" : "text-align: center;" : ""}`}
        >{column.label}</th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each items as ch (ch.id)}
      <tr class="fade-in" data-chemid={ch.id}>
        {#each model.columns as column (column.id)}
          {#if column.kind === "name"}
            <td class={`${column.className} chem-name`} data-column={column.id}>
              {#if onOpenLocation !== undefined}
                <button
                  type="button"
                  class="chemical-name-link"
                  title={`Open ${rowLocationText(ch)}`}
                  aria-label={`Open ${rowLocationText(ch)} for ${ch.name ?? "chemical"}`}
                  onclick={() => onOpenLocation(ch)}
                ><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html highlightHtml(displayText(ch.name ?? ""), query)}</button>
              {:else if layout === "room"}
                <strong>{displayText(ch.name ?? "")}</strong>
              {:else}
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html highlightHtml(displayText(ch.name ?? ""), query)}
              {/if}
              {#if layout !== "room" && model.selected.has("type") && (ch.type ?? "chemical") !== "chemical"}
                <span class={`status-badge ${materialTypeColorClass(ch.type)}`} style="margin-left:0.4rem;">{labels[ch.type ?? "chemical"] ?? ch.type}</span>
              {/if}
              {#if layout === "room" && legacy && ch.concentration !== null && ch.concentration !== undefined}
                <div class="room-chemical-meta">{ch.concentration}{ch.concUnit ? ` ${ch.concUnit}` : ""}</div>
              {/if}
            </td>
          {:else if column.kind === "type"}
            <td class={column.className} data-column={column.id}><span class={`status-badge ${materialTypeColorClass(ch.type ?? "chemical")}`}>{cellText(ch, column)}</span></td>
          {:else if column.kind === "position"}
            <td class={column.className} data-column={column.id}><span class={`chem-pos ${fridgePositions || layout === "deepfreezer-search" ? "fridge" : ""}`}>{cellText(ch, column)}</span></td>
          {:else if column.kind === "location" && onOpenLocation !== undefined}
            <td class={column.className} data-column={column.id}>
              <button
                type="button"
                class="deepfreezer-nav-btn"
                title="Go to Box"
                style="margin: 0; background: rgba(59, 130, 246, 0.15); border-color: rgba(59, 130, 246, 0.3); color: var(--accent-blue); font-weight: 600;"
                onclick={() => onOpenLocation(ch)}
              >{displayText(cellText(ch, column))}</button>
            </td>
          {:else if column.kind === "quantity"}
            <td class={column.className} data-column={column.id}>
              <div class="qty-adjuster" aria-label={`Quantity of ${ch.name ?? "chemical"}`}>
                {#if canAdjust}
                  <button type="button" class="btn-qty" title="Decrease quantity" aria-label={`Decrease quantity of ${ch.name ?? "chemical"}`} onclick={(event) => { event.stopPropagation(); onAdjust?.(ch, -1); }}>−</button>
                {/if}
                <span class={`chem-quantity ${quantityClass(ch.quantity)}`}>{ch.quantity ?? 0}</span>
                {#if canAdjust}
                  <button type="button" class="btn-qty" title="Increase quantity" aria-label={`Increase quantity of ${ch.name ?? "chemical"}`} onclick={(event) => { event.stopPropagation(); onAdjust?.(ch, 1); }}>+</button>
                {/if}
              </div>
            </td>
          {:else if column.kind === "descriptor" && column.field?.key === "molecular_formula"}
            <td class={`${column.className} chem-formula`} data-column={column.id}><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html renderFormulaHtml(chemicalFormulaSource(ch))}</td>
          {:else if column.kind === "actions"}
            <td class={column.className} data-column={column.id} style={layout === "room" ? "text-align: right;" : "text-align: center;"}>
              {@render actions(ch)}
            </td>
          {:else}
            <td
              class={`${column.className} ${numericColumn(column) ? "stocks-mono" : ""}`}
              data-column={column.id}
              style={column.kind === "concentration" || column.kind === "received" || column.kind === "expires" ? "white-space: nowrap;" : ""}
            >{cellText(ch, column)}</td>
          {/if}
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
