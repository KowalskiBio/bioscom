import { z } from "zod";
import { MATERIAL_TYPES, type MaterialTypeKey } from "./material.js";

/**
 * Core columns that every catalog row has always defaulted to. Kept separate so
 * the optional core columns below can be selectable without changing any
 * user's existing default layout.
 */
export const CATALOG_DEFAULT_CORE_COLUMN_KEYS = [
  "name",
  "type",
  "quantity",
  "location",
  "lot",
  "received",
  "expires",
  "status",
  "actions",
] as const;

/**
 * Optional core columns. They are common to every scope but stay opt-in so no
 * existing default layout changes:
 * - manufacturer/catalog_number render the row's own product when attached.
 * - concentration renders the stock's numeric concentration and unit together.
 * - note renders the package/stock note (`CatalogStock.note`), not a material
 *   attribute. It replaces the legacy All-view `custom_notes` descriptor alias.
 */
export const CATALOG_OPTIONAL_CORE_COLUMN_KEYS = [
  "manufacturer",
  "catalog_number",
  "concentration",
  "note",
] as const;

/**
 * In the All view the Other type's `custom_notes` descriptor used to double as
 * the stock-note column. New selections use the canonical `note` key; the alias
 * is still accepted and normalised so saved layouts are not lost.
 */
export const CATALOG_LEGACY_ALL_NOTE_COLUMN_KEY = "custom_notes";

/**
 * Columns that always exist on every catalog row, independent of the material
 * type. Descriptor keys that happen to collide with one of these are ignored so
 * a custom attribute can never shadow a core column.
 */
export const CATALOG_CORE_COLUMN_KEYS = [
  ...CATALOG_DEFAULT_CORE_COLUMN_KEYS,
  ...CATALOG_OPTIONAL_CORE_COLUMN_KEYS,
] as const;

/** Name and Actions are mandatory; every other column (including Type) is optional. */
export const CATALOG_REQUIRED_COLUMN_KEYS = ["name", "actions"] as const;

export type CatalogCoreColumnKey = (typeof CATALOG_CORE_COLUMN_KEYS)[number];

/** "all" is the combined stock view; every material type key has its own view. */
export type CatalogColumnScope = "all" | MaterialTypeKey;

export type CatalogColumnSelections = Record<CatalogColumnScope, string[]>;

const SCOPE_VALUES: [CatalogColumnScope, ...CatalogColumnScope[]] = [
  "all",
  ...MATERIAL_TYPES.map((type) => type.key),
];

export const CATALOG_COLUMN_SCOPES = SCOPE_VALUES;

const CORE_KEY_SET: ReadonlySet<string> = new Set(CATALOG_CORE_COLUMN_KEYS);

function fieldsForType(scope: MaterialTypeKey): readonly { key: string }[] {
  return MATERIAL_TYPES.find((type) => type.key === scope)?.fields ?? [];
}

function descriptorKeysForScope(scope: CatalogColumnScope): string[] {
  const keys: string[] = [];
  if (scope !== "all") {
    for (const field of fieldsForType(scope)) {
      if (!CORE_KEY_SET.has(field.key) && !keys.includes(field.key)) {
        keys.push(field.key);
      }
    }
    return keys;
  }

  // All view: deduplicated union of every type's descriptors, core keys reserved.
  // The legacy `custom_notes` alias is omitted here because the canonical stock
  // `note` core column owns the All "Note" header; otherwise All would offer two
  // user-facing Note columns. Other keeps its own `custom_notes` descriptor.
  for (const type of MATERIAL_TYPES) {
    for (const field of type.fields) {
      if (field.key === CATALOG_LEGACY_ALL_NOTE_COLUMN_KEY) {
        continue;
      }
      if (!CORE_KEY_SET.has(field.key) && !keys.includes(field.key)) {
        keys.push(field.key);
      }
    }
  }
  return keys;
}

/**
 * Map legacy All-view `custom_notes` selections onto the canonical stock `note`
 * column. Both aliases collapse to a single `note` (first occurrence keeps its
 * position); every other scope and every ordinary duplicate is left untouched
 * so the schema can still reject those separately.
 */
export function normalizeCatalogColumnSelection(
  scope: CatalogColumnScope,
  columns: readonly string[],
): string[] {
  if (scope !== "all") {
    return [...columns];
  }
  const normalized: string[] = [];
  let noteAdded = false;
  for (const column of columns) {
    if (column === "note" || column === CATALOG_LEGACY_ALL_NOTE_COLUMN_KEY) {
      if (noteAdded) {
        continue;
      }
      noteAdded = true;
      normalized.push("note");
      continue;
    }
    normalized.push(column);
  }
  return normalized;
}

/** Permitted column keys for a scope: the core columns plus that type's descriptors. */
export function catalogColumnKeysForScope(scope: CatalogColumnScope): string[] {
  return [...CATALOG_CORE_COLUMN_KEYS, ...descriptorKeysForScope(scope)];
}

/**
 * Defaults mirror the pre-preference catalog: core columns for All/Other,
 * chemical's legacy CAS + molecular weight pair, and the first two registry
 * fields for the remaining types. This deliberately selects a subset; callers
 * can still enable any other permitted descriptor.
 */
export function defaultCatalogColumnsForScope(scope: CatalogColumnScope): string[] {
  // Optional core extras stay opt-in: the original nine core columns are the
  // only core defaults for every scope.
  const columns: string[] = [...CATALOG_DEFAULT_CORE_COLUMN_KEYS];
  if (scope === "all" || scope === "other") {
    return columns;
  }
  if (scope === "chemical") {
    columns.push("cas_number", "molecular_weight");
    return columns;
  }
  for (const field of fieldsForType(scope).slice(0, 2)) {
    columns.push(field.key);
  }
  return columns;
}

/** Fresh, independent arrays for every scope so callers cannot mutate shared state. */
export function defaultCatalogColumnSelections(): CatalogColumnSelections {
  const selections = {} as CatalogColumnSelections;
  for (const scope of SCOPE_VALUES) {
    selections[scope] = defaultCatalogColumnsForScope(scope);
  }
  return selections;
}

export const CatalogColumnScopeSchema = z.enum(SCOPE_VALUES);

export const CatalogColumnUpdateSchema = z
  .object({
    scope: CatalogColumnScopeSchema,
    columns: z.array(z.string().min(1)).max(64),
  })
  .superRefine((value, ctx) => {
    const permitted = new Set(catalogColumnKeysForScope(value.scope));
    if (value.scope === "all") {
      // Accept the legacy alias so old saved layouts and clients keep working;
      // the transform below stores the canonical `note` key instead.
      permitted.add(CATALOG_LEGACY_ALL_NOTE_COLUMN_KEY);
    }
    const seen = new Set<string>();
    value.columns.forEach((column, index) => {
      if (seen.has(column)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate column: ${column}`,
          path: ["columns", index],
        });
        return;
      }
      seen.add(column);
      if (!permitted.has(column)) {
        ctx.addIssue({
          code: "custom",
          message: `column not available for this scope: ${column}`,
          path: ["columns", index],
        });
      }
    });
    // Required keys are never aliases, so checking the canonical set is enough
    // while `note` + `custom_notes` remain a valid (deduplicated) pair.
    const canonical = new Set(normalizeCatalogColumnSelection(value.scope, value.columns));
    for (const required of CATALOG_REQUIRED_COLUMN_KEYS) {
      if (!canonical.has(required)) {
        ctx.addIssue({
          code: "custom",
          message: `missing required column: ${required}`,
          path: ["columns"],
        });
      }
    }
  })
  .transform((value) => ({
    scope: value.scope,
    columns: normalizeCatalogColumnSelection(value.scope, value.columns),
  }));

export type CatalogColumnUpdate = z.infer<typeof CatalogColumnUpdateSchema>;
