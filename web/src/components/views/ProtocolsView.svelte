<script lang="ts">
  import type { Protocol } from "@bioscom/shared";
  import { inventory } from "../../lib/stores/inventory.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { openProtocolDeleteConfirm, openProtocolDetail, openProtocolForm } from "../../lib/forms";
  import { stripEmoji } from "../../lib/inventoryUtils";
  import { protocolContentExcerpt, type ProtocolColumnCount } from "../../lib/protocol";
  import { theme } from "../../lib/theme.svelte";

  let { columns }: { columns: ProtocolColumnCount } = $props();

  const design = $derived(theme.design);
  const protocols = $derived(inventory.tree?.protocols ?? []);
  const isReader = $derived(session.user?.role === "reader");

  function openEditor(protocol: Protocol): void {
    openProtocolForm({
      id: protocol.id,
      title: protocol.title ?? "",
      description: protocol.description,
      tags: protocol.tags,
      content: protocol.content ?? "",
    });
  }

  function openViewer(protocol: Protocol): void {
    openProtocolDetail(protocol);
  }

  function onCardKeydown(event: KeyboardEvent, protocol: Protocol): void {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopPropagation();
    openViewer(protocol);
  }

</script>

<div class="protocols-view">
  <div
    id="protocols-container"
    class="protocols-container protocols-overview-grid"
    data-columns={columns}
    style={`--protocol-columns: ${columns}; display: ${protocols.length === 0 ? "none" : "grid"};`}
  >
    {#each protocols as prot (prot.id)}
      <!-- The card is always a viewer; writer actions remain separate nested controls. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="protocol-card"
        class:protocol-card--writable={!isReader}
        data-protocol-id={prot.id}
        role="button"
        tabindex="0"
        aria-label={`View protocol ${prot.title ?? ""}`}
        onclick={() => openViewer(prot)}
        onkeydown={(event) => onCardKeydown(event, prot)}
      >
        <div class="protocol-title">{design === "bauhaus" ? stripEmoji(prot.title) : prot.title}</div>

        {#if (prot.tags?.length ?? 0) > 0}
          <div class="protocol-tags" aria-label="Tags">
            {#each prot.tags ?? [] as tag}
              <span class="protocol-tag">{design === "bauhaus" ? stripEmoji(tag) : tag}</span>
            {/each}
          </div>
        {/if}

        {#if prot.description?.trim()}
          <div class="protocol-description">{design === "bauhaus" ? stripEmoji(prot.description) : prot.description}</div>
        {:else if (prot.content ?? "").trim() !== ""}
          {@const excerpt = protocolContentExcerpt(design === "bauhaus" ? stripEmoji(prot.content ?? "") : (prot.content ?? ""))}
          {#if excerpt !== ""}
            <div class="protocol-content protocol-content-fallback">{excerpt}</div>
          {/if}
        {/if}

        {#if !isReader}
          <div class="protocol-actions">
            <button
              type="button"
              class="btn-inline"
              title="Edit"
              aria-label={`Edit protocol ${prot.title ?? ""}`}
              onclick={(event) => { event.stopPropagation(); openEditor(prot); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button
              type="button"
              class="btn-inline danger"
              title="Delete"
              aria-label={`Delete protocol ${prot.title ?? ""}`}
              onclick={(event) => { event.stopPropagation(); openProtocolDeleteConfirm(prot); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div id="protocols-empty" class="empty-state" style={`display: ${protocols.length === 0 ? "block" : "none"};`}>
    <div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-blue" aria-hidden="true"></span>{:else}📖{/if}</div><h2>No protocols yet</h2><p>Add your first standard solution or protocol</p>
  </div>
</div>

<style>
  .protocols-view {
    min-width: 0;
  }

  .protocols-overview-grid {
    grid-template-columns: repeat(var(--protocol-columns, 1), minmax(0, 1fr));
    gap: 1.25rem;
  }

  .protocol-card {
    min-width: 0;
    overflow-wrap: anywhere;
    cursor: pointer;
  }

  .protocol-card:focus-visible {
    outline: 2px solid var(--accent-blue);
    outline-offset: 3px;
  }

  .protocol-title {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .protocol-card--writable .protocol-title {
    padding-right: 4.5rem;
  }

  .protocol-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    min-width: 0;
    margin: -0.15rem 0 0.75rem;
  }

  .protocol-tag {
    display: inline-block;
    max-width: 100%;
    padding: 0.12rem 0.5rem;
    overflow-wrap: anywhere;
    color: var(--accent-blue);
    background: rgba(14, 165, 233, 0.1);
    border: 1px solid rgba(14, 165, 233, 0.24);
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.5;
  }

  .protocol-description,
  .protocol-content-fallback {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--text-secondary);
    font-size: 0.875rem;
    line-height: 1.6;
  }

  .protocol-description {
    white-space: pre-line;
  }

  .protocol-content-fallback {
    white-space: normal;
  }

  .protocol-card:focus-within .protocol-actions,
  .protocol-card:focus-visible .protocol-actions {
    opacity: 1;
  }

  :global(body[data-design="bauhaus"]) .protocol-description,
  :global(body[data-design="bauhaus"]) .protocol-content-fallback {
    color: rgba(23, 21, 18, 0.65);
  }

  :global(body[data-design="bauhaus"]) .protocol-tag {
    color: #171512;
    background: #f4f0e6;
    border: 1px solid #171512;
    border-radius: 0;
    font-family: var(--bauhaus-font-mono);
    font-size: 0.68rem;
    text-transform: uppercase;
  }

  :global(body[data-design="bauhaus"]) .protocol-card:focus-visible {
    outline-color: #1d4fa2;
  }

  @media (max-width: 1100px) {
    .protocols-overview-grid[data-columns="3"],
    .protocols-overview-grid[data-columns="4"] {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 640px) {
    .protocols-overview-grid,
    .protocols-overview-grid[data-columns="2"],
    .protocols-overview-grid[data-columns="3"],
    .protocols-overview-grid[data-columns="4"] {
      grid-template-columns: minmax(0, 1fr);
    }

    .protocol-card {
      padding: 1.15rem;
    }

    .protocol-actions {
      top: 0.85rem;
      right: 0.85rem;
      opacity: 1;
    }
  }
</style>
