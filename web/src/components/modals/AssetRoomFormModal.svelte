<script lang="ts">
  let {
    form,
    physicalRooms,
  }: {
    form: { name: string; linkedRoomId: string };
    physicalRooms: Array<{ id: string; name: string }>;
  } = $props();
</script>

<div class="form-group"><label class="form-label" for="ar-name">Room Name *</label><input class="form-input" id="ar-name" placeholder="e.g. Storage Room A" bind:value={form.name}></div>
{#if physicalRooms.length > 0}
  <div class="form-group">
    <label class="form-label" for="ar-linked-room">Linked chemical room (optional)</label>
    <select class="form-select" id="ar-linked-room" bind:value={form.linkedRoomId}>
      <option value="">No chemical room linked</option>
      {#each physicalRooms as room (room.id)}
        <option value={room.id}>{room.name}</option>
      {/each}
    </select>
    <p class="form-hint">Show this Inventory room’s barcoded assets in the selected chemical room. Existing asset assignments stay unchanged.</p>
  </div>
{/if}
