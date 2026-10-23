<script lang="ts">
  import { inventory } from "../../lib/stores/inventory.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { openModal, closeModal } from "../../lib/modal.svelte";
  import { showToast } from "../../lib/stores/toast.svelte";
  import { verifyCaptchaAndExecute } from "../../lib/captcha";
  import { opDeleteProtocol, roleCanWrite } from "../../lib/ops";
  import { openProtocolForm } from "../../lib/forms";

  const protocols = $derived(inventory.tree?.protocols ?? []);
  const isReader = $derived(session.user?.role === "reader");

  function deleteProtocol(id: string, title: string): void {
    openModal({
      title: "Delete Protocol",
      bodyHtml: `<p>Delete <strong>${escapeHtmlText(title)}</strong>?</p>`,
      btnText: "Delete",
      onConfirm: () => {
        verifyCaptchaAndExecute(async () => {
          if (await opDeleteProtocol(id)) {
            closeModal();
            showToast("Protocol deleted");
          }
        });
      },
    });
  }

  function escapeHtmlText(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
</script>

<div id="protocols-container" class="protocols-container" style={`display: ${protocols.length === 0 ? "none" : "block"};`}>
    {#each protocols as prot (prot.id)}
        <div class="protocol-card" style={isReader ? "" : "cursor:pointer;"} onclick={isReader ? undefined : () => openProtocolForm({ id: prot.id, title: prot.title ?? "", content: prot.content ?? "" })}>
            <div class="protocol-title">{prot.title}</div>
            <div class="protocol-content">{prot.content}</div>
            <div class="protocol-actions">
                {#if !isReader}
                    <button class="btn-inline danger" title="Delete" onclick={(e) => { e.stopPropagation(); deleteProtocol(prot.id, prot.title ?? ""); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                {/if}
            </div>
        </div>
    {/each}
</div>
<div id="protocols-empty" class="empty-state" style={`display: ${protocols.length === 0 ? "block" : "none"};`}>
    <div class="empty-icon">📖</div><h2>No protocols yet</h2><p>Add your first standard solution or protocol</p>
</div>
