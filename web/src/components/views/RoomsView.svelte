<script lang="ts">
  import { inventory } from "../../lib/stores/inventory.svelte";
  import { navigateTo } from "../../lib/router.svelte";
  import { countAllChems, countChems } from "../../lib/inventoryUtils";
  import { theme } from "../../lib/theme.svelte";

  const design = $derived(theme.design);

  const rooms = $derived(inventory.tree?.rooms ?? []);
  const shared = $derived(inventory.sharedContainers);
  const showEmpty = $derived(rooms.length === 0 && shared.length === 0);
  const totalSharedChems = $derived(shared.reduce((acc, c) => acc + countChems(c.container), 0));

  function roomChemCount(roomIndex: number): number {
    const room = rooms[roomIndex];
    if (room === undefined) {
      return 0;
    }
    let ch = countAllChems(room);
    const matching = shared.filter(
      (sc) => sc.roomName !== undefined && sc.roomName.toLowerCase() === room.name.toLowerCase(),
    );
    for (const sc of matching) {
      ch += countChems(sc.container);
    }
    return ch;
  }

  function roomContainerCount(roomIndex: number): number {
    const room = rooms[roomIndex];
    if (room === undefined) {
      return 0;
    }
    const cc = (room.containers ?? []).length;
    const matching = shared.filter(
      (sc) => sc.roomName !== undefined && sc.roomName.toLowerCase() === room.name.toLowerCase(),
    );
    return cc + matching.length;
  }
</script>

<div id="rooms-grid" class="card-grid" style={`display: ${showEmpty ? "none" : "grid"};`}>
    {#each rooms as room, i (room.id)}
        <div class="card" onclick={() => { navigateTo("containers", { roomId: room.id }); }}>
            <div class="card-icon room">{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}🏠{/if}</div>
            <div class="card-title">{room.name}</div>
            <div class="card-description">{room.description || "Room"}</div>
            <div class="card-stats">
              <div class="card-stat">{#if design !== "bauhaus"}🗄️ {/if}<span class="card-stat-value">{roomContainerCount(i)}</span> containers</div>
              <div class="card-stat">{#if design !== "bauhaus"}🧪 {/if}<span class="card-stat-value">{roomChemCount(i)}</span> chemicals</div>
            </div>
        </div>
    {/each}
    {#if shared.length > 0}
        <div class="card" onclick={() => { navigateTo("containers", { roomId: "shared-assets" }); }} style="background: linear-gradient(135deg, rgba(34, 197, 94, 0.05), rgba(59, 130, 246, 0.03)); border-color: rgba(34, 197, 94, 0.25);">
            <div class="card-icon" style="background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.05));">{#if design === "bauhaus"}<span class="glyph glyph-circle-blue" aria-hidden="true"></span>{:else}🤝{/if}</div>
            <div class="card-title" style="color: var(--accent-green);">Shared Assets</div>
            <div class="card-description">Shared from neighboring laboratories</div>
            <div class="card-stats">
              <div class="card-stat">{#if design !== "bauhaus"}🗄️ {/if}<span class="card-stat-value">{shared.length}</span> containers</div>
              <div class="card-stat">{#if design !== "bauhaus"}🧪 {/if}<span class="card-stat-value">{totalSharedChems}</span> chemicals</div>
            </div>
        </div>
    {/if}
</div>
<div id="rooms-empty" class="empty-state" style={`display: ${showEmpty ? "block" : "none"};`}>
    <div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}🏢{/if}</div><h2>No rooms yet</h2><p>Start by adding your first room</p>
    <button class="btn-primary add-room-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Room</span></button>
</div>
