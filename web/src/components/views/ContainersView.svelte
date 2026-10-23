<script lang="ts">
  import type { Container } from "@bioscom/shared";
  import { inventory } from "../../lib/stores/inventory.svelte";
  import { router, navigateTo } from "../../lib/router.svelte";
  import { countChems } from "../../lib/inventoryUtils";
  import { groupList } from "../../lib/stores/groups.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";

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
</script>

{#snippet card(cont: Container, typeName: string, icon: string, cls: string)}
  {@const chemCount = countChems(cont)}
  {@const isFromOtherLab = cont.ownerGroupId !== undefined && cont.ownerGroupId !== currentGroup.groupId}
  {@const isMySharedContainer = !isFromOtherLab && (cont.sharedWithGroupIds ?? []).length > 0}
  {@const groupNames = Object.fromEntries(groupList.items.map((g) => [g.id, g.name]))}
  {@const otherGroupIds = (cont.sharedWithGroupIds ?? []).filter((gid) => gid !== currentGroup.groupId)}
  <div
    class={`card ${cls}-card`}
    style={isMySharedContainer ? "border: 2px solid var(--accent-blue); box-shadow: 0 0 12px rgba(59, 130, 246, 0.25);" : ""}
    onclick={() => { navigateTo("detail", { roomId, containerId: cont.id }); }}
  >
    <span class={`card-type-badge ${cls}-badge`}>{cont.type === "deepfreezer" ? "Deep Freezer" : typeName}</span>
    <div class={`card-icon ${cls}`}>{cont.emoji || icon}</div>
    <div class="card-title">{cont.name}{isFromOtherLab ? " (Shared)" : ""}</div>
    <div class="card-description">{cont.description || ""}
      <br>
      {#if isFromOtherLab}
        <span style="font-size: 0.7rem; background: rgba(34, 197, 94, 0.15); color: var(--accent-green); padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; margin-top: 0.4rem; font-weight: 600;">🔗 Shared from: {cont.ownerGroupName ?? "—"} (Room: {shared.find((sc) => sc.container.id === cont.id)?.roomName ?? "—"})</span>
      {:else if otherGroupIds.length > 0}
        <span style="font-size: 0.7rem; background: rgba(59, 130, 246, 0.12); color: var(--accent-blue); padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; margin-top: 0.4rem; font-weight: 600;">🔗 Shared to: {otherGroupIds.map((gid) => groupNames[gid] ?? "Unknown Lab").join(", ")}</span>
      {/if}
    </div>
    <div class="card-stats"><div class="card-stat">📁 <span class="card-stat-value">{(cont.shelves ?? []).length}</span> shelves</div><div class="card-stat">🧪 <span class="card-stat-value">{chemCount}</span> chemicals</div></div>
  </div>
{/snippet}

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
    <div class="empty-icon">🗄️</div><h2>No cabinets, fridges or freezers yet</h2><p>Add your first container</p>
</div>
