<script lang="ts">
  let { form }: { form: { title: string; content: string } } = $props();
</script>

<div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="p-title" bind:value={form.title}></div>
<div class="form-group"><label class="form-label">Content</label><textarea class="form-textarea" id="p-content" rows="6" bind:value={form.content}></textarea></div>
