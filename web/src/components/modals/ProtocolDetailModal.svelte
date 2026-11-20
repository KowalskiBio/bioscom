<script lang="ts">
  import type { Protocol } from "@bioscom/shared";
  import { renderProtocolMarkdown } from "../../lib/protocol";
  import { stripEmoji } from "../../lib/inventoryUtils";
  import { theme } from "../../lib/theme.svelte";

  let { protocol }: { protocol: Protocol } = $props();

  const design = $derived(theme.design);
  const description = $derived(protocol.description?.trim() ?? "");
  const tags = $derived(protocol.tags ?? []);
  const content = $derived(protocol.content ?? "");
  const contentHtml = $derived(renderProtocolMarkdown(content));
</script>

<article id="protocol-detail" class="protocol-detail">
  {#if description !== ""}
    <section class="protocol-detail-summary" aria-labelledby="protocol-detail-description-label">
      <h3 class="protocol-detail-label" id="protocol-detail-description-label">Description</h3>
      <p id="protocol-detail-description" class="protocol-detail-description">
        {design === "bauhaus" ? stripEmoji(description) : description}
      </p>
    </section>
  {/if}

  {#if tags.length > 0}
    <section class="protocol-detail-summary" aria-labelledby="protocol-detail-tags-label">
      <h3 class="protocol-detail-label" id="protocol-detail-tags-label">Tags</h3>
      <div id="protocol-detail-tags" class="protocol-detail-tags">
        {#each tags as tag}
          <span class="protocol-detail-tag">{design === "bauhaus" ? stripEmoji(tag) : tag}</span>
        {/each}
      </div>
    </section>
  {/if}

  <section aria-labelledby="protocol-detail-content-label">
    <h3 class="protocol-detail-label" id="protocol-detail-content-label">Content</h3>
    <!-- Keyboard focus lets readers scroll long protocols without a mouse. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      id="protocol-detail-content"
      class="protocol-detail-content protocol-markdown"
      role="region"
      aria-labelledby="protocol-detail-content-label"
      tabindex="0"
    >
      {#if content.trim() === ""}
        <p class="protocol-detail-empty">No content provided.</p>
      {:else}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html contentHtml}
      {/if}
    </div>
  </section>
</article>

<style>
  .protocol-detail {
    min-width: 0;
  }

  .protocol-detail-summary {
    margin-bottom: 1rem;
  }

  .protocol-detail-label {
    margin: 0 0 0.5rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  .protocol-detail-description {
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--text-primary);
    font-size: 0.95rem;
    line-height: 1.65;
    white-space: pre-line;
  }

  .protocol-detail-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    min-width: 0;
  }

  .protocol-detail-tag {
    display: inline-block;
    max-width: 100%;
    padding: 0.16rem 0.55rem;
    overflow-wrap: anywhere;
    color: var(--accent-blue);
    background: rgba(14, 165, 233, 0.1);
    border: 1px solid rgba(14, 165, 233, 0.24);
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.5;
  }

  .protocol-detail-content {
    height: clamp(20rem, 52vh, 38rem);
    min-width: 0;
    padding: 1rem 1.15rem;
    overflow: auto;
    overflow-wrap: anywhere;
    color: var(--text-primary);
    background: var(--bg-input);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    font-size: 0.925rem;
    line-height: 1.65;
    overscroll-behavior: contain;
  }

  .protocol-detail-content:focus-visible {
    border-color: var(--accent-blue);
    outline: none;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .protocol-detail-empty {
    margin: 0;
    color: var(--text-muted);
  }

  .protocol-markdown :global(> :first-child) {
    margin-top: 0;
  }

  .protocol-markdown :global(> :last-child) {
    margin-bottom: 0;
  }

  .protocol-markdown :global(h1),
  .protocol-markdown :global(h2),
  .protocol-markdown :global(h3),
  .protocol-markdown :global(h4) {
    margin: 1em 0 0.45em;
    line-height: 1.25;
  }

  .protocol-markdown :global(h1) { font-size: 1.55rem; }
  .protocol-markdown :global(h2) { font-size: 1.3rem; }
  .protocol-markdown :global(h3) { font-size: 1.1rem; }
  .protocol-markdown :global(h4) { font-size: 1rem; }

  .protocol-markdown :global(p),
  .protocol-markdown :global(ul),
  .protocol-markdown :global(ol),
  .protocol-markdown :global(blockquote),
  .protocol-markdown :global(pre),
  .protocol-markdown :global(table) {
    margin: 0 0 0.8em;
  }

  .protocol-markdown :global(ul),
  .protocol-markdown :global(ol) {
    padding-left: 1.4rem;
  }

  .protocol-markdown :global(a) {
    color: var(--accent-blue);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .protocol-markdown :global(blockquote) {
    padding-left: 0.75rem;
    border-left: 3px solid var(--accent-blue);
    color: var(--text-secondary);
  }

  .protocol-markdown :global(code) {
    padding: 0.1em 0.3em;
    overflow-wrap: anywhere;
    background: rgba(148, 163, 184, 0.12);
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 0.9em;
  }

  .protocol-markdown :global(pre) {
    max-width: 100%;
    padding: 0.75rem;
    overflow: auto;
    background: rgba(148, 163, 184, 0.1);
    border-radius: var(--radius-sm);
  }

  .protocol-markdown :global(pre code) {
    padding: 0;
    overflow-wrap: normal;
    background: transparent;
  }

  .protocol-markdown :global(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
  }

  .protocol-markdown :global(th),
  .protocol-markdown :global(td) {
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--border-light);
    text-align: left;
  }

  .protocol-markdown :global(img) {
    max-width: 100%;
    height: auto;
  }

  :global(body[data-design="bauhaus"]) .protocol-detail-label,
  :global(body[data-design="bauhaus"]) .protocol-detail-description,
  :global(body[data-design="bauhaus"]) .protocol-detail-content {
    color: #171512;
  }

  :global(body[data-design="bauhaus"]) .protocol-detail-tag {
    color: #171512;
    background: #f4f0e6;
    border: 1px solid #171512;
    border-radius: 0;
    font-family: var(--bauhaus-font-mono);
    font-size: 0.7rem;
    text-transform: uppercase;
  }

  :global(body[data-design="bauhaus"]) .protocol-detail-content {
    border: 2px solid #171512;
    border-radius: 0;
  }

  :global(body[data-design="bauhaus"]) .protocol-detail-content:focus-visible {
    border-color: #1d4fa2;
    box-shadow: 4px 4px 0 #f0b62b;
  }

  :global(body[data-design="bauhaus"]) .protocol-markdown :global(pre) {
    border-radius: 0;
  }

  @media (max-width: 700px) {
    .protocol-detail-content {
      height: 48vh;
      min-height: 18rem;
      padding: 0.85rem;
    }
  }
</style>
