<script lang="ts">
  import JsBarcode from "jsbarcode";
  import type { AssetRoom } from "@bioscom/shared";
  import { fetchInventory, inventory, inventoryFor } from "../../lib/stores/inventory.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { roleCanWrite } from "../../lib/ops";
  import { openAssetRoomForm } from "../../lib/forms";
  import { stripEmoji } from "../../lib/inventoryUtils";
  import { theme } from "../../lib/theme.svelte";

  let {
    roomId,
  }: {
    roomId: string;
  } = $props();

  const design = $derived(theme.design);
  const tree = $derived(inventoryFor(currentGroup.groupId));
  const mappedAssetRoomIds = $derived(
    new Set(
      (tree?.assetRooms ?? [])
        .filter((assetRoom) => assetRoom.linkedRoomId === roomId)
        .map((assetRoom) => assetRoom.id),
    ),
  );
  // Asset.roomId continues to reference AssetRoom.id. Only the explicit
  // AssetRoom.linkedRoomId connects those legacy assignments to this Room.
  const barcodedAssets = $derived(
    (tree?.assets ?? []).filter(
      (asset) =>
        asset.roomId !== undefined &&
        asset.roomId !== null &&
        mappedAssetRoomIds.has(asset.roomId) &&
        (asset.barcode ?? "").trim() !== "",
    ),
  );
  const mappingRooms = $derived(
    (tree?.assetRooms ?? []).filter(
      (assetRoom) => (assetRoom.linkedRoomId ?? "") === "" || assetRoom.linkedRoomId === roomId,
    ),
  );
  const canWrite = $derived(roleCanWrite());
  const isReader = $derived(session.user?.role === "reader");

  let expanded = $state(false);
  let barcodeRoot = $state<HTMLDivElement | null>(null);

  $effect(() => {
    const root = barcodeRoot;
    if (!expanded || root === null) {
      return;
    }
    const assetsById = new Map(barcodedAssets.map((asset) => [asset.id, asset]));
    // Scope rendering to this disclosure. The legacy Assets view intentionally
    // remains independent and continues to own its own .barcode-render nodes.
    for (const element of root.querySelectorAll<SVGSVGElement>("svg[data-room-asset-barcode]")) {
      const asset = assetsById.get(element.dataset.roomAssetBarcode ?? "");
      const value = asset?.barcode?.trim() ?? "";
      if (asset === undefined || value === "") {
        continue;
      }
      try {
        JsBarcode(element, value, {
          format: "CODE128",
          width: 2,
          height: 48,
          displayValue: false,
          margin: 4,
        });
        const box = element.getBBox();
        if (box.width > 0 && box.height > 0) {
          element.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
        }
        element.removeAttribute("data-barcode-error");
      } catch {
        element.setAttribute("data-barcode-error", "true");
      }
    }
  });

  function editMapping(assetRoom: AssetRoom): void {
    const linked = assetRoom.linkedRoomId === roomId;
    openAssetRoomForm(
      { id: assetRoom.id, name: assetRoom.name, linkedRoomId: assetRoom.linkedRoomId },
      { preferredRoomId: linked ? null : roomId },
    );
  }

  function retryInventory(): void {
    const groupId = currentGroup.groupId;
    if (groupId !== null) {
      void fetchInventory(groupId).catch(() => undefined);
    }
  }
</script>

<section id="room-barcodes-section" class="room-equipment-section" aria-labelledby="room-barcodes-title" data-room-id={roomId}>
  <div class="room-equipment-heading">
    <div>
      <h2 id="room-barcodes-title">Asset barcodes</h2>
      <p class="room-equipment-subtitle">Inventory barcodes from asset rooms explicitly linked to this room.</p>
    </div>
    <div class="room-equipment-actions">
      {#if tree !== null}<span class="room-equipment-count">{barcodedAssets.length} {barcodedAssets.length === 1 ? "barcoded asset" : "barcoded assets"}</span>{/if}
      {#if !isReader}<a class="btn-inline" id="room-open-inventory" href="#assets">Open in Inventory</a>{/if}
    </div>
  </div>

  <button
    type="button"
    class="room-barcode-toggle"
    id="room-barcodes-toggle"
    aria-expanded={expanded}
    aria-controls="room-barcodes-panel"
    onclick={() => { expanded = !expanded; }}
  >
    <span>{expanded ? "Hide asset barcodes" : "Show asset barcodes"}</span>
    <span aria-hidden="true">{expanded ? "−" : "+"}</span>
  </button>

  <div id="room-barcodes-panel" class="room-barcode-panel" hidden={!expanded}>
    {#if inventory.loadError !== ""}
      <div class="room-equipment-message warning" role="alert">
        <span>{inventory.loadError} {tree !== null ? "Showing the last confirmed assignments." : "Barcode assignments are not confirmed yet."}</span>
        <button type="button" class="btn-inline" id="room-barcodes-retry" onclick={retryInventory}>Try again</button>
      </div>
    {:else if tree === null}
      <p class="room-equipment-message" id="room-barcodes-loading" role="status">Loading this room’s barcode assignments…</p>
    {/if}

    {#if tree !== null && barcodedAssets.length === 0}
      <p class="room-equipment-empty" id="room-barcodes-empty">No barcoded assets are assigned to this room.</p>
    {:else if tree !== null && barcodedAssets.length > 0}
      <div class="room-barcode-grid" id="room-barcode-grid" bind:this={barcodeRoot}>
        {#each barcodedAssets as asset (asset.id)}
          {@const barcode = asset.barcode?.trim() ?? ""}
          <article class="room-barcode-card" data-room-barcode-asset={asset.id}>
            <h3>{design === "bauhaus" ? stripEmoji(asset.name) : asset.name}</h3>
            {#if asset.model}<p class="room-barcode-model">{design === "bauhaus" ? stripEmoji(asset.model) : asset.model}</p>{/if}
            <p class="room-barcode-value" data-room-barcode-value={barcode}>{barcode}</p>
            <svg
              class="room-barcode-svg"
              data-room-asset-barcode={asset.id}
              role="img"
              aria-label={`CODE128 barcode ${barcode} for ${asset.name}`}
            ></svg>
            <p class="room-barcode-preview-error">CODE128 preview unavailable; use the printed value above.</p>
          </article>
        {/each}
      </div>
    {/if}

    {#if canWrite && tree !== null && mappingRooms.length > 0}
      <div class="room-mapping" id="room-mapping">
        <h3>Inventory room links</h3>
        <p>Link an existing Inventory room to show its barcoded assets here, or clear its current link. Asset assignments do not change.</p>
        <div class="room-mapping-list">
          {#each mappingRooms as assetRoom (assetRoom.id)}
            <div class="room-mapping-row">
              <div>
                <strong>{design === "bauhaus" ? stripEmoji(assetRoom.name) : assetRoom.name}</strong>
                <span>{assetRoom.linkedRoomId === roomId ? "Linked to this room" : "No chemical room linked"}</span>
              </div>
              <button
                type="button"
                class="btn-inline"
                id={`room-map-${assetRoom.id}`}
                onclick={() => editMapping(assetRoom)}
              >{assetRoom.linkedRoomId === roomId ? "Edit link" : "Link to this room"}</button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</section>
