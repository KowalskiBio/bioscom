<script lang="ts">
  let { form }: { form: { name: string } } = $props();
</script>

<div class="form-group"><label class="form-label">Room Name *</label><input class="form-input" id="ar-name" placeholder="e.g. Storage Room A" bind:value={form.name}></div>
