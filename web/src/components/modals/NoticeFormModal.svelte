<script lang="ts">
  import { theme } from "../../lib/theme.svelte";

  let { form }: { form: { title: string; content: string; category: string } } = $props();

  const design = $derived(theme.design);
</script>

<div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="n-title" placeholder="Short, descriptive title" bind:value={form.title}></div>
<div class="form-group">
    <label class="form-label">Category</label>
    <select class="form-select" id="n-category" bind:value={form.category}>
        <option value="general">{design === "bauhaus" ? "General" : "📌 General"}</option>
        <option value="suggestion">{design === "bauhaus" ? "Suggestion" : "💡 Suggestion"}</option>
        <option value="issue">{design === "bauhaus" ? "Issue" : "⚠️ Issue"}</option>
        <option value="info">{design === "bauhaus" ? "Info" : "ℹ️ Info"}</option>
    </select>
</div>
<div class="form-group"><label class="form-label">Content *</label><textarea class="form-textarea" id="n-content" rows="5" placeholder="Share it with the lab..." bind:value={form.content}></textarea></div>
