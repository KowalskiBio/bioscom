<script lang="ts">
  let {
    form,
    rooms,
  }: {
    form: { name: string; model: string; barcode: string; description: string; roomId: string };
    rooms: Array<{ id: string; name: string }>;
  } = $props();
</script>

<div class="form-group"><label class="form-label" for="a-name">Name *</label><input class="form-input" id="a-name" placeholder="e.g. Centrifuge 5424R" bind:value={form.name}></div>
<div class="form-group"><label class="form-label" for="a-model">Model / Brand</label><input class="form-input" id="a-model" placeholder="e.g. Eppendorf" bind:value={form.model}></div>
<div class="form-group"><label class="form-label" for="a-barcode">Barcode (optional)</label><input class="form-input" id="a-barcode" placeholder="e.g. 12345678" bind:value={form.barcode}></div>
<div class="form-group">
  <label class="form-label" for="a-room">Physical room</label>
  <select class="form-select" id="a-room" aria-describedby="a-room-help" bind:value={form.roomId}>
    <option value="">No Room Assigned</option>
    {#each rooms as room (room.id)}
      <option value={room.id}>{room.name}</option>
    {/each}
  </select>
  <p class="form-hint" id="a-room-help">Choose a current physical room, or keep the legacy unassigned state. Existing legacy room references stay unchanged until you choose a room.</p>
</div>
<div class="form-group"><label class="form-label" for="a-desc">Description / Note</label><textarea class="form-textarea" id="a-desc" placeholder="Details about this asset..." rows="4" bind:value={form.description}></textarea></div>
