<script lang="ts">
  import { onDestroy } from "svelte";
  import { MATERIAL_TYPES, materialTypeLabels, type MaterialFieldDef } from "@bioscom/shared";
  import { catalog, type CatalogMaterial, type CatalogStock, type StockExpDays } from "../../lib/stores/catalog.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { router } from "../../lib/router.svelte";
  import { openMaterialDetailModal } from "../../lib/forms";

  const labels = materialTypeLabels();

  let tab = $state<"materials" | "stocks">("materials");
  let searchText = $state("");
  let stockSearchText = $state("");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let stockDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const totalPages = $derived(Math.max(1, Math.ceil(catalog.total / 25)));
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
    if (router.route.view === "catalog" && groupId !== null && catalog.loadedGroupId !== groupId) {
      void catalog.fetchCatalog(1);
    }
  });

  $effect(() => {
    const groupId = currentGroup.groupId;
    if (
      router.route.view === "catalog" &&
      tab === "stocks" &&
      groupId !== null &&
      catalog.stocksLoadedGroupId !== groupId &&
      !catalog.stocksLoading
    ) {
      void catalog.fetchStocks(1);
    }
  });

  onDestroy(() => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    if (stockDebounceTimer !== null) {
      clearTimeout(stockDebounceTimer);
    }
  });

  function onSearchInput(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      catalog.setQuery(searchText.trim());
      void catalog.fetchCatalog(1);
    }, 300);
  }

  function onTypeSelect(type: string): void {
    catalog.setTypeFilter(type);
    void catalog.fetchCatalog(1);
    void catalog.fetchStocks(1);
  }

  function selectTab(next: "materials" | "stocks"): void {
    tab = next;
    if (next === "stocks" && (!catalog.stocksLoaded || catalog.stocksLoadedGroupId !== currentGroup.groupId)) {
      void catalog.fetchStocks(1);
    }
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

  function onStockStatusChange(event: Event): void {
    catalog.setStockStatus((event.currentTarget as HTMLSelectElement).value);
    void catalog.fetchStocks(1);
  }

  function onStockExpiryChange(event: Event): void {
    catalog.setStockExpDays((event.currentTarget as HTMLSelectElement).value as StockExpDays);
    void catalog.fetchStocks(1);
  }

  function descriptorSummary(material: CatalogMaterial): string {
    const type = MATERIAL_TYPES.find((entry) => entry.key === material.type);
    if (type === undefined) {
      return "";
    }
    const parts: string[] = [];
    for (const field of type.fields) {
      const value = material.attributes[field.key];
      if (value === undefined || value === null || value === "") {
        continue;
      }
      parts.push(`${field.label}: ${String(value)}`);
      if (parts.length >= 2) {
        break;
      }
    }
    return parts.join(" · ");
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
        <button id="catalog-type-all" class={`filter-pill ${catalog.typeFilter === "" ? "active" : ""}`} onclick={() => onTypeSelect("")}>All</button>
        {#each MATERIAL_TYPES as type (type.key)}
            <button id={`catalog-type-${type.key}`} class={`filter-pill ${catalog.typeFilter === type.key ? "active" : ""}`} onclick={() => onTypeSelect(type.key)}>{type.label}</button>
        {/each}
    </div>
</div>

<div class="catalog-tabs-nav">
    <button id="catalog-tab-materials" class="print-tab-btn" class:active={tab === "materials"} onclick={() => selectTab("materials")}>Materials</button>
    <button id="catalog-tab-stocks" class="print-tab-btn" class:active={tab === "stocks"} onclick={() => selectTab("stocks")}>Stocks</button>
</div>

{#if tab === "materials"}
    <div class="catalog-filters">
        <div class="search-box" style="min-width: 250px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="catalog-search-input" placeholder="Search materials..." autocomplete="off" bind:value={searchText} oninput={onSearchInput}>
        </div>
    </div>

    {#if catalog.loading && catalog.items.length === 0}
        <div class="empty-state" id="catalog-loading">
            <p>Loading…</p>
        </div>
    {:else if catalog.loaded && catalog.items.length === 0}
        <div class="empty-state" id="catalog-empty">
            <h2>No materials match the filter</h2>
            <p>Try a different search or material type.</p>
        </div>
    {:else}
        <div id="catalog-grid" class="catalog-grid">
            {#each catalog.items as material (material.id)}
                <div class="card" data-material-id={material.id} role="button" tabindex="0" onclick={() => openMaterialDetailModal(material.id)} onkeydown={(e) => (e.key === "Enter" || e.key === " ") && openMaterialDetailModal(material.id)}>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                        <div class="card-title">{material.name}</div>
                        <span class="chem-pos">{labels[material.type] ?? material.type}</span>
                    </div>
                    {#if material.description}
                        <div class="card-description">{material.description}</div>
                    {/if}
                    {#if descriptorSummary(material) !== ""}
                        <div class="card-description" style="margin-bottom: 0;">{descriptorSummary(material)}</div>
                    {/if}
                    <div class="catalog-counts">
                        <span>{material.counts.stocks} stocks</span>
                        <span aria-hidden="true">·</span>
                        <span>{material.counts.locations} locations</span>
                        <span aria-hidden="true">·</span>
                        <span>{material.counts.products} {material.counts.products === 1 ? "product" : "products"}</span>
                    </div>
                </div>
            {/each}
        </div>
        <div id="catalog-pagination" style="display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 1.5rem;">
            <button class="btn-icon" title="Previous page" aria-label="Previous page" disabled={catalog.page <= 1} onclick={() => void catalog.fetchCatalog(catalog.page - 1)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span style="font-size: 0.85rem; color: var(--text-secondary); font-variant-numeric: tabular-nums;">Page {catalog.page} of {totalPages}</span>
            <button class="btn-icon" title="Next page" aria-label="Next page" disabled={catalog.page >= totalPages} onclick={() => void catalog.fetchCatalog(catalog.page + 1)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
        </div>
    {/if}
{:else}
    <div class="catalog-filters">
        <div class="search-box" style="min-width: 250px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="stocks-search-input" placeholder="Search stocks..." autocomplete="off" bind:value={stockSearchText} oninput={onStockSearchInput}>
        </div>
        <select id="stocks-status-select" class="form-select" value={catalog.stockStatus} onchange={onStockStatusChange}>
            <option value="">All statuses</option>
            <option value="available">Available</option>
            <option value="depleted">Depleted</option>
            <option value="discarded">Discarded</option>
            <option value="reserved">Reserved</option>
            <option value="unknown">Unknown</option>
        </select>
        <select id="stocks-expiry-select" class="form-select" value={catalog.stockExpDays} onchange={onStockExpiryChange}>
            <option value="">Any expiry</option>
            <option value="30">≤30 days</option>
            <option value="60">≤60 days</option>
            <option value="90">≤90 days</option>
        </select>
    </div>

    {#if catalog.stocksLoading && catalog.stockItems.length === 0}
        <div class="empty-state" id="stocks-loading">
            <p>Loading…</p>
        </div>
    {:else if catalog.stocksLoaded && catalog.stockItems.length === 0}
        <div class="empty-state" id="stocks-empty">
            <h2>No stocks match the filter</h2>
            <p>Try a different search, status, or expiry window.</p>
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
                        <th>Expires</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {#each catalog.stockItems as stock (stock.id)}
                        <tr
                            role="button"
                            tabindex="0"
                            style="cursor: pointer;"
                            onclick={() => openMaterialDetailModal(stock.materialId)}
                            onkeydown={(e) => (e.key === "Enter" || e.key === " ") && openMaterialDetailModal(stock.materialId)}
                        >
                            <td><strong>{stock.name}</strong></td>
                            <td><span class="chem-pos">{labels[stock.type] ?? stock.type}</span></td>
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
                            <td class="stocks-mono" style={expiryColor(stock.batch.expiresAt) !== "" ? `color: ${expiryColor(stock.batch.expiresAt)};` : ""}>{formatExpiry(stock.batch.expiresAt)}</td>
                            <td><span class={`status-badge ${statusClass(stock.status)}`}>{statusLabel(stock.status)}</span></td>
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
{/if}
