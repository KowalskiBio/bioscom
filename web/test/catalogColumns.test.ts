import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalogColumnKeysForScope,
  defaultCatalogColumnSelections,
  defaultCatalogColumnsForScope,
  type CatalogColumnScope,
} from "@bioscom/shared";
import {
  catalogCoreColumnLabel,
  catalogColumnsForSave,
  catalogDescriptorFieldsForSelection,
  catalogScopeForTypeFilter,
  fetchCatalogColumnPreferences,
  updateCatalogColumnPreferences,
} from "../src/lib/catalogColumns";
import { resetConnection } from "../src/lib/stores/connection.svelte";

let fetchCalls: Array<{ url: string; init: RequestInit }> = [];
let responseBody: unknown = {};

beforeEach(() => {
  fetchCalls = [];
  responseBody = { columnsByType: defaultCatalogColumnSelections(), updatedAt: 0 };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetConnection();
});

describe("catalog column presentation", () => {
  it("maps only the empty Packages filter to the all preference scope", () => {
    expect(catalogScopeForTypeFilter("")).toBe("all");
    expect(catalogScopeForTypeFilter("chemical")).toBe("chemical");
    expect(catalogScopeForTypeFilter("biological_stock")).toBe("biological_stock");
  });

  it("honors selected chemical descriptors instead of a hardcoded first-two list", () => {
    const fields = catalogDescriptorFieldsForSelection("chemical", [
      "name",
      "actions",
      "molecular_weight",
      "safety_notes",
      "target",
    ]);
    expect(fields.map((field) => field.key)).toEqual(["molecular_weight", "safety_notes"]);
    expect(fields[0]?.unit).toBe("g/mol");
  });

  it("resolves the selected All descriptors across material registries", () => {
    const fields = catalogDescriptorFieldsForSelection("all", [
      "cas_number",
      "target",
      "sequence",
      "organism",
      "note",
      "custom_notes",
    ]);
    // All uses the canonical stock Note core column, so Other's legacy
    // `custom_notes` descriptor must not appear as an extra Notes column.
    expect(fields.map((field) => field.key)).toEqual(["cas_number", "target", "sequence", "organism"]);
    expect(catalogDescriptorFieldsForSelection("antibody", ["cas_number", "target"])).toEqual([
      expect.objectContaining({ key: "target", label: "Target" }),
    ]);
  });

  it("keeps Other's own custom_notes descriptor selectable in the Other view", () => {
    expect(
      catalogDescriptorFieldsForSelection("other", ["note", "custom_notes"]).map((field) => field.key),
    ).toEqual(["custom_notes"]);
  });

  it("keeps the All permit list deduplicated and sends only valid selected keys", () => {
    const permitted = catalogColumnKeysForScope("all");
    expect(new Set(permitted).size).toBe(permitted.length);
    expect(permitted).toEqual(expect.arrayContaining(["cas_number", "target", "sequence", "target_species"]));

    expect(catalogColumnsForSave("primer", ["sequence", "location", "not_a_column"])).toEqual([
      "name",
      "location",
      "actions",
      "sequence",
    ]);
  });

  it("offers manufacturer, catalog number, concentration and the stock Note in every scope, without defaults", () => {
    for (const scope of ["all", "chemical", "primer", "antibody", "other"] as const) {
      expect(catalogColumnKeysForScope(scope)).toEqual(
        expect.arrayContaining(["manufacturer", "catalog_number", "concentration", "note"]),
      );
      expect(defaultCatalogColumnsForScope(scope)).not.toContain("manufacturer");
      expect(defaultCatalogColumnsForScope(scope)).not.toContain("catalog_number");
      expect(defaultCatalogColumnsForScope(scope)).not.toContain("concentration");
      expect(defaultCatalogColumnsForScope(scope)).not.toContain("note");
    }
    expect(catalogCoreColumnLabel("manufacturer")).toBe("Manufacturer");
    expect(catalogCoreColumnLabel("catalog_number")).toBe("Catalog number");
    expect(catalogCoreColumnLabel("concentration")).toBe("Concentration");
    expect(catalogCoreColumnLabel("note")).toBe("Note");
    expect(catalogColumnKeysForScope("all")).not.toContain("custom_notes");
    expect(catalogColumnKeysForScope("other")).toContain("custom_notes");
  });

  it("normalizes a legacy All custom_notes draft to the canonical stock Note on save", () => {
    expect(catalogColumnsForSave("all", ["name", "actions", "custom_notes"])).toEqual([
      "name",
      "actions",
      "note",
    ]);
    expect(catalogColumnsForSave("other", ["name", "actions", "custom_notes", "note"])).toEqual([
      "name",
      "actions",
      "note",
      "custom_notes",
    ]);
  });

  it("saves product extras and primer target_species while leaving descriptors to the type fields", () => {
    expect(
      catalogColumnsForSave("primer", ["manufacturer", "catalog_number", "target_species", "sequence"]),
    ).toEqual(["name", "actions", "manufacturer", "catalog_number", "sequence", "target_species"]);

    expect(
      catalogDescriptorFieldsForSelection("primer", [
        "manufacturer",
        "catalog_number",
        "target_species",
      ]).map((field) => field.key),
    ).toEqual(["target_species"]);

    expect(
      catalogDescriptorFieldsForSelection("all", ["target", "target_species"]).map((field) => field.key),
    ).toEqual(["target", "target_species"]);
  });
});

describe("catalog column API client", () => {
  it("loads account preferences from the user endpoint", async () => {
    await fetchCatalogColumnPreferences();
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("/api/users/me/catalog-columns");
    expect(fetchCalls[0]?.init.method).toBe("GET");
  });

  it("updates one scope with a filtered, complete payload", async () => {
    const scope: CatalogColumnScope = "antibody";
    await updateCatalogColumnPreferences(scope, ["target", "status", "unknown", "target"]);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("/api/users/me/catalog-columns");
    expect(fetchCalls[0]?.init.method).toBe("PUT");
    expect(JSON.parse(String(fetchCalls[0]?.init.body))).toEqual({
      scope: "antibody",
      columns: ["name", "status", "actions", "target"],
    });
  });
});
