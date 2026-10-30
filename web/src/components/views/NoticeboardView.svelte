<script lang="ts">
  import { noticeList } from "../../lib/stores/notices.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { openModal, closeModal } from "../../lib/modal.svelte";
  import { openNoticeForm as openNoticeFormShared } from "../../lib/forms";
  import { showToast } from "../../lib/stores/toast.svelte";
  import { verifyCaptchaAndExecute } from "../../lib/captcha";
    import { opDeleteNotice, opAddReaction, opDeleteReaction } from "../../lib/featureOps";
  import { countWords } from "../../lib/inventoryUtils";
  import { theme } from "../../lib/theme.svelte";

  const design = $derived(theme.design);
  
  const notices = $derived([...noticeList.items].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)));
  const isSuperadmin = $derived(session.user?.role === "superadmin");

  const categoryColors: Record<string, string> = {
    suggestion: "rgba(34, 197, 94, 0.15)",
    issue: "rgba(239, 68, 68, 0.15)",
    info: "rgba(59, 130, 246, 0.15)",
    general: "rgba(255, 255, 255, 0.05)",
  };
  const categoryLabels: Record<string, string> = {
    suggestion: "💡 Suggestion",
    issue: "⚠️ Issue",
    info: "ℹ️ Info",
    general: "📌 General",
  };
  const categoryPlainLabels: Record<string, string> = {
    suggestion: "Suggestion",
    issue: "Issue",
    info: "Info",
    general: "General",
  };

  function deleteNotice(id: string, title: string): void {
    openModal({
      title: "Delete Notice",
      bodyHtml: `<p>Are you sure you want to delete <strong>${escapeHtmlText(title)}</strong>?</p>`,
      btnText: "Delete",
      onConfirm: () => {
        verifyCaptchaAndExecute(async () => {
          if (await opDeleteNotice(id)) {
            closeModal();
            showToast("Notice deleted");
          }
        });
      },
    });
  }

  async function addReaction(noticeId: string, emoji?: string): Promise<void> {
    const input = document.getElementById(`reaction-input-${noticeId}`) as HTMLInputElement | null;
    const text = emoji ?? input?.value.trim() ?? "";
    if (text === "") {
      return;
    }
    if (countWords(text) > 300) {
      showToast("Comment exceeds 300 words!", "error");
      return;
    }
    if (await opAddReaction(noticeId, text)) {
      if (input !== null && emoji === undefined) {
        input.value = "";
      }
    }
  }

  function onReactionKeydown(event: KeyboardEvent, noticeId: string): void {
    if (event.key === "Enter") {
      void addReaction(noticeId);
    }
  }

  function escapeHtmlText(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
</script>

<div id="noticeboard-container" class="protocols-container" style={`display: ${notices.length === 0 ? "none" : "block"};`}>
    {#each notices as n (n.id)}
      {@const cat = n.category ?? "general"}
      {@const canDelete = isSuperadmin || n.authorUid === session.user?.uid}
      {@const reactions = Object.values(n.reactions ?? {}).sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))}
        <div class="protocol-card fade-in" style={`border-left: 4px solid ${cat === "suggestion" ? "var(--accent-green)" : cat === "issue" ? "var(--accent-red, #ef4444)" : cat === "info" ? "var(--accent-blue)" : "var(--border-subtle)"};`}>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem;">
                    <span style={`font-size: 0.7rem; background: ${categoryColors[cat] ?? categoryColors.general}; padding: 0.15rem 0.4rem; border-radius: 3px; font-weight: 600; margin-right: 0.25rem;`}>{design === "bauhaus" ? (categoryPlainLabels[cat] ?? categoryPlainLabels.general) : (categoryLabels[cat] ?? categoryLabels.general)}</span>
                    {#if n.authorName}<span style="font-weight: 600; color: var(--accent-blue); display: inline-flex; align-items: center;">{#if n.authorAvatar}<img src={n.authorAvatar} style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-subtle); margin-right: 0.35rem;" title={n.authorName}>{/if}{n.authorName}</span>{/if}
                    {#if n.authorLab}<span style="color: var(--text-muted); font-size: 0.75rem; margin-left: 0.5rem;">{n.authorLab}</span>{/if}
                    {#if n.timestamp}<span style="color: var(--text-muted); font-size: 0.75rem; margin-left: 0.5rem;">{new Date(n.timestamp).toLocaleString()}</span>{/if}
                </div>
                <div style="display: flex; gap: 0.25rem;">
                    {#if canDelete}
                        <button class="btn-inline" title="Edit" onclick={() => openNoticeFormShared({ id: n.id, title: n.title ?? "", content: n.content ?? "", category: cat })}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button class="btn-inline danger" title="Delete" onclick={() => deleteNotice(n.id, n.title ?? "")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                    {/if}
                </div>
            </div>
            <div class="protocol-title" style="margin-bottom: 0.35rem;">{n.title}</div>
            <div class="protocol-content" style="margin-bottom: 0.75rem;">{n.content ?? ""}</div>
            <div class="notice-reactions-container" style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.5rem;">
                {#if reactions.length > 0}
                    <div style="display:flex; flex-wrap:wrap; gap:0.4rem; margin-bottom: 0.5rem;">
                        {#each reactions as r (r.id)}
                            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-light); border-radius:12px; padding:0.15rem 0.5rem; font-size:0.75rem; display:flex; align-items:center;">
                                {#if r.userAvatar}<img src={r.userAvatar} style="width: 16px; height: 16px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-subtle); margin-right: 0.25rem; vertical-align: middle;">{/if}
                                <span style="font-weight:600; color:var(--text-secondary); margin-right:0.3rem;">{r.userName}:</span>
                                <span>{r.text ?? ""}</span>
                                {#if r.userId === session.user?.uid}<span onclick={() => void opDeleteReaction(n.id, r.id ?? "")} style="cursor:pointer; color:var(--text-muted); margin-left:0.3rem;" title="Remove">&times;</span>{/if}
                            </div>
                        {/each}
                    </div>
                {/if}
                <div style="display:flex; align-items:center; gap:0.4rem; margin-top:0.25rem;">
                    <button class="btn-inline" style="padding:0.15rem; font-size:0.9rem;" title="Thumbs Up" onclick={() => void addReaction(n.id, "👍")}>{#if design === "bauhaus"}<span class="glyph glyph-circle-blue" aria-hidden="true"></span>{:else}👍{/if}</button>
                    <button class="btn-inline" style="padding:0.15rem; font-size:0.9rem;" title="Heart" onclick={() => void addReaction(n.id, "❤️")}>{#if design === "bauhaus"}<span class="glyph glyph-circle-red" aria-hidden="true"></span>{:else}❤️{/if}</button>
                    <button class="btn-inline" style="padding:0.15rem; font-size:0.9rem;" title="Check" onclick={() => void addReaction(n.id, "✅")}>{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}✅{/if}</button>
                    <input type="text" id={`reaction-input-${n.id}`} placeholder="Type a comment..." style="flex:1; background:transparent; border:none; border-bottom:1px solid var(--border-subtle); color:var(--text-primary); outline:none; font-size:0.75rem; padding:0.15rem 0;" onkeydown={(e) => onReactionKeydown(e, n.id)}>
                    <button class="btn-inline" style="padding:0.15rem 0.4rem; font-size:0.75rem; color:var(--accent-blue);" onclick={() => void addReaction(n.id)}>Send</button>
                </div>
            </div>
        </div>
    {/each}
</div>
<div id="noticeboard-empty" class="empty-state" style={`display: ${notices.length === 0 ? "block" : "none"};`}>
    <div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}📝{/if}</div><h2>No notes yet</h2><p>Add the first note or suggestion for your lab team</p>
</div>
