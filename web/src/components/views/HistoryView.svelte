<script lang="ts">
  import { historyData } from "../../lib/stores/history.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { openModal, closeModal } from "../../lib/modal.svelte";
  import { showToast } from "../../lib/stores/toast.svelte";
  import { opCreateManualBackup, opRestoreBackup } from "../../lib/featureOps";
  import { stripEmoji } from "../../lib/inventoryUtils";
  import { theme } from "../../lib/theme.svelte";

  const design = $derived(theme.design);

  let activeTab = $state<"log" | "backups">("log");
  const isSuperadmin = $derived(session.user?.role === "superadmin");
  const entries = $derived(historyData.entries);
  const backups = $derived(historyData.backups);

  function switchTab(tab: "log" | "backups"): void {
    activeTab = tab;
  }

  function restoreBackup(backupId: string, timestamp: number): void {
    openModal({
      title: "Restore Backup",
      bodyHtml: `<p>Restore the lab inventory to the snapshot from <strong>${new Date(timestamp).toLocaleString()}</strong>?</p><p style="color: var(--accent-red); font-size: 0.85rem;">Current data will be replaced.</p>`,
      btnText: "Restore",
      onConfirm: async () => {
        if (await opRestoreBackup(backupId)) {
          closeModal();
          showToast("Backup restored");
        }
      },
    });
  }
</script>

<div class="print-tabs-nav">
    <button class={`print-tab-btn ${activeTab === "log" ? "active" : ""}`} id="history-tab-log-btn" onclick={() => switchTab("log")}>{design === "bauhaus" ? "Audit Log" : "📝 Audit Log"}</button>
    <button class={`print-tab-btn ${activeTab === "backups" ? "active" : ""}`} id="history-tab-backups-btn" onclick={() => switchTab("backups")}>{design === "bauhaus" ? "Auto-Backups" : "💾 Auto-Backups"}</button>
</div>

<div id="history-log-tab-content" style={`display: ${activeTab === "log" ? "block" : "none"};`}>
    <div id="history-log-list" class="protocols-container" style="margin-top: 1rem; display: {entries.length === 0 ? 'none' : 'block'};">
        {#each entries as entry (entry.id)}
            <div class="protocol-card fade-in" style="padding: 0.75rem 1rem;">
                <div style="display:flex; justify-content:space-between; gap:1rem; align-items:baseline;">
                    <div style="font-size: 0.9rem;">{design === "bauhaus" ? stripEmoji(entry.action) : entry.action}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); white-space:nowrap;">{design === "bauhaus" ? stripEmoji(entry.user) : entry.user} · {new Date(entry.timestamp).toLocaleString()}</div>
                </div>
            </div>
        {/each}
    </div>
    <div id="history-log-empty" class="empty-state" style={`display: ${entries.length === 0 ? "block" : "none"};`}>
        <div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}📝{/if}</div><h2>No history events</h2><p>Actions performed in the lab will appear here</p>
    </div>
</div>

<div id="history-backups-tab-content" style={`display: ${activeTab === "backups" ? "block" : "none"};`}>
    <div id="history-backups-actions" style="margin-bottom: 1rem; margin-top: 1rem; display: {isSuperadmin ? 'block' : 'none'};">
        <button class="btn-primary" onclick={() => void opCreateManualBackup().then((ok) => ok && showToast("Backup created"))}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span style="margin-left:6px;">Create Manual Backup</span></button>
    </div>
    <div id="history-backups-list" class="protocols-container" style="margin-top: 1rem; display: {backups.length === 0 ? 'none' : 'block'};">
        {#each backups as backup (backup.id)}
            <div class="protocol-card fade-in" style="padding: 0.75rem 1rem;">
                <div style="display:flex; justify-content:space-between; gap:1rem; align-items:center;">
                    <div>
                        <div style="font-weight:600;">{#if design !== "bauhaus"}💾 {/if}Snapshot</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">{new Date(backup.timestamp).toLocaleString()}</div>
                    </div>
                    {#if isSuperadmin}
                        <button class="btn-inline" onclick={() => restoreBackup(backup.id, backup.timestamp)}>Restore</button>
                    {/if}
                </div>
            </div>
        {/each}
    </div>
    <div id="history-backups-empty" class="empty-state" style={`display: ${backups.length === 0 ? "block" : "none"};`}>
        <div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-blue" aria-hidden="true"></span>{:else}💾{/if}</div><h2>No backups yet</h2><p>Auto-backups are generated every 30 minutes of active use</p>
    </div>
</div>
