<script lang="ts">
  let {
    form,
  }: {
    form: { name: string };
  } = $props();
</script>

<div class="form-group">
  <label class="form-label" for="ar-name">Room Name *</label>
  <input class="form-input" id="ar-name" placeholder="e.g. Storage Room A" bind:value={form.name}>
  <p class="form-hint">This creates a physical room that can be used throughout Rooms &amp; equipment, Inventory and Reservations.</p>
</div>
