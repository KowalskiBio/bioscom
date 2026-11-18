<script lang="ts">
  import { printData } from "../../lib/stores/print.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { openModal, closeModal } from "../../lib/modal.svelte";
  import { openCatalogForm as openCatalogFormShared, openPrintRequestModal } from "../../lib/forms";
  import { showToast } from "../../lib/stores/toast.svelte";
  import { verifyCaptchaAndExecute } from "../../lib/captcha";
  import { opDeleteCatalogItem, opSetPrintStatus } from "../../lib/featureOps";
  import { stripEmoji } from "../../lib/inventoryUtils";
  import { theme } from "../../lib/theme.svelte";

  const design = $derived(theme.design);
    
  let activeTab = $state<"catalog" | "requests">("catalog");
  let categoryFilter = $state("all");

  const isSuperadmin = $derived(session.user?.role === "superadmin");
  const categories = ["all", "Racks & Holders", "Adapters & Clamps", "Fluidics & Tubing", "Enclosures & Boxes", "Safety Gears", "Others"];
  const catalog = $derived(categoryFilter === "all" ? printData.catalog : printData.catalog.filter((i) => i.category === categoryFilter));
  const requests = $derived(printData.requests);

  function switchTab(tab: "catalog" | "requests"): void {
    activeTab = tab;
  }

  function deleteCatalogItem(id: string, name: string): void {
    openModal({
      title: "Delete Catalog Item",
      bodyHtml: `<p>Delete <strong>${escapeHtmlText(name)}</strong> from the catalog?</p>`,
      btnText: "Delete",
      onConfirm: () => {
        verifyCaptchaAndExecute(async () => {
          if (await opDeleteCatalogItem(id)) {
            closeModal();
            showToast("Catalog item deleted");
          }
        });
      },
    });
  }

  function escapeHtmlText(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
</script>

<div class="print-tabs-nav">
    <button class={`print-tab-btn ${activeTab === "catalog" ? "active" : ""}`} id="print-tab-catalog-btn" onclick={() => switchTab("catalog")}>{design === "bauhaus" ? "Catalog" : "📚 Catalog"}</button>
    <button class={`print-tab-btn ${activeTab === "requests" ? "active" : ""}`} id="print-tab-requests-btn" onclick={() => switchTab("requests")}>{design === "bauhaus" ? "Print Requests" : "📋 Print Requests"}</button>
</div>

<div id="print-catalog-tab-content" style={`display: ${activeTab === "catalog" ? "block" : "none"};`}>
    <div class="filter-pills-container" id="print-category-filters">
        {#each categories as cat (cat)}
            <button class={`filter-pill ${categoryFilter === cat ? "active" : ""}`} onclick={() => (categoryFilter = cat)}>{cat === "all" ? "All" : cat}</button>
        {/each}
    </div>
    <div id="print-catalog-grid" class="assets-grid" style={`display: ${catalog.length === 0 ? "none" : "grid"};`}>
        {#each catalog as item (item.id)}
            <div class="asset-card print-catalog-card" data-catalog-id={item.id}>
                <div class="asset-header">
                    <div class="asset-title">{design === "bauhaus" ? stripEmoji(item.name) : item.name}</div>
                    {#if item.category}<div class="asset-meta">{design === "bauhaus" ? stripEmoji(item.category) : item.category}</div>{/if}
                </div>
                {#if item.description}<div class="asset-description">{design === "bauhaus" ? stripEmoji(item.description) : item.description}</div>{/if}
                {#if item.material}<div style="font-size: 0.8rem; color: var(--text-muted);">{#if design !== "bauhaus"}🧵 {/if}{design === "bauhaus" ? stripEmoji(item.material) : item.material}</div>{/if}
                {#if item.estimatedTime}<div style="font-size: 0.8rem; color: var(--text-muted);">⏱️ {design === "bauhaus" ? stripEmoji(item.estimatedTime) : item.estimatedTime}</div>{/if}
                <div class="asset-actions">
                    <button class="btn-inline" onclick={() => openPrintRequestModal({ id: item.id, name: item.name ?? "" })}>{design === "bauhaus" ? "Request" : "🖨️ Request"}</button>
                    {#if isSuperadmin}
                        <button class="btn-inline" onclick={() => openCatalogFormShared({ id: item.id, name: item.name ?? "", description: item.description ?? "", category: item.category ?? "", material: item.material ?? "", estimatedTime: item.estimatedTime ?? "" })}>Edit</button>
                        <button class="btn-inline danger" onclick={() => deleteCatalogItem(item.id, item.name ?? "")}>Delete</button>
                    {/if}
                </div>
            </div>
        {/each}
    </div>
    <div id="print-catalog-empty" class="empty-state" style={`display: ${catalog.length === 0 ? "block" : "none"};`}>
        <div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-red" aria-hidden="true"></span>{:else}🖨️{/if}</div><h2>No items in catalog yet</h2><p>Add your first 3D printable design to the catalog</p>
    </div>
</div>

<div id="print-requests-tab-content" style={`display: ${activeTab === "requests" ? "block" : "none"};`}>
    <div id="print-requests-list" class="booking-list" style="margin-top: 0;">
        {#each requests as r (r.id)}
            <div class="print-request-card asset-card" data-request-id={r.id}>
                <div class="asset-header">
                    <div class="asset-title">{design === "bauhaus" ? stripEmoji(r.catalogItemName ?? "Custom Design") : (r.catalogItemName ?? "Custom Design")}</div>
                    <span style={`font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 10px; font-weight: 600; ${r.status === "done" ? "background: rgba(34,197,94,0.15); color: var(--accent-green);" : r.status === "printing" ? "background: rgba(59,130,246,0.15); color: var(--accent-blue);" : r.status === "rejected" ? "background: rgba(239,68,68,0.15); color: var(--accent-red);" : "background: rgba(255,255,255,0.05); color: var(--text-muted);"}`}>{r.status ?? "pending"}</span>
                </div>
                {#if r.note}<div class="asset-description">{design === "bauhaus" ? stripEmoji(r.note) : r.note}</div>{/if}
                <div style="font-size: 0.8rem; color: var(--text-muted);">by {design === "bauhaus" ? stripEmoji(r.requestedBy) : r.requestedBy}{r.requestedByLabName ? ` (${design === "bauhaus" ? stripEmoji(r.requestedByLabName) : r.requestedByLabName})` : ""} · qty {r.quantity ?? 1}</div>
                {#if isSuperadmin}
                    <div class="asset-actions">
                        <button class="btn-inline" onclick={() => void opSetPrintStatus(r.id, "printing")}>Start</button>
                        <button class="btn-inline" onclick={() => void opSetPrintStatus(r.id, "done")}>Done</button>
                        <button class="btn-inline danger" onclick={() => void opSetPrintStatus(r.id, "rejected")}>Reject</button>
                    </div>
                {/if}
            </div>
        {/each}
    </div>
    <div id="print-requests-empty" class="empty-state" style={`display: ${requests.length === 0 ? "block" : "none"};`}>
        <div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-blue" aria-hidden="true"></span>{:else}📋{/if}</div><h2>No print requests yet</h2><p>Request print from the catalog or submit a custom request</p>
    </div>
</div>
