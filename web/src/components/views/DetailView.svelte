<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Chemical, Container, Room, Shelf } from "@bioscom/shared";
  import { resolveRackGrid, resolveRackShelves, resolveRackShelfIndex } from "@bioscom/shared";
  import { inventory } from "../../lib/stores/inventory.svelte";
  import { router, navigateTo } from "../../lib/router.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import {
    computePositions,
    effectivePosition,
    parseDeepFreezerShelf,
    chemMatchesQuery,
    sortChems,
    countChems,
    stripEmoji,
  } from "../../lib/inventoryUtils";
  import { openModal, closeModal } from "../../lib/modal.svelte";
  import { showToast } from "../../lib/stores/toast.svelte";
  import { verifyCaptchaAndExecute } from "../../lib/captcha";
  import {
    opAdjustQty,
    opDeleteChemical,
    opDeleteShelf,
    opMoveDeepFreezerRack,
    opMoveDeepFreezerBox,
  } from "../../lib/ops";
  import {
    openChemicalForm,
    openChemicalRadioPrompt,
  openAddBoxForm,
  openAddDeepFreezerBoxForm,
  openAddDeepFreezerRackForm,
  openDeepFreezerGridSettings,
  openDeepFreezerShelfSettings,
  openAddShelfForm,
    openRenameShelfForm,
    openChangeBoxColorForm,
    openStockLabelModal,
  } from "../../lib/forms";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { theme } from "../../lib/theme.svelte";
  import ChemicalTable from "./ChemicalTable.svelte";
  import {
    catalogColumnPreferences,
    loadCatalogColumnPreferences,
  } from "../../lib/stores/catalogColumnPreferences.svelte";

  const design = $derived(theme.design);

  interface RackBoxEntry {
    shelf: Shelf;
    boxName: string;
    shelfIndex: number | null;
  }

  interface DeepFreezerMatch {
    chem: Chemical;
    shelfId: string;
    rack: string;
    box: string;
  }

  let {
    searchQuery = $bindable(""),
  }: {
    searchQuery?: string;
  } = $props();

  const route = $derived(router.route);
  const roomId = $derived(route.view === "detail" ? route.roomId : "");
  const containerId = $derived(route.view === "detail" ? route.containerId : "");
  const room = $derived.by(() => {
    const roomFromRooms = inventory.tree?.rooms.find((r) => r.id === roomId);
    if (roomFromRooms !== undefined) return roomFromRooms;
    const freezer = inventory.tree?.deepFreezers?.find((c) => c.id === roomId);
    if (freezer === undefined) return undefined;
    return { id: freezer.id, name: freezer.name ?? freezer.id, containers: [freezer] } as unknown as typeof roomFromRooms;
  });
  const cont = $derived(room?.containers.find((c) => c.id === containerId));
  const isReader = $derived(session.user?.role === "reader");
  const preferencesConfirmed = $derived(
    session.user?.uid !== undefined &&
      catalogColumnPreferences.accountId === session.user.uid &&
      catalogColumnPreferences.confirmed,
  );
  const activeColumns = $derived(
    catalogColumnPreferences.columnsForUser(session.user?.uid ?? "", "all"),
  );

  $effect(() => {
    const userId = session.user?.uid ?? null;
    if (route.view === "detail") {
      void loadCatalogColumnPreferences(userId);
    }
  });

  function retryColumnPreferences(): void {
    void loadCatalogColumnPreferences(session.user?.uid ?? null, true);
  }

  let openShelves = $state<Set<string>>(new Set());
  let selectedRack = $state<string | null>(null);
  let selectedBox = $state<string | null>(null);
  let selectedBoxShelfId = $state<string | null>(null);
  let draggedRack = $state<string | null>(null);
  let dragOverSlot = $state<number | null>(null);
  let draggedBox = $state<RackBoxEntry | null>(null);
  let dragOverShelfIndex = $state<number | null>(null);

  $effect(() => {
    if (route.view === "detail" && route.rack !== undefined) {
      selectedRack = route.rack;
      selectedBox = route.box ?? null;
      if (selectedBox === null) {
        selectedBoxShelfId = null;
      } else if (selectedBoxShelfId !== null) {
        const selected = shelves.find((shelf) => shelf.id === selectedBoxShelfId);
        if (selected === undefined) {
          selectedBoxShelfId = null;
        } else {
          const parsed = parseDeepFreezerShelf(selected);
          if (parsed.rack !== selectedRack || parsed.box !== selectedBox) selectedBoxShelfId = null;
        }
      }
    }
  });

  const DEFAULT_DOCUMENT_TITLE = "BioSCom – Chemical Inventory";
  onDestroy(() => {
    document.title = DEFAULT_DOCUMENT_TITLE;
  });
  $effect(() => {
    const name = route.view === "detail" && cont?.type === "deepfreezer" ? cont.name.trim() : "";
    const description = name !== "" ? (cont?.description ?? "").trim() : "";
    document.title = name === "" ? DEFAULT_DOCUMENT_TITLE : description === "" ? name : `${name} — ${description}`;
    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  });

  const q = $derived(searchQuery.trim().toLowerCase());
  const posMap = $derived(cont !== undefined ? computePositions(cont) : {});
  const shelves = $derived(cont?.shelves ?? []);
  const rackGrid = $derived(resolveRackGrid(cont ?? {}));
  const rackSlotIndexes = $derived(Array.from({ length: rackGrid.capacity }, (_, i) => i));
  const rackShelfCount = $derived(resolveRackShelves(cont ?? {}));
  const rackShelfIndexes = $derived(Array.from({ length: rackShelfCount }, (_, i) => i + 1));
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

  const rackKeys = $derived.by<string[]>(() => {
    const names = new Set([...Object.keys(racks), ...Object.keys(cont?.rackPositions ?? {})]);
    return [...names].sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });
  });

  const selectedRackBoxes = $derived.by<RackBoxEntry[]>(() => {
    if (selectedRack === null) return [];
    const entries: RackBoxEntry[] = [];
    for (const shelf of shelves) {
      const parsed = parseDeepFreezerShelf(shelf);
      if (parsed.rack !== selectedRack) continue;
      entries.push({
        shelf,
        boxName: parsed.box,
        shelfIndex: resolveRackShelfIndex({
          rackShelf: shelf.rackShelf,
          boxName: shelf.boxName ?? parsed.box,
        }),
      });
    }
    return entries;
  });
  const legacyRackBoxes = $derived(
    selectedRackBoxes.filter(
      (entry) => entry.shelfIndex === null || entry.shelfIndex < 1 || entry.shelfIndex > rackShelfCount,
    ),
  );

  function shelvesForRack(rackName: string): Shelf[] {
    return shelves.filter((shelf) => parseDeepFreezerShelf(shelf).rack === rackName);
  }

  function boxesAtShelf(index: number): RackBoxEntry[] {
    return selectedRackBoxes.filter((entry) => entry.shelfIndex === index);
  }

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
    selectedBoxShelfId = null;
    navigateTo("detail", { roomId, containerId, rack, box: null });
  }

  function selectBox(box: string, shelfId?: string): void {
    selectedBox = box;
    selectedBoxShelfId = shelfId ?? null;
    navigateTo("detail", { roomId, containerId, rack: selectedRack, box });
  }

  function openMatchingBox(match: DeepFreezerMatch): void {
    selectedRack = match.rack;
    selectedBox = match.box;
    selectedBoxShelfId = match.shelfId;
    navigateTo("detail", { roomId, containerId, rack: match.rack, box: match.box });
  }

  function matchingLocation(match: DeepFreezerMatch): string {
    return `Rack ${match.rack} / Box ${match.box}`;
  }

  function resetSelection(): void {
    selectedRack = null;
    selectedBox = null;
    selectedBoxShelfId = null;
    navigateTo("detail", { roomId, containerId });
  }

  function rackNameAtSlot(slot: number): string | undefined {
    return Object.entries(cont?.rackPositions ?? {}).find(([, position]) => position === slot)?.[0];
  }

  function canDropDraggedRack(slot: number): boolean {
    if (draggedRack === null || slot < 0 || slot >= rackGrid.capacity) return false;
    const occupant = rackNameAtSlot(slot);
    return occupant === undefined || occupant === draggedRack;
  }

  function onRackDragStart(event: DragEvent, rackName: string): void {
    if (isReader || cont === undefined || cont.type !== "deepfreezer") {
      event.preventDefault();
      return;
    }
    draggedRack = rackName;
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-bioscom-rack", rackName);
    }
  }

  function onRackDragEnd(): void {
    draggedRack = null;
    dragOverSlot = null;
  }

  function onRackDragOver(event: DragEvent, slot: number): void {
    if (!canDropDraggedRack(slot)) {
      dragOverSlot = null;
      if (draggedRack !== null && event.dataTransfer !== null) event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
    dragOverSlot = slot;
  }

  function onRackDragLeave(slot: number): void {
    if (dragOverSlot === slot) dragOverSlot = null;
  }

  async function moveRackToSlot(rackName: string, slot: number): Promise<boolean> {
    const freezerId = cont?.id;
    if (isReader || freezerId === undefined || slot < 0 || slot >= rackGrid.capacity) return false;
    const occupant = rackNameAtSlot(slot);
    if (occupant !== undefined && occupant !== rackName) {
      showToast(`Slot ${slot + 1} is already occupied by Rack ${occupant}`, "error");
      return false;
    }
    if (cont?.rackPositions?.[rackName] === slot) return true;
    if (await opMoveDeepFreezerRack(freezerId, rackName, slot)) {
      showToast(`Rack "${rackName}" moved to slot ${slot + 1}`);
      return true;
    }
    return false;
  }

  async function onRackDrop(event: DragEvent, slot: number): Promise<void> {
    const rackName = draggedRack;
    if (rackName === null) return;
    event.preventDefault();
    draggedRack = null;
    dragOverSlot = null;
    await moveRackToSlot(rackName, slot);
  }

  async function onRackKeydown(event: KeyboardEvent, rackName: string): Promise<void> {
    if (!event.ctrlKey || isReader) return;
    const currentSlot = cont?.rackPositions?.[rackName];
    if (currentSlot === undefined || !Number.isInteger(currentSlot)) return;
    let delta = 0;
    if (event.key === "ArrowLeft") delta = -1;
    else if (event.key === "ArrowRight") delta = 1;
    else if (event.key === "ArrowUp") delta = -rackGrid.columns;
    else if (event.key === "ArrowDown") delta = rackGrid.columns;
    else return;
    const target = currentSlot + delta;
    if (target < 0 || target >= rackGrid.capacity) return;
    event.preventDefault();
    await moveRackToSlot(rackName, target);
  }

  function canDropDraggedBox(index: number): boolean {
    if (draggedBox === null || index < 1 || index > rackShelfCount) return false;
    return boxesAtShelf(index).every((entry) => entry.shelf.id === draggedBox!.shelf.id);
  }

  function onBoxDragStart(event: DragEvent, entry: RackBoxEntry): void {
    if (isReader || cont === undefined || cont.type !== "deepfreezer") {
      event.preventDefault();
      return;
    }
    draggedBox = entry;
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-bioscom-box", entry.shelf.id);
    }
  }

  function onBoxDragEnd(): void {
    draggedBox = null;
    dragOverShelfIndex = null;
  }

  function onBoxDragOver(event: DragEvent, index: number): void {
    if (draggedBox === null) return;
    if (!canDropDraggedBox(index)) {
      dragOverShelfIndex = null;
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
    dragOverShelfIndex = index;
  }

  function onBoxDragLeave(index: number): void {
    if (dragOverShelfIndex === index) dragOverShelfIndex = null;
  }

  async function moveBoxToShelf(boxId: string, index: number): Promise<boolean> {
    const freezerId = cont?.id;
    if (isReader || freezerId === undefined || index < 1 || index > rackShelfCount) return false;
    const occupants = boxesAtShelf(index).filter((entry) => entry.shelf.id !== boxId);
    if (occupants.length > 0) {
      showToast(`Shelf position ${index} is already occupied`, "error");
      return false;
    }
    const moving = selectedRackBoxes.find((entry) => entry.shelf.id === boxId);
    if (moving?.shelfIndex === index) return true;
    if (await opMoveDeepFreezerBox(freezerId, boxId, index)) {
      showToast(`Box "${moving?.boxName ?? boxId}" moved to shelf ${index}`);
      return true;
    }
    return false;
  }

  async function onBoxDrop(event: DragEvent, index: number): Promise<void> {
    const source = draggedBox;
    if (source === null) return;
    event.preventDefault();
    const allowed = canDropDraggedBox(index);
    draggedBox = null;
    dragOverShelfIndex = null;
    if (!allowed) {
      showToast(`Shelf position ${index} is already occupied`, "error");
      return;
    }
    await moveBoxToShelf(source.shelf.id, index);
  }

  async function onBoxKeydown(event: KeyboardEvent, entry: RackBoxEntry): Promise<void> {
    if (!event.ctrlKey || isReader || entry.shelfIndex === null) return;
    let target = 0;
    if (event.key === "ArrowUp") target = entry.shelfIndex - 1;
    else if (event.key === "ArrowDown") target = entry.shelfIndex + 1;
    else return;
    if (target < 1 || target > rackShelfCount) return;
    event.preventDefault();
    await moveBoxToShelf(entry.shelf.id, target);
  }

  async function adjustQty(shelfId: string, chemId: string, delta: number): Promise<void> {
    if (cont === undefined || room === undefined) {
      return;
    }
    await opAdjustQty(room.id, cont.id, shelfId, chemId, delta);
  }

  async function adjustDirectQty(containerId: string, chemId: string, delta: number): Promise<void> {
    if (room === undefined) {
      return;
    }
    await opAdjustQty(room.id, containerId, "", chemId, delta);
  }

  function deleteDirectChemical(containerId: string, chem: Chemical): void {
    if (room === undefined) {
      return;
    }
    openModal({
      title: "Delete Chemical",
      bodyHtml: `<p>Delete <strong>${escapeHtmlText(chem.name ?? "")}</strong>?</p>`,
      btnText: "Delete",
      onConfirm: () => {
        verifyCaptchaAndExecute(async () => {
          if (await opDeleteChemical(room.id, containerId, "", chem.id)) {
            closeModal();
            showToast("Deleted");
          }
        });
      },
    });
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

  const subContainerTypeLabels: Record<string, string> = {
    shelf: "Shelf",
    door_shelf: "Door shelf",
    crate: "Crate",
    box: "Box",
  };

  function subContainerTypeLabel(type: string | undefined): string {
    return subContainerTypeLabels[type ?? "shelf"] ?? "Shelf";
  }

  function shelfTypeChip(type: string | undefined): string | null {
    if (type === undefined || type === "shelf") {
      return null;
    }
    return subContainerTypeLabels[type] ?? type;
  }

  // Boxes may nest only under a typed shelf (or legacy fridge/freezer shelves).
  function canHostBox(shelf: Shelf): boolean {
    if (shelf.type === "box") {
      return false;
    }
    if (shelf.type !== undefined) {
      return true;
    }
    return cont?.type === "fridge" || cont?.type === "freezer";
  }

  const totalChems = $derived(
    shelves.reduce((s, sh) => s + (sh.chemicals ?? []).length, 0) + (cont?.chemicals?.length ?? 0),
  );
  const showEmpty = $derived(
    cont !== undefined &&
      totalChems === 0 &&
      shelves.length === 0 &&
      (room?.chemicals?.length ?? 0) === 0,
  );
</script>

{#snippet rackBoxCard(entry: RackBoxEntry)}
  {@const activeShelf = entry.shelf}
  {@const sampleCount = (activeShelf.chemicals ?? []).length}
  {@const boxColor = activeShelf.color ?? "#3b82f6"}
  <div
    class={`deepfreezer-card box-card ${activeShelf.color ? "has-custom-color" : ""}`}
    style={activeShelf.color ? `--custom-bg: ${boxColor}2d; --custom-border: ${boxColor}; --custom-bg-hover: ${boxColor}4d;` : ""}
    data-box-id={activeShelf.id}
    draggable={!isReader}
    role="group"
    aria-label={`Box ${entry.boxName}`}
    ondragstart={(event) => onBoxDragStart(event, entry)}
    ondragend={onBoxDragEnd}
  >
    <button
      class="rack-card-open"
      type="button"
      title={`Open Box ${entry.boxName} · Ctrl+Arrow Up/Down to change shelf`}
      aria-label={`Open Box ${entry.boxName}. Ctrl+Arrow Up/Down changes shelf position.`}
      onclick={() => selectBox(entry.boxName, activeShelf.id)}
      onkeydown={(event) => onBoxKeydown(event, entry)}
    >
      <span class="deepfreezer-card-icon" style={`color: ${boxColor};`}>{#if design === "bauhaus"}<span class="glyph glyph-box" aria-hidden="true"></span>{:else}📦{/if}</span>
      <span class="deepfreezer-card-title">Box {design === "bauhaus" ? stripEmoji(entry.boxName) : entry.boxName}</span>
      <span class="deepfreezer-card-subtitle">{sampleCount} samples</span>
    </button>
    {#if !isReader}
      <div class="deepfreezer-card-actions" role="group" aria-label={`Box ${entry.boxName} actions`}>
        <button class="card-action-btn" title="Rename Box" onclick={() => openRenameShelfForm(room!, cont!, activeShelf.id, activeShelf.name)}>{design === "bauhaus" ? "R" : "✏️"}</button>
        <button class="card-action-btn" title="Change Color" onclick={() => openChangeBoxColorForm(room!, cont!, activeShelf.id)}>{design === "bauhaus" ? "C" : "🎨"}</button>
        <button class="card-action-btn danger" title="Delete Box" onclick={() => deleteShelf(activeShelf)}>{design === "bauhaus" ? "D" : "🗑️"}</button>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet directChemicalActions(ch: Chemical, opts: { containerId: string; canEdit: boolean })}
  {@const barcode = (ch.barcode ?? "").trim()}
  <div class="row-actions">
    {#if barcode !== ""}
      <button class="btn-inline" title="Print label" aria-label="Print label" onclick={() => openStockLabelModal({ name: ch.name, barcode, type: ch.type ?? undefined, locationText: `${room?.name ?? ""} / ${cont?.name ?? ""}`, position: effectivePosition(ch) ?? null, lotCode: ch.batchInfo?.lotCode ?? null, expiresAt: ch.batchInfo?.expiresAt ?? null })}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5v14"/><path d="M8 5v14"/><path d="M12 5v14"/><path d="M16 5v14"/><path d="M20 5v14"/></svg></button>
    {/if}
    {#if opts.canEdit && !isReader && room !== undefined && cont !== undefined}
      <button class="btn-inline" title="Edit" aria-label={`Edit ${ch.name}`} onclick={() => openChemicalForm(room, cont, { editChemId: ch.id })}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
    {/if}
    {#if !isReader}
      <button class="btn-inline danger" title="Delete" aria-label={`Delete ${ch.name}`} onclick={() => deleteDirectChemical(opts.containerId, ch)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    {/if}
  </div>
{/snippet}

{#snippet shelfChemicalActions(ch: Chemical, shelfId: string)}
  {@const barcode = (ch.barcode ?? "").trim()}
  <div class="row-actions">
    {#if barcode !== ""}
      <button class="btn-inline" title="Print label" aria-label="Print label" onclick={() => openStockLabelModal({ name: ch.name, barcode, type: ch.type ?? undefined, locationText: `${room?.name ?? ""} / ${cont?.name ?? ""}`, position: effectivePosition(ch) ?? null, lotCode: ch.batchInfo?.lotCode ?? null, expiresAt: ch.batchInfo?.expiresAt ?? null })}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5v14"/><path d="M8 5v14"/><path d="M12 5v14"/><path d="M16 5v14"/><path d="M20 5v14"/></svg></button>
    {/if}
    <button class="btn-inline" title="Edit" aria-label={`Edit ${ch.name}`} onclick={() => openChemicalForm(room, cont, { editChemId: ch.id })}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
    {#if !isReader}
      <button class="btn-inline danger" title="Delete" aria-label={`Delete ${ch.name}`} onclick={() => deleteChemical(shelfId, ch)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    {/if}
  </div>
{/snippet}

{#if cont !== undefined && room !== undefined}
  {#if catalogColumnPreferences.loading && !catalogColumnPreferences.confirmed}
    <div class="catalog-column-sync" role="status">Loading your saved room columns… The existing columns are shown until loading finishes.</div>
  {:else if catalogColumnPreferences.loadError !== ""}
    <div class="catalog-column-sync warning" role="alert">
      <span>
        {catalogColumnPreferences.loadError}
        {catalogColumnPreferences.confirmed ? "Showing your last loaded selections." : "Showing the existing room columns, not confirmed account settings."}
      </span>
      <button type="button" class="btn-inline" onclick={retryColumnPreferences}>Try again</button>
    </div>
  {/if}
  {#if route.view !== "detail" && (room.chemicals?.length ?? 0) > 0}
    {@const roomDirectChems = sortChems((room.chemicals ?? []).filter((c) => q === "" || chemMatchesQuery(c, q)), posMap)}
    <div class="room-chemical-list" id="room-direct-chemicals" style="margin-bottom:1rem;">
      <div class="shelf-header" style="cursor:default;">
        <div class="shelf-info">
          <span class="shelf-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}🏠{/if}</span>
          <span class="shelf-name">Directly in this room</span>
          <span class="shelf-count">{roomDirectChems.length} chemicals</span>
        </div>
      </div>
      <div class="shelf-body">
        {#if roomDirectChems.length > 0}
          <ChemicalTable
            tableId="detail-room-direct-chemicals-table"
            items={roomDirectChems}
            columns={activeColumns}
            legacy={!preferencesConfirmed}
            query={q}
            posMap={posMap}
            onAdjust={(chem, delta) => void adjustDirectQty("", chem.id, delta)}
          >
            {#snippet actions(ch)}
              {@render directChemicalActions(ch, { containerId: "", canEdit: true })}
            {/snippet}
          </ChemicalTable>
        {:else}
          <div class="shelf-empty">No results</div>
        {/if}
      </div>
    </div>
  {/if}
  {#if (cont.chemicals?.length ?? 0) > 0}
    {@const contDirectChems = sortChems((cont.chemicals ?? []).filter((c) => q === "" || chemMatchesQuery(c, q)), posMap)}
    <div class="room-chemical-list" id="container-direct-chemicals" style="margin-bottom:1rem;">
      <div class="shelf-header" style="cursor:default;">
        <div class="shelf-info">
          <span class="shelf-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}📦{/if}</span>
          <span class="shelf-name">Directly in {design === "bauhaus" ? stripEmoji(cont.name) : cont.name}</span>
          <span class="shelf-count">{contDirectChems.length} chemicals</span>
        </div>
      </div>
      <div class="shelf-body">
        {#if contDirectChems.length > 0}
          <ChemicalTable
            tableId="container-direct-chemicals-table"
            items={contDirectChems}
            columns={activeColumns}
            legacy={!preferencesConfirmed}
            query={q}
            posMap={posMap}
            onAdjust={(chem, delta) => void adjustDirectQty(cont.id, chem.id, delta)}
          >
            {#snippet actions(ch)}
              {@render directChemicalActions(ch, { containerId: cont.id, canEdit: true })}
            {/snippet}
          </ChemicalTable>
        {:else}
          <div class="shelf-empty">No results</div>
        {/if}
      </div>
    </div>
  {/if}
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
          <div class="room-chemical-list room-chemical-list--nested">
            <div class="room-chemical-table-wrap">
              <ChemicalTable
                tableId="deepfreezer-search-chemicals-table"
                items={sortChems(matching.map((m) => m.chem), posMap)}
                columns={activeColumns}
                layout="deepfreezer-search"
                legacy={!preferencesConfirmed}
                query={q}
                posMap={posMap}
                locationText={(chem) => {
                  const match = matching.find((entry) => entry.chem.id === chem.id);
                  return match === undefined ? "—" : matchingLocation(match);
                }}
                onOpenLocation={(chem) => {
                  const match = matching.find((entry) => entry.chem.id === chem.id);
                  if (match !== undefined) openMatchingBox(match);
                }}
                onAdjust={(chem, delta) => {
                  const match = matching.find((entry) => entry.chem.id === chem.id);
                  if (match !== undefined) void adjustQty(match.shelfId, chem.id, delta);
                }}
              >
                {#snippet actions(ch)}
                  {@const match = matching.find((entry) => entry.chem.id === ch.id)}
                  {#if match !== undefined}
                    {@render shelfChemicalActions(ch, match.shelfId)}
                  {/if}
                {/snippet}
              </ChemicalTable>
            </div>
          </div>
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
              <div class="deepfreezer-rack-actions">
                <button id="btn-rack-grid-settings" class="btn-secondary" type="button" onclick={() => openDeepFreezerGridSettings(cont)}>Grid settings</button>
                <button id="btn-add-rack" class="btn-primary" style="font-size: 0.8rem; padding: 0.4rem 0.8rem; display: inline-flex; align-items: center; gap: 0.25rem; margin: 0;" onclick={() => openAddDeepFreezerRackForm(cont)}>{design === "bauhaus" ? "+ Add Rack" : "➕ Add Rack"}</button>
              </div>
            {/if}
          </div>
        </div>
        <div class="deepfreezer-rack-grid-scroll">
          <div class="deepfreezer-grid-8x4" style={`--rack-columns: ${rackGrid.columns}; min-width: ${Math.max(320, rackGrid.columns * 112)}px;`}>
            {#each rackSlotIndexes as i (i)}
              {@const rackAtSlot = rackNameAtSlot(i)}
              {#if rackAtSlot !== undefined && rackKeys.includes(rackAtSlot)}
                {@const boxesInRack = shelvesForRack(rackAtSlot)}
                {@const boxesCount = boxesInRack.length}
                {@const totalItems = boxesInRack.reduce((acc, sh) => acc + (sh.chemicals ?? []).length, 0)}
                <div
                  class="deepfreezer-grid-cell"
                  class:drag-over={dragOverSlot === i}
                  data-slot={i}
                  role="group"
                  aria-label={`Slot ${i + 1}`}
                  ondragover={(event) => onRackDragOver(event, i)}
                  ondragleave={() => onRackDragLeave(i)}
                  ondrop={(event) => void onRackDrop(event, i)}
                >
                  <div
                    class="deepfreezer-card rack-card"
                    data-rack-name={rackAtSlot}
                    draggable={!isReader}
                    role="group"
                    aria-label={`Rack ${rackAtSlot}`}
                    ondragstart={(event) => onRackDragStart(event, rackAtSlot)}
                    ondragend={onRackDragEnd}
                  >
                    <button
                      class="rack-card-open"
                      type="button"
                      title={`Open Rack ${rackAtSlot} · Ctrl+Arrow keys to relocate`}
                      aria-label={`Open Rack ${rackAtSlot}. Ctrl+Arrow keys relocate.`}
                      onclick={() => selectRack(rackAtSlot!)}
                      onkeydown={(event) => onRackKeydown(event, rackAtSlot)}
                    >
                      <span class="deepfreezer-card-icon">{#if design === "bauhaus"}<span class="glyph glyph-box" aria-hidden="true"></span>{:else}🗄️{/if}</span>
                      <span class="deepfreezer-card-title">Rack {design === "bauhaus" ? stripEmoji(rackAtSlot) : rackAtSlot}</span>
                      <span class="deepfreezer-card-subtitle">{boxesCount === 0 ? "No boxes yet" : `${boxesCount} Boxes (${totalItems} samples)`}</span>
                    </button>
                  </div>
                </div>
              {:else}
                <div
                  class="deepfreezer-grid-cell"
                  class:drag-over={dragOverSlot === i}
                  data-slot={i}
                  role="group"
                  aria-label={`Slot ${i + 1}`}
                  ondragover={(event) => onRackDragOver(event, i)}
                  ondragleave={() => onRackDragLeave(i)}
                  ondrop={(event) => void onRackDrop(event, i)}
                >
                  <div class="deepfreezer-grid-empty-slot">Slot {i + 1}</div>
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {:else if selectedBox === null}
        <div class="deepfreezer-nav">
          <div class="deepfreezer-nav-item" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div>
                <span class="deepfreezer-nav-link" onclick={() => resetSelection()}>{#if design !== "bauhaus"}❄️ {/if}Deep Freezer Explorer</span>
              <span class="deepfreezer-nav-separator">›</span>
              <span class="deepfreezer-nav-text">Rack {design === "bauhaus" ? stripEmoji(selectedRack) : selectedRack}</span>
              <button class="deepfreezer-nav-btn" onclick={() => resetSelection()}>Change Rack</button>
              <span class="deepfreezer-nav-separator">/</span>
              <span class="deepfreezer-nav-text" style="color: var(--text-muted);">Select a Shelf</span>
            </div>
            {#if !isReader}
              <div class="deepfreezer-rack-actions">
                <button id="btn-rack-shelf-settings" class="btn-secondary" type="button" onclick={() => openDeepFreezerShelfSettings(cont)}>Shelf settings ({rackShelfCount})</button>
                <button id="btn-add-box" class="btn-primary" style="font-size: 0.8rem; padding: 0.4rem 0.8rem; display: inline-flex; align-items: center; gap: 0.25rem; margin: 0;" onclick={() => openAddDeepFreezerBoxForm(cont, selectedRack!)}>{design === "bauhaus" ? "+ Add Box" : "➕ Add Box"}</button>
              </div>
            {/if}
          </div>
        </div>
        <div class="deepfreezer-boxes-column deepfreezer-shelf-list">
          {#if selectedRackBoxes.length === 0}
            <div class="shelf-empty">No boxes in this rack yet. Add one, or drag a legacy box into a free shelf.</div>
          {/if}
          {#each rackShelfIndexes as index (index)}
            {@const boxes = boxesAtShelf(index)}
            <div
              class="deepfreezer-shelf-position"
              class:drag-over={dragOverShelfIndex === index}
              data-shelf-index={index}
              role="group"
              aria-label={`Shelf position ${index}${boxes.length === 0 ? ", available" : ", occupied"}`}
              ondragover={(event) => onBoxDragOver(event, index)}
              ondragleave={() => onBoxDragLeave(index)}
              ondrop={(event) => void onBoxDrop(event, index)}
            >
              <div class="deepfreezer-shelf-position-label">Shelf {index}</div>
              <div class="deepfreezer-shelf-position-content">
                {#if boxes.length === 0}
                  <div class="deepfreezer-shelf-available">Available</div>
                {:else}
                  {#each boxes as entry (entry.shelf.id)}
                    {@render rackBoxCard(entry)}
                  {/each}
                {/if}
              </div>
            </div>
          {/each}
        </div>
        {#if legacyRackBoxes.length > 0}
          <section class="deepfreezer-legacy-boxes deepfreezer-boxes-column" aria-label="Legacy boxes without a current shelf position">
            <h3 class="detail-section-title">Legacy boxes without a current shelf</h3>
            <p class="form-hint">Custom names are not renumbered. Drag a box into any free shelf above.</p>
            {#each legacyRackBoxes as entry (entry.shelf.id)}
              <div class="deepfreezer-legacy-item">
                <div class="deepfreezer-legacy-note">{entry.shelfIndex === null ? "No shelf assigned" : `Stored shelf ${entry.shelfIndex} is outside current settings`}</div>
                {@render rackBoxCard(entry)}
              </div>
            {/each}
          </section>
        {/if}
      {:else}
        {@const activeShelf = selectedBoxShelfId !== null ? shelves.find((shelf) => shelf.id === selectedBoxShelfId) : racks[selectedRack]?.[selectedBox]}
        {#if activeShelf !== undefined}
          <div class="deepfreezer-explorer">
            <div class="deepfreezer-nav">
              <div class="deepfreezer-nav-item">
<span class="deepfreezer-nav-link" onclick={() => resetSelection()}>{#if design !== "bauhaus"}❄️ {/if}Deep Freezer Explorer</span>
                <span class="deepfreezer-nav-separator">›</span>
                <span class="deepfreezer-nav-link" onclick={() => { selectedBox = null; navigateTo("detail", { roomId, containerId, rack: selectedRack }); }}>Rack {design === "bauhaus" ? stripEmoji(selectedRack) : selectedRack}</span>
                <button class="deepfreezer-nav-btn" onclick={() => resetSelection()}>Change Rack</button>
                <span class="deepfreezer-nav-separator">›</span>
                <span class="deepfreezer-nav-text">Box {design === "bauhaus" ? stripEmoji(selectedBox) : selectedBox}</span>
                <button class="deepfreezer-nav-btn" onclick={() => { selectedBox = null; navigateTo("detail", { roomId, containerId, rack: selectedRack }); }}>Change Box</button>
              </div>
            </div>
            <div class="shelf-section open" data-sid={activeShelf.id}>
              <div class="shelf-header" style="cursor: default;">
                <div class="shelf-info">
                  <span class="shelf-icon" style={`color: ${activeShelf.color ?? "#3b82f6"};`}>{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}🧊{/if}</span>
                  <span class="shelf-name">Rack {design === "bauhaus" ? stripEmoji(selectedRack) : selectedRack} / Box {design === "bauhaus" ? stripEmoji(selectedBox) : selectedBox}</span>
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
                  <div class="room-chemical-list room-chemical-list--nested">
                    <div class="room-chemical-table-wrap">
                      <ChemicalTable
                        tableId="deepfreezer-box-chemicals-table"
                        items={sortChems(activeShelf.chemicals ?? [], posMap)}
                        columns={activeColumns}
                        legacy={!preferencesConfirmed}
                        query={q}
                        posMap={posMap}
                        fridgePositions={true}
                        onAdjust={(chem, delta) => void adjustQty(activeShelf.id, chem.id, delta)}
                      >
                        {#snippet actions(ch)}
                          {@render shelfChemicalActions(ch, activeShelf.id)}
                        {/snippet}
                      </ChemicalTable>
                    </div>
                  </div>
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
      {#each shelves.filter((s) => !s.parentShelfId && s.type !== "box") as sh (sh.id)}
        {@const chems = sortChems((sh.chemicals ?? []).filter((c) => q === "" || chemMatchesQuery(c, q)), posMap)}
        {@const boxes = shelves.filter((s) => s.parentShelfId === sh.id && (s.type ?? "box") === "box")}
        {@const isOpen = openShelves.has(sh.id) || q !== ""}
        {@const isFreezer = cont.type === "freezer"}
        {@const isFridgeOrFreezer = cont.type === "fridge" || isFreezer}
        {@const icon = isFridgeOrFreezer ? (sh.name.startsWith("Door") ? "🚪" : isFreezer ? "🧊" : "❄️") : "📁"}
        {@const typeChip = shelfTypeChip(sh.type)}
        <div class={`shelf-section shelf-section--chemical-list ${isOpen ? "open" : ""}`} data-sid={sh.id}>
          <div class="shelf-header" onclick={() => toggleShelf(sh.id)}>
            <div class="shelf-info">
              <span class="shelf-icon">{#if design === "bauhaus"}<span class="glyph glyph-square-ink" aria-hidden="true"></span>{:else}{icon}{/if}</span>
              {#if typeChip !== null}<span class="chem-pos">{typeChip}</span>{/if}
              <span class="shelf-name">{design === "bauhaus" ? stripEmoji(sh.name) : sh.name}</span>
              <span class="shelf-count">{chems.length} chemicals</span>
            </div>
            <div class="shelf-actions">
              {#if canManage}
                <button class="btn-inline" title="Rename Shelf" onclick={(e) => { e.stopPropagation(); openRenameShelfForm(room, cont, sh.id, sh.name); }}>{design === "bauhaus" ? "R" : "✏️"}</button>
                {#if canHostBox(sh)}
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
                    <div class="deepfreezer-card-title" style="font-size: 0.85rem;">{design === "bauhaus" ? stripEmoji(box.name) : box.name}</div>
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
                  <div class="box-chemicals-section room-chemical-list room-chemical-list--nested" style="margin-bottom: 1.25rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.5rem;">
                      <h4 style="margin: 0; color: var(--text-primary); font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem;">
                        <span style={`color: ${box.color ?? "#3b82f6"};`}>{#if design === "bauhaus"}<span class="glyph glyph-box" aria-hidden="true"></span>{:else}📦{/if}</span>
                        {#if shelfTypeChip(box.type) !== null}<span class="chem-pos">{shelfTypeChip(box.type)}</span>{/if}
                        {design === "bauhaus" ? stripEmoji(box.name) : box.name} Chemicals
                      </h4>
                      {#if canManage}
                        <button class="btn-primary" style="font-size: 0.75rem; padding: 0.35rem 0.7rem; margin: 0; height: auto; display: inline-flex; align-items: center; gap: 0.25rem;" onclick={() => openChemicalRadioPrompt(room, cont, box.id)}>{design === "bauhaus" ? "+ Add Chemical" : "➕ Add Chemical"}</button>
                      {/if}
                    </div>
                    {#if boxChems.length > 0}
                      <div class="room-chemical-table-wrap">
                        <ChemicalTable
                          tableId={"nested-box-chemicals-table-" + box.id}
                          items={boxChems}
                          columns={activeColumns}
                          legacy={!preferencesConfirmed}
                          query={q}
                          posMap={posMap}
                          fridgePositions={true}
                          onAdjust={(chem, delta) => void adjustQty(box.id, chem.id, delta)}
                        >
                          {#snippet actions(ch)}
                            {@render shelfChemicalActions(ch, box.id)}
                          {/snippet}
                        </ChemicalTable>
                      </div>
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
              <div class="room-chemical-list room-chemical-list--nested">
                <div class="room-chemical-table-wrap">
                  <ChemicalTable
                    tableId={"shelf-chemicals-table-" + sh.id}
                    items={chems}
                    columns={activeColumns}
                    legacy={!preferencesConfirmed}
                    query={q}
                    posMap={posMap}
                    fridgePositions={isFridgeOrFreezer}
                    onAdjust={(chem, delta) => void adjustQty(sh.id, chem.id, delta)}
                  >
                    {#snippet actions(ch)}
                      {@render shelfChemicalActions(ch, sh.id)}
                    {/snippet}
                  </ChemicalTable>
                </div>
              </div>
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
