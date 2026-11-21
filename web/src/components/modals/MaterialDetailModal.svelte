<script lang="ts">
  import { onMount, tick } from "svelte";
  import { MATERIAL_TYPES, materialTypeLabels, type MaterialFieldDef } from "@bioscom/shared";
  import { catalog, type CatalogDetail, type CatalogStock } from "../../lib/stores/catalog.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { inventoryFor } from "../../lib/stores/inventory.svelte";
  import { showToast } from "../../lib/stores/toast.svelte";
  import {
    openCatalogStockEditForm,
    resolveCatalogStockTarget,
    type CatalogStockTarget,
  } from "../../lib/forms";
  import { effectivePosition, materialTypeColorClass, renderFormulaHtml } from "../../lib/inventoryUtils";
  import { opAdjustQty, opSetChemicalAvailability, roleCanWrite } from "../../lib/ops";
  import { parseStoredSafetyNotes } from "../../lib/safetyNotes";

  let { materialId, focusStockId }: { materialId: string; focusStockId?: string } = $props();

  const labels = materialTypeLabels();
  const canWrite = $derived(roleCanWrite());
  let pendingAction = $state<string | null>(null);

  onMount(() => {
    void catalog.fetchMaterialDetail(materialId);
  });

  interface DescriptorRow {
    key: string;
    label: string;
    value: string;
    htmlValue?: string;
    tags?: string[];
    mono: boolean;
    title?: string;
    wide?: boolean;
  }

  interface StockPreview {
    stock: CatalogStock;
    quantityText: string | null;
    detailRows: DescriptorRow[];
    locationText: string | null;
    positionText: string | null;
    positionTitle: "Generated position" | "Custom position" | null;
  }

  const detail = $derived(catalog.detail);
  const material = $derived(detail?.material ?? null);
  const materialStocks = $derived.by<CatalogStock[]>(() => {
    if (detail === null || material === null) {
      return [];
    }
    return detail.stocks.filter((stock) => stock.materialId === material.id);
  });
  const requestedStockId = $derived(focusStockId === undefined || focusStockId === "" ? null : focusStockId);
  const focusedStockMissing = $derived.by(() => {
    if (
      requestedStockId === null ||
      catalog.detailLoading ||
      detail === null ||
      material === null ||
      material.id !== materialId
    ) {
      return false;
    }
    return !materialStocks.some((stock) => stock.id === requestedStockId);
  });

  $effect(() => {
    const stockId = requestedStockId;
    const loadedMaterialId = material?.id;
    if (stockId === null || catalog.detailLoading || loadedMaterialId !== materialId) {
      return;
    }
    void focusRequestedStock(stockId, loadedMaterialId);
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
      const value = formatValue(raw);
      const tags = field.key === "safety_notes" ? parseStoredSafetyNotes(raw) : undefined;
      if (tags?.length === 0) continue;
      rows.push({
        key: field.key,
        label: field.label,
        value,
        htmlValue: field.key === "molecular_formula" ? renderFormulaHtml(value) : undefined,
        tags,
        mono: numeric,
      });
    }
    for (const [key, raw] of Object.entries(material.attributes)) {
      if (known.has(key) || raw === undefined || raw === null || raw === "") {
        continue;
      }
      const value = formatValue(raw);
      const tags = key === "safety_notes" ? parseStoredSafetyNotes(raw) : undefined;
      if (tags?.length === 0) continue;
      rows.push({
        key,
        label: humanLabel(key),
        value,
        htmlValue: key === "molecular_formula" ? renderFormulaHtml(value) : undefined,
        tags,
        mono: false,
      });
    }
    return rows;
  });

  const stockPreviews = $derived.by<StockPreview[]>(() => {
    if (detail === null || material === null) {
      return [];
    }
    return materialStocks.map((stock) => buildStockPreview(stock, detail, material.name, material.type));
  });

  function formatValue(value: string | number | boolean): string {
    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }
    return String(value);
  }

  function cleanText(value: string | null | undefined): string | null {
    const text = value?.trim();
    return text === undefined || text === "" ? null : text;
  }

  function stockLocationText(stock: CatalogStock): string | null {
    const path = cleanText(stock.location.path);
    if (path !== null) {
      return path;
    }

    const segments: string[] = [];
    const seen = new Set<string>();
    const values = [
      stock.location.roomName,
      stock.location.containerName,
      stock.location.name,
      stock.location.rackName,
      stock.location.boxName,
    ];
    for (const value of values) {
      for (const part of value?.split(/\s+\/\s+/) ?? []) {
        const segment = cleanText(part);
        if (segment === null || seen.has(segment)) {
          continue;
        }
        seen.add(segment);
        segments.push(segment);
      }
    }
    return segments.length === 0 ? null : segments.join(" / ");
  }

  function humanLabel(value: string): string {
    const text = value.replaceAll("_", " ").trim();
    return text === "" ? value : text.charAt(0).toUpperCase() + text.slice(1);
  }

  function formatDate(value: number | null | undefined): string {
    if (value === undefined || value === null || !Number.isFinite(value)) {
      return "—";
    }
    return new Date(value).toISOString().slice(0, 10);
  }

  function addRow(
    rows: DescriptorRow[],
    key: string,
    label: string,
    value: string | number | boolean | null | undefined,
    options: { mono?: boolean; title?: string; wide?: boolean } = {},
  ): void {
    if (value === null || value === undefined) {
      return;
    }
    const text = formatValue(value).trim();
    if (text === "") {
      return;
    }
    rows.push({
      key,
      label,
      value: text,
      mono: options.mono ?? false,
      title: options.title,
      wide: options.wide,
    });
  }

  function addDateRow(rows: DescriptorRow[], key: string, label: string, value: number | null | undefined): void {
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      addRow(rows, key, label, formatDate(value), { mono: true });
    }
  }

  function amountText(value: number | null, unit: string | null): string | null {
    if (value === null || !Number.isFinite(value)) {
      return null;
    }
    const cleanUnit = cleanText(unit);
    return cleanUnit === null ? String(value) : `${value} ${cleanUnit}`;
  }

  function statusLabel(status: string): string {
    if (status === "out_of_stock") {
      return "Out of stock";
    }
    if (status === "low") {
      return "Low stock";
    }
    return humanLabel(status);
  }

  function statusClass(status: string): string {
    if (status === "available") {
      return "done";
    }
    if (status === "out_of_stock" || status === "discarded") {
      return "rejected";
    }
    return "pending";
  }

  function quantityClass(status: string): string {
    if (status === "out_of_stock") {
      return "low";
    }
    if (status === "low") {
      return "medium";
    }
    return status === "available" ? "ok" : "";
  }

  function buildStockPreview(
    stock: CatalogStock,
    currentDetail: CatalogDetail,
    materialName: string,
    materialType: string,
  ): StockPreview {
    const batch = currentDetail.batches.find((candidate) => candidate.id === stock.batch.id);
    const productId = stock.product?.id ?? batch?.productId ?? null;
    const product = currentDetail.products.find((candidate) => candidate.id === productId);
    const detailRows: DescriptorRow[] = [];

    if (stock.name !== materialName) {
      addRow(detailRows, "name", "Stock name", stock.name);
    }
    if (stock.type !== materialType) {
      addRow(detailRows, "type", "Stock type", labels[stock.type] ?? stock.type);
    }
    addRow(detailRows, "concentration", "Concentration", amountText(stock.concentration, stock.concentrationUnit), { mono: true });
    const customPosition = cleanText(stock.customPosition);
    const positionText = cleanText(effectivePosition(stock));
    addRow(detailRows, "barcode", "Barcode", stock.barcode, { mono: true });
    addRow(detailRows, "note", "Note", stock.note, { wide: true });

    addRow(detailRows, "product-name", "Product name", product?.productName ?? stock.product?.productName ?? batch?.product?.productName, { wide: true });
    addRow(detailRows, "manufacturer", "Manufacturer", product?.manufacturer ?? stock.product?.manufacturer ?? batch?.product?.manufacturer);
    addRow(detailRows, "supplier", "Supplier", product?.supplier);
    addRow(detailRows, "catalog-number", "Catalog number", product?.catalogNumber ?? stock.product?.catalogNumber ?? batch?.product?.catalogNumber, { mono: true });
    addRow(detailRows, "variant", "Variant", product?.variant);
    for (const [key, value] of Object.entries(product?.attributes ?? {})) {
      addRow(detailRows, `product-attribute-${key}`, humanLabel(key), value);
    }

    addRow(detailRows, "lot", "Lot code", batch?.lotCode ?? stock.batch.lotCode, { mono: true });
    const originType = batch?.originType ?? stock.batch.originType;
    addRow(detailRows, "origin", "Origin type", cleanText(originType) === null ? null : humanLabel(originType));
    addDateRow(detailRows, "received", "Received date", batch?.receivedAt ?? stock.batch.receivedAt);
    addDateRow(detailRows, "prepared", "Prepared date", batch?.preparedAt ?? stock.batch.preparedAt);
    addRow(detailRows, "prepared-by", "Prepared by", batch?.preparedBy);
    addDateRow(detailRows, "expiry", "Expiry date", batch?.expiresAt ?? stock.batch.expiresAt);

    return {
      stock,
      quantityText: amountText(stock.quantity, stock.unit),
      detailRows,
      locationText: stockLocationText(stock),
      positionText,
      positionTitle: positionText === null ? null : customPosition === null ? "Generated position" : "Custom position",
    };
  }

  function stockEditLabel(stock: CatalogStock): string {
    const lotCode = cleanText(stock.batch.lotCode);
    const barcode = cleanText(stock.barcode);
    const context = [
      cleanText(stock.location.path),
      lotCode === null ? null : `lot ${lotCode}`,
      barcode === null ? null : `barcode ${barcode}`,
    ].filter((part): part is string => part !== null);
    return context.length === 0
      ? `Edit package ${stock.id}`
      : `Edit package: ${context.join(", ")}`;
  }

  function openStockEditor(stock: CatalogStock): void {
    const refresh = (): void => {
      void catalog.fetchMaterialDetail(stock.materialId);
    };
    openCatalogStockEditForm(stock.id, refresh);
  }

  async function focusRequestedStock(stockId: string, expectedMaterialId: string): Promise<void> {
    await tick();
    if (material?.id !== expectedMaterialId) {
      return;
    }
    const card = document.getElementById(`stock-card-${stockId}`);
    if (!(card instanceof HTMLElement) || !card.isConnected || !card.classList.contains("material-stock-card")) {
      return;
    }
    card.focus({ preventScroll: true });
    card.scrollIntoView({ behavior: "auto", block: "center" });
  }

  function stockTarget(stockId: string): CatalogStockTarget | null {
    const tree = inventoryFor(currentGroup.groupId);
    if (tree === null) {
      showToast("Inventory is not loaded yet. Please try again in a moment.", "error");
      return null;
    }
    const target = resolveCatalogStockTarget(tree, stockId);
    if (target === undefined) {
      showToast("Package not found in the current lab inventory. Refresh Packages and try again.", "error");
      return null;
    }
    return target;
  }

  async function adjustStockQuantity(stock: CatalogStock, delta: number): Promise<void> {
    const activeMaterialId = material?.id;
    if (!canWrite || activeMaterialId === undefined || pendingAction !== null) {
      return;
    }
    const target = stockTarget(stock.id);
    if (target === null) {
      return;
    }
    pendingAction = `${stock.id}:quantity`;
    try {
      const ok = await opAdjustQty(
        target.room.id,
        target.container?.id ?? "",
        target.shelfId,
        stock.id,
        delta,
        target.boxId,
      );
      if (ok) {
        await catalog.fetchMaterialDetail(activeMaterialId);
      }
    } finally {
      pendingAction = null;
    }
  }

  async function toggleStockAvailability(stock: CatalogStock): Promise<void> {
    const activeMaterialId = material?.id;
    if (!canWrite || activeMaterialId === undefined || pendingAction !== null || stock.status === "out_of_stock") {
      return;
    }
    const target = stockTarget(stock.id);
    if (target === null) {
      return;
    }
    const availability = stock.status === "low" ? "available" : "low";
    pendingAction = `${stock.id}:availability`;
    try {
      const ok = await opSetChemicalAvailability(
        target.room.id,
        target.container?.id ?? "",
        target.shelfId,
        stock.id,
        availability,
        target.boxId,
      );
      if (ok) {
        await catalog.fetchMaterialDetail(activeMaterialId);
      }
    } finally {
      pendingAction = null;
    }
  }
</script>

{#if catalog.detailLoading || detail === null || material === null || material.id !== materialId}
    <div id="material-detail-loading" aria-busy="true" style="display: flex; flex-direction: column; gap: 0.6rem; padding: 0.5rem 0;">
        {#each [70, 45, 55, 80, 60] as width, index (index)}
            <div style={`height: 0.75rem; width: ${width}%; border-radius: 4px; background: var(--bg-input); opacity: 0.6;`}></div>
        {/each}
    </div>
{:else}
    <div id="material-detail" class="material-detail">
        <div class="material-detail-header">
            <div class="material-heading-block">
                <div class="material-title-line">
                    <h3 class="material-detail-heading">{material.name}</h3>
                    <span class={`chem-pos ${materialTypeColorClass(material.type)}`}>{labels[material.type] ?? material.type}</span>
                </div>
                <div class="material-detail-created">
                    <span>Created {formatDate(material.createdAt)}</span>
                    <span>Updated {formatDate(material.updatedAt)}</span>
                </div>
            </div>
        </div>
        {#if material.description}
            <p class="material-description">{material.description}</p>
        {/if}

        {#if descriptorRows.length > 0}
            <section class="material-attributes" aria-labelledby="material-attributes-heading">
                <h4 class="material-section-heading" id="material-attributes-heading">Material attributes</h4>
                <div class="detail-defs">
                    {#each descriptorRows as row (row.key)}
                        <div class="detail-def-key">{row.label}</div>
                        <div class="detail-def-val" style={row.mono ? "font-family: monospace; font-variant-numeric: tabular-nums;" : ""}>
                            {#if row.tags !== undefined}
                                <div class="safety-note-tags" aria-label={row.label}>
                                    {#each row.tags as tag (tag)}
                                        <span class="safety-note-tag">{tag}</span>
                                    {/each}
                                </div>
                            {:else if row.htmlValue !== undefined}
                                <!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html row.htmlValue}
                            {:else}
                                {row.value}
                            {/if}
                        </div>
                    {/each}
                </div>
            </section>
        {/if}

        <section class="material-stocks" aria-labelledby="material-stocks-heading">
            <div class="material-stocks-heading-row">
                <h4 class="material-section-heading" id="material-stocks-heading">Stock records</h4>
                {#if stockPreviews.length > 0}
                    <span class="material-stock-count">{stockPreviews.length}</span>
                {/if}
            </div>
            {#if focusedStockMissing}
                <p class="material-stock-focus-warning" id="material-stock-focus-missing" role="alert">The selected package is no longer available. Refresh Packages and try again.</p>
            {/if}
            {#if stockPreviews.length === 0}
                <p class="material-stock-empty">No stock records.</p>
            {:else}
                <div class="material-stock-list">
                    {#each stockPreviews as preview, index (preview.stock.id)}
                        {@const stock = preview.stock}
                        <article
                            class="material-stock-card"
                            class:is-focused={requestedStockId === stock.id}
                            id={`stock-card-${stock.id}`}
                            data-stock-id={stock.id}
                            aria-labelledby={`stock-heading-${stock.id}`}
                            tabindex="-1"
                        >
                            <header class="material-stock-header">
                                <div class="material-stock-heading-group">
                                    <h5 id={`stock-heading-${stock.id}`}>Stock {index + 1}</h5>
                                    {#if cleanText(stock.status) !== null}
                                        <span class={`status-badge ${statusClass(stock.status)}`}>{statusLabel(stock.status)}</span>
                                    {/if}
                                </div>
                                <div class="material-stock-header-actions">
                                    {#if canWrite || preview.quantityText !== null}
                                        <div class="material-stock-quantity">
                                            {#if canWrite}
                                                <div
                                                    class="qty-adjuster"
                                                    role="group"
                                                    aria-label={`Quantity controls for stock ${index + 1}`}
                                                    aria-busy={pendingAction === `${stock.id}:quantity`}
                                                >
                                                    <button
                                                        type="button"
                                                        class="btn-qty"
                                                        id={`qty-decrease-${stock.id}`}
                                                        title="Decrease quantity"
                                                        aria-label={`Decrease quantity for stock ${index + 1}`}
                                                        disabled={pendingAction !== null}
                                                        onclick={() => void adjustStockQuantity(stock, -1)}
                                                    >−</button>
                                                    <span id={`quantity-${stock.id}`} class={`chem-quantity ${quantityClass(stock.status)}`}>{stock.quantity ?? 0}</span>
                                                    <button
                                                        type="button"
                                                        class="btn-qty"
                                                        id={`qty-increase-${stock.id}`}
                                                        title="Increase quantity"
                                                        aria-label={`Increase quantity for stock ${index + 1}`}
                                                        disabled={pendingAction !== null}
                                                        onclick={() => void adjustStockQuantity(stock, 1)}
                                                    >+</button>
                                                </div>
                                                {#if cleanText(stock.unit) !== null}
                                                    <span class="material-stock-unit">{stock.unit}</span>
                                                {/if}
                                            {:else if preview.quantityText !== null}
                                                <span id={`quantity-${stock.id}`} class={`chem-quantity ${quantityClass(stock.status)}`}>{stock.quantity}</span>
                                                {#if cleanText(stock.unit) !== null}
                                                    <span class="material-stock-unit">{stock.unit}</span>
                                                {/if}
                                            {/if}
                                        </div>
                                    {/if}
                                    {#if canWrite}
                                        <button
                                            type="button"
                                            class="btn-secondary material-stock-availability"
                                            class:is-low={stock.status === "low"}
                                            id={`availability-${stock.id}`}
                                            aria-pressed={stock.status === "low"}
                                            title={stock.status === "out_of_stock" ? "Out-of-stock packages cannot be marked low." : stock.status === "low" ? "Mark available" : "Mark low"}
                                            disabled={pendingAction !== null || stock.status === "out_of_stock"}
                                            onclick={() => void toggleStockAvailability(stock)}
                                        >{stock.status === "low" ? "Mark available" : "Mark low"}</button>
                                        <button
                                            type="button"
                                            class="btn-secondary material-stock-edit"
                                            id={`stock-edit-${stock.id}`}
                                            aria-label={stockEditLabel(stock)}
                                            title={stockEditLabel(stock)}
                                            onclick={() => openStockEditor(stock)}
                                        >Edit package</button>
                                    {/if}
                                </div>
                            </header>

                            {#if preview.detailRows.length > 0 || preview.locationText !== null || preview.positionText !== null}
                                <dl class="material-stock-facts">
                                    {#each preview.detailRows as row (row.key)}
                                        <div class="material-stock-fact" class:wide={row.wide}>
                                            <dt>{row.label}</dt>
                                            <dd class:mono={row.mono} title={row.title}>{row.value}</dd>
                                        </div>
                                    {/each}
                                    {#if preview.locationText !== null || preview.positionText !== null}
                                        <div class="material-stock-fact material-stock-location wide">
                                            <dt>Location</dt>
                                            <dd class="material-stock-location-content">
                                                <span class="material-stock-location-path">{preview.locationText ?? "Not available"}</span>
                                                {#if preview.positionText !== null}
                                                    <span class="chem-pos material-stock-position" title={preview.positionTitle ?? undefined}>
                                                        <span class="material-stock-sr-only">{`${preview.positionTitle}: `}</span><span class="material-stock-position-value">{preview.positionText}</span>
                                                    </span>
                                                {/if}
                                            </dd>
                                        </div>
                                    {/if}
                                </dl>
                            {/if}
                        </article>
                    {/each}
                </div>
            {/if}
        </section>
    </div>
{/if}

<style>
    .material-detail {
        min-width: 0;
        max-width: 100%;
        color: var(--text-primary);
    }

    .material-detail-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.75rem 1rem;
        min-width: 0;
        margin-bottom: 0.75rem;
    }

    .material-heading-block {
        flex: 1 1 20rem;
        min-width: 0;
    }

    .material-title-line {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.55rem 0.75rem;
        min-width: 0;
    }

    .material-detail-heading {
        min-width: 0;
        margin: 0;
        color: var(--text-primary);
        font-size: 1.2rem;
        font-weight: 700;
        line-height: 1.3;
        overflow-wrap: anywhere;
    }

    .material-detail-created {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem 0.85rem;
        margin-top: 0.4rem;
        color: var(--text-muted);
        font-size: 0.75rem;
    }

    .material-stock-availability:disabled,
    .btn-qty:disabled {
        cursor: not-allowed;
        opacity: 0.5;
        transform: none;
    }

    .material-description {
        margin: 0 0 1rem;
        color: var(--text-secondary);
        font-size: 0.875rem;
        line-height: 1.55;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    .material-attributes {
        min-width: 0;
        margin-top: 1rem;
    }

    .material-section-heading {
        margin: 0;
        color: var(--text-secondary);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.09em;
        text-transform: uppercase;
    }

    .material-attributes .detail-defs {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin: 0.6rem 0 0;
    }

    .material-attributes .detail-def-key,
    .material-attributes .detail-def-val {
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .safety-note-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        min-width: 0;
    }

    .safety-note-tag {
        display: inline-block;
        max-width: 100%;
        padding: 0.12rem 0.5rem;
        overflow-wrap: anywhere;
        color: var(--accent-blue);
        background: rgba(14, 165, 233, 0.1);
        border: 1px solid rgba(14, 165, 233, 0.24);
        border-radius: 999px;
        font-size: 0.72rem;
        font-weight: 600;
        line-height: 1.5;
    }

    :global(body[data-design="bauhaus"]) .safety-note-tag {
        color: #171512;
        background: #f4f0e6;
        border: 1px solid #171512;
        border-radius: 0;
        font-family: var(--bauhaus-font-mono);
        font-size: 0.68rem;
        text-transform: uppercase;
    }

    .material-stocks {
        min-width: 0;
        margin-top: 1rem;
        padding-top: 0.8rem;
        border-top: 1px solid var(--border-subtle);
    }

    .material-stocks-heading-row {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        margin-bottom: 0.6rem;
    }

    .material-stock-focus-warning {
        margin: 0 0 0.75rem;
        padding: 0.6rem 0.75rem;
        background: rgba(245, 158, 11, 0.08);
        border: 1px solid rgba(245, 158, 11, 0.35);
        border-radius: var(--radius-sm);
        color: var(--accent-amber);
        font-size: 0.8rem;
        line-height: 1.45;
    }

    .material-stock-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.35rem;
        height: 1.35rem;
        padding: 0 0.35rem;
        border: 1px solid var(--border-light);
        border-radius: 999px;
        color: var(--text-muted);
        font-size: 0.7rem;
        font-variant-numeric: tabular-nums;
    }

    .material-stock-empty {
        margin: 0;
        padding: 1rem;
        border: 1px dashed var(--border-light);
        border-radius: var(--radius-md);
        color: var(--text-muted);
        font-size: 0.85rem;
        text-align: center;
    }

    .material-stock-list {
        display: grid;
        gap: 0.65rem;
        min-width: 0;
    }

    .material-stock-card {
        min-width: 0;
        max-width: 100%;
        padding: 0.75rem;
        background: rgba(255, 255, 255, 0.025);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md);
        scroll-margin: 1rem;
        transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }

    .material-stock-card:focus {
        outline: none;
    }

    .material-stock-card.is-focused {
        border-color: var(--accent-blue);
        box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.18);
    }

    .material-stock-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 0.45rem 0.75rem;
        min-width: 0;
        max-width: 100%;
    }

    .material-stock-heading-group {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.4rem 0.5rem;
        min-width: 0;
        max-width: 100%;
    }

    .material-stock-header-actions {
        display: flex;
        flex: 1 1 auto;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 0.4rem;
        min-width: 0;
        max-width: 100%;
    }

    .material-stock-header h5 {
        margin: 0;
        color: var(--text-primary);
        font-size: 0.9rem;
        font-weight: 700;
    }

    .material-stock-quantity {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.35rem;
        min-width: 0;
        max-width: 100%;
    }

    .material-stock-unit {
        color: var(--text-secondary);
        font-size: 0.8rem;
        overflow-wrap: anywhere;
    }

    .material-stock-edit,
    .material-stock-availability {
        flex: 0 0 auto;
        min-height: 30px;
        padding: 0.28rem 0.6rem;
        font-size: 0.74rem;
        white-space: nowrap;
    }

    .material-stock-availability.is-low {
        border-color: rgba(245, 158, 11, 0.45);
        color: var(--accent-amber);
    }

    .btn-qty:focus-visible,
    .material-stock-edit:focus-visible,
    .material-stock-availability:focus-visible {
        outline: 2px solid var(--accent-blue);
        outline-offset: 2px;
    }

    .material-stock-facts {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.45rem 1rem;
        min-width: 0;
        margin: 0.65rem 0 0;
        padding-top: 0.6rem;
        border-top: 1px solid var(--border-subtle);
    }

    .material-stock-fact {
        min-width: 0;
    }

    .material-stock-fact.wide {
        grid-column: 1 / -1;
    }

    .material-stock-fact dt {
        margin: 0 0 0.12rem;
        color: var(--text-muted);
        font-size: 0.64rem;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
    }

    .material-stock-fact dd {
        min-width: 0;
        margin: 0;
        color: var(--text-secondary);
        font-size: 0.8rem;
        line-height: 1.35;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
    }

    .material-stock-fact dd.mono {
        color: var(--text-primary);
        font-family: monospace;
        font-variant-numeric: tabular-nums;
    }

    .material-stock-fact dd.material-stock-location-content {
        display: flex;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 0.45rem 0.75rem;
        max-width: 100%;
        white-space: normal;
    }

    .material-stock-location-path {
        flex: 1 1 10rem;
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
    }

    .material-stock-position {
        flex: 0 1 auto;
        min-width: 0;
        max-width: 100%;
        margin-left: auto;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
    }

    .material-stock-position-value {
        font-family: monospace;
        font-variant-numeric: tabular-nums;
    }

    .material-stock-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }

    :global(body[data-design="bauhaus"]) .material-stock-card {
        background: #FFFFFF;
        border: 1px solid #171512;
        border-radius: 0;
    }

    :global(body[data-design="bauhaus"]) .material-stock-header h5,
    :global(body[data-design="bauhaus"]) .material-section-heading {
        color: #171512;
        font-family: var(--bauhaus-font-display);
    }

    :global(body[data-design="bauhaus"]) .material-stock-count {
        background: #FFFFFF;
        border-color: #171512;
        border-radius: 0;
        color: #171512;
        font-family: var(--bauhaus-font-mono);
    }

    :global(body[data-design="bauhaus"]) .material-stock-empty {
        background: #FFFFFF;
        border-color: #171512;
        border-radius: 0;
        color: rgba(23, 21, 18, 0.65);
    }

    :global(body[data-design="bauhaus"]) .material-stock-card.is-focused {
        border-color: #171512;
        box-shadow: 4px 4px 0 rgba(23, 21, 18, 0.25);
    }

    :global(body[data-design="bauhaus"]) .material-stock-facts {
        border-top-color: rgba(23, 21, 18, 0.25);
    }

    :global(body[data-design="bauhaus"]) .material-stock-availability.btn-secondary,
    :global(body[data-design="bauhaus"]) .material-stock-edit.btn-secondary {
        height: 32px;
        min-height: 32px;
        padding: 0 0.65rem;
        border-width: 1px;
        font-size: 0.65rem;
        letter-spacing: 0.07em;
    }

    :global(body[data-design="bauhaus"]) .material-stock-availability.is-low {
        border-color: #171512;
        color: #171512;
    }

    :global(body[data-design="bauhaus"]) .material-stock-fact dt {
        color: rgba(23, 21, 18, 0.55);
        font-family: var(--bauhaus-font-mono);
        letter-spacing: 0.04em;
    }

    :global(body[data-design="bauhaus"]) .material-stock-fact dd,
    :global(body[data-design="bauhaus"]) .material-stock-fact dd.mono {
        color: #3A3630;
        font-family: var(--font-family);
    }

    :global(body[data-design="bauhaus"]) .material-stock-position {
        white-space: normal;
    }

    @media (max-width: 640px) {
        .material-detail-header {
            align-items: flex-start;
        }

        .material-heading-block {
            flex-basis: 100%;
        }

        .material-stock-header {
            align-items: flex-start;
        }

        .material-stock-header-actions {
            flex-basis: 100%;
            justify-content: flex-start;
        }

        .material-attributes .detail-defs,
        .material-stock-facts {
            grid-template-columns: minmax(0, 1fr);
        }

        .material-stock-fact.wide {
            grid-column: auto;
        }

        .material-stock-card {
            padding: 0.65rem;
        }
    }
</style>
