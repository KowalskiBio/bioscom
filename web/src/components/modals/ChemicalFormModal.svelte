<script lang="ts">
  import type { Container } from "@bioscom/shared";
  import { MATERIAL_TYPES } from "@bioscom/shared";
  import type { MaterialFieldDef, MaterialTypeDef } from "@bioscom/shared";
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
      type: string;
      attributes: Record<string, string | number | boolean | null>;
      product: {
        manufacturer: string;
        supplier: string;
        catalogNumber: string;
        productName: string;
        variant: string;
      };
      batch: {
        lotCode: string;
        originType: string;
        expiresAt: string;
        receivedAt: string;
        preparedBy: string;
      };
    };
    container: Container;
  } = $props();

  const units = ["pcs", "g", "kg", "ml", "L", "μL", "mg"];
  const concUnits = ["", "mol/L", "mmol/L", "mol", "mmol", "%", "g/L", "mg/L", "μg/L"];
  const batchOriginOptions = [
    { value: "purchased", label: "Purchased" },
    { value: "prepared", label: "Prepared" },
    { value: "derived", label: "Derived" },
    { value: "unknown", label: "Unknown" },
  ];

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
  const materialDef = $derived(
    MATERIAL_TYPES.find((type) => type.key === form.type) as MaterialTypeDef | undefined,
  );
  const descriptorFields = $derived.by<MaterialFieldDef[]>(() => {
    const fields = materialDef?.fields ?? [];
    if (form.type === "chemical") {
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

<div class="form-group">
  <label class="form-label" for="f-type">Item type *</label>
  <select class="form-select" id="f-type" bind:value={form.type}>
    {#each MATERIAL_TYPES as type (type.key)}
      <option value={type.key}>{type.label}</option>
    {/each}
  </select>
</div>

<div class="form-group"><label class="form-label">Chemical name *</label><input class="form-input" id="f-cn2" placeholder="e.g. Hydrochloric acid" bind:value={form.name}></div>
{#if form.type === "chemical"}
  <div class="form-group">
    <label class="form-label">Formula</label>
    <input class="form-input" id="f-cf" placeholder="e.g. H2SO4, Na2CO3" bind:value={form.formula}>
    <div id="f-cf-preview" style="margin-top:0.4rem;padding:0.4rem 0.6rem;font-size:1.1rem;color:var(--text-secondary);min-height:1.5em;letter-spacing:0.02em;font-style:italic;"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html formulaPreview}</div>
  </div>
{/if}

{#if descriptorFields.length > 0}
  {#each descriptorFields as field (field.key)}
    <div class="form-group">
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
{#if form.type === "chemical"}
  <div class="form-group"><label class="form-label">CAS number</label><input class="form-input" id="f-cc" placeholder="e.g. 7647-01-0" bind:value={form.cas}></div>
{/if}

<div class="form-group">
  <span class="form-label">Commercial product (optional)</span>
  <div class="form-row">
    <div class="form-group"><label class="form-label" for="f-p-manufacturer">Manufacturer</label><input class="form-input" id="f-p-manufacturer" placeholder="e.g. Sigma-Aldrich" bind:value={form.product.manufacturer}></div>
    <div class="form-group"><label class="form-label" for="f-p-supplier">Supplier</label><input class="form-input" id="f-p-supplier" placeholder="e.g. Thermo Fisher" bind:value={form.product.supplier}></div>
  </div>
  <div class="form-row">
    <div class="form-group"><label class="form-label" for="f-p-catalog">Catalog number</label><input class="form-input" id="f-p-catalog" placeholder="e.g. A1234" bind:value={form.product.catalogNumber}></div>
    <div class="form-group"><label class="form-label" for="f-p-name">Product name</label><input class="form-input" id="f-p-name" placeholder="e.g. Anti-GAPDH antibody" bind:value={form.product.productName}></div>
  </div>
  <div class="form-group"><label class="form-label" for="f-p-variant">Variant</label><input class="form-input" id="f-p-variant" placeholder="e.g. 100 µL vial" bind:value={form.product.variant}></div>
</div>

<div class="form-group">
  <span class="form-label">Batch / lot (optional)</span>
  <div class="form-row">
    <div class="form-group"><label class="form-label" for="f-b-lot">Lot code</label><input class="form-input" id="f-b-lot" placeholder="e.g. LOT-2026-01" bind:value={form.batch.lotCode}></div>
    <div class="form-group"><label class="form-label" for="f-b-origin">Origin</label><select class="form-select" id="f-b-origin" bind:value={form.batch.originType}><option value="">—</option>{#each batchOriginOptions as option (option.value)}<option value={option.value}>{option.label}</option>{/each}</select></div>
  </div>
  <div class="form-row">
    <div class="form-group"><label class="form-label" for="f-b-expiry">Expiry date</label><input class="form-input" type="date" id="f-b-expiry" bind:value={form.batch.expiresAt}></div>
    <div class="form-group"><label class="form-label" for="f-b-received">Received date</label><input class="form-input" type="date" id="f-b-received" bind:value={form.batch.receivedAt}></div>
  </div>
  <div class="form-group"><label class="form-label" for="f-b-preparedby">Prepared by</label><input class="form-input" id="f-b-preparedby" placeholder="e.g. J. Novák" bind:value={form.batch.preparedBy}></div>
</div>

<div class="form-group"><label class="form-label">Note</label><textarea class="form-textarea" id="f-cno" placeholder="Optional note" bind:value={form.note}></textarea></div>
