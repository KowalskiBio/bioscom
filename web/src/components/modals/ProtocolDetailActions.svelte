<script lang="ts">
  let {
    protocolTitle,
    onEdit,
    onRemove,
  }: { protocolTitle: string; onEdit: () => void; onRemove: () => void } = $props();
</script>

<button
  type="button"
  class="modal-header-action-btn"
  title="Edit"
  aria-label={`Edit protocol ${protocolTitle}`}
  onclick={onEdit}
>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
</button>
<button
  type="button"
  class="modal-header-action-btn danger"
  title="Remove"
  aria-label={`Remove protocol ${protocolTitle}`}
  onclick={onRemove}
>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
</button>
