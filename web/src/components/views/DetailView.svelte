<script lang="ts">
  import type { Chemical, Container, Room, Shelf } from "@bioscom/shared";
  import { inventory } from "../../lib/stores/inventory.svelte";
  import { router, navigateTo } from "../../lib/router.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import {
    computePositions,
    parseDeepFreezerShelf,
    chemMatchesQuery,
    quantityClass,
    sortChems,
    renderFormulaHtml,
    highlightHtml,
    countChems,
  } from "../../lib/inventoryUtils";
  import { openModal, closeModal } from "../../lib/modal.svelte";
  import { showToast } from "../../lib/stores/toast.svelte";
  import { verifyCaptchaAndExecute } from "../../lib/captcha";
  import {
    opAdjustQty,
    opDeleteChemical,
    opDeleteShelf,
    roleCanWrite,
  } from "../../lib/ops";
  import {
    openChemicalForm,
    openChemicalRadioPrompt,
    openAddBoxForm,
    openAddShelfForm,
    openRenameShelfForm,
    openChangeBoxColorForm,
  } from "../../lib/forms";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { theme } from "../../lib/theme.svelte";

  const design = $derived(theme.design);

  let {
    searchQuery = $bindable(""),
  }: {
    searchQuery?: string;
  } = $props();

  const route = $derived(router.route);
  const roomId = $derived(route.view === "detail" ? route.roomId : "");
  const containerId = $derived(route.view === "detail" ? route.containerId : "");
  const room = $derived(inventory.tree?.rooms.find((r) => r.id === roomId));
  const cont = $derived(inventory.tree?.rooms.find((r) => r.id === roomId)?.containers.find((c) => c.id === containerId));
  const isReader = $derived(session.user?.role === "reader");

  let openShelves = $state<Set<string>>(new Set());
  let selectedRack = $state<string | null>(null);
  let selectedBox = $state<string | null>(null);

  $effect(() => {
    if (route.view === "detail" && route.rack !== undefined) {
      selectedRack = route.rack;
      selectedBox = route.box ?? null;
    }
  });

  const q = $derived(searchQuery.trim().toLowerCase());
  const posMap = $derived(cont !== undefined ? computePositions(cont) : {});
  const shelves = $derived(cont?.shelves ?? []);
  const canManage = $derived(isReader === false);

  const racks = $derived.by(() => {
    const map: Record<string, Record<string, Shelf>> = {};
    for (const sh of shelves) {
      const parsed = parseDeepFreezerShelf(sh);
      map[parsed.rack] ??= {};
      map[parsed.rack]![parsed.box] = sh;
    }
    return map;
  });

  const rackKeys = $derived(
    Object.keys(racks).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    }),
  );

  function toggleShelf(sid: string): void {
    const next = new Set(openShelves);
    if (next.has(sid)) {
      next.delete(sid);
    } else {
      next.add(sid);
    }
    openShelves = next;
  }

  function selectRack(rack: string): void {
    selectedRack = rack;
    selectedBox = null;
    navigateTo("detail", { roomId, containerId, rack, box: null });
  }

  function selectBox(box: string): void {
    selectedBox = box;
    navigateTo("detail", { roomId, containerId, rack: selectedRack, box });
  }

  function resetSelection(): void {
    selectedRack = null;
    selectedBox = null;
    navigateTo("detail", { roomId, containerId });
  }

  async function adjustQty(shelfId: string, chemId: string, delta: number): Promise<void> {
    if (cont === undefined || room === undefined) {
      return;
    }
    await opAdjustQty(room.id, cont.id, shelfId, chemId, delta);
  }

  function deleteChemical(shelfId: string, chem: Chemical): void {
    if (cont === undefined || room === undefined) {
      return;
    }
    openModal({
      title: "Delete Chemical",
      bodyHtml: `<p>Delete <strong>${escapeHtmlText(chem.name ?? "")}</strong>?</p>`,
      btnText: "Delete",
      onConfirm: () => {
        verifyCaptchaAndExecute(async () => {
          if (await opDeleteChemical(room.id, cont.id, shelfId, chem.id)) {
            closeModal();
            showToast("Deleted");
          }
        });
      },
    });
  }

  function deleteShelf(shelf: Shelf): void {
    if (cont === undefined || room === undefined) {
      return;
    }
    openModal({
      title: "Delete Shelf",
      bodyHtml: `<p>Delete <strong>${escapeHtmlText(shelf.name)}</strong> and all chemicals on it?</p>`,
      btnText: "Delete",
      onConfirm: () => {
        verifyCaptchaAndExecute(async () => {
          if (await opDeleteShelf(room.id, cont.id, shelf.id)) {
            closeModal();
            showToast("Deleted");
          }
        });
      },
    });
  }

  function escapeHtmlText(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  const totalChems = $derived(shelves.reduce((s, sh) => s + (sh.chemicals ?? []).length, 0));
  const showEmpty = $derived(cont !== undefined && totalChems === 0 && shelves.length === 0);
</script>

{#if cont !== undefined && room !== undefined}
  {#if cont.type === "deepfreezer"}
    <div class="deepfreezer-explorer" id="shelves-container">
      {#if q !== ""}
        {@const matching = shelves.flatMap((sh) => {
          const parsed = parseDeepFreezerShelf(sh);
          return (sh.chemicals ?? [])
            .filter((ch) => chemMatchesQuery(ch, q))
            .map((ch) => ({ chem: ch, shelfId: sh.id, rack: parsed.rack, box: parsed.box }));
        })}
        <div class="deepfreezer-nav">
          <div class="deepfreezer-nav-item">
            <span class="deepfreezer-nav-text">{#if design !== "bauhaus"}🔍 {/if}Search Results inside Deep Freezer: {matching.length} items found</span>
          </div>
        </div>
        {#if matching.length === 0}
          <div class="shelf-empty">No results found for "{searchQuery}" in this deep freezer</div>
        {:else}
          <table class="chemicals-table">
            <thead>
              <tr><th>Location</th><th>Pos.</th><th>Name</th><th>Formula</th><th>Qty</th><th>Unit</th><th>Conc.</th><th>CAS</th><th>Note</th><th style="width:80px;text-align:center">Actions</th></tr>
            </thead>
            <tbody>
              {#each sortChems(matching.map((m) => m.chem), posMap) as ch (ch.id)}
                {@const match = matching.find((m) => m.chem.id === ch.id)!}
                {@const conc = ch.concentration !== null && ch.concentration !== undefined ? `${ch.concentration} ${ch.concUnit ?? ""}` : "—"}
                <tr class="fade-in" data-chemid={ch.id}>
                  <td>
                    <button class="deepfreezer-nav-btn" title="Go to Box" style="margin: 0; background: rgba(59, 130, 246, 0.15); border-color: rgba(59, 130, 246, 0.3); color: var(--accent-blue); font-weight: 600;" onclick={() => { selectedRack = match.rack; selectedBox = match.box; navigateTo("detail", { roomId, containerId, rack: match.rack, box: match.box }); }}>Rack {match.rack} / Box {match.box}</button>
                  </td>
                  <td><span class="chem-pos fridge">{posMap[ch.id] ?? "—"}</span></td>
                  <td class="chem-name"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html highlightHtml(ch.name ?? "", q)}</td>
                  <td class="chem-formula"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html renderFormulaHtml(ch.formula)}</td>
                  <td>
                    <div class="qty-adjuster">
                      <button class="btn-qty" onclick={(e) => { e.stopPropagation(); void adjustQty(match.shelfId, ch.id, -1); }}>−</button>
                      <span class={`chem-quantity ${quantityClass(ch.quantity)}`}>{ch.quantity ?? 0}</span>
                      <button class="btn-qty" onclick={(e) => { e.stopPropagation(); void adjustQty(match.shelfId, ch.id, 1); }}>+</button>
                    </div>
                  </td>
                  <td>{ch.unit ?? "pcs"}</td>
                  <td style="white-space:nowrap">{conc}</td>
                  <td>{ch.cas ?? "—"}</td>
                  <td>{ch.note ?? "—"}</td>
                  <td>
                    <div class="row-actions">
                      <button class="btn-inline" title="Edit" onclick={() => openChemicalForm(room, cont, { editChemId: ch.id })}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                      {#if !isReader}<button class="btn-inline danger" title="Delete" onclick={() => deleteChemical(match.shelfId, ch)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>{/if}
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {:else if selectedRack === null}
        <div class="deepfreezer-nav">
          <div class="deepfreezer-nav-item" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div>
              <span class="deepfreezer-nav-text">{#if design !== "bauhaus"}❄️ {/if}Deep Freezer Explorer</span>
              <span class="deepfreezer-nav-separator">/</span>
              <span class="deepfreezer-nav-text" style="color: var(--text-muted);">Select a Rack</span>
            </div>
            {#if !isReader}
              <button class="btn-primary" style="font-size: 0.8rem; padding: 0.4rem 0.8rem; display: inline-flex; align-items: center; gap: 0.25rem; margin: 0;" onclick={() => openAddShelfForm(room, cont)}>{design === "bauhaus" ? "+ Add Rack" : "➕ Add Rack"}</button>
            {/if}
          </div>
        </div>
        <div class="deepfreezer-grid-8x4">
          {#each Array.from({ length: 32 }, (_, i) => i) as i (i)}
            {@const rk = rackKeys.find((name) => racks[name] !== undefined)}
            {@const rackAtSlot = Object.entries(cont.rackPositions ?? {}).find(([, slot]) => slot === i)?.[0]}
            {#if rackAtSlot !== undefined && rackKeys.includes(rackAtSlot)}
              {@const boxesCount = Object.keys(racks[rackAtSlot] ?? {}).length}
              {@const totalItems = Object.values(racks[rackAtSlot] ?? {}).reduce((acc, sh) => acc + (sh.chemicals ?? []).length, 0)}
              <div class="deepfreezer-grid-cell" data-slot={i}>
                <div class="deepfreezer-card rack-card" onclick={() => selectRack(rackAtSlot!)}>
                  <div class="deepfreezer-card-icon">{#if design === "bauhaus"}<span class="glyph glyph-box" aria-hidden="true"></span>{:else}🗄️{/if}</div>
                  <div class="deepfreezer-card-title">Rack {rackAtSlot}</div>
                  <div class="deepfreezer-card-subtitle">{boxesCount} Boxes ({totalItems} samples)</div>
                </div>
              </div>
            {:else}
              <div class="deepfreezer-grid-cell" data-slot={i}>
                <div class="deepfreezer-grid-empty-slot">Slot {i + 1}</div>
              </div>
            {/if}
          {/each}
        </div>
      {:else if selectedBox === null}
        <div class="deepfreezer-nav">
          <div class="deepfreezer-nav-item" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div>
                <span class="deepfreezer-nav-link" onclick={() => resetSelection()}>{#if design !== "bauhaus"}❄️ {/if}Deep Freezer Explorer</span>
              <span class="deepfreezer-nav-separator">›</span>
              <span class="deepfreezer-nav-text">Rack {selectedRack}</span>
              <button class="deepfreezer-nav-btn" onclick={() => resetSelection()}>Change Rack</button>
              <span class="deepfreezer-nav-separator">/</span>
              <span class="deepfreezer-nav-text" style="color: var(--text-muted);">Select a Box</span>
            </div>
            {#if !isReader}
              <button class="btn-primary" style="font-size: 0.8rem; padding: 0.4rem 0.8rem; display: inline-flex; align-items: center; gap: 0.25rem; margin: 0;" onclick={() => openAddShelfForm(room, cont)}>{design === "bauhaus" ? "+ Add Box" : "➕ Add Box"}</button>
            {/if}
          </div>
        </div>
        <div class="deepfreezer-boxes-column">
          {#each Object.keys(racks[selectedRack] ?? {}).sort((a, b) => { const numA = parseInt(a, 10); const numB = parseInt(b, 10); if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB; return a.localeCompare(b); }) as bk (bk)}
            {@const activeShelf = racks[selectedRack]![bk]!}
            {@const sampleCount = (activeShelf.chemicals ?? []).length}
            {@const boxColor = activeShelf.color ?? "#3b82f6"}
            <div
              class={`deepfreezer-card box-card ${activeShelf.color ? "has-custom-color" : ""}`}
              style={activeShelf.color ? `--custom-bg: ${boxColor}2d; --custom-border: ${boxColor}; --custom-bg-hover: ${boxColor}4d;` : ""}
              onclick={() => selectBox(bk)}
            >
              <div class="deepfreezer-card-icon" style={`color: ${boxColor};`}>{#if design === "bauhaus"}<span class="glyph glyph-box" aria-hidden="true"></span>{:else}📦{/if}</div>
              <div class="deepfreezer-card-title">Box {bk}</div>
              <div class="deepfreezer-card-subtitle">{sampleCount} samples</div>
              {#if !isReader}
                <div class="deepfreezer-card-actions" onclick={(e) => e.stopPropagation()}>
                  <button class="card-action-btn" title="Rename Box" onclick={() => openRenameShelfForm(room, cont, activeShelf.id, activeShelf.name)}>{design === "bauhaus" ? "R" : "✏️"}</button>
                  <button class="card-action-btn" title="Change Color" onclick={() => openChangeBoxColorForm(room, cont, activeShelf.id)}>{design === "bauhaus" ? "C" : "🎨"}</button>
                  <button class="card-action-btn danger" title="Delete Box" onclick={() => deleteShelf(activeShelf)}>{design === "bauhaus" ? "D" : "🗑️"}</button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        {@const activeShelf = racks[selectedRack]?.[selectedBox]}
        {#if activeShelf !== undefined}
          <div class="deepfreezer-explorer">
            <div class="deepfreezer-nav">
              <div class="deepfreezer-nav-item">
<span class="deepfreezer-nav-link" onclick={() => resetSelection()}>{#if design !== "bauhaus"}❄️ {/if}Deep Freezer Explorer</span>
                <span class="deepfreezer-nav-separator">›</span>
                <span class="deepfreezer-nav-link" onclick={() => { selectedBox = null; navigateTo("detail", { roomId, containerId, rack: selectedRack }); }}>Rack {selectedRack}</span>
                <button class="deepfreezer-nav-btn" onclick={() => resetSelection()}>Change Rack</button>
                <span class="deepfreezer-nav-separator">›</span>
                <span class="deepfreezer-nav-text">Box {selectedBox}</span>
                <button class="deepfreezer-nav-btn" onclick={() => { selectedBox = null; navigateTo("detail", { roomId, containerId, rack: selectedRack }); }}>Change Box</button>
              </div>
            </div>
            <div class="shelf-section open" data-sid={activeShelf.id}>
              <div class="shelf-header" style="cursor: default;">
                <div class="shelf-info">
                  <span class="shelf-icon" style={`color: ${activeShelf.color ?? "#3b82f6"};`}>{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}🧊{/if}</span>
                  <span class="shelf-name">Rack {selectedRack} / Box {selectedBox}</span>
                  <span class="shelf-count">{(activeShelf.chemicals ?? []).length} chemicals</span>
                </div>
                <div class="shelf-actions">
                  {#if !isReader}
                    <button class="btn-inline danger" title="Delete Box" onclick={(e) => { e.stopPropagation(); deleteShelf(activeShelf); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                  {/if}
                </div>
              </div>
              <div class="shelf-body">
                {#if (activeShelf.chemicals ?? []).length > 0}
                  <table class="chemicals-table">
                    <thead><tr><th>Pos.</th><th>Name</th><th>Formula</th><th>Qty</th><th>Unit</th><th>Conc.</th><th>CAS</th><th>Note</th><th style="width:80px;text-align:center">Actions</th></tr></thead>
                    <tbody>
                      {#each sortChems(activeShelf.chemicals ?? [], posMap) as ch (ch.id)}
                        {@const conc = ch.concentration !== null && ch.concentration !== undefined ? `${ch.concentration} ${ch.concUnit ?? ""}` : "—"}
                        <tr class="fade-in" data-chemid={ch.id}>
                          <td><span class="chem-pos fridge">{posMap[ch.id] ?? "—"}</span></td>
                          <td class="chem-name"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html highlightHtml(ch.name ?? "", q)}</td>
                          <td class="chem-formula"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html renderFormulaHtml(ch.formula)}</td>
                          <td>
                            <div class="qty-adjuster">
                              <button class="btn-qty" onclick={(e) => { e.stopPropagation(); void adjustQty(activeShelf.id, ch.id, -1); }}>−</button>
                              <span class={`chem-quantity ${quantityClass(ch.quantity)}`}>{ch.quantity ?? 0}</span>
                              <button class="btn-qty" onclick={(e) => { e.stopPropagation(); void adjustQty(activeShelf.id, ch.id, 1); }}>+</button>
                            </div>
                          </td>
                          <td>{ch.unit ?? "pcs"}</td>
                          <td style="white-space:nowrap">{conc}</td>
                          <td>{ch.cas ?? "—"}</td>
                          <td>{ch.note ?? "—"}</td>
                          <td>
                            <div class="row-actions">
                              <button class="btn-inline" title="Edit" onclick={() => openChemicalForm(room, cont, { editChemId: ch.id })}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                              {#if !isReader}<button class="btn-inline danger" title="Delete" onclick={() => deleteChemical(activeShelf.id, ch)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>{/if}
                            </div>
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {:else}
                  <div class="shelf-empty">Empty box</div>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  {:else}
    <div id="shelves-container">
      {#each shelves.filter((s) => !s.parentShelfId) as sh (sh.id)}
        {@const chems = sortChems((sh.chemicals ?? []).filter((c) => q === "" || chemMatchesQuery(c, q)), posMap)}
        {@const boxes = shelves.filter((s) => s.parentShelfId === sh.id)}
        {@const isOpen = openShelves.has(sh.id) || q !== ""}
        {@const isFreezer = cont.type === "freezer"}
        {@const isFridgeOrFreezer = cont.type === "fridge" || isFreezer}
        {@const icon = isFridgeOrFreezer ? (sh.name.startsWith("Door") ? "🚪" : isFreezer ? "🧊" : "❄️") : "📁"}
        <div class={`shelf-section ${isOpen ? "open" : ""}`} data-sid={sh.id}>
          <div class="shelf-header" onclick={() => toggleShelf(sh.id)}>
            <div class="shelf-info">
              <span class="shelf-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}{icon}{/if}</span>
              <span class="shelf-name">{sh.name}</span>
              <span class="shelf-count">{chems.length} chemicals</span>
            </div>
            <div class="shelf-actions">
              {#if canManage}
                <button class="btn-inline" title="Rename Shelf" onclick={(e) => { e.stopPropagation(); openRenameShelfForm(room, cont, sh.id, sh.name); }}>{design === "bauhaus" ? "R" : "✏️"}</button>
                {#if cont.type === "fridge" || cont.type === "freezer"}
                  <button class="btn-inline" title="Add Box" onclick={(e) => { e.stopPropagation(); openAddBoxForm(room, cont, sh.id); }}>{design === "bauhaus" ? "+ Box" : "➕ Box"}</button>
                {/if}
                <button class="btn-inline" title="Add Chemical to Shelf" onclick={(e) => { e.stopPropagation(); openChemicalRadioPrompt(room, cont, sh.id); }}>{design === "bauhaus" ? "+ Chem" : "➕ Chem"}</button>
                <button class="btn-inline danger" title="Delete shelf" onclick={(e) => { e.stopPropagation(); deleteShelf(sh); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
              {/if}
              <span class="shelf-toggle">▼</span>
            </div>
          </div>
          <div class="shelf-body">
            {#if boxes.length > 0}
              <div class="deepfreezer-grid" style="margin-bottom: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; padding: 0.25rem;">
                {#each boxes as box (box.id)}
                  {@const boxColor = box.color ?? "#3b82f6"}
                  <div
                    class={`deepfreezer-card box-card ${box.color ? "has-custom-color" : ""} ${openShelves.has(box.id) ? "active-box" : ""}`}
                    style={`${box.color ? `--custom-bg: ${boxColor}2d; --custom-border: ${boxColor}; --custom-bg-hover: ${boxColor}4d;` : ""} padding: 1.25rem 0.75rem; min-height: auto;`}
                    onclick={(e) => { e.stopPropagation(); toggleShelf(box.id); }}
                  >
                    <div class="deepfreezer-card-icon" style={`color: ${boxColor}; font-size: 1.8rem; margin-bottom: 0.25rem;`}>{#if design === "bauhaus"}<span class="glyph glyph-box" aria-hidden="true"></span>{:else}📦{/if}</div>
                    <div class="deepfreezer-card-title" style="font-size: 0.85rem;">{box.name}</div>
                    <div class="deepfreezer-card-subtitle" style="font-size: 0.7rem;">{(box.chemicals ?? []).length} samples</div>
                    {#if canManage}
                      <div class="deepfreezer-card-actions" style="margin-top: 0.35rem;" onclick={(e) => e.stopPropagation()}>
                        <button class="card-action-btn" title="Rename Box" style="padding: 2px 4px; font-size: 0.7rem;" onclick={() => openRenameShelfForm(room, cont, box.id, box.name)}>{design === "bauhaus" ? "R" : "✏️"}</button>
                        <button class="card-action-btn" title="Change Color" style="padding: 2px 4px; font-size: 0.7rem;" onclick={() => openChangeBoxColorForm(room, cont, box.id)}>{design === "bauhaus" ? "C" : "🎨"}</button>
                        <button class="card-action-btn danger" title="Delete Box" style="padding: 2px 4px; font-size: 0.7rem;" onclick={() => deleteShelf(box)}>{design === "bauhaus" ? "D" : "🗑️"}</button>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
              {#each boxes as box (box.id)}
                {#if openShelves.has(box.id) || q !== ""}
                  {@const boxChems = sortChems((box.chemicals ?? []).filter((c) => q === "" || chemMatchesQuery(c, q)), posMap)}
                  <div class="box-chemicals-section" style="border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 1.25rem; margin-bottom: 1.25rem; background: rgba(255,255,255,0.015); box-shadow: inset 0 0 10px rgba(0,0,0,0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.5rem;">
                      <h4 style="margin: 0; color: var(--text-primary); font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem;">
                        <span style={`color: ${box.color ?? "#3b82f6"};`}>{#if design === "bauhaus"}<span class="glyph glyph-box" aria-hidden="true"></span>{:else}📦{/if}</span> {box.name} Chemicals
                      </h4>
                      {#if canManage}
                        <button class="btn-primary" style="font-size: 0.75rem; padding: 0.35rem 0.7rem; margin: 0; height: auto; display: inline-flex; align-items: center; gap: 0.25rem;" onclick={() => openChemicalRadioPrompt(room, cont, box.id)}>{design === "bauhaus" ? "+ Add Chemical" : "➕ Add Chemical"}</button>
                      {/if}
                    </div>
                    {#if boxChems.length > 0}
                      <table class="chemicals-table"><thead><tr><th>Pos.</th><th>Name</th><th>Formula</th><th>Qty</th><th>Unit</th><th>Conc.</th><th>CAS</th><th>Note</th><th style="width:80px;text-align:center">Actions</th></tr></thead><tbody>
                        {#each boxChems as ch (ch.id)}
                          {@const conc = ch.concentration !== null && ch.concentration !== undefined ? `${ch.concentration} ${ch.concUnit ?? ""}` : "—"}
                          <tr class="fade-in" data-chemid={ch.id}><td><span class="chem-pos fridge">{posMap[ch.id] ?? "—"}</span></td><td class="chem-name"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html highlightHtml(ch.name ?? "", q)}</td><td class="chem-formula"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html renderFormulaHtml(ch.formula)}</td><td><div class="qty-adjuster"><button class="btn-qty" onclick={(e) => { e.stopPropagation(); void adjustQty(box.id, ch.id, -1); }}>−</button><span class={`chem-quantity ${quantityClass(ch.quantity)}`}>{ch.quantity ?? 0}</span><button class="btn-qty" onclick={(e) => { e.stopPropagation(); void adjustQty(box.id, ch.id, 1); }}>+</button></div></td><td>{ch.unit ?? "pcs"}</td><td style="white-space:nowrap">{conc}</td><td>{ch.cas ?? "—"}</td><td>{ch.note ?? "—"}</td><td><div class="row-actions"><button class="btn-inline" title="Edit" onclick={() => openChemicalForm(room, cont, { editChemId: ch.id })}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>{#if !isReader}<button class="btn-inline danger" title="Delete" onclick={() => deleteChemical(box.id, ch)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>{/if}</div></td></tr>
                        {/each}
                      </tbody></table>
                    {:else}
                      <div class="shelf-empty">{q !== "" ? "No results" : "Empty box"}</div>
                    {/if}
                  </div>
                {/if}
              {/each}
            {/if}
            {#if chems.length > 0}
              {#if boxes.length > 0}
                <h4 style="margin: 0.75rem 0 0.5rem 0; color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;">Direct Shelf Chemicals</h4>
              {/if}
              <table class="chemicals-table"><thead><tr><th>Pos.</th><th>Name</th><th>Formula</th><th>Qty</th><th>Unit</th><th>Conc.</th><th>CAS</th><th>Note</th><th style="width:80px;text-align:center">Actions</th></tr></thead><tbody>
                {#each chems as ch (ch.id)}
                  {@const conc = ch.concentration !== null && ch.concentration !== undefined ? `${ch.concentration} ${ch.concUnit ?? ""}` : "—"}
                  <tr class="fade-in" data-chemid={ch.id}><td><span class={`chem-pos ${isFridgeOrFreezer ? "fridge" : ""}`}>{posMap[ch.id] ?? "—"}</span></td><td class="chem-name"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html highlightHtml(ch.name ?? "", q)}</td><td class="chem-formula"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html renderFormulaHtml(ch.formula)}</td><td><div class="qty-adjuster"><button class="btn-qty" onclick={(e) => { e.stopPropagation(); void adjustQty(sh.id, ch.id, -1); }}>−</button><span class={`chem-quantity ${quantityClass(ch.quantity)}`}>{ch.quantity ?? 0}</span><button class="btn-qty" onclick={(e) => { e.stopPropagation(); void adjustQty(sh.id, ch.id, 1); }}>+</button></div></td><td>{ch.unit ?? "pcs"}</td><td style="white-space:nowrap">{conc}</td><td>{ch.cas ?? "—"}</td><td>{ch.note ?? "—"}</td><td><div class="row-actions"><button class="btn-inline" title="Edit" onclick={() => openChemicalForm(room, cont, { editChemId: ch.id })}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>{#if !isReader}<button class="btn-inline danger" title="Delete" onclick={() => deleteChemical(sh.id, ch)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>{/if}</div></td></tr>
                {/each}
              </tbody></table>
            {:else if boxes.length === 0}
              <div class="shelf-empty">{q !== "" ? "No results" : "Empty shelf"}</div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
  <div id="detail-empty" class="empty-state" style={`display: ${showEmpty ? "block" : "none"};`}>
      <div class="empty-icon">{#if design === "bauhaus"}<span class="glyph glyph-circle-blue" aria-hidden="true"></span>{:else}🧪{/if}</div><h2>No chemicals yet</h2><p>Add your first chemical</p>
      <button class="btn-primary add-chem-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Chemical</span></button>
  </div>
{/if}
