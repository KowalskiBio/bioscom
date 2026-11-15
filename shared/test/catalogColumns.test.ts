import { describe, expect, it } from "vitest";
import {
  CATALOG_COLUMN_SCOPES,
  CATALOG_CORE_COLUMN_KEYS,
  CATALOG_DEFAULT_CORE_COLUMN_KEYS,
  CATALOG_OPTIONAL_CORE_COLUMN_KEYS,
  CATALOG_REQUIRED_COLUMN_KEYS,
  CatalogColumnUpdateSchema,
  MATERIAL_TYPES,
  catalogColumnKeysForScope,
  defaultCatalogColumnSelections,
  defaultCatalogColumnsForScope,
  normalizeCatalogColumnSelection,
} from "../src/index.js";

const CORE = [...CATALOG_CORE_COLUMN_KEYS];
const DEFAULT_CORE = [...CATALOG_DEFAULT_CORE_COLUMN_KEYS];
const ALL_FIELD_KEYS = MATERIAL_TYPES.flatMap((type) => type.fields.map((field) => field.key));
// All uses the canonical stock `note` core column and omits Other's legacy
// `custom_notes` descriptor alias so there is no duplicate Note header.
const ALL_DESCRIPTOR_KEYS = [...new Set(ALL_FIELD_KEYS)].filter((key) => key !== "custom_notes");

describe("catalog column scope registry", () => {
  it("covers All plus every material type key", () => {
    expect(CATALOG_COLUMN_SCOPES).toEqual(["all", ...MATERIAL_TYPES.map((type) => type.key)]);
    expect(CATALOG_COLUMN_SCOPES).toHaveLength(MATERIAL_TYPES.length + 1);
  });

  it("declares the documented core and mandatory keys", () => {
    expect(CORE).toEqual([
      "name",
      "type",
      "quantity",
      "location",
      "lot",
      "received",
      "expires",
      "status",
      "actions",
      "manufacturer",
      "catalog_number",
      "concentration",
      "note",
    ]);
    expect(DEFAULT_CORE).toEqual([
      "name",
      "type",
      "quantity",
      "location",
      "lot",
      "received",
      "expires",
      "status",
      "actions",
    ]);
    expect([...CATALOG_OPTIONAL_CORE_COLUMN_KEYS]).toEqual(["manufacturer", "catalog_number", "concentration", "note"]);
    expect([...CATALOG_REQUIRED_COLUMN_KEYS]).toEqual(["name", "actions"]);
  });
});

describe("catalogColumnKeysForScope", () => {
  it("offers every descriptor once in the All view without the legacy Notes alias", () => {
    const keys = catalogColumnKeysForScope("all");
    expect(keys).toEqual([...CORE, ...ALL_DESCRIPTOR_KEYS]);
    expect(keys).toHaveLength(CORE.length + ALL_DESCRIPTOR_KEYS.length);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of ALL_DESCRIPTOR_KEYS) {
      expect(keys).toContain(key);
    }
    // The canonical stock Note is a core column; Other's descriptor stays in Other.
    expect(keys).toContain("note");
    expect(keys).not.toContain("custom_notes");
    expect(catalogColumnKeysForScope("other")).toContain("custom_notes");
  });

  it("offers only the type's own descriptors for a specific type", () => {
    for (const type of MATERIAL_TYPES) {
      expect(catalogColumnKeysForScope(type.key)).toEqual([...CORE, ...type.fields.map((field) => field.key)]);
    }
    expect(catalogColumnKeysForScope("antibody")).not.toContain("cas_number");
    expect(catalogColumnKeysForScope("chemical")).not.toContain("target");
    expect(catalogColumnKeysForScope("primer")).toContain("target_species");
    expect(catalogColumnKeysForScope("antibody")).not.toContain("target_species");
  });

  it("offers the product-derived extras in every scope", () => {
    for (const scope of CATALOG_COLUMN_SCOPES) {
      const keys = catalogColumnKeysForScope(scope);
      expect(keys).toContain("manufacturer");
      expect(keys).toContain("catalog_number");
    }
  });

  it("reserves core names against descriptor collisions and deduplicates", () => {
    const keys = catalogColumnKeysForScope("all");
    for (const core of CORE) {
      expect(keys.filter((key) => key === core)).toHaveLength(1);
    }
  });
});

describe("defaultCatalogColumnsForScope", () => {
  it("preserves the current catalog defaults without selecting every descriptor", () => {
    expect(defaultCatalogColumnsForScope("all")).toEqual(DEFAULT_CORE);
    expect(defaultCatalogColumnsForScope("other")).toEqual(DEFAULT_CORE);
    expect(defaultCatalogColumnsForScope("chemical")).toEqual([...DEFAULT_CORE, "cas_number", "molecular_weight"]);
    expect(defaultCatalogColumnsForScope("reagent")).toEqual([...DEFAULT_CORE, "formulation", "kit_components"]);
    expect(defaultCatalogColumnsForScope("antibody")).toEqual([...DEFAULT_CORE, "target", "host_species"]);
    expect(defaultCatalogColumnsForScope("primer")).toEqual([...DEFAULT_CORE, "sequence", "sequence_length"]);
    expect(defaultCatalogColumnsForScope("solution")).toEqual([...DEFAULT_CORE, "composition", "ph"]);
    expect(defaultCatalogColumnsForScope("biological_stock")).toEqual([...DEFAULT_CORE, "organism", "strain"]);
    for (const scope of CATALOG_COLUMN_SCOPES) {
      const columns = defaultCatalogColumnsForScope(scope);
      expect(columns).not.toContain("manufacturer");
      expect(columns).not.toContain("catalog_number");
      expect(columns).not.toContain("concentration");
      expect(columns).not.toContain("note");
    }
  });

  it("returns fresh arrays that callers may mutate safely", () => {
    const first = defaultCatalogColumnsForScope("chemical");
    first.push("molecular_formula");
    expect(defaultCatalogColumnsForScope("chemical")).toEqual([...DEFAULT_CORE, "cas_number", "molecular_weight"]);

    const selections = defaultCatalogColumnSelections();
    selections.chemical.push("molecular_formula");
    expect(defaultCatalogColumnSelections().chemical).toEqual([...DEFAULT_CORE, "cas_number", "molecular_weight"]);
    expect(selections.all).not.toBe(defaultCatalogColumnSelections().all);
  });

  it("builds a complete map for every scope", () => {
    const selections = defaultCatalogColumnSelections();
    expect(Object.keys(selections).sort()).toEqual([...CATALOG_COLUMN_SCOPES].sort());
    for (const scope of CATALOG_COLUMN_SCOPES) {
      expect(selections[scope]).toEqual(defaultCatalogColumnsForScope(scope));
    }
  });
});

describe("normalizeCatalogColumnSelection", () => {
  it("maps the legacy All custom_notes alias to the canonical stock Note", () => {
    expect(normalizeCatalogColumnSelection("all", ["name", "actions", "custom_notes"])).toEqual([
      "name",
      "actions",
      "note",
    ]);
  });

  it("deduplicates both Note aliases while preserving the first position", () => {
    expect(normalizeCatalogColumnSelection("all", ["name", "custom_notes", "actions", "note"])).toEqual([
      "name",
      "note",
      "actions",
    ]);
    expect(normalizeCatalogColumnSelection("all", ["name", "actions", "note", "custom_notes"])).toEqual([
      "name",
      "actions",
      "note",
    ]);
  });

  it("leaves other scopes verbatim so Other keeps its material descriptor", () => {
    expect(normalizeCatalogColumnSelection("other", ["name", "actions", "custom_notes", "note"])).toEqual([
      "name",
      "actions",
      "custom_notes",
      "note",
    ]);
    expect(normalizeCatalogColumnSelection("chemical", ["name", "actions", "custom_notes"])).toEqual([
      "name",
      "actions",
      "custom_notes",
    ]);
  });
});

describe("CatalogColumnUpdateSchema", () => {
  it("accepts a permitted selection for the requested scope", () => {
    const parsed = CatalogColumnUpdateSchema.safeParse({
      scope: "antibody",
      columns: ["name", "actions", "target", "clonality"],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown scopes", () => {
    expect(CatalogColumnUpdateSchema.safeParse({ scope: "unknown", columns: ["name", "actions"] }).success).toBe(
      false,
    );
  });

  it("rejects selections missing mandatory name or actions", () => {
    expect(CatalogColumnUpdateSchema.safeParse({ scope: "all", columns: ["type", "actions"] }).success).toBe(false);
    expect(CatalogColumnUpdateSchema.safeParse({ scope: "all", columns: ["name", "type"] }).success).toBe(false);
    expect(CatalogColumnUpdateSchema.safeParse({ scope: "all", columns: [] }).success).toBe(false);
  });

  it("rejects duplicate columns", () => {
    expect(
      CatalogColumnUpdateSchema.safeParse({ scope: "all", columns: ["name", "actions", "name"] }).success,
    ).toBe(false);
    expect(
      CatalogColumnUpdateSchema.safeParse({
        scope: "all",
        columns: ["name", "actions", "custom_notes", "custom_notes"],
      }).success,
    ).toBe(false);
  });

  it("accepts the Note core column in every scope", () => {
    for (const scope of CATALOG_COLUMN_SCOPES) {
      expect(
        CatalogColumnUpdateSchema.safeParse({ scope, columns: ["name", "actions", "note"] }).success,
      ).toBe(true);
    }
  });

  it("normalizes a legacy All custom_notes selection to the stock Note", () => {
    expect(
      CatalogColumnUpdateSchema.parse({ scope: "all", columns: ["name", "actions", "custom_notes"] }),
    ).toEqual({ scope: "all", columns: ["name", "actions", "note"] });
  });

  it("deduplicates note plus the legacy alias without rejecting the pair", () => {
    expect(
      CatalogColumnUpdateSchema.parse({
        scope: "all",
        columns: ["name", "actions", "note", "custom_notes"],
      }),
    ).toEqual({ scope: "all", columns: ["name", "actions", "note"] });
    expect(
      CatalogColumnUpdateSchema.parse({
        scope: "all",
        columns: ["name", "custom_notes", "actions", "note"],
      }),
    ).toEqual({ scope: "all", columns: ["name", "note", "actions"] });
  });

  it("keeps Other's material custom_notes separate and preserves other scopes verbatim", () => {
    expect(
      CatalogColumnUpdateSchema.parse({
        scope: "other",
        columns: ["name", "actions", "note", "custom_notes"],
      }),
    ).toEqual({ scope: "other", columns: ["name", "actions", "note", "custom_notes"] });
    expect(
      CatalogColumnUpdateSchema.safeParse({
        scope: "chemical",
        columns: ["name", "actions", "custom_notes"],
      }).success,
    ).toBe(false);
  });

  it("accepts the optional product-derived extras in every scope", () => {
    for (const scope of CATALOG_COLUMN_SCOPES) {
      expect(
        CatalogColumnUpdateSchema.safeParse({
          scope,
          columns: ["name", "actions", "manufacturer", "catalog_number"],
        }).success,
      ).toBe(true);
    }
  });

  it("accepts optional stock concentration in every scope without selecting it by default", () => {
    for (const scope of CATALOG_COLUMN_SCOPES) {
      expect(defaultCatalogColumnsForScope(scope)).not.toContain("concentration");
      expect(
        CatalogColumnUpdateSchema.safeParse({ scope, columns: ["name", "actions", "concentration"] }).success,
      ).toBe(true);
    }
  });

  it("accepts target_species only for primer, distinct from antibody target", () => {
    expect(
      CatalogColumnUpdateSchema.safeParse({
        scope: "primer",
        columns: ["name", "actions", "sequence", "target_species"],
      }).success,
    ).toBe(true);
    expect(
      CatalogColumnUpdateSchema.safeParse({
        scope: "antibody",
        columns: ["name", "actions", "target", "target_species"],
      }).success,
    ).toBe(false);
    expect(
      CatalogColumnUpdateSchema.safeParse({
        scope: "all",
        columns: ["name", "actions", "target", "target_species"],
      }).success,
    ).toBe(true);
  });

  it("rejects descriptors that do not belong to the requested scope", () => {
    expect(
      CatalogColumnUpdateSchema.safeParse({ scope: "antibody", columns: ["name", "actions", "cas_number"] })
        .success,
    ).toBe(false);
    expect(
      CatalogColumnUpdateSchema.safeParse({ scope: "chemical", columns: ["name", "actions", "target"] }).success,
    ).toBe(false);
  });

  it("rejects arbitrary typed attributes outside the registry", () => {
    expect(
      CatalogColumnUpdateSchema.safeParse({ scope: "all", columns: ["name", "actions", "unknown_field"] }).success,
    ).toBe(false);
  });
});
