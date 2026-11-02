<script lang="ts">
  import {
    MATERIAL_TYPES,
    validateAttributes,
    type AttributeValue,
    type BulkImportItem,
    type Container,
    type Room,
  } from "@bioscom/shared";
  import { api, ApiError } from "../../lib/api";
  import { closeModal } from "../../lib/modal.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { showToast } from "../../lib/stores/toast.svelte";

  let { room, container }: { room: Room; container: Container } = $props();

  type Step = "paste" | "preview" | "result";

  interface ParsedRow {
    rowNumber: number;
    item: BulkImportItem;
    warnings: string[];
  }

  interface SkippedRow {
    rowNumber: number;
    name: string;
    error: string;
  }

  interface ServerSkipped {
    index: number;
    name: string;
    error: string;
  }

  const RESERVED_HEADERS = new Set([
    "name",
    "type",
    "quantity",
    "unit",
    "cas",
    "formula",
    "concentration",
    "concunit",
    "position",
    "customposition",
    "note",
    "manufacturer",
    "supplier",
    "catalognumber",
    "productname",
    "variant",
    "lotcode",
    "origintype",
    "receivedat",
    "preparedat",
    "preparedby",
    "expiresat",
  ]);

  const ORIGIN_TYPES = new Set(["purchased", "prepared", "derived", "unknown"]);
  const TYPE_KEYS = new Set<string>(MATERIAL_TYPES.map((entry) => entry.key));

  const shelves = $derived(container.shelves ?? []);

  let step = $state<Step>("paste");
  let shelfId = $state("");
  let csvText = $state("");
  let parseError = $state("");
  let rows = $state<ParsedRow[]>([]);
  let skippedRows = $state<SkippedRow[]>([]);
  let submitError = $state("");
  let submitting = $state(false);
  let result = $state<{ created: number; skipped: ServerSkipped[] } | null>(null);

  const selectedShelfId = $derived(shelfId !== "" ? shelfId : (shelves[0]?.id ?? ""));
  const warningRows = $derived(rows.filter((row) => row.warnings.length > 0));
  const canParse = $derived(selectedShelfId !== "" && csvText.trim() !== "");

  function attrKeysFor(typeKey: string): Set<string> {
    const definition = MATERIAL_TYPES.find((entry) => entry.key === typeKey);
    return new Set((definition?.fields ?? []).map((field) => field.key));
  }

  /**
   * Small CSV reader: splits on commas/newlines, honours double-quoted fields
   * (including escaped "" quotes and embedded commas/newlines). `\r` is
   * normalised away. Blank rows are dropped later by the caller.
   */
  function parseCsv(text: string): string[][] {
    const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const records: string[][] = [];
    let cells: string[] = [];
    let field = "";
    let inQuotes = false;
    let i = 0;

    while (i < source.length) {
      const ch = source[i]!;
      if (inQuotes) {
        if (ch === '"') {
          if (source[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        cells.push(field);
        field = "";
        i += 1;
        continue;
      }
      if (ch === "\n") {
        cells.push(field);
        records.push(cells);
        cells = [];
        field = "";
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
    }

    if (field !== "" || cells.length > 0) {
      cells.push(field);
      records.push(cells);
    }
    return records;
  }

  function parseNumber(raw: string): number | "invalid" {
    if (raw === "") {
      return "invalid";
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : "invalid";
  }

  function parseDate(raw: string): number | "invalid" {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (match === null) {
      return "invalid";
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const epoch = Date.UTC(year, month - 1, day);
    const date = new Date(epoch);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return "invalid";
    }
    return epoch;
  }

  function cellValue(cells: string[], headerIndex: Map<string, number>, header: string): string {
    const index = headerIndex.get(header);
    if (index === undefined) {
      return "";
    }
    return (cells[index] ?? "").trim();
  }

  function buildItem(cells: string[], headerIndex: Map<string, number>): { item: BulkImportItem | null; error: string; warnings: string[] } {
    const warnings: string[] = [];
    const errors: string[] = [];

    const name = cellValue(cells, headerIndex, "name");
    if (name === "") {
      errors.push("name is required");
    } else if (name.length > 100) {
      errors.push("name exceeds 100 characters");
    }

    const rawType = cellValue(cells, headerIndex, "type").toLowerCase();
    const effectiveType = rawType === "" ? "chemical" : rawType;
    if (!TYPE_KEYS.has(effectiveType)) {
      errors.push(`type: unknown material type "${rawType}"`);
    }

    const quantityRaw = cellValue(cells, headerIndex, "quantity");
    let quantity: number | undefined;
    if (quantityRaw !== "") {
      const parsed = parseNumber(quantityRaw);
      if (parsed === "invalid") {
        errors.push("quantity: expected a number");
      } else {
        quantity = parsed;
      }
    }

    const concentrationRaw = cellValue(cells, headerIndex, "concentration");
    let concentration: number | undefined;
    if (concentrationRaw !== "") {
      const parsed = parseNumber(concentrationRaw);
      if (parsed === "invalid") {
        errors.push("concentration: expected a number");
      } else {
        concentration = parsed;
      }
    }

    const dateFields = ["expiresAt", "receivedAt", "preparedAt"] as const;
    const parsedDates: Record<(typeof dateFields)[number], number | undefined> = {
      expiresAt: undefined,
      receivedAt: undefined,
      preparedAt: undefined,
    };
    for (const field of dateFields) {
      const raw = cellValue(cells, headerIndex, field.toLowerCase());
      if (raw === "") {
        continue;
      }
      const parsed = parseDate(raw);
      if (parsed === "invalid") {
        errors.push(`${field}: expected YYYY-MM-DD`);
      } else {
        parsedDates[field] = parsed;
      }
    }

    const originRaw = cellValue(cells, headerIndex, "origintype").toLowerCase();
    if (originRaw !== "" && !ORIGIN_TYPES.has(originRaw)) {
      errors.push("originType: expected purchased, prepared, derived or unknown");
    }

    // Any header that is not one of the dedicated columns is treated as a
    // registry attribute. Known descriptor keys become validated attributes;
    // unknown ones are still passed through with a non-fatal warning.
    const knownAttrKeys = attrKeysFor(effectiveType);
    const attributes: Record<string, AttributeValue> = {};
    for (const [header, index] of headerIndex) {
      if (header === "" || RESERVED_HEADERS.has(header)) {
        continue;
      }
      const value = (cells[index] ?? "").trim();
      if (value === "") {
        continue;
      }
      attributes[header] = value;
      if (!knownAttrKeys.has(header)) {
        warnings.push(`Column "${header}" is not a known field for type "${effectiveType}"; it is sent as a custom attribute.`);
      }
    }

    let validatedAttributes: Record<string, AttributeValue> | undefined;
    if (Object.keys(attributes).length > 0) {
      const validation = validateAttributes(effectiveType, attributes);
      if (!validation.ok) {
        errors.push(...validation.errors);
      } else {
        validatedAttributes = validation.value;
      }
    }

    const product: NonNullable<BulkImportItem["product"]> = {};
    let hasProduct = false;
    for (const key of ["manufacturer", "supplier", "catalogNumber", "productName", "variant"] as const) {
      const value = cellValue(cells, headerIndex, key.toLowerCase());
      if (value !== "") {
        product[key] = value;
        hasProduct = true;
      }
    }

    const batchInfo: NonNullable<BulkImportItem["batchInfo"]> = {};
    let hasBatch = false;
    const lotCode = cellValue(cells, headerIndex, "lotcode");
    if (lotCode !== "") {
      batchInfo.lotCode = lotCode;
      hasBatch = true;
    }
    if (originRaw !== "" && ORIGIN_TYPES.has(originRaw)) {
      batchInfo.originType = originRaw as NonNullable<BulkImportItem["batchInfo"]>["originType"];
      hasBatch = true;
    }
    const preparedBy = cellValue(cells, headerIndex, "preparedby");
    if (preparedBy !== "") {
      batchInfo.preparedBy = preparedBy;
      hasBatch = true;
    }
    if (parsedDates.expiresAt !== undefined) {
      batchInfo.expiresAt = parsedDates.expiresAt;
      hasBatch = true;
    }
    if (parsedDates.receivedAt !== undefined) {
      batchInfo.receivedAt = parsedDates.receivedAt;
      hasBatch = true;
    }
    if (parsedDates.preparedAt !== undefined) {
      batchInfo.preparedAt = parsedDates.preparedAt;
      hasBatch = true;
    }

    if (errors.length > 0) {
      return { item: null, error: errors.join("; "), warnings };
    }

    const item: BulkImportItem = {
      name,
      ...(rawType === "" ? {} : { type: effectiveType }),
      ...(validatedAttributes === undefined ? {} : { attributes: validatedAttributes }),
      ...(cellValue(cells, headerIndex, "cas") === "" ? {} : { cas: cellValue(cells, headerIndex, "cas") }),
      ...(cellValue(cells, headerIndex, "formula") === "" ? {} : { formula: cellValue(cells, headerIndex, "formula") }),
      ...(quantity === undefined ? {} : { quantity }),
      ...(cellValue(cells, headerIndex, "unit") === "" ? {} : { unit: cellValue(cells, headerIndex, "unit") }),
      ...(concentration === undefined ? {} : { concentration }),
      ...(cellValue(cells, headerIndex, "concunit") === "" ? {} : { concUnit: cellValue(cells, headerIndex, "concunit") }),
      ...(cellValue(cells, headerIndex, "position") === "" ? {} : { position: cellValue(cells, headerIndex, "position") }),
      ...(cellValue(cells, headerIndex, "customposition") === "" ? {} : { customPosition: cellValue(cells, headerIndex, "customposition") }),
      ...(cellValue(cells, headerIndex, "note") === "" ? {} : { note: cellValue(cells, headerIndex, "note") }),
      ...(hasProduct ? { product } : {}),
      ...(hasBatch ? { batchInfo } : {}),
    };

    return { item, error: "", warnings };
  }

  function handleParse(): void {
    parseError = "";
    submitError = "";
    const records = parseCsv(csvText).filter((cells) => cells.some((value) => value.trim() !== ""));
    if (records.length === 0) {
      parseError = "Paste some CSV rows to import.";
      return;
    }

    const headerCells = records[0]!.map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, "") : value).trim().toLowerCase());
    if (!headerCells.includes("name")) {
      parseError = "The header row must include a 'name' column.";
      return;
    }

    const dataRows = records.slice(1);
    if (dataRows.length === 0) {
      parseError = "No data rows found below the header.";
      return;
    }
    if (dataRows.length > 500) {
      parseError = "At most 500 rows can be imported at once.";
      return;
    }

    const headerIndex = new Map<string, number>();
    headerCells.forEach((header, index) => {
      if (header !== "" && !headerIndex.has(header)) {
        headerIndex.set(header, index);
      }
    });

    const parsedRows: ParsedRow[] = [];
    const newSkipped: SkippedRow[] = [];
    dataRows.forEach((cells, index) => {
      const rowNumber = index + 2;
      const { item, error, warnings } = buildItem(cells, headerIndex);
      if (item === null) {
        newSkipped.push({ rowNumber, name: cellValue(cells, headerIndex, "name"), error });
      } else {
        parsedRows.push({ rowNumber, item, warnings });
      }
    });

    rows = parsedRows;
    skippedRows = newSkipped;
    step = "preview";
  }

  function backToPaste(): void {
    submitError = "";
    step = "paste";
  }

  async function confirmImport(): Promise<void> {
    if (submitting) {
      return;
    }
    const groupId = currentGroup.groupId;
    if (groupId === null) {
      submitError = "No lab selected.";
      return;
    }
    if (selectedShelfId === "") {
      submitError = "Select a target shelf.";
      return;
    }
    if (rows.length === 0) {
      submitError = "There are no valid rows to import.";
      return;
    }

    submitting = true;
    submitError = "";
    try {
      const body = await api.post<{ created: number; skipped: ServerSkipped[] }>(
        `/api/groups/${encodeURIComponent(groupId)}/inventory/bulk-import`,
        {
          roomId: room.id,
          containerId: container.id,
          shelfId: selectedShelfId,
          items: rows.map((row) => row.item),
        },
      );
      result = { created: body.created, skipped: body.skipped ?? [] };
      step = "result";
      showToast(`Created ${body.created} items`);
    } catch (error) {
      submitError = error instanceof ApiError && error.message !== "" ? error.message : "Import failed";
      showToast(submitError, "error");
    } finally {
      submitting = false;
    }
  }
</script>

{#if step === "paste"}
  <div class="form-group">
    <label class="form-label" for="bulk-shelf">Target shelf</label>
    {#if shelves.length === 0}
      <p style="font-size: 0.85rem; color: var(--accent-amber);">This container has no shelves. Add a shelf before importing items.</p>
    {:else}
      <select class="form-select" id="bulk-shelf" value={selectedShelfId} onchange={(event) => (shelfId = event.currentTarget.value)}>
        {#each shelves as shelf (shelf.id)}
          <option value={shelf.id}>{shelf.name}</option>
        {/each}
      </select>
    {/if}
  </div>

  <div class="form-group">
    <label class="form-label" for="bulk-csv">CSV data</label>
    <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0 0 0.5rem; line-height: 1.45;">
      Paste CSV with a header row. The first column must be <code>name</code>. Headers are case-insensitive;
      supported headers: name, type, quantity, unit, cas, formula, concentration, concUnit, position,
      customPosition, note, manufacturer, supplier, catalogNumber, productName, variant, lotCode, originType,
      receivedAt, preparedAt, preparedBy, expiresAt, plus any registry attribute key for the row's type.
    </p>
    <textarea
      class="form-textarea"
      id="bulk-csv"
      rows="10"
      spellcheck="false"
      placeholder={'name,type,quantity,unit,cas,formula,catalogNumber,lotCode,expiresAt\nTris base,chemical,250,g,77-86-1,C4H11NO3,,LOT-1,2027-01-31\nPBS 1x,solution,500,mL,,,,'}
      bind:value={csvText}
    ></textarea>
  </div>

  {#if parseError !== ""}
    <p style="font-size: 0.85rem; color: var(--accent-red); margin-bottom: 0.75rem;">{parseError}</p>
  {/if}

  <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle);">
    <button type="button" class="btn-secondary" id="bulk-parse" disabled={!canParse} onclick={handleParse}>Parse</button>
  </div>
{:else if step === "preview"}
  <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
    <strong>{rows.length}</strong> valid rows, <strong>{skippedRows.length}</strong> skipped
  </p>

  {#if rows.length > 0}
    <h4 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.4rem;">Valid rows</h4>
    <div style="max-height: 240px; overflow: auto; margin-bottom: 1rem; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
      <table class="detail-table">
        <thead>
          <tr><th>Name</th><th>Type</th><th>Quantity</th><th>Unit</th></tr>
        </thead>
        <tbody>
          {#each rows as row (row.rowNumber)}
            <tr>
              <td>{row.item.name}</td>
              <td>{row.item.type ?? "chemical"}</td>
              <td>{row.item.quantity ?? "—"}</td>
              <td>{row.item.unit ?? "—"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if skippedRows.length > 0}
    <h4 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.4rem;">Skipped rows</h4>
    <div style="max-height: 180px; overflow: auto; margin-bottom: 1rem; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
      <table class="detail-table">
        <thead>
          <tr><th>Row</th><th>Name</th><th>Error</th></tr>
        </thead>
        <tbody>
          {#each skippedRows as row (row.rowNumber)}
            <tr>
              <td>{row.rowNumber}</td>
              <td>{row.name !== "" ? row.name : "—"}</td>
              <td style="color: var(--accent-red);">{row.error}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if warningRows.length > 0}
    <h4 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent-amber); margin-bottom: 0.4rem;">Warnings</h4>
    <ul style="margin: 0 0 1rem; padding-left: 1.1rem; font-size: 0.8rem; color: var(--accent-amber);">
      {#each warningRows as row (row.rowNumber)}
        {#each row.warnings as warning}
          <li>Row {row.rowNumber} ({row.item.name}): {warning}</li>
        {/each}
      {/each}
    </ul>
  {/if}

  {#if submitError !== ""}
    <p style="font-size: 0.85rem; color: var(--accent-red); margin-bottom: 0.75rem;">{submitError}</p>
  {/if}

  <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle);">
    <button type="button" class="btn-secondary" id="bulk-back" disabled={submitting} onclick={backToPaste}>Back to paste</button>
    <button type="button" class="btn-primary" id="bulk-confirm" disabled={submitting || rows.length === 0} onclick={() => void confirmImport()}>
      {submitting ? "Importing…" : "Confirm import"}
    </button>
  </div>
{:else}
  <div id="bulk-result">
    <p style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.5rem;">Created {result?.created ?? 0} items</p>

    {#if result !== null && result.skipped.length > 0}
      <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.4rem;">The server skipped {result.skipped.length} rows:</p>
      <div style="max-height: 220px; overflow: auto; margin-bottom: 1rem; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
        <table class="detail-table">
          <thead>
            <tr><th>Name</th><th>Error</th></tr>
          </thead>
          <tbody>
            {#each result.skipped as row (row.index)}
              <tr>
                <td>{row.name}</td>
                <td style="color: var(--accent-red);">{row.error}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle);">
    <button type="button" class="btn-primary" id="bulk-close" onclick={() => closeModal()}>Close</button>
  </div>
{/if}
