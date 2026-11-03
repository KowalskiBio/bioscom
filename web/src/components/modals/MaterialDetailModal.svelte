<script lang="ts">
  import { onMount } from "svelte";
  import { MATERIAL_TYPES, materialTypeLabels, type MaterialFieldDef } from "@bioscom/shared";
  import { catalog } from "../../lib/stores/catalog.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { openMaterialMergeModal } from "../../lib/forms";

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

  function expiryHint(value: number | null): string {
    if (value === null) {
      return "";
    }
    const days = Math.ceil((value - Date.now()) / 86_400_000);
    if (days < 0 || days > 60) {
      return "";
    }
    return days === 1 ? "expires in 1 day" : `expires in ${days} days`;
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

  function stockPosition(stock: { position: string | null; customPosition: string | null }): string {
    return stock.customPosition ?? stock.position ?? "—";
  }
</script>

{#if catalog.detailLoading || detail === null || material === null || material.id !== materialId}
    <div id="material-detail-loading" aria-busy="true" style="display: flex; flex-direction: column; gap: 0.6rem; padding: 0.5rem 0;">
        {#each [70, 45, 55, 80, 60] as width, index (index)}
            <div style={`height: 0.75rem; width: ${width}%; border-radius: 4px; background: var(--bg-input); opacity: 0.6;`}></div>
        {/each}
    </div>
{:else}
    <div id="material-detail" style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
        <h3 style="font-size: 1.2rem; font-weight: 700; color: var(--text-primary);">{material.name}</h3>
        <span class="chem-pos">{labels[material.type] ?? material.type}</span>
        <span style="font-size: 0.75rem; color: var(--text-muted);">Created {formatDate(material.createdAt)}</span>
        {#if session.user?.role !== "reader"}
            <button
                type="button"
                class="btn-secondary"
                id="material-merge-open"
                style="margin-left: auto; padding: 0.3rem 0.7rem; font-size: 0.8rem;"
                onclick={() => openMaterialMergeModal(material.id, material.name)}
            >Merge into…</button>
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

    {@const productById = new Map((detail.products ?? []).map((p) => [p.id, p]))}
    <h4 class="detail-section-title">Packages</h4>
    {#if detail.batches.length === 0}
        <p style="font-size: 0.85rem; color: var(--text-muted);">No packages recorded.</p>
    {:else}
        <table class="detail-table">
            <thead>
                <tr><th>Lot</th><th>Origin</th><th>Manufacturer</th><th>Catalog #</th><th>Received</th><th>Expires</th></tr>
            </thead>
            <tbody>
                {#each detail.batches as batch (batch.id)}
                    {@const product = batch.productId !== null && batch.productId !== undefined ? productById.get(batch.productId) : undefined}
                    <tr>
                        <td class="stocks-mono">{batch.lotCode ?? "—"}</td>
                        <td>{batch.originType}</td>
                        <td>{product?.manufacturer ?? "—"}</td>
                        <td class="stocks-mono">{product?.catalogNumber ?? "—"}</td>
                        <td>{formatDate(batch.receivedAt)}</td>
                        <td>
                            {formatDate(batch.expiresAt)}
                            {#if expiryHint(batch.expiresAt) !== ""}
                                <div style="font-size: 0.7rem; color: var(--text-muted);">{expiryHint(batch.expiresAt)}</div>
                            {/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}

    <h4 class="detail-section-title">Locations</h4>
    {#if detail.stocks.length === 0}
        <p style="font-size: 0.85rem; color: var(--text-muted);">No stock records.</p>
    {:else}
        <table class="detail-table">
            <thead>
                <tr><th>Location</th><th>Position</th><th>Quantity</th><th>Status</th></tr>
            </thead>
            <tbody>
                {#each detail.stocks as stock (stock.id)}
                    <tr>
                        <td>
                            <div>{stock.location.path || "—"}</div>
                            {#if stock.location.rackName || stock.location.boxName}
                                <div style="font-family: monospace; font-size: 0.7rem; color: var(--text-muted);">
                                    {[stock.location.rackName, stock.location.boxName].filter((part) => part !== null && part !== "").join(" / ")}
                                </div>
                            {/if}
                        </td>
                        <td>
                            {#if stock.customPosition !== null && stock.customPosition !== ""}
                                <span class="chem-pos">{stock.customPosition}</span>
                            {:else}
                                {stockPosition(stock)}
                            {/if}
                        </td>
                        <td>{stock.quantity ?? "—"} {stock.unit ?? ""}</td>
                        <td><span class={`status-badge ${statusClass(stock.status)}`}>{statusLabel(stock.status)}</span></td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}
{/if}
