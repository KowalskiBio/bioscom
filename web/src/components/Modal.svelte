<script lang="ts">
  import { modal, closeModal } from "../lib/modal.svelte";

  function onConfirm(): void {
    if (modal.state.onConfirm !== null) {
      modal.state.onConfirm();
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (
      event.key === "Enter" &&
      modal.state.open &&
      document.activeElement !== null &&
      document.activeElement.tagName !== "TEXTAREA"
    ) {
      event.preventDefault();
      onConfirm();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Modal -->
<div id="modal-overlay" class="modal-overlay" class:active={modal.state.open}>
    <div id="modal" class="modal">
        <div class="modal-header">
            <h2 id="modal-title">{modal.state.title}</h2>
            <button id="modal-close" class="modal-close-btn" onclick={() => closeModal()}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div id="modal-body" class="modal-body">
            {#if modal.state.component !== null}
                {@const Body = modal.state.component}
                <Body {...modal.state.props} />
            {:else}
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html modal.state.bodyHtml}
            {/if}
        </div>
        <div class="modal-footer" style={modal.state.btnText !== null ? "" : "display: none;"}>
            <button id="modal-cancel" class="btn-secondary" onclick={() => closeModal()}>Cancel</button>
            <button id="modal-confirm" class="btn-primary" style={modal.state.btnText !== null ? "" : "display: none;"} onclick={onConfirm}>{modal.state.btnText ?? "Confirm"}</button>
        </div>
    </div>
</div>
