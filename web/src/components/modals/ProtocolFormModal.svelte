<script lang="ts">
  let {
    form,
  }: { form: { title: string; description: string; tags: string; content: string } } = $props();
</script>

<div class="protocol-form">
  <div class="form-group">
    <label class="form-label" for="p-title">Title *</label>
    <input class="form-input" id="p-title" bind:value={form.title} required>
  </div>

  <div class="form-group">
    <label class="form-label" for="p-description">Description <span class="optional">(optional)</span></label>
    <input class="form-input" id="p-description" bind:value={form.description} placeholder="A short summary of this protocol">
  </div>

  <div class="form-group">
    <label class="form-label" for="p-tags">Tags <span class="optional">(optional)</span></label>
    <input class="form-input" id="p-tags" bind:value={form.tags} aria-describedby="p-tags-hint" placeholder="buffer, assay, DNA">
    <div class="form-hint" id="p-tags-hint">Separate with commas. Duplicates are removed; up to 24 tags are saved.</div>
  </div>

  <div class="form-group protocol-source">
    <label class="form-label" for="p-content">Content</label>
    <textarea class="form-textarea" id="p-content" rows="18" bind:value={form.content} aria-describedby="p-content-hint" placeholder="## Preparation&#10;&#10;1. Prepare the solution…"></textarea>
    <div class="form-hint" id="p-content-hint">Use GitHub-flavored Markdown for headings, lists, links, tables, and code.</div>
  </div>
</div>

<style>
  .protocol-form,
  .protocol-source {
    min-width: 0;
  }

  .optional {
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
    opacity: 0.8;
  }

  .protocol-source textarea {
    width: 100%;
    height: 48vh;
    min-height: 24rem;
    max-height: 42rem;
    font-family: var(--bauhaus-font-mono, ui-monospace, SFMono-Regular, Consolas, monospace);
    font-size: 0.85rem;
    line-height: 1.55;
  }

  @media (max-width: 700px) {
    .protocol-source textarea {
      height: 42vh;
      min-height: 18rem;
    }
  }
</style>
