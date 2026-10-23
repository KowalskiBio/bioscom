<script lang="ts">
  let { form }: { form: { title: string; content: string; category: string } } = $props();
</script>

<div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="n-title" placeholder="Short, descriptive title" bind:value={form.title}></div>
<div class="form-group">
    <label class="form-label">Category</label>
    <select class="form-select" id="n-category" bind:value={form.category}>
        <option value="general">📌 General</option>
        <option value="suggestion">💡 Suggestion</option>
        <option value="issue">⚠️ Issue</option>
        <option value="info">ℹ️ Info</option>
    </select>
</div>
<div class="form-group"><label class="form-label">Content *</label><textarea class="form-textarea" id="n-content" rows="5" placeholder="Share it with the lab..." bind:value={form.content}></textarea></div>
