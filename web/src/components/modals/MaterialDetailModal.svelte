<script lang="ts">
  import { onMount } from "svelte";
  import { MATERIAL_TYPES, materialTypeLabels, type MaterialFieldDef } from "@bioscom/shared";
  import { catalog } from "../../lib/stores/catalog.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { openCatalogStockEditForm, openMaterialMergeModal } from "../../lib/forms";
  import { materialTypeColorClass } from "../../lib/inventoryUtils";

  let { materialId }: { materialId: string } = $props();

  const labels = materialTypeLabels();

  onMount(() => {
    void catalog.fetchMaterialDetail(materialId);
  });

  interface DescriptorRow {
    key: string;
    label: string;
    value: string;
    mono: boolean;
  }

  const detail = $derived(catalog.detail);
  const material = $derived(detail?.material ?? null);
  const editableStock = $derived.by(() => {
    if (detail === null || material === null) {
      return null;
    }
    const stocks = detail.stocks.filter((stock) => stock.materialId === material.id);
    return stocks.find((stock) => material.id === `m-${stock.id}`) ?? stocks[0] ?? null;
  });

  const fieldDefs = $derived.by<readonly MaterialFieldDef[]>(() => {
    if (material === null) {
      return [];
    }
    return MATERIAL_TYPES.find((type) => type.key === material.type)?.fields ?? [];
  });

  const descriptorRows = $derived.by<DescriptorRow[]>(() => {
    if (material === null) {
      return [];
    }
    const rows: DescriptorRow[] = [];
    const known = new Set<string>();
    for (const field of fieldDefs) {
      known.add(field.key);
      const raw = material.attributes[field.key];
      if (raw === undefined || raw === null || raw === "") {
        continue;
      }
      const numeric = field.dataType === "number" || field.dataType === "sequence";
      rows.push({
        key: field.key,
        label: field.label,
        value: formatValue(raw),
        mono: numeric,
      });
    }
    for (const [key, raw] of Object.entries(material.attributes)) {
      if (known.has(key) || raw === undefined || raw === null || raw === "") {
        continue;
      }
      rows.push({ key, label: key.replaceAll("_", " "), value: formatValue(raw), mono: false });
    }
    return rows;
  });

  function formatValue(value: string | number | boolean): string {
    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }
    return String(value);
  }

  function formatDate(value: number | null | undefined): string {
    if (value === undefined || value === null || !Number.isFinite(value)) {
      return "—";
    }
    return new Date(value).toISOString().slice(0, 10);
  }

  function openSelectedStockEditor(): void {
    if (material === null || editableStock === null) {
      return;
    }
    openCatalogStockEditForm(editableStock.id, () => {
      void catalog.fetchMaterialDetail(material.id);
    });
  }
</script>

{#if catalog.detailLoading || detail === null || material === null || material.id !== materialId}
    <div id="material-detail-loading" aria-busy="true" style="display: flex; flex-direction: column; gap: 0.6rem; padding: 0.5rem 0;">
        {#each [70, 45, 55, 80, 60] as width, index (index)}
            <div style={`height: 0.75rem; width: ${width}%; border-radius: 4px; background: var(--bg-input); opacity: 0.6;`}></div>
        {/each}
    </div>
{:else}
    <div id="material-detail" class="material-detail-header">
        <h3 class="material-detail-heading">{material.name}</h3>
        <span class={`chem-pos ${materialTypeColorClass(material.type)}`}>{labels[material.type] ?? material.type}</span>
        <span class="material-detail-created">Created {formatDate(material.createdAt)}</span>
        {#if session.user?.role !== "reader"}
            <div class="material-detail-actions" role="group" aria-label="Material actions">
                <button
                    type="button"
                    class="btn-secondary material-detail-action"
                    id="material-merge-open"
                    onclick={() => openMaterialMergeModal(material.id, material.name)}
                >Merge into…</button>
                <button
                    type="button"
                    class="btn-secondary material-detail-action"
                    id="material-edit-open"
                    aria-label="Edit material details"
                    title={editableStock === null ? "Edit unavailable: this material has no stock records." : "Edit material details"}
                    disabled={editableStock === null}
                    onclick={openSelectedStockEditor}
                >Edit</button>
            </div>
        {/if}
    </div>
    {#if material.description}
        <p style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 1rem;">{material.description}</p>
    {/if}

    {#if descriptorRows.length > 0}
        <div class="detail-defs">
            {#each descriptorRows as row (row.key)}
                <div class="detail-def-key">{row.label}</div>
                <div class="detail-def-val" style={row.mono ? "font-family: monospace; font-variant-numeric: tabular-nums;" : ""}>{row.value}</div>
            {/each}
        </div>
    {/if}
{/if}

<style>
    .material-detail-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.75rem;
        min-width: 0;
        margin-bottom: 0.5rem;
    }

    .material-detail-heading {
        min-width: 0;
        margin: 0;
        color: var(--text-primary);
        font-size: 1.2rem;
        font-weight: 700;
        overflow-wrap: anywhere;
    }

    .material-detail-created {
        color: var(--text-muted);
        font-size: 0.75rem;
    }

    .material-detail-actions {
        display: flex;
        flex: 0 1 auto;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 0.5rem;
        min-width: 0;
        max-width: 100%;
        margin-left: auto;
    }

    .material-detail-action {
        padding: 0.3rem 0.7rem;
        font-size: 0.8rem;
        white-space: nowrap;
    }
</style>
