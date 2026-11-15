import {
  CATALOG_COLUMN_SCOPES,
  CATALOG_CORE_COLUMN_KEYS,
  CATALOG_REQUIRED_COLUMN_KEYS,
  MATERIAL_TYPES,
  catalogColumnKeysForScope,
  normalizeCatalogColumnSelection,
  type CatalogCoreColumnKey,
  type CatalogColumnScope,
  type CatalogColumnSelections,
  type MaterialFieldDef,
} from "@bioscom/shared";
import { api } from "./api";

export interface CatalogColumnsResponse {
  columnsByType: CatalogColumnSelections;
  updatedAt: number;
}

const CORE_COLUMN_LABELS: Record<CatalogCoreColumnKey, string> = {
  name: "Name",
  type: "Type",
  quantity: "Quantity",
  location: "Location",
  lot: "Lot",
  received: "Received",
  expires: "Expires",
  status: "Status",
  actions: "Actions",
  manufacturer: "Manufacturer",
  catalog_number: "Catalog number",
  concentration: "Concentration",
  note: "Note",
};

export function catalogScopeForTypeFilter(typeFilter: string): CatalogColumnScope {
  if (typeFilter === "") {
    return "all";
  }
  const scope = CATALOG_COLUMN_SCOPES.find((entry) => entry === typeFilter);
  return scope ?? "all";
}

export function catalogCoreColumnLabel(key: CatalogCoreColumnKey): string {
  return CORE_COLUMN_LABELS[key];
}

export function catalogColumnIsRequired(key: string): boolean {
  return (CATALOG_REQUIRED_COLUMN_KEYS as readonly string[]).includes(key);
}

export function catalogCoreColumnsForScope(scope: CatalogColumnScope): CatalogCoreColumnKey[] {
  const permitted = new Set(catalogColumnKeysForScope(scope));
  return CATALOG_CORE_COLUMN_KEYS.filter((key) => permitted.has(key));
}

export function catalogColumnsForSave(scope: CatalogColumnScope, columns: readonly string[]): string[] {
  // Normalise legacy All `custom_notes` drafts to the canonical stock `note`
  // key before filtering, so a stale draft still saves the user's Note choice.
  const selected = new Set(normalizeCatalogColumnSelection(scope, columns));
  return catalogColumnKeysForScope(scope).filter(
    (key) => selected.has(key) || catalogColumnIsRequired(key),
  );
}

export function catalogDescriptorFieldsForSelection(
  scope: CatalogColumnScope,
  columns: readonly string[],
): MaterialFieldDef[] {
  const selected = new Set(columns);
  const permitted = new Set(catalogColumnKeysForScope(scope));
  const core = new Set<string>(CATALOG_CORE_COLUMN_KEYS);
  const seen = new Set<string>();
  const fields: MaterialFieldDef[] = [];

  for (const type of MATERIAL_TYPES) {
    if (scope !== "all" && type.key !== scope) {
      continue;
    }
    for (const field of type.fields) {
      if (
        selected.has(field.key) &&
        permitted.has(field.key) &&
        !core.has(field.key) &&
        !seen.has(field.key)
      ) {
        fields.push(field);
        seen.add(field.key);
      }
    }
  }
  return fields;
}

export function cloneCatalogColumnSelections(
  selections: CatalogColumnSelections,
): CatalogColumnSelections {
  const clone = {} as CatalogColumnSelections;
  for (const scope of CATALOG_COLUMN_SCOPES) {
    clone[scope] = [...selections[scope]];
  }
  return clone;
}

export function fetchCatalogColumnPreferences(): Promise<CatalogColumnsResponse> {
  return api.get<CatalogColumnsResponse>("/api/users/me/catalog-columns");
}

export function updateCatalogColumnPreferences(
  scope: CatalogColumnScope,
  columns: readonly string[],
): Promise<CatalogColumnsResponse> {
  return api.put<CatalogColumnsResponse>("/api/users/me/catalog-columns", {
    scope,
    columns: catalogColumnsForSave(scope, columns),
  });
}
