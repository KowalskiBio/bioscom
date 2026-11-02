import { describe, expect, it } from "vitest";
import {
  BatchSchema,
  LegacyChemicalMapSchema,
  LocationSchema,
  MATERIAL_TYPES,
  MaterialSchema,
  ProductSchema,
  StockSchema,
  materialTypeLabels,
  validateAttributes,
  validateAttributesAgainstType,
} from "../src/index.js";
import type { MaterialTypeDef } from "../src/index.js";

const timestamps = { created_at: 1760000000000, updated_at: 1760000001000 };

describe("MATERIAL_TYPES", () => {
  it("registers the seven initial types in order", () => {
    expect(MATERIAL_TYPES.map((type) => type.key)).toEqual([
      "chemical",
      "reagent",
      "antibody",
      "primer",
      "solution",
      "biological_stock",
      "other",
    ]);
  });

  it("marks every type with schema version 1 and field definitions", () => {
    for (const type of MATERIAL_TYPES) {
      expect(type.schemaVersion).toBe(1);
      expect(type.fields.length).toBeGreaterThan(0);
    }
  });

  it("exposes the expected chemical and primer fields", () => {
    const chemical = MATERIAL_TYPES.find((type) => type.key === "chemical");
    const primer = MATERIAL_TYPES.find((type) => type.key === "primer");
    expect(chemical?.fields.map((field) => field.key)).toEqual([
      "cas_number",
      "molecular_formula",
      "molecular_weight",
      "safety_notes",
    ]);
    expect(primer?.fields.map((field) => field.key)).toEqual([
      "sequence",
      "sequence_length",
      "modifications",
      "purification",
      "tm_celsius",
    ]);
    expect(chemical?.fields.find((field) => field.key === "cas_number")?.searchable).toBe(true);
    expect(primer?.fields.find((field) => field.key === "sequence")?.dataType).toBe("sequence");
  });

  it("returns labels keyed by type key", () => {
    expect(materialTypeLabels()).toMatchObject({
      chemical: "Chemical / compound",
      antibody: "Antibody",
      biological_stock: "Biological / glycerol stock",
      other: "Other material",
    });
  });
});

describe("validateAttributes", () => {
  it("accepts the Tris base chemical attributes", () => {
    const result = validateAttributes("chemical", {
      cas_number: "77-86-1",
      molecular_weight: 121.14,
      molecular_formula: "C4H11NO3",
    });
    expect(result).toEqual({
      ok: true,
      errors: [],
      value: {
        cas_number: "77-86-1",
        molecular_weight: 121.14,
        molecular_formula: "C4H11NO3",
      },
    });
  });

  it("coerces numeric strings but rejects non-numeric input", () => {
    expect(validateAttributes("chemical", { molecular_weight: "121.14" }).value.molecular_weight).toBe(121.14);
    const result = validateAttributes("chemical", { molecular_weight: "abc" });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("molecular_weight: expected a finite number");
  });

  it("preserves unknown attribute keys as passthrough", () => {
    const result = validateAttributes("chemical", {
      cas_number: "77-86-1",
      legacy_note: "archive drawer 3",
      legacy_flag: true,
    });
    expect(result.ok).toBe(true);
    expect(result.value.legacy_note).toBe("archive drawer 3");
    expect(result.value.legacy_flag).toBe(true);
  });

  it("rejects an unknown material type", () => {
    const result = validateAttributes("wizard_stock", { anything: "x" });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toBe("unknown material type: wizard_stock");
    expect(result.value).toEqual({});
  });

  it("rejects an invalid antibody host species and accepts Rabbit", () => {
    expect(validateAttributes("antibody", { host_species: "Human" }).ok).toBe(false);
    expect(validateAttributes("antibody", { host_species: "Rabbit" }).value.host_species).toBe("Rabbit");
  });

  it("uppercases DNA/IUPAC sequences and rejects other characters", () => {
    expect(validateAttributes("primer", { sequence: "ACGTN" }).value.sequence).toBe("ACGTN");
    expect(validateAttributes("primer", { sequence: " acgtn " }).value.sequence).toBe("ACGTN");
    const invalid = validateAttributes("primer", { sequence: "XYZ123" });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors).toContain("sequence: expected a DNA/IUPAC nucleotide sequence");
  });

  it("accepts year-month and full dates but rejects impossible months", () => {
    const dateType: MaterialTypeDef = {
      key: "dated",
      label: "Dated",
      schemaVersion: 1,
      fields: [{ key: "checked_on", label: "Checked on", dataType: "date", required: false }],
    };
    expect(validateAttributesAgainstType(dateType, { checked_on: "2028-04" }).ok).toBe(true);
    expect(validateAttributesAgainstType(dateType, { checked_on: "2028-04-15" }).ok).toBe(true);
    expect(validateAttributesAgainstType(dateType, { checked_on: "2028-13" }).ok).toBe(false);
  });

  it("allows null for optional fields", () => {
    const result = validateAttributes("solution", { ph: null });
    expect(result.ok).toBe(true);
    expect(result.value.ph).toBeNull();
  });

  it("reports missing required fields from a synthetic type definition", () => {
    const synthetic: MaterialTypeDef = {
      key: "synthetic",
      label: "Synthetic",
      schemaVersion: 1,
      fields: [{ key: "must_fill", label: "Must fill", dataType: "string", required: true }],
    };
    const missing = validateAttributesAgainstType(synthetic, {});
    expect(missing.ok).toBe(false);
    expect(missing.errors).toContain("must_fill: required");
    expect(validateAttributesAgainstType(synthetic, { must_fill: "value" }).ok).toBe(true);
  });
});

describe("material entity schemas", () => {
  it("parses a minimal material and defaults attributes to an empty object", () => {
    const result = MaterialSchema.parse({
      id: "m-tris",
      group_id: "group-a",
      type_key: "chemical",
      name: "Tris base",
      ...timestamps,
    });
    expect(result.attributes).toEqual({});
    expect(result.description).toBeUndefined();
  });

  it("parses a minimal product", () => {
    const result = ProductSchema.parse({
      id: "p-1",
      material_id: "m-tris",
      manufacturer_name: "Sigma-Aldrich",
      ...timestamps,
    });
    expect(result.material_id).toBe("m-tris");
    expect(result.attributes).toEqual({});
  });

  it("defaults an unknown or missing batch origin type", () => {
    const bogus = BatchSchema.parse({
      id: "b-1",
      material_id: "m-tris",
      origin_type: "conjured",
      ...timestamps,
    });
    const missing = BatchSchema.parse({ id: "b-2", material_id: "m-tris", ...timestamps });
    expect(bogus.origin_type).toBe("unknown");
    expect(missing.origin_type).toBe("unknown");
  });

  it("defaults an unknown or missing stock status", () => {
    const bogus = StockSchema.parse({
      id: "chem-1",
      group_id: "group-a",
      batch_id: "b-1",
      location_id: "shelf-a",
      status: "haunted",
      ...timestamps,
    });
    const missing = StockSchema.parse({
      id: "chem-2",
      group_id: "group-a",
      batch_id: "b-1",
      location_id: "shelf-a",
      ...timestamps,
    });
    expect(bogus.status).toBe("unknown");
    expect(missing.status).toBe("unknown");
  });

  it("parses a minimal location and the legacy chemical map", () => {
    const location = LocationSchema.parse({
      id: "room-204",
      group_id: "group-a",
      kind: "room",
      name: "Room 204",
      ...timestamps,
    });
    const map = LegacyChemicalMapSchema.parse({
      group_id: "group-a",
      chemical_id: "chem-1",
      material_id: "m-chem-1",
      batch_id: "b-chem-1",
      stock_id: "chem-1",
      migrated_at: 1760000000000,
    });
    expect(location.kind).toBe("room");
    expect(map.stock_id).toBe("chem-1");
  });
});
