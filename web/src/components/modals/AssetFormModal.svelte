<script lang="ts">
  let {
    form,
    assetRooms,
  }: {
    form: { name: string; model: string; barcode: string; description: string; roomId: string };
    assetRooms: Array<{ id: string; name: string }>;
  } = $props();
</script>

<div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="a-name" placeholder="e.g. Centrifuge 5424R" bind:value={form.name}></div>
<div class="form-group"><label class="form-label">Model / Brand</label><input class="form-input" id="a-model" placeholder="e.g. Eppendorf" bind:value={form.model}></div>
<div class="form-group"><label class="form-label">Barcode (optional)</label><input class="form-input" id="a-barcode" placeholder="e.g. 12345678" bind:value={form.barcode}></div>
<div class="form-group">
  <label class="form-label">Room</label>
  <select class="login-input" id="a-room" style="padding:0.4rem;background:var(--bg-input);border:1px solid var(--border-subtle);color:var(--text-primary);border-radius:var(--radius-sm);width:100%;" bind:value={form.roomId}>
    <option value="">-- No Room Assigned --</option>
    {#each assetRooms as room (room.id)}
      <option value={room.id}>{room.name}</option>
    {/each}
  </select>
</div>
<div class="form-group"><label class="form-label">Description / Note</label><textarea class="form-textarea" id="a-desc" placeholder="Details about this asset..." rows="4" bind:value={form.description}></textarea></div>
