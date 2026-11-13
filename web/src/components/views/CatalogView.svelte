<script lang="ts">
  import { onDestroy } from "svelte";
  import { MATERIAL_TYPES, materialTypeLabels, type MaterialFieldDef } from "@bioscom/shared";
  import { catalog, type CatalogStock } from "../../lib/stores/catalog.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { router } from "../../lib/router.svelte";
  import { openCatalogStockEditForm, openMaterialDetailModal } from "../../lib/forms";
  import { materialTypeColorClass } from "../../lib/inventoryUtils";
  import { roleCanWrite } from "../../lib/ops";

  const labels = materialTypeLabels();
  const canEdit = $derived(roleCanWrite());

  let stockSearchText = $state("");
  let stockDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const stocksTotalPages = $derived(Math.max(1, Math.ceil(catalog.stocksTotal / 25)));

  const activeTypeFields = $derived.by<readonly MaterialFieldDef[]>(() => {
    if (catalog.typeFilter === "") {
      return [];
    }
    const type = MATERIAL_TYPES.find((entry) => entry.key === catalog.typeFilter);
    if (type === undefined || type.key === "other") {
      return [];
    }
    if (type.key === "chemical") {
      const fields: MaterialFieldDef[] = [];
      for (const key of ["cas_number", "molecular_weight"]) {
        const field = type.fields.find((entry) => entry.key === key);
        if (field !== undefined) {
          fields.push(field);
        }
      }
      return fields;
    }
    return type.fields.slice(0, 2);
  });

  $effect(() => {
    const groupId = currentGroup.groupId;
    if (
      router.route.view === "catalog" &&
      groupId !== null &&
      catalog.stocksLoadedGroupId !== groupId &&
      !catalog.stocksLoading
    ) {
      void catalog.fetchStocks(1);
    }
  });

  onDestroy(() => {
    if (stockDebounceTimer !== null) {
      clearTimeout(stockDebounceTimer);
    }
  });

  function onTypeSelect(type: string): void {
    catalog.setTypeFilter(type);
    void catalog.fetchStocks(1);
  }

  function onStockSearchInput(): void {
    if (stockDebounceTimer !== null) {
      clearTimeout(stockDebounceTimer);
    }
    stockDebounceTimer = setTimeout(() => {
      catalog.setStockQuery(stockSearchText.trim());
      void catalog.fetchStocks(1);
    }, 300);
  }

  function onStockEdit(stockId: string): void {
    openCatalogStockEditForm(stockId, () => {
      void catalog.fetchStocks(catalog.stocksPage);
    });
  }

  function descriptorHeader(field: MaterialFieldDef): string {
    return field.unit === undefined ? field.label : `${field.label} (${field.unit})`;
  }

  function formatStockAttribute(
    field: MaterialFieldDef,
    value: string | number | boolean | null | undefined,
  ): string {
    if (value === undefined || value === null || value === "") {
      return "—";
    }
    switch (field.dataType) {
      case "boolean":
        return value === true ? "Yes" : value === false ? "No" : "—";
      case "number":
        return field.unit === undefined ? String(value) : `${value} ${field.unit}`;
      case "sequence":
        return String(value).toUpperCase();
      case "string":
      case "text":
        return String(value).trim() || "—";
      default:
        return String(value);
    }
  }

  function stockPosition(stock: CatalogStock): string {
    return stock.customPosition ?? stock.position ?? "";
  }

  function formatExpiry(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return "—";
    }
    return new Date(value).toISOString().slice(0, 10);
  }

  function expiryColor(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return "";
    }
    const expiry = new Date(value);
    const expiryDay = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = Math.round((expiryDay - today) / 86_400_000);
    if (days <= 0) {
      return "var(--accent-red)";
    }
    if (days <= 60) {
      return "var(--accent-amber)";
    }
    return "";
  }

  function statusClass(status: string): string {
    switch (status) {
      case "available":
        return "done";
      case "depleted":
        return "pending";
      case "discarded":
        return "rejected";
      case "reserved":
        return "printing";
      default:
        return "pending";
    }
  }

  function statusLabel(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }
</script>

<div class="catalog-filters">
    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;">
        <button id="catalog-type-all" class={`filter-pill ${materialTypeColorClass("")} ${catalog.typeFilter === "" ? "active" : ""}`} onclick={() => onTypeSelect("")}>All</button>
        {#each MATERIAL_TYPES as type (type.key)}
            <button id={`catalog-type-${type.key}`} class={`filter-pill ${materialTypeColorClass(type.key)} ${catalog.typeFilter === type.key ? "active" : ""}`} onclick={() => onTypeSelect(type.key)}>{type.label}</button>
        {/each}
    </div>
</div>

    <div class="catalog-filters">
        <div class="search-box" style="min-width: 250px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="stocks-search-input" placeholder="Search stocks..." autocomplete="off" bind:value={stockSearchText} oninput={onStockSearchInput}>
        </div>
    </div>

    {#if catalog.stocksLoading && catalog.stockItems.length === 0}
        <div class="empty-state" id="stocks-loading">
            <p>Loading…</p>
        </div>
    {:else if catalog.stocksLoaded && catalog.stockItems.length === 0}
        <div class="empty-state" id="stocks-empty">
            <h2>No packages match the filter</h2>
            <p>Try a different search or material type.</p>
        </div>
    {:else}
        <div style="overflow-x: auto;">
            <table class="detail-table" id="stocks-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Quantity</th>
                        {#each activeTypeFields as field (field.key)}
                            <th>{descriptorHeader(field)}</th>
                        {/each}
                        <th>Location</th>
                        <th>Lot</th>
                        <th>Received</th>
                        <th>Expires</th>
                        <th>Status</th>
                        {#if canEdit}
                            <th style="text-align: right;">Actions</th>
                        {/if}
                    </tr>
                </thead>
                <tbody>
                    {#each catalog.stockItems as stock (stock.id)}
                        <!-- Whole-row clicks are a pointer shortcut; the name button provides keyboard access. -->
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <tr
                            data-stock-id={stock.id}
                            style="cursor: pointer;"
                            onclick={() => openMaterialDetailModal(stock.materialId)}
                        >
                            <td>
                                <button
                                    type="button"
                                    aria-label={`View ${stock.name} details`}
                                    title="View details"
                                    style="background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer;"
                                    onclick={(event) => {
                                        event.stopPropagation();
                                        openMaterialDetailModal(stock.materialId);
                                    }}
                                >
                                    <strong>{stock.name}</strong>
                                </button>
                            </td>
                            <td><span class={`chem-pos ${materialTypeColorClass(stock.type)}`}>{labels[stock.type] ?? stock.type}</span></td>
                            <td class="stocks-mono">{stock.quantity ?? "—"}{stock.unit ? ` ${stock.unit}` : ""}</td>
                            {#each activeTypeFields as field (field.key)}
                                <td class={field.dataType === "number" || field.dataType === "sequence" ? "stocks-mono" : ""}>{formatStockAttribute(field, stock.attributes[field.key])}</td>
                            {/each}
                            <td>
                                <div class="stocks-dim" style="font-size: 0.75rem;">{stock.location.path || "—"}</div>
                                {#if stockPosition(stock) !== ""}
                                    <span class="chem-pos">{stockPosition(stock)}</span>
                                {/if}
                            </td>
                            <td class="stocks-mono">{stock.batch.lotCode ?? "—"}</td>
                            <td class="stocks-mono">{formatExpiry(stock.batch.receivedAt)}</td>
                            <td class="stocks-mono" style={expiryColor(stock.batch.expiresAt) !== "" ? `color: ${expiryColor(stock.batch.expiresAt)};` : ""}>{formatExpiry(stock.batch.expiresAt)}</td>
                            <td><span class={`status-badge ${statusClass(stock.status)}`}>{statusLabel(stock.status)}</span></td>
                            {#if canEdit}
                                <td style="text-align: right;">
                                    <button
                                        id={`edit-stock-${stock.id}`}
                                        type="button"
                                        class="btn-inline"
                                        title={`Edit ${stock.name}`}
                                        aria-label={`Edit ${stock.name}`}
                                        onclick={(event) => {
                                            event.stopPropagation();
                                            onStockEdit(stock.id);
                                        }}
                                    >
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    </button>
                                </td>
                            {/if}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        <div id="stocks-pagination" style="display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 1.5rem;">
            <button id="stocks-prev-page" class="btn-icon" title="Previous page" aria-label="Previous page" disabled={catalog.stocksPage <= 1} onclick={() => void catalog.fetchStocks(catalog.stocksPage - 1)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span style="font-size: 0.85rem; color: var(--text-secondary); font-variant-numeric: tabular-nums;">Page {catalog.stocksPage} of {stocksTotalPages}</span>
            <button id="stocks-next-page" class="btn-icon" title="Next page" aria-label="Next page" disabled={catalog.stocksPage >= stocksTotalPages} onclick={() => void catalog.fetchStocks(catalog.stocksPage + 1)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
        </div>
    {/if}
