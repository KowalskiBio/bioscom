<script lang="ts">
  let {
    form,
    rooms,
    roomStatus,
    onCreateRoom,
  }: {
    form: { name: string; description: string; location: string; contactPerson: string; contactEmail: string; roomId: string };
    rooms: Array<{ id: string; name: string }>;
    roomStatus: "loading" | "error" | "ready";
    onCreateRoom: () => void;
  } = $props();
</script>

<div class="form-group"><label class="form-label" for="i-name">Name *</label><input class="form-input" id="i-name" placeholder="e.g. Centrifuge 5424R" bind:value={form.name}></div>
<div class="form-group">
  <label class="form-label" for="i-room">Physical room *</label>
  <select
    class="form-select"
    id="i-room"
    required
    disabled={rooms.length === 0}
    aria-describedby="i-room-help i-room-error"
    aria-invalid={form.roomId === ""}
    bind:value={form.roomId}
  >
    {#if form.roomId === "" || rooms.length === 0}
      <option value="" disabled={rooms.length > 0}>{rooms.length === 0 ? "No physical rooms available" : "Select a physical room"}</option>
    {/if}
    {#each rooms as room (room.id)}
      <option value={room.id}>{room.name}</option>
    {/each}
  </select>
  <p class="form-hint" id="i-room-help">Required for saving and booking. Choose a room from Rooms &amp; equipment.</p>
  {#if roomStatus === "loading"}
    <p class="form-hint" id="i-room-loading" role="status">Loading physical rooms…</p>
  {:else if roomStatus === "error"}
    <p class="form-hint" id="i-room-load-error" role="alert">Physical rooms couldn’t be loaded. Create a room or close this form and try again.</p>
  {:else if rooms.length === 0}
    <p class="form-hint" id="i-room-empty" role="status">A physical room is required before an instrument can be saved or booked. Create one first, then select it here.</p>
  {/if}
  {#if rooms.length === 0}
    <button type="button" class="btn-secondary" id="i-create-room" onclick={onCreateRoom}>Create physical room</button>
  {/if}
  <p class="form-hint" id="i-room-error" role="alert" hidden={form.roomId !== ""}>Select a physical room before saving this instrument.</p>
</div>
<div class="form-group"><label class="form-label" for="i-location">Placement note (optional)</label><input class="form-input" id="i-location" placeholder="e.g. Bench 2, left side" bind:value={form.location}><p class="form-hint">Add bench or other placement details. For a new instrument, leaving this blank uses the selected room name.</p></div>
<div class="form-group"><label class="form-label" for="i-desc">Description</label><textarea class="form-textarea" id="i-desc" rows="3" placeholder="Details, specs, usage notes..." bind:value={form.description}></textarea></div>
<div class="form-row">
    <div class="form-group"><label class="form-label" for="i-contact">Contact Person</label><input class="form-input" id="i-contact" placeholder="Who to ask" bind:value={form.contactPerson}></div>
    <div class="form-group"><label class="form-label" for="i-email">Contact Email</label><input class="form-input" id="i-email" placeholder="name@muni.cz" bind:value={form.contactEmail}></div>
</div>
