<script lang="ts">
  let {
    form,
    rooms,
  }: {
    form: { name: string; description: string; location: string; contactPerson: string; contactEmail: string; roomId: string };
    rooms: Array<{ id: string; name: string }>;
  } = $props();
</script>

<div class="form-group"><label class="form-label" for="i-name">Name *</label><input class="form-input" id="i-name" placeholder="e.g. Centrifuge 5424R" bind:value={form.name}></div>
<div class="form-group">
  <label class="form-label" for="i-room">Room assignment (optional)</label>
  <select class="form-select" id="i-room" bind:value={form.roomId}>
    <option value="">No physical room assigned</option>
    {#each rooms as room (room.id)}
      <option value={room.id}>{room.name}</option>
    {/each}
  </select>
  <p class="form-hint">Choose a chemical storage room. This does not change the location text below.</p>
</div>
<div class="form-group"><label class="form-label" for="i-location">Location *</label><input class="form-input" id="i-location" placeholder="e.g. Room A301, bench 2" bind:value={form.location}><p class="form-hint">Placement details shown with the instrument. For a new instrument, leaving this blank uses the selected room name.</p></div>
<div class="form-group"><label class="form-label" for="i-desc">Description</label><textarea class="form-textarea" id="i-desc" rows="3" placeholder="Details, specs, usage notes..." bind:value={form.description}></textarea></div>
<div class="form-row">
    <div class="form-group"><label class="form-label" for="i-contact">Contact Person</label><input class="form-input" id="i-contact" placeholder="Who to ask" bind:value={form.contactPerson}></div>
    <div class="form-group"><label class="form-label" for="i-email">Contact Email</label><input class="form-input" id="i-email" placeholder="name@muni.cz" bind:value={form.contactEmail}></div>
</div>
