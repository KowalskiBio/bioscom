<script lang="ts">
  import type { Container } from "@bioscom/shared";
  import { renderFormulaHtml, normalizeFormula } from "../../lib/inventoryUtils";
  import { theme } from "../../lib/theme.svelte";

  const design = $derived(theme.design);

  let {
    form,
    container,
  }: {
    form: {
      shelfId: string;
      cabinetShelf: string;
      name: string;
      formula: string;
      quantity: number | null;
      unit: string;
      concentration: number | null;
      concUnit: string;
      cas: string;
      note: string;
      customPosition: string;
    };
    container: Container;
  } = $props();

  const units = ["pcs", "g", "kg", "ml", "L", "μL", "mg"];
  const concUnits = ["", "mol/L", "mmol/L", "mol", "mmol", "%", "g/L", "mg/L", "μg/L"];

  const parentShelves = $derived((container.shelves ?? []).filter((s) => !s.parentShelfId));
  const isCabinet = $derived(container.type === "cabinet");
  const isCooling = $derived(
    container.type === "fridge" || container.type === "freezer" || container.type === "deepfreezer",
  );
  const isAlphabetical = $derived(
    container.cabinetMethod === "alphabetical" ||
      (container.cabinetMethod === "custom" && container.customRangeType === "alphabetical"),
  );
  const hasRangeShelves = $derived((container.shelves ?? []).some((s) => s.isRangeShelf === true));
  const canAuto = $derived(isAlphabetical || hasRangeShelves);
  const formulaPreview = $derived(renderFormulaHtml(normalizeFormula(form.formula)));
</script>

{#if isCooling}
  {#if container.type === "deepfreezer"}
    <div class="form-group">
      <label class="form-label">Box *</label>
      <select class="form-select" id="f-shelf" bind:value={form.shelfId}>
        {#each container.shelves ?? [] as shelf (shelf.id)}
          <option value={shelf.id}>{shelf.name}</option>
        {/each}
      </select>
    </div>
  {:else}
    <div class="form-group">
      <label class="form-label">Shelf / Box *</label>
      <select class="form-select" id="f-shelf" bind:value={form.shelfId}>
        {#each parentShelves as parentShelf (parentShelf.id)}
          {@const boxes = (container.shelves ?? []).filter((s) => s.parentShelfId === parentShelf.id)}
          {#if boxes.length > 0}
            <optgroup label={parentShelf.name}>
              <option value={parentShelf.id}>Directly on {parentShelf.name} (no box)</option>
              {#each boxes as box (box.id)}
                <option value={box.id}>{design === "bauhaus" ? "" : "📦 "}{box.name}</option>
              {/each}
            </optgroup>
          {:else}
            <option value={parentShelf.id}>{parentShelf.name}</option>
          {/if}
        {/each}
      </select>
    </div>
  {/if}
{:else if isCabinet}
  <div class="form-group">
    <label class="form-label">Shelf placement *</label>
    <select class="form-select" id="f-cab-shelf" style="cursor: pointer;" bind:value={form.cabinetShelf}>
      {#if canAuto}
        <option value="auto">Auto – alphabetically by first letter</option>
      {/if}
      {#each container.shelves ?? [] as shelf (shelf.id)}
        <option value={shelf.id}>Manual: {shelf.name}</option>
      {/each}
    </select>
    <div class="form-hint">{canAuto ? "Auto places the chemical alphabetically in the shelf matching its first letter. Manual options let you select the shelf explicitly." : "Select the shelf explicitly for the chemical."}</div>
  </div>
{/if}

<div class="form-group"><label class="form-label">Chemical name *</label><input class="form-input" id="f-cn2" placeholder="e.g. Hydrochloric acid" bind:value={form.name}></div>
<div class="form-group">
  <label class="form-label">Formula</label>
  <input class="form-input" id="f-cf" placeholder="e.g. H2SO4, Na2CO3" bind:value={form.formula}>
  <div id="f-cf-preview" style="margin-top:0.4rem;padding:0.4rem 0.6rem;font-size:1.1rem;color:var(--text-secondary);min-height:1.5em;letter-spacing:0.02em;font-style:italic;"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html formulaPreview}</div>
</div>
<div class="form-group"><label class="form-label">Custom position code</label><input class="form-input" id="f-cpos" placeholder="e.g. M4-custom (leave blank for auto)" bind:value={form.customPosition}></div>
<div class="form-row">
  <div class="form-group"><label class="form-label">Quantity</label><input class="form-input" id="f-cq" type="number" step="any" min="0" bind:value={form.quantity}></div>
  <div class="form-group"><label class="form-label">Unit</label><select class="form-select" id="f-cu" bind:value={form.unit}>{#each units as unit (unit)}<option value={unit}>{unit}</option>{/each}</select></div>
</div>
<div class="form-row">
  <div class="form-group"><label class="form-label">Concentration</label><input class="form-input" id="f-cconc" type="number" step="any" min="0" placeholder="e.g. 1.5" bind:value={form.concentration}></div>
  <div class="form-group"><label class="form-label">Conc. Unit</label><select class="form-select" id="f-ccu" bind:value={form.concUnit}>{#each concUnits as unit (unit)}<option value={unit}>{unit === "" ? "—" : unit}</option>{/each}</select></div>
</div>
<div class="form-group"><label class="form-label">CAS number</label><input class="form-input" id="f-cc" placeholder="e.g. 7647-01-0" bind:value={form.cas}></div>
<div class="form-group"><label class="form-label">Note</label><textarea class="form-textarea" id="f-cno" placeholder="Optional note" bind:value={form.note}></textarea></div>
