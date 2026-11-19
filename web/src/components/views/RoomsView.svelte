<script lang="ts">
  import type { Container, Room } from "@bioscom/shared";
  import { inventory } from "../../lib/stores/inventory.svelte";
  import { navigateTo } from "../../lib/router.svelte";
  import { countAllChems, countChems, parseDeepFreezerShelf, stripEmoji } from "../../lib/inventoryUtils";
  import { opMoveRoomGrid, roleCanWrite } from "../../lib/ops";
  import { openDeepFreezerForm } from "../../lib/forms";
  import { theme } from "../../lib/theme.svelte";
  import { showToast } from "../../lib/stores/toast.svelte";
  import GridBoard from "../GridBoard.svelte";

  const design = $derived(theme.design);
  const canWrite = $derived(roleCanWrite());

  const rooms = $derived(inventory.tree?.rooms ?? []);
  const deepFreezers = $derived(inventory.tree?.deepFreezers ?? []);
  const shared = $derived(inventory.sharedContainers);
  const roomGrid = $derived(inventory.tree?.roomGrid);
  const showEmpty = $derived(rooms.length === 0 && shared.length === 0 && deepFreezers.length === 0 && roomGrid === undefined);
  const totalSharedChems = $derived(shared.reduce((acc, c) => acc + countChems(c.container), 0));

  function deepFreezerStats(df: Container): { racks: number; boxes: number; items: number } {
    const shelves = df.shelves ?? [];
    const racks = new Set<string>();
    let boxes = 0;
    for (const shelf of shelves) {
      const parsed = parseDeepFreezerShelf(shelf);
      if (parsed.rack !== "") {
        racks.add(parsed.rack);
      }
      if (parsed.box !== "") {
        boxes += 1;
      }
    }
    return { racks: racks.size, boxes, items: countChems(df) };
  }

  function roomChemCount(room: Room): number {
    let count = countAllChems(room);
    const matching = shared.filter(
      (sc) => sc.roomName !== undefined && sc.roomName.toLowerCase() === room.name.toLowerCase(),
    );
    for (const sc of matching) {
      count += countChems(sc.container);
    }
    return count;
  }

  function roomContainerCount(room: Room): number {
    const containerCount = (room.containers ?? []).length;
    const matching = shared.filter(
      (sc) => sc.roomName !== undefined && sc.roomName.toLowerCase() === room.name.toLowerCase(),
    );
    return containerCount + matching.length;
  }

  function openRoom(room: Room): void {
    navigateTo("containers", { roomId: room.id });
  }

  function openSharedAssets(): void {
    navigateTo("containers", { roomId: "shared-assets" });
  }

  function onCardKeydown(event: KeyboardEvent, activate: () => void): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  }

  async function moveRoom(roomId: string, slot: number): Promise<void> {
    const roomName = rooms.find((room) => room.id === roomId)?.name ?? "Room";
    if (await opMoveRoomGrid(roomId, slot)) {
      showToast(`${roomName} moved to slot ${slot + 1}`);
    }
  }
</script>

{#snippet roomCard(room: Room)}
  {@const directChems = room.chemicals?.length ?? 0}
  <div class="card room-card">
    <div class="card-icon room">{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}🏠{/if}</div>
    <div class="card-title">{design === "bauhaus" ? stripEmoji(room.name) : room.name}</div>
    <div class="card-description">{design === "bauhaus" ? stripEmoji(room.description || "Room") : (room.description || "Room")}</div>
    <div class="card-stats">
      <div class="card-stat">{#if design !== "bauhaus"}🗄️ {/if}<span class="card-stat-value">{roomContainerCount(room)}</span> containers</div>
      <div class="card-stat">{#if design !== "bauhaus"}🧪 {/if}<span class="card-stat-value">{roomChemCount(room)}</span> chemicals</div>
    </div>
    {#if directChems > 0}
      <div class="card-stat" style="margin-top:0.35rem;font-size:0.75rem;">{directChems} direct items</div>
    {/if}
  </div>
{/snippet}

{#snippet sharedAssetsCard()}
  <div class="card shared-assets-card">
    <div class="card-icon shared-assets-icon">{#if design === "bauhaus"}<span class="glyph glyph-circle-blue" aria-hidden="true"></span>{:else}🤝{/if}</div>
    <div class="card-title shared-assets-title">Shared Assets</div>
    <div class="card-description">Shared from neighboring laboratories</div>
    <div class="card-stats">
      <div class="card-stat">{#if design !== "bauhaus"}🗄️ {/if}<span class="card-stat-value">{shared.length}</span> containers</div>
      <div class="card-stat">{#if design !== "bauhaus"}🧪 {/if}<span class="card-stat-value">{totalSharedChems}</span> chemicals</div>
    </div>
  </div>
{/snippet}

<div id="rooms-band">
  <div class="rooms-band-main">
    {#if roomGrid !== undefined}
      <GridBoard
        boardId="room-grid-board"
        title="Room grid"
        items={rooms}
        grid={roomGrid}
        canWrite={canWrite}
        itemLabel="Room"
        overflowLabel="Unplaced rooms"
        onMove={moveRoom}
        onOpen={openRoom}
      >
        {#snippet card(room)}
          {@render roomCard(room)}
        {/snippet}
      </GridBoard>
      {#if shared.length > 0}
        <div class="shared-assets-standalone legacy-card-open" role="button" tabindex="0" aria-label="Open Shared Assets" onclick={openSharedAssets} onkeydown={(event) => onCardKeydown(event, openSharedAssets)}>
          {@render sharedAssetsCard()}
        </div>
      {/if}
    {:else}
      <div id="rooms-grid" class="card-grid" style={`display: ${showEmpty ? "none" : "grid"};`}>
        {#each rooms as room (room.id)}
          <div class="legacy-card-open" role="button" tabindex="0" aria-label={`Open room ${room.name}`} onclick={() => openRoom(room)} onkeydown={(event) => onCardKeydown(event, () => openRoom(room))}>
            {@render roomCard(room)}
          </div>
        {/each}
        {#if shared.length > 0}
          <div class="legacy-card-open" role="button" tabindex="0" aria-label="Open Shared Assets" onclick={openSharedAssets} onkeydown={(event) => onCardKeydown(event, openSharedAssets)}>
            {@render sharedAssetsCard()}
          </div>
        {/if}
      </div>
    {/if}
  </div>
  <div id="deepfreezers-rail">
    {#each deepFreezers as df (df.id)}
      {@const stats = deepFreezerStats(df)}
      <div id={`df-card-${df.id}`} class="card freezer-card" role="button" tabindex="0" onclick={() => { navigateTo("detail", { roomId: df.id, containerId: df.id }); }} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigateTo("detail", { roomId: df.id, containerId: df.id }); } }}>
        <div class="card-icon freezer">{#if design === "bauhaus"}<span class="glyph glyph-circle-ink" aria-hidden="true"></span>{:else}{df.emoji || "❄️"}{/if}</div>
        <div class="card-title">{df.name}</div>
        <div class="card-description">{df.description || "Deep freezer"}</div>
        <div class="card-stats" style="flex-wrap: wrap; gap: 0.35rem;">
          <div class="card-stat"><span id="df-racks" class="card-stat-value">{stats.racks}</span> racks</div>
          <div class="card-stat" aria-hidden="true">·</div>
          <div class="card-stat"><span id="df-boxes" class="card-stat-value">{stats.boxes}</span> boxes</div>
          <div class="card-stat" aria-hidden="true">·</div>
          <div class="card-stat"><span id="df-samples" class="card-stat-value">{stats.items}</span> items</div>
        </div>
      </div>
    {/each}
    {#if canWrite}
      <button id="btn-add-deepfreezer" type="button" class="btn-secondary" style="justify-content: center;" onclick={openDeepFreezerForm}>Add Deep Freezer</button>
    {/if}
  </div>
</div>
{#if showEmpty}
  <div id="rooms-empty" class="empty-state">
    <div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}🏢{/if}</div><h2>No rooms yet</h2><p>Start by adding your first room</p>
    <button class="btn-primary add-room-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Room</span></button>
  </div>
{/if}

<style>
  #rooms-band {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
  }
  .rooms-band-main {
    flex: 1;
    min-width: 0;
  }
  #rooms-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .legacy-card-open {
    min-width: 0;
  }
  .legacy-card-open > .card {
    height: 100%;
  }
  .legacy-card-open:focus-visible {
    outline: 3px solid var(--accent-blue);
    outline-offset: 3px;
    border-radius: var(--radius-lg);
  }
  .shared-assets-standalone {
    margin-top: 1rem;
    max-width: 360px;
  }
  .shared-assets-card {
    background: rgba(34, 197, 94, 0.04);
    border-color: rgba(34, 197, 94, 0.25);
  }
  .shared-assets-icon {
    background: rgba(34, 197, 94, 0.12);
  }
  .shared-assets-title {
    color: var(--accent-green);
  }
  #deepfreezers-rail {
    flex: 0 0 260px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  @media (max-width: 900px) {
    #rooms-band {
      flex-direction: column;
      align-items: stretch;
    }
    #deepfreezers-rail {
      flex: 0 0 auto;
      width: 100%;
    }
  }
  @media (max-width: 768px) {
    #rooms-grid {
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    }
  }
</style>
