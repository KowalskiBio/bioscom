<script lang="ts">
  import { materialTypeLabels } from "@bioscom/shared";
  import type { Chemical, Container } from "@bioscom/shared";
  import { inventory } from "../../lib/stores/inventory.svelte";
  import { router, navigateTo } from "../../lib/router.svelte";
  import { countChems, escapeHtml, materialTypeColorClass, quantityClass, stripEmoji } from "../../lib/inventoryUtils";
  import { groupList } from "../../lib/stores/groups.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { opAdjustQty, opDeleteChemical } from "../../lib/ops";
  import { openChemicalForm, openStockLabelModal } from "../../lib/forms";
  import { closeModal, openModal } from "../../lib/modal.svelte";
  import { showToast } from "../../lib/stores/toast.svelte";
  import { verifyCaptchaAndExecute } from "../../lib/captcha";
  import { theme } from "../../lib/theme.svelte";

  const design = $derived(theme.design);

  const route = $derived(router.route);
  const roomId = $derived(route.view === "containers" || route.view === "detail" ? route.roomId : "");
  const room = $derived(inventory.tree?.rooms.find((r) => r.id === roomId));
  const shared = $derived(inventory.sharedContainers);

  const containers = $derived.by(() => {
    if (room === undefined) {
      return [];
    }
    const conts = [...(room.containers ?? [])];
    if (roomId === "shared-assets") {
      for (const sc of shared) {
        if (!conts.some((c) => c.id === sc.container.id)) {
          conts.push(sc.container);
        }
      }
    }
    return conts;
  });

  const cabinets = $derived(containers.filter((c) => c.type === "cabinet"));
  const fridges = $derived(containers.filter((c) => c.type === "fridge"));
  const freezers = $derived(containers.filter((c) => c.type === "freezer" || c.type === "deepfreezer"));
  const showEmpty = $derived(containers.length === 0);
  const labels = materialTypeLabels();
  const isReader = $derived(session.user?.role === "reader");

  async function adjustRoomQuantity(chemId: string, delta: number): Promise<void> {
    if (isReader || room === undefined) return;
    await opAdjustQty(room.id, "", "", chemId, delta);
  }

  function editRoomChemical(ch: Chemical): void {
    if (isReader || room === undefined) return;
    openChemicalForm(room, undefined, { editChemId: ch.id });
  }

  function deleteRoomChemical(ch: Chemical): void {
    if (isReader || room === undefined) return;
    const currentRoom = room;
    openModal({
      title: "Delete Chemical",
      bodyHtml: `<p>Delete <strong>${escapeHtml(ch.name ?? "")}</strong> from this room?</p>`,
      btnText: "Delete",
      onConfirm: () => {
        verifyCaptchaAndExecute(async () => {
          if (await opDeleteChemical(currentRoom.id, "", "", ch.id)) {
            closeModal();
            showToast("Deleted");
          }
        });
      },
    });
  }
</script>

{#snippet card(cont: Container, typeName: string, icon: string, cls: string)}
  {@const chemCount = countChems(cont)}
  {@const isFromOtherLab = cont.ownerGroupId !== undefined && cont.ownerGroupId !== currentGroup.groupId}
  {@const isMySharedContainer = !isFromOtherLab && (cont.sharedWithGroupIds ?? []).length > 0}
  {@const groupNames = Object.fromEntries(groupList.items.map((g) => [g.id, g.name]))}
  {@const otherGroupIds = (cont.sharedWithGroupIds ?? []).filter((gid) => gid !== currentGroup.groupId)}
  {@const glyphKind = cont.type === "cabinet" ? "square-red" : cont.type === "fridge" ? "circle-blue" : cont.type === "freezer" ? "square-ink" : cont.type === "deepfreezer" ? "circle-ink" : "square-ink"}
  <div
    class={`card ${cls}-card`}
    style={isMySharedContainer ? "border: 2px solid var(--accent-blue); box-shadow: 0 0 12px rgba(59, 130, 246, 0.25);" : ""}
    onclick={() => { navigateTo("detail", { roomId, containerId: cont.id }); }}
  >
    <span class={`card-type-badge ${cls}-badge`}>{cont.type === "deepfreezer" ? "Deep Freezer" : typeName}</span>
    <div class={`card-icon ${cls}`}>{#if design === "bauhaus"}<span class={`glyph glyph-${glyphKind}`} aria-hidden="true"></span>{:else}{cont.emoji || icon}{/if}</div>
    <div class="card-title">{design === "bauhaus" ? stripEmoji(cont.name) : cont.name}{isFromOtherLab ? " (Shared)" : ""}</div>
    <div class="card-description">{design === "bauhaus" ? stripEmoji(cont.description || "") : (cont.description || "")}
      <br>
      {#if isFromOtherLab}
        <span style="font-size: 0.7rem; background: rgba(34, 197, 94, 0.15); color: var(--accent-green); padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; margin-top: 0.4rem; font-weight: 600;">{#if design !== "bauhaus"}🔗 {/if}Shared from: {design === "bauhaus" ? stripEmoji(cont.ownerGroupName ?? "—") : (cont.ownerGroupName ?? "—")} (Room: {design === "bauhaus" ? stripEmoji(shared.find((sc) => sc.container.id === cont.id)?.roomName ?? "—") : (shared.find((sc) => sc.container.id === cont.id)?.roomName ?? "—")})</span>
      {:else if otherGroupIds.length > 0}
        <span style="font-size: 0.7rem; background: rgba(59, 130, 246, 0.12); color: var(--accent-blue); padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; margin-top: 0.4rem; font-weight: 600;">{#if design !== "bauhaus"}🔗 {/if}Shared to: {design === "bauhaus" ? stripEmoji(otherGroupIds.map((gid) => groupNames[gid] ?? "Unknown Lab").join(", ")) : otherGroupIds.map((gid) => groupNames[gid] ?? "Unknown Lab").join(", ")}</span>
      {/if}
    </div>
    <div class="card-stats"><div class="card-stat">{#if design !== "bauhaus"}📁 {/if}<span class="card-stat-value">{(cont.shelves ?? []).length}</span> shelves</div><div class="card-stat">{#if design !== "bauhaus"}🧪 {/if}<span class="card-stat-value">{chemCount}</span> chemicals</div></div>
  </div>
{/snippet}

{#if route.view === "containers" && room !== undefined && (room.chemicals ?? []).length > 0}
  <section id="room-direct-chemicals" class="room-chemical-list" aria-labelledby="room-direct-chemicals-title">
    <div class="room-chemical-heading">
      <h2 class="detail-section-title" id="room-direct-chemicals-title">Directly in this room</h2>
      <span class="shelf-count">{(room.chemicals ?? []).length} chemicals</span>
    </div>
    <div class="room-chemical-table-wrap">
      <table class="detail-table" aria-label="Chemicals stored directly in this room">
        <thead>
          <tr><th>Name</th><th>Type</th><th>Quantity</th><th>Unit</th><th>Location</th><th style="width: 9rem; text-align: right;">Actions</th></tr>
        </thead>
        <tbody>
          {#each room.chemicals ?? [] as ch (ch.id)}
            {@const barcode = (ch.barcode ?? "").trim()}
            {@const concentration = ch.concentration !== null && ch.concentration !== undefined ? `${ch.concentration} ${ch.concUnit ?? ""}` : ""}
            <tr data-chemid={ch.id}>
              <td>
                <strong>{design === "bauhaus" ? stripEmoji(ch.name ?? "") : (ch.name ?? "")}</strong>
                {#if concentration !== ""}<div class="room-chemical-meta">{concentration}</div>{/if}
              </td>
              <td><span class={`status-badge ${materialTypeColorClass(ch.type ?? "chemical")}`}>{labels[ch.type ?? "chemical"] ?? ch.type ?? "chemical"}</span></td>
              <td>
                <div class="qty-adjuster" aria-label={`Quantity of ${ch.name ?? "chemical"}`}>
                  {#if !isReader}<button class="btn-qty" title="Decrease quantity" aria-label={`Decrease quantity of ${ch.name}`} onclick={() => void adjustRoomQuantity(ch.id, -1)}>−</button>{/if}
                  <span class={`chem-quantity ${quantityClass(ch.quantity)}`}>{ch.quantity ?? 0}</span>
                  {#if !isReader}<button class="btn-qty" title="Increase quantity" aria-label={`Increase quantity of ${ch.name}`} onclick={() => void adjustRoomQuantity(ch.id, 1)}>+</button>{/if}
                </div>
              </td>
              <td>{ch.unit ?? "pcs"}</td>
              <td>{design === "bauhaus" ? stripEmoji(room.name) : room.name}</td>
              <td>
                <div class="row-actions">
                  {#if barcode !== ""}
                    <button class="btn-inline" title={`Print label for ${ch.name}`} aria-label={`Print label for ${ch.name}`} onclick={() => openStockLabelModal({ name: ch.name, barcode, type: ch.type ?? undefined, locationText: room.name, position: ch.customPosition ?? ch.position ?? null, lotCode: ch.batchInfo?.lotCode ?? null, expiresAt: ch.batchInfo?.expiresAt ?? null })}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5v14"/><path d="M8 5v14"/><path d="M12 5v14"/><path d="M16 5v14"/><path d="M20 5v14"/></svg>
                    </button>
                  {/if}
                  {#if !isReader}
                    <button class="btn-inline" title={`Edit ${ch.name}`} aria-label={`Edit ${ch.name}`} onclick={() => editRoomChemical(ch)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-inline danger" title={`Delete ${ch.name}`} aria-label={`Delete ${ch.name}`} onclick={() => deleteRoomChemical(ch)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/if}

<div id="containers-split" class="containers-split" style={`display: ${showEmpty ? "none" : "flex"};`}>
    <div class="containers-col">
        <h2 class="col-title">Cabinets</h2>
        <div id="cabinets-grid" class="card-grid" style={`display: ${cabinets.length === 0 ? "none" : "grid"};`}>
            {#each cabinets as cont (cont.id)}{@render card(cont, "Cabinet", "🗄️", "cabinet")}{/each}
        </div>
        <div id="cabinets-empty" class="empty-state-small" style={`display: ${cabinets.length === 0 ? "block" : "none"};`}>No cabinets yet</div>
    </div>
    <div class="containers-col">
        <h2 class="col-title">Fridges</h2>
        <div id="fridges-grid" class="card-grid" style={`display: ${fridges.length === 0 ? "none" : "grid"};`}>
            {#each fridges as cont (cont.id)}{@render card(cont, "Fridge", "❄️", "fridge")}{/each}
        </div>
        <div id="fridges-empty" class="empty-state-small" style={`display: ${fridges.length === 0 ? "block" : "none"};`}>No fridges yet</div>
    </div>
    <div class="containers-col">
        <h2 class="col-title">Freezers</h2>
        <div id="freezers-grid" class="card-grid" style={`display: ${freezers.length === 0 ? "none" : "grid"};`}>
            {#each freezers as cont (cont.id)}{@render card(cont, "Freezer", "🧊", "freezer")}{/each}
        </div>
        <div id="freezers-empty" class="empty-state-small" style={`display: ${freezers.length === 0 ? "block" : "none"};`}>No freezers yet</div>
    </div>
</div>
<div id="containers-empty" class="empty-state" style={`display: ${showEmpty ? "block" : "none"};`}>
    <div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-red" aria-hidden="true"></span>{:else}🗄️{/if}</div><h2>No cabinets, fridges or freezers yet</h2><p>Add your first container</p>
</div>
