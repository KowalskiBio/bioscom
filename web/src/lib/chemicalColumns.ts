import {
  normalizeCatalogColumnSelection,
  type CatalogCoreColumnKey,
  type Chemical,
  type MaterialFieldDef,
} from "@bioscom/shared";
import {
  catalogCoreColumnLabel,
  catalogDescriptorFieldsForSelection,
} from "./catalogColumns";

export type ChemicalTableLayout = "room" | "detail" | "deepfreezer-search";

export type ChemicalColumnKind =
  | "name"
  | "type"
  | "position"
  | "location"
  | "quantity"
  | "unit"
  | "concentration"
  | "descriptor"
  | "manufacturer"
  | "catalog_number"
  | "lot"
  | "received"
  | "expires"
  | "status"
  | "note"
  | "actions";

export interface ChemicalTableColumn {
  /** Stable within one table; quantity and unit intentionally share a preference key. */
  id: string;
  preferenceKey: string;
  kind: ChemicalColumnKind;
  label: string;
  className: string;
  field?: MaterialFieldDef;
  width?: number;
}

export interface ChemicalTableModel {
  columns: ChemicalTableColumn[];
  selected: ReadonlySet<string>;
  legacy: boolean;
  minWidth: number;
}

const LEGACY_DETAIL_SELECTION = [
  "name",
  "type",
  "location",
  "molecular_formula",
  "quantity",
  "concentration",
  "cas_number",
  "note",
  "actions",
] as const;

const LEGACY_ROOM_SELECTION = ["name", "type", "quantity", "location", "actions"] as const;

function attributeText(value: string | number | boolean | null | undefined): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function chemicalProductText(value: string | null | undefined): string {
  return value === null || value === undefined || value.trim() === "" ? "—" : value;
}

/** Zero is a real concentration; only absent/non-finite values use the empty marker. */
export function chemicalConcentrationText(ch: Chemical): string {
  if (ch.concentration === null || ch.concentration === undefined || !Number.isFinite(ch.concentration)) {
    return "—";
  }
  const unit = ch.concUnit?.trim();
  return unit === undefined || unit === "" ? String(ch.concentration) : `${ch.concentration} ${unit}`;
}

export function chemicalDateText(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : new Date(value).toISOString().slice(0, 10);
}

/**
 * Legacy chemical documents were not assigned a stock-status authority. Only a
 * real string already present on the document may be displayed; quantity never
 * turns into an available/depleted guess.
 */
export function chemicalLegacyStatusText(ch: Chemical): string {
  const status = (ch as unknown as Record<string, unknown>)["status"];
  return typeof status === "string" && status.trim() !== "" ? status.trim() : "—";
}

/**
 * The All room preference owns the stock Note. Other's legacy descriptor is a
 * fallback only for Other rows with no stock note, matching Packages. No other
 * material can borrow attributes.custom_notes as its Note.
 */
export function chemicalNoteText(ch: Chemical): string {
  const note = ch.note?.trim();
  if (note !== undefined && note !== "") {
    return note;
  }
  if (ch.type === "other") {
    return attributeText(ch.attributes?.["custom_notes"]) ?? "—";
  }
  return "—";
}

export function formatChemicalAttribute(
  field: MaterialFieldDef,
  value: string | number | boolean | null | undefined,
): string {
  if (value === undefined || value === null || value === "") {
    return "—";
  }
  switch (field.dataType) {
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : "—";
    case "number":
      return field.unit === undefined ? String(value) : `${value} ${field.unit}`;
    case "sequence":
      return String(value).toUpperCase();
    case "string":
    case "text":
      return String(value).trim() || "—";
    default:
      return String(value);
  }
}

/** Typed chemical attributes win; legacy top-level CAS/formula remain backwards-compatible fallbacks. */
export function chemicalFormulaSource(ch: Chemical): string | null {
  return attributeText(ch.attributes?.["molecular_formula"]) ?? attributeText(ch.formula);
}

export function chemicalDescriptorText(ch: Chemical, field: MaterialFieldDef): string {
  if (field.key === "cas_number") {
    return attributeText(ch.attributes?.[field.key]) ?? attributeText(ch.cas) ?? "—";
  }
  if (field.key === "molecular_formula") {
    return chemicalFormulaSource(ch) ?? "—";
  }
  return formatChemicalAttribute(field, ch.attributes?.[field.key]);
}

function makeColumn(
  kind: ChemicalColumnKind,
  id: string,
  preferenceKey: string,
  label: string,
  width?: number,
  field?: MaterialFieldDef,
): ChemicalTableColumn {
  const semanticKey = id.replace(/[^a-zA-Z0-9_-]/g, "-");
  return {
    id,
    preferenceKey,
    kind,
    label,
    field,
    width,
    className: `chemical-col chemical-col-${kind} chemical-col-${semanticKey}`,
  };
}

function coreColumn(
  key: CatalogCoreColumnKey,
  layout: ChemicalTableLayout,
  id = key,
): ChemicalTableColumn {
  const widths: Partial<Record<CatalogCoreColumnKey, number>> = {
    name: 220,
    type: 140,
    quantity: 105,
    location: layout === "deepfreezer-search" ? 190 : 180,
    lot: 120,
    received: 110,
    expires: 110,
    status: 120,
    actions: layout === "room" ? 144 : 96,
    manufacturer: 160,
    catalog_number: 140,
    concentration: 110,
    note: 280,
  };
  const labels: Partial<Record<CatalogCoreColumnKey, string>> = {
    location: layout === "room" || layout === "deepfreezer-search" ? "Location" : "Pos.",
    quantity: layout === "room" ? "Quantity" : "Qty",
    concentration: "Conc.",
    catalog_number: "Catalog number",
  };
  return makeColumn(key, id, key, labels[key] ?? catalogCoreColumnLabel(key), widths[key]);
}

function descriptorColumn(field: MaterialFieldDef, legacy: boolean): ChemicalTableColumn {
  const width = field.key === "cas_number" || field.key === "molecular_formula"
    ? 125
    : field.dataType === "text"
      ? 220
      : field.dataType === "sequence"
        ? 170
        : 150;
  const label = legacy && field.key === "cas_number"
    ? "CAS"
    : legacy && field.key === "molecular_formula"
      ? "Formula"
      : field.unit === undefined
        ? field.label
        : `${field.label} (${field.unit})`;
  return makeColumn("descriptor", field.key, field.key, label, width, field);
}

function legacyModel(layout: ChemicalTableLayout): ChemicalTableModel {
  const selection = layout === "room" ? LEGACY_ROOM_SELECTION : LEGACY_DETAIL_SELECTION;
  const selected: ReadonlySet<string> = new Set(selection);
  if (layout === "room") {
    const columns = [
      coreColumn("name", layout),
      coreColumn("type", layout),
      coreColumn("quantity", layout),
      makeColumn("unit", "unit", "quantity", "Unit", 80),
      coreColumn("location", layout),
      coreColumn("actions", layout),
    ];
    return { columns, selected, legacy: true, minWidth: 0 };
  }

  const fields = catalogDescriptorFieldsForSelection("all", selection);
  const formula = fields.find((field) => field.key === "molecular_formula")!;
  const cas = fields.find((field) => field.key === "cas_number")!;
  const columns: ChemicalTableColumn[] = [];
  if (layout === "deepfreezer-search") {
    columns.push(coreColumn("location", layout));
  }
  columns.push(
    makeColumn("position", "position", "location", "Pos.", 75),
    coreColumn("name", layout),
    descriptorColumn(formula, true),
    coreColumn("quantity", layout),
    makeColumn("unit", "unit", "quantity", "Unit", 80),
    coreColumn("concentration", layout),
    descriptorColumn(cas, true),
    coreColumn("note", layout),
    coreColumn("actions", layout),
  );
  return { columns, selected, legacy: true, minWidth: 950 };
}

/**
 * Build semantic cells from the same All selection used by Packages. The legacy
 * branch exists only while account state is unconfirmed, avoiding a temporary
 * jump to unrelated defaults during initial loading or a first-load failure.
 */
export function chemicalTableModel(
  selection: readonly string[],
  layout: ChemicalTableLayout,
  legacy = false,
): ChemicalTableModel {
  if (legacy) {
    return legacyModel(layout);
  }

  const normalized = normalizeCatalogColumnSelection("all", selection);
  const selected: ReadonlySet<string> = new Set(normalized);
  const columns: ChemicalTableColumn[] = [];
  const addLocation = (): void => {
    if (!selected.has("location")) return;
    if (layout === "room" || layout === "deepfreezer-search") {
      columns.push(coreColumn("location", layout));
    }
    if (layout !== "room") {
      columns.push(makeColumn("position", "position", "location", "Pos.", 75));
    }
  };

  // Direct room placement follows its legacy spot after Quantity. Detail Pos.
  // and deep-freezer Rack/Box navigation stay at the left of their rows.
  if (layout !== "room") addLocation();
  // Name is a presentation invariant even for malformed/untrusted cached data.
  columns.push(coreColumn("name", layout));
  // Detail rows retain their established inline non-chemical chip in Name.
  if (layout === "room" && selected.has("type")) columns.push(coreColumn("type", layout));
  if (selected.has("quantity")) {
    columns.push(coreColumn("quantity", layout));
    columns.push(makeColumn("unit", "unit", "quantity", "Unit", 80));
  }
  if (layout === "room") addLocation();
  if (selected.has("concentration")) columns.push(coreColumn("concentration", layout));

  for (const field of catalogDescriptorFieldsForSelection("all", normalized)) {
    columns.push(descriptorColumn(field, false));
  }
  for (const key of ["manufacturer", "catalog_number", "lot", "received", "expires", "status"] as const) {
    if (selected.has(key)) columns.push(coreColumn(key, layout));
  }
  // Note is always the final informational column, immediately before Actions.
  if (selected.has("note")) columns.push(coreColumn("note", layout));
  if (selected.has("actions")) columns.push(coreColumn("actions", layout));

  const fixedWidth = columns.reduce((total, column) => total + (column.width ?? 0), 0);
  return {
    columns,
    selected,
    legacy: false,
    minWidth: layout === "room" ? 0 : Math.max(950, fixedWidth),
  };
}
