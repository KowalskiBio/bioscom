<script lang="ts">
  import { onDestroy } from "svelte";
  import { MATERIAL_TYPES, materialTypeLabels } from "@bioscom/shared";
  import { catalog, type CatalogMaterial } from "../../lib/stores/catalog.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { router } from "../../lib/router.svelte";
  import { openMaterialDetailModal } from "../../lib/forms";

  const labels = materialTypeLabels();

  let searchText = $state("");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const totalPages = $derived(Math.max(1, Math.ceil(catalog.total / 25)));

  $effect(() => {
    const groupId = currentGroup.groupId;
    if (router.route.view === "catalog" && groupId !== null && catalog.loadedGroupId !== groupId) {
      void catalog.fetchCatalog(1);
    }
  });

  onDestroy(() => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
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
</script>

<div class="catalog-filters">
    <div class="search-box" style="min-width: 250px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="catalog-search-input" placeholder="Search materials..." autocomplete="off" bind:value={searchText} oninput={onSearchInput}>
    </div>
    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;">
        <button id="catalog-type-all" class={`filter-pill ${catalog.typeFilter === "" ? "active" : ""}`} onclick={() => onTypeSelect("")}>All</button>
        {#each MATERIAL_TYPES as type (type.key)}
            <button id={`catalog-type-${type.key}`} class={`filter-pill ${catalog.typeFilter === type.key ? "active" : ""}`} onclick={() => onTypeSelect(type.key)}>{type.label}</button>
        {/each}
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
