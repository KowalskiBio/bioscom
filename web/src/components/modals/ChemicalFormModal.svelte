<script lang="ts">
  import type { Container, Room } from "@bioscom/shared";
  import { MATERIAL_TYPES } from "@bioscom/shared";
  import type { MaterialFieldDef, MaterialTypeDef } from "@bioscom/shared";
  import { renderFormulaHtml, normalizeFormula } from "../../lib/inventoryUtils";
  import { theme } from "../../lib/theme.svelte";
  import { untrack } from "svelte";

  const design = $derived(theme.design);

  let {
    form,
    container,
    rooms,
  }: {
    form: {
      shelfId: string;
      cabinetShelf: string;
      roomId?: string;
      contId?: string;
      name: string;
      formula: string;
      quantity: number | null;
      unit: string;
      concentration: number | null;
      concUnit: string;
      cas: string;
      note: string;
      customPosition: string;
      type: string;
      attributes: Record<string, string | number | boolean | null>;
      safetyNotes?: string[];
      product: {
        manufacturer: string;
        catalogNumber: string;
      };
      batch: {
        lotCode: string;
        originType: string;
        expiresAt: string;
        receivedAt: string;
        preparedBy: string;
      };
    };
    container?: Container;
    rooms?: Room[];
  } = $props();

  const units = ["pcs", "g", "kg", "ml", "L", "μL", "mg"];
  const concUnits = ["", "mol/L", "mmol/L", "mol", "mmol", "%", "g/L", "mg/L", "μg/L"];
  const batchOriginOptions = [
    { value: "purchased", label: "Purchased" },
    { value: "prepared", label: "Prepared" },
    { value: "derived", label: "Derived" },
    { value: "unknown", label: "Unknown" },
  ];

  const contextRooms = $derived([...(rooms ?? [])].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")));
  let roomId = $state("");
  let contId = $state("");

  let typeKey = $state<string>(untrack(() => form.type ?? "chemical"));
  let formulaText = $state<string>(untrack(() => form.formula));
  $effect(() => {
    form.type = typeKey;
  });
  $effect(() => {
    form.formula = formulaText;
  });

  function onTypeChange(next: string): void {
    typeKey = next;
    if (next !== "chemical") {
      form.cas = "";
      formulaText = "";
    }
  }
  const selectedRoom = $derived(contextRooms.find((room) => room.id === roomId));
  const selectedRoomContainers = $derived(selectedRoom?.containers ?? []);
  const selectedContainerFromPicks = $derived(selectedRoomContainers.find((pick) => pick.id === contId));
  const activeContainer = $derived(container ?? selectedContainerFromPicks);
  const containerShelves = $derived(activeContainer?.shelves ?? []);

  const parentShelves = $derived(
    containerShelves.filter((s) => !s.parentShelfId && s.type !== "box"),
  );
  const isCabinet = $derived(activeContainer?.type === "cabinet");

  const subContainerLabels: Record<string, string> = {
    shelf: "Shelf",
    door_shelf: "Door shelf",
    crate: "Crate",
    box: "Box",
  };

  function subContainerTypeLabel(type: string | undefined): string {
    return subContainerLabels[type ?? "shelf"] ?? "Shelf";
  }

  function defaultPlacementFor(next: Container | undefined): string {
    if (next === undefined) {
      return "";
    }
    if (next.type === "deepfreezer") {
      return (next.shelves ?? [])[0]?.id ?? "";
    }
    if (next.type === "cabinet") {
      return "";
    }
    return (next.shelves ?? []).find((shelf) => !shelf.parentShelfId && shelf.type !== "box")?.id ?? next.id;
  }
  const isAlphabetical = $derived(
    activeContainer?.cabinetMethod === "alphabetical" ||
      (activeContainer?.cabinetMethod === "custom" && activeContainer?.customRangeType === "alphabetical"),
  );
  const hasRangeShelves = $derived(containerShelves.some((s) => s.isRangeShelf === true));
  const canAuto = $derived(isAlphabetical || hasRangeShelves);
  const formulaPreview = $derived(renderFormulaHtml(normalizeFormula(formulaText)));
  const materialDef = $derived(
    MATERIAL_TYPES.find((type) => type.key === typeKey) as MaterialTypeDef | undefined,
  );
  const descriptorFields = $derived.by<MaterialFieldDef[]>(() => {
    const fields = materialDef?.fields ?? [];
    if (typeKey === "chemical") {
      return fields.filter((field) => field.key !== "cas_number" && field.key !== "molecular_formula");
    }
    return [...fields];
  });

  function attrValue(key: string): string {
    const value = form.attributes[key];
    return value === undefined || value === null ? "" : String(value);
  }

  function setAttrText(key: string, value: string): void {
    form.attributes[key] = value;
  }

  function setAttrChecked(key: string, checked: boolean): void {
    form.attributes[key] = checked;
  }

  function normalizeTag(raw: string): string {
    return raw.trim().replace(/^#+/, "").trim();
  }

  function parseSafetyTags(value: string): string[] {
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const part of value.split(/[\s,]+/)) {
      const tag = normalizeTag(part);
      if (tag === "") {
        continue;
      }
      const key = tag.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      tags.push(tag);
    }
    return tags;
  }

  const initialSafetyTags = untrack(() =>
    form.safetyNotes !== undefined ? [...form.safetyNotes] : parseSafetyTags(attrValue("safety_notes")),
  );
  let safetyTags = $state<string[]>(initialSafetyTags);
  let tagDraft = $state("");

  function writeSafetyTags(next: string[]): void {
    safetyTags = next;
    form.safetyNotes = [...next];
  }

  function commitTag(raw: string): void {
    const tag = normalizeTag(raw);
    if (tag === "" || safetyTags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      return;
    }
    writeSafetyTags([...safetyTags, tag]);
  }

  function removeTag(index: number): void {
    if (index < 0) {
      return;
    }
    writeSafetyTags(safetyTags.filter((_, i) => i !== index));
  }

  function onTagInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const raw = input.value;
    if (raw.includes(",")) {
      const parts = raw.split(",");
      const remainder = parts.pop() ?? "";
      for (const part of parts) {
        commitTag(part);
      }
      tagDraft = remainder;
      input.value = remainder;
    } else {
      tagDraft = raw;
    }
  }

  function onTagKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      // The modal window handler would otherwise confirm the form.
      event.preventDefault();
      event.stopPropagation();
      commitTag(tagDraft);
      tagDraft = "";
      return;
    }
    if (event.key === ",") {
      event.preventDefault();
      commitTag(tagDraft);
      tagDraft = "";
      return;
    }
    if (event.key === "Backspace" && tagDraft === "") {
      event.preventDefault();
      removeTag(safetyTags.length - 1);
    }
  }

  function onTagBlur(): void {
    commitTag(tagDraft);
    tagDraft = "";
  }

  function onRoomChange(): void {
    form.roomId = roomId;
    form.contId = "";
    contId = "";
    form.shelfId = "";
    form.cabinetShelf = "auto";
  }

  function onContainerChange(): void {
    form.contId = contId;
    const room = contextRooms.find((r) => r.id === roomId);
    const next = (room?.containers ?? []).find((c) => c.id === contId);
    const shelves = next?.shelves ?? [];
    const canAutoShelf =
      shelves.some((s) => s.isRangeShelf === true) ||
      next?.cabinetMethod === "alphabetical" ||
      (next?.cabinetMethod === "custom" && next.customRangeType === "alphabetical");
    form.shelfId = defaultPlacementFor(next);
    form.cabinetShelf = next?.type === "cabinet" && !canAutoShelf ? (shelves[0]?.id ?? "") : "auto";
  }
</script>

<div class="form-cols form-cols-3">
{#if container === undefined}
  {#if contextRooms.length === 0}
    <div class="form-group span-2">
      <p class="form-hint" id="f-no-rooms">Create a room and a container first to add chemicals.</p>
    </div>
  {:else}
    <div class="form-group">
      <label class="form-label" for="f-room">Room *</label>
      <select class="form-select" id="f-room" bind:value={roomId} onchange={onRoomChange}>
        <option value="">— Select room —</option>
        {#each contextRooms as room (room.id)}
          <option value={room.id}>{room.name}</option>
        {/each}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label" for="f-container">Container</label>
      <select class="form-select" id="f-container" bind:value={contId} disabled={!roomId} onchange={onContainerChange}>
        {#if roomId && selectedRoomContainers.length === 0}
          <option value="">no containers yet — creating inside the room</option>
        {:else}
          <option value="">— directly in the room —</option>
          {#each selectedRoomContainers as pick (pick.id)}
            <option value={pick.id}>{pick.name}</option>
          {/each}
        {/if}
      </select>
    </div>
    <div class="form-group span-2">
      <p class="form-hint" id="f-placement-hint">Pick a room alone to store the chemical directly in the room, or choose an already-created container. To use a new container, create it first in the room.</p>
    </div>
  {/if}
{/if}

{#if container !== undefined || contextRooms.length > 0}
<div class="form-group">
  <label class="form-label" for="f-type">Item type *</label>
  <select class="form-select" id="f-type" value={typeKey} onchange={(e) => onTypeChange((e.target as HTMLSelectElement).value)}>
    {#each MATERIAL_TYPES as type (type.key)}
      <option value={type.key}>{type.label}</option>
    {/each}
  </select>
</div>

{#if activeContainer}
{#if activeContainer.type === "deepfreezer"}
  <div class="form-group span-2">
    <label class="form-label">Box *</label>
    <select class="form-select" id="f-shelf" bind:value={form.shelfId}>
      {#each containerShelves as shelf (shelf.id)}
        <option value={shelf.id}>{shelf.name}</option>
      {/each}
    </select>
  </div>
{:else if isCabinet}
  <div class="form-group span-2">
    <label class="form-label">Shelf placement *</label>
    <select class="form-select" id="f-cab-shelf" style="cursor: pointer;" bind:value={form.cabinetShelf}>
      {#if canAuto}
        <option value="auto">Auto – alphabetically by first letter</option>
      {/if}
      {#each containerShelves as shelf (shelf.id)}
        <option value={shelf.id}>Manual: {shelf.name}</option>
      {/each}
    </select>
    <div class="form-hint">{canAuto ? "Auto places the chemical alphabetically in the shelf matching its first letter. Manual options let you select the shelf explicitly." : "Select the shelf explicitly for the chemical."}</div>
  </div>
{:else}
  <div class="form-group span-2">
    <label class="form-label" for="f-shelf">Placement *</label>
    <select class="form-select" id="f-shelf" bind:value={form.shelfId}>
      <option value={activeContainer.id}>Directly in {activeContainer.name} (no shelf)</option>
      {#each parentShelves as parentShelf (parentShelf.id)}
        {@const boxes = containerShelves.filter((s) => s.parentShelfId === parentShelf.id && (s.type ?? "box") === "box")}
        {#if boxes.length > 0}
          <optgroup label={`${subContainerTypeLabel(parentShelf.type)}: ${parentShelf.name}`}>
            <option value={parentShelf.id}>Directly in {subContainerTypeLabel(parentShelf.type)}: {parentShelf.name} (no box)</option>
            {#each boxes as box (box.id)}
              <option value={box.id}>Box: {box.name}</option>
            {/each}
          </optgroup>
        {:else}
          <option value={parentShelf.id}>{subContainerTypeLabel(parentShelf.type)}: {parentShelf.name}</option>
        {/if}
      {/each}
    </select>
  </div>
{/if}
{/if}

<div class="form-group"><label class="form-label">Chemical name *</label><input class="form-input" id="f-cn2" placeholder="e.g. Hydrochloric acid" bind:value={form.name}></div>
{#if typeKey === "chemical"}
  <div class="form-group">
    <label class="form-label">Formula</label>
    <input class="form-input" id="f-cf" placeholder="e.g. H2SO4, Na2CO3" bind:value={formulaText}>
    {#if formulaText.trim() !== ""}
      <div id="f-cf-preview" style="margin-top:0.4rem;padding:0.4rem 0.6rem;font-size:1.1rem;color:var(--text-secondary);min-height:1.5em;letter-spacing:0.02em;font-style:italic;"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html formulaPreview}</div>
    {/if}
  </div>
  <div class="form-group"><label class="form-label">CAS number</label><input class="form-input" id="f-cc" placeholder="e.g. 7647-01-0" bind:value={form.cas}></div>
{/if}

{#if descriptorFields.length > 0}
  {#each descriptorFields as field (field.key)}
    <div class="form-group" class:span-2={field.dataType === "text" || field.dataType === "sequence"}>
      {#if field.dataType === "boolean"}
        <label class="form-label" style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
          <input type="checkbox" id={`f-attr-${field.key}`} checked={form.attributes[field.key] === true} onchange={(e) => setAttrChecked(field.key, e.currentTarget.checked)}>
          {field.label}{field.required ? " *" : ""}
        </label>
      {:else if field.dataType === "enum"}
        <label class="form-label" for={`f-attr-${field.key}`}>{field.label}{field.required ? " *" : ""}</label>
        <select class="form-select" id={`f-attr-${field.key}`} value={attrValue(field.key)} onchange={(e) => setAttrText(field.key, e.currentTarget.value)}>
          <option value="">—</option>
          {#each field.options ?? [] as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
      {:else if field.key === "safety_notes" && typeKey === "chemical"}
        <label class="form-label" for="f-attr-safety_notes">
          {field.label}{field.required ? " *" : ""}
          <span class="form-hint" style="display:inline;margin:0 0 0 0.4rem;font-weight:400;text-transform:none;letter-spacing:normal;">(press Enter to add)</span>
        </label>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.35rem;">
          {#each safetyTags as tag, index (tag)}
            <span style="display:inline-flex;align-items:center;gap:0.1rem;border:1px solid var(--border-light);border-radius:999px;font-size:.72rem;padding:.1rem .45rem;background:transparent;">
              {tag}
              <button type="button" class="btn-inline" style="padding:0 .12rem;line-height:1;" aria-label={`Remove ${tag}`} onclick={() => removeTag(index)}>×</button>
            </span>
          {/each}
          <input
            class="form-input"
            id="f-attr-safety_notes"
            placeholder="add tag + Enter"
            style="flex:1 1 9rem;width:auto;min-width:9rem;padding:0.4rem 0.6rem;"
            value={tagDraft}
            oninput={onTagInput}
            onkeydown={onTagKeydown}
            onblur={onTagBlur}
          >
        </div>
      {:else if field.dataType === "text"}
        <label class="form-label" for={`f-attr-${field.key}`}>{field.label}{field.required ? " *" : ""}</label>
        <textarea class="form-textarea" id={`f-attr-${field.key}`} rows="3" value={attrValue(field.key)} oninput={(e) => setAttrText(field.key, e.currentTarget.value)}></textarea>
      {:else if field.dataType === "sequence"}
        <label class="form-label" for={`f-attr-${field.key}`}>{field.label}{field.required ? " *" : ""}</label>
        <textarea class="form-textarea" id={`f-attr-${field.key}`} rows="2" style="font-family:'IBM Plex Mono',monospace; text-transform:uppercase;" value={attrValue(field.key)} oninput={(e) => setAttrText(field.key, e.currentTarget.value)}></textarea>
        <div class="form-hint">DNA/IUPAC nucleotide letters only</div>
      {:else if field.dataType === "date"}
        <label class="form-label" for={`f-attr-${field.key}`}>{field.label}{field.required ? " *" : ""}</label>
        <input class="form-input" type="date" id={`f-attr-${field.key}`} value={attrValue(field.key)} oninput={(e) => setAttrText(field.key, e.currentTarget.value)}>
      {:else if field.dataType === "number"}
        <label class="form-label" for={`f-attr-${field.key}`}>{field.label}{field.required ? " *" : ""}{field.unit ? ` (${field.unit})` : ""}</label>
        <input class="form-input" type="number" step="any" id={`f-attr-${field.key}`} value={attrValue(field.key)} oninput={(e) => setAttrText(field.key, e.currentTarget.value)}>
      {:else}
        <label class="form-label" for={`f-attr-${field.key}`}>{field.label}{field.required ? " *" : ""}</label>
        <input class="form-input" id={`f-attr-${field.key}`} value={attrValue(field.key)} oninput={(e) => setAttrText(field.key, e.currentTarget.value)}>
      {/if}
    </div>
  {/each}
{/if}

<div class="form-group"><label class="form-label">Custom position code</label><input class="form-input" id="f-cpos" placeholder="e.g. M4-custom (leave blank for auto)" bind:value={form.customPosition}></div>
<div class="form-row">
  <div class="form-group"><label class="form-label">Quantity</label><input class="form-input" id="f-cq" type="number" step="any" min="0" bind:value={form.quantity}></div>
  <div class="form-group"><label class="form-label">Unit</label><select class="form-select" id="f-cu" bind:value={form.unit}>{#each units as unit (unit)}<option value={unit}>{unit}</option>{/each}</select></div>
</div>
<div class="form-row">
  <div class="form-group"><label class="form-label">Concentration</label><input class="form-input" id="f-cconc" type="number" step="any" min="0" placeholder="e.g. 1.5" bind:value={form.concentration}></div>
  <div class="form-group"><label class="form-label">Conc. Unit</label><select class="form-select" id="f-ccu" bind:value={form.concUnit}>{#each concUnits as unit (unit)}<option value={unit}>{unit === "" ? "—" : unit}</option>{/each}</select></div>
</div>

<div class="form-group" style="display:flex;flex-direction:column;gap:0.35rem;">
  <span class="form-label" style="margin-bottom:0;">Commercial product (optional)</span>
  <div class="form-group" style="margin-bottom:0;"><label class="form-label" for="f-p-manufacturer" style="margin-bottom:0.25rem;">Manufacturer / supplier</label><input class="form-input" id="f-p-manufacturer" placeholder="e.g. Sigma-Aldrich" bind:value={form.product.manufacturer}></div>
  <div class="form-group" style="margin-bottom:0;"><label class="form-label" for="f-p-catalog" style="margin-bottom:0.25rem;">Catalog number</label><input class="form-input" id="f-p-catalog" placeholder="e.g. A1234" bind:value={form.product.catalogNumber}></div>
</div>

<div class="form-group span-2">
  <span class="form-label" style="margin-bottom:0.25rem;">Batch / lot (optional)</span>
  <div class="form-cols form-cols-3" style="gap:0.35rem 0.85rem;">
    <div class="form-group" style="margin-bottom:0;"><label class="form-label" for="f-b-lot" style="margin-bottom:0.25rem;">Lot code</label><input class="form-input" id="f-b-lot" placeholder="e.g. LOT-2026-01" bind:value={form.batch.lotCode}></div>
    <div class="form-group" style="margin-bottom:0;"><label class="form-label" for="f-b-origin" style="margin-bottom:0.25rem;">Origin</label><select class="form-select" id="f-b-origin" bind:value={form.batch.originType}><option value="">—</option>{#each batchOriginOptions as option (option.value)}<option value={option.value}>{option.label}</option>{/each}</select></div>
    <div class="form-group" style="margin-bottom:0;"><label class="form-label" for="f-b-expiry" style="margin-bottom:0.25rem;">Expiry date</label><input class="form-input" type="date" id="f-b-expiry" bind:value={form.batch.expiresAt}></div>
    <div class="form-group" style="margin-bottom:0;"><label class="form-label" for="f-b-received" style="margin-bottom:0.25rem;">Received date</label><input class="form-input" type="date" id="f-b-received" bind:value={form.batch.receivedAt}></div>
    <div class="form-group" style="margin-bottom:0;"><label class="form-label" for="f-b-preparedby" style="margin-bottom:0.25rem;">Prepared by</label><input class="form-input" id="f-b-preparedby" placeholder="e.g. J. Novák" bind:value={form.batch.preparedBy}></div>
  </div>
</div>

<div class="form-group span-2"><label class="form-label">Note</label><textarea class="form-textarea" id="f-cno" placeholder="Optional note" style="min-height:3.25rem;" bind:value={form.note}></textarea></div>
{/if}
</div>
