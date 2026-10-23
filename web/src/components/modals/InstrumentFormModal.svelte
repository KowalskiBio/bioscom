<script lang="ts">
  let {
    form,
  }: {
    form: { name: string; description: string; location: string; contactPerson: string; contactEmail: string };
  } = $props();
</script>

<div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="i-name" placeholder="e.g. Centrifuge 5424R" bind:value={form.name}></div>
<div class="form-group"><label class="form-label">Location *</label><input class="form-input" id="i-location" placeholder="e.g. Room A301, bench 2" bind:value={form.location}></div>
<div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="i-desc" rows="3" placeholder="Details, specs, usage notes..." bind:value={form.description}></textarea></div>
<div class="form-row">
    <div class="form-group"><label class="form-label">Contact Person</label><input class="form-input" id="i-contact" placeholder="Who to ask" bind:value={form.contactPerson}></div>
    <div class="form-group"><label class="form-label">Contact Email</label><input class="form-input" id="i-email" placeholder="name@muni.cz" bind:value={form.contactEmail}></div>
</div>
