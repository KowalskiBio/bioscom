<script lang="ts">
  import JsBarcode from "jsbarcode";
  import type { Asset } from "@bioscom/shared";
  import { inventory } from "../../lib/stores/inventory.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { openModal, closeModal } from "../../lib/modal.svelte";
  import { showToast } from "../../lib/stores/toast.svelte";
  import { verifyCaptchaAndExecute } from "../../lib/captcha";
  import { opDeleteAsset, opDeleteAssetRoom, roleCanWrite } from "../../lib/ops";
  import { openAssetForm, openAssetRoomForm } from "../../lib/forms";
  import { theme } from "../../lib/theme.svelte";

  const design = $derived(theme.design);

  let {
    searchQuery = $bindable(""),
  }: {
    searchQuery?: string;
  } = $props();


  let highlightedAssetId = $state<string | null>(null);

  const assets = $derived(inventory.tree?.assets ?? []);
  const rooms = $derived(inventory.tree?.assetRooms ?? []);
  const isReader = $derived(session.user?.role === "reader");
  const q = $derived(searchQuery.trim().toLowerCase());
  const list = $derived(
    q === ""
      ? assets
      : assets.filter(
          (a) =>
            (a.name ?? "").toLowerCase().includes(q) ||
            (a.model ?? "").toLowerCase().includes(q) ||
            (a.description ?? "").toLowerCase().includes(q),
        ),
  );
  const showEmpty = $derived(list.length === 0 && q === "" && rooms.length === 0);

  const validRoomIds = $derived(new Set(rooms.map((r) => r.id)));
  const unassigned = $derived(
    list.filter((a) => a.roomId === undefined || a.roomId === null || a.roomId === "" || a.roomId === "unassigned" || !validRoomIds.has(a.roomId)),
  );

  $effect(() => {
    if (list.length === 0) {
      return;
    }
    const nodes = document.querySelectorAll(".barcode-render");
    for (const el of nodes) {
      const value = el.getAttribute("data-barcode") ?? "";
      if (value === "") {
        continue;
      }
      try {
        JsBarcode(el as Element, value, {
          format: "CODE128",
          width: 2,
          height: 60,
          displayValue: true,
          fontSize: 16,
          margin: 10,
        });
        const bbox = (el as SVGSVGElement).getBBox();
        if (bbox.width > 0 && bbox.height > 0) {
          (el as SVGSVGElement).setAttribute("viewBox", `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
          (el as SVGSVGElement).setAttribute("width", "100%");
          (el as SVGSVGElement).setAttribute("height", "100%");
        }
      } catch {
        console.error("Barcode generation failed for", value);
      }
    }
  });

  function deleteAsset(id: string, name: string): void {
    openModal({
      title: "Delete Asset",
      bodyHtml: `<p>Delete <strong>${escapeHtmlText(name)}</strong>?</p>`,
      btnText: "Delete",
      onConfirm: () => {
        verifyCaptchaAndExecute(async () => {
          if (await opDeleteAsset(id)) {
            closeModal();
            showToast("Asset deleted");
          }
        });
      },
    });
  }

  function highlight(assetId: string): void {
    highlightedAssetId = assetId;
    setTimeout(() => {
      highlightedAssetId = null;
    }, 3000);
  }

  function escapeHtmlText(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function deleteAssetRoom(id: string): void {
    openModal({
      title: "Delete Asset Room",
      bodyHtml: `Are you sure you want to delete this room? Assets assigned to it will be unassigned.`,
      btnText: "Delete",
      onConfirm: async () => {
        if (await opDeleteAssetRoom(id)) {
          closeModal();
          showToast("Asset room deleted");
        }
      },
    });
  }
</script>

{#snippet assetCard(a: Asset)}
  <div class={`asset-card ${highlightedAssetId === a.id ? "highlighted" : ""}`} data-asset-id={a.id} style={highlightedAssetId === a.id ? "box-shadow: 0 0 0 3px var(--primary); transform: scale(1.02); transition: all 0.5s ease;" : ""}>
    <div class="asset-header">
      <div class="asset-title">{a.name}</div>
      {#if a.model}<div class="asset-meta">{a.model}</div>{/if}
    </div>
    {#if a.description}<div class="asset-description">{a.description}</div>{/if}
    {#if a.barcode && a.barcode.trim() !== ""}
      <div class="asset-barcode-card-view" style="text-align: center; margin: 10px 0;">
        <svg class="barcode-render" data-barcode={a.barcode.trim()} style="width: 3.5in; height: 1.2in; display: block; margin: 0 auto; background: white; padding: 8px; border: 1px solid var(--border-subtle); box-sizing: border-box;"></svg>
      </div>
    {/if}
    <div class="asset-actions">
      <button class="btn-inline" onclick={() => { highlight(a.id); openAssetForm(rooms, { id: a.id, name: a.name ?? "", model: a.model, barcode: a.barcode, description: a.description, roomId: a.roomId }); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> <span>Edit</span></button>
      <button class="btn-inline danger" onclick={() => deleteAsset(a.id, a.name ?? "")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> <span>Delete</span></button>
    </div>
  </div>
{/snippet}

<div id="assets-grid" class="assets-grid" style={`display: ${list.length === 0 && q !== "" ? "block" : "grid"};`}>
    {#if q !== "" && list.length === 0}
      <div class="empty-state" style="grid-column: 1 / -1; padding: 3rem;"><div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-circle-ink" aria-hidden="true"></span>{:else}🔍{/if}</div><h2>No matching items found</h2><p>Try searching for a different name, brand, or model</p></div>
    {/if}
    {#each rooms as room (room.id)}
      {@const roomAssets = list.filter((a) => a.roomId === room.id)}
      <div style="grid-column: 1 / -1; margin-top: 1rem; margin-bottom: 0.5rem; border-bottom: 2px solid var(--border-subtle); padding-bottom: 0.25rem; display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0; color: var(--text-primary); font-size: 1.1rem;">{#if design !== "bauhaus"}🚪 {/if}{room.name}</h3>
        {#if !isReader}
          <div style="display:flex; gap:0.5rem;">
            <button class="btn-inline" style="font-size:0.75rem;" onclick={() => openAssetRoomForm({ id: room.id, name: room.name ?? "" })}>Edit Room</button>
            <button class="btn-inline danger" style="font-size:0.75rem;" onclick={() => deleteAssetRoom(room.id)}>Delete</button>
          </div>
        {/if}
      </div>
      {#if roomAssets.length === 0}
        <div style="grid-column: 1 / -1; color: var(--text-muted); font-size: 0.9rem; font-style: italic; padding: 1rem 0;">No assets in this room.</div>
      {:else}
        {#each roomAssets as a (a.id)}{@render assetCard(a)}{/each}
      {/if}
    {/each}
    {#if unassigned.length > 0}
      <div style="grid-column: 1 / -1; margin-top: 1rem; margin-bottom: 0.5rem; border-bottom: 2px solid var(--border-subtle); padding-bottom: 0.25rem; display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0; color: var(--text-primary); font-size: 1.1rem;">{#if design !== "bauhaus"}🚪 {/if}No Room Assigned</h3>
      </div>
      {#each unassigned as a (a.id)}{@render assetCard(a)}{/each}
    {/if}
</div>
<div id="assets-empty" class="empty-state" style={`display: ${showEmpty ? "block" : "none"};`}>
    <div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}📦{/if}</div><h2>No items in lab inventory yet</h2><p>Add your first laboratory asset, device, or equipment item</p>
    <button class="btn-primary" id="btn-add-asset-empty"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Asset</span></button>
</div>
