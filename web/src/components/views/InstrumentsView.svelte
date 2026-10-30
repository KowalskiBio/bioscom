<script lang="ts">
  import { instrumentList } from "../../lib/stores/instruments.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { openModal, closeModal } from "../../lib/modal.svelte";
  import { openInstrumentForm as openInstrumentFormShared, openBookingModal } from "../../lib/forms";
  import { showToast } from "../../lib/stores/toast.svelte";
  import { verifyCaptchaAndExecute } from "../../lib/captcha";
  import { opDeleteInstrument, opCancelBooking } from "../../lib/featureOps";
  import { theme } from "../../lib/theme.svelte";

  const design = $derived(theme.design);
    
  let {
    search = $bindable(""),
  }: {
    search?: string;
  } = $props();


  const q = $derived(search.trim().toLowerCase());
  const list = $derived(
    q === ""
      ? instrumentList.items
      : instrumentList.items.filter(
          (i) =>
            (i.name ?? "").toLowerCase().includes(q) ||
            (i.description ?? "").toLowerCase().includes(q) ||
            (i.location ?? "").toLowerCase().includes(q) ||
            (i.ownerLabName ?? "").toLowerCase().includes(q),
        ),
  );
  const isReader = $derived(session.user?.role === "reader");

  function deleteInstrument(id: string, name: string): void {
    openModal({
      title: "Delete Instrument",
      bodyHtml: `<p>Delete <strong>${escapeHtmlText(name)}</strong> and all its bookings?</p>`,
      btnText: "Delete",
      onConfirm: () => {
        verifyCaptchaAndExecute(async () => {
          if (await opDeleteInstrument(id)) {
            closeModal();
            showToast("Instrument deleted");
          }
        });
      },
    });
  }

  function escapeHtmlText(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
</script>

<div id="instruments-grid" class="assets-grid" style={`display: ${list.length === 0 ? "none" : "grid"};`}>
    {#each list as inst (inst.id)}
        <div class="asset-card">
            <div class="asset-header">
                <div class="asset-title">{inst.name}</div>
                {#if inst.ownerLabName}<div class="asset-meta">{inst.ownerLabName}</div>{/if}
            </div>
            {#if inst.description}<div class="asset-description">{inst.description}</div>{/if}
            {#if inst.location}<div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">{#if design !== "bauhaus"}📍 {/if}{inst.location}</div>{/if}
            {#if (inst.bookings ?? []).length > 0}
                <div style="margin-bottom: 0.75rem;">
                    <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem;">Upcoming Bookings</div>
                    {#each inst.bookings ?? [] as b (b.id)}
                        <div style="display:flex; justify-content:space-between; align-items:center; background: rgba(124,58,237,0.08); border: 1px solid rgba(124,58,237,0.2); border-radius: var(--radius-sm); padding: 0.35rem 0.6rem; margin-bottom: 0.3rem; font-size: 0.8rem;">
                            <div>
                                <strong>{b.date}</strong> {b.startTime}–{b.endTime}
                                <span style="color: var(--text-muted);"> · {b.userName}{b.labName ? ` (${b.labName})` : ""}</span>
                            </div>
                            {#if b.userId === session.user?.uid}
                                <button class="btn-inline danger" style="font-size:0.7rem; padding:0.15rem 0.4rem;" onclick={() => void opCancelBooking(inst.id, b.id ?? "")}>Cancel</button>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}
            <div class="asset-actions">
                <button class="btn-inline" onclick={() => openBookingModal(inst.id, inst.name ?? "")}>{design === "bauhaus" ? "Book" : "📅 Book"}</button>
                {#if !isReader}
                    <button class="btn-inline" onclick={() => openInstrumentFormShared({ id: inst.id, name: inst.name ?? "", description: inst.description ?? "", location: inst.location ?? "", contactPerson: inst.contactPerson ?? "", contactEmail: inst.contactEmail ?? "" })}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> <span>Edit</span></button>
                    <button class="btn-inline danger" onclick={() => deleteInstrument(inst.id, inst.name ?? "")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> <span>Delete</span></button>
                {/if}
            </div>
        </div>
    {/each}
</div>
<div id="instruments-empty" class="empty-state" style={`display: ${list.length === 0 ? "block" : "none"};`}>
    <div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-circle-red" aria-hidden="true"></span>{:else}🔬{/if}</div><h2>No instruments yet</h2><p>Add your first laboratory instrument</p>
    <button class="btn-primary" id="btn-add-instrument-empty"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Instrument</span></button>
</div>
