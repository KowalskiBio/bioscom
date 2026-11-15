import { describe, expect, it } from "vitest";
import type { Chemical, MaterialFieldDef } from "@bioscom/shared";
import {
  chemicalConcentrationText,
  chemicalDateText,
  chemicalDescriptorText,
  chemicalFormulaSource,
  chemicalLegacyStatusText,
  chemicalNoteText,
  chemicalTableModel,
  formatChemicalAttribute,
} from "../src/lib/chemicalColumns";

function chemical(overrides: Record<string, unknown> = {}): Chemical {
  return {
    id: "chem-a",
    name: "Synthetic chemical",
    type: "chemical",
    quantity: 8,
    unit: "g",
    ...overrides,
  } as Chemical;
}

describe("room chemical table model", () => {
  const selection = [
    "name",
    "type",
    "quantity",
    "location",
    "concentration",
    "cas_number",
    "molecular_formula",
    "target_species",
    "manufacturer",
    "catalog_number",
    "lot",
    "received",
    "expires",
    "status",
    "custom_notes",
    "actions",
  ];

  it("maps the legacy All Note alias to actual stock Note immediately before Actions", () => {
    for (const layout of ["room", "detail", "deepfreezer-search"] as const) {
      const model = chemicalTableModel(selection, layout);
      const ids = model.columns.map((column) => column.id);
      expect(ids.at(-2)).toBe("note");
      expect(ids.at(-1)).toBe("actions");
      expect(ids).not.toContain("custom_notes");
      expect(model.columns.filter((column) => column.id === "note")).toHaveLength(1);
      expect(model.selected.has("note")).toBe(true);
    }
  });

  it("keeps quantity and unit under one logical preference with semantic columns", () => {
    const shown = chemicalTableModel(["name", "quantity", "actions"], "room");
    expect(shown.columns.map((column) => column.id)).toEqual(["name", "quantity", "unit", "actions"]);
    expect(shown.columns[1]?.preferenceKey).toBe("quantity");
    expect(shown.columns[2]?.preferenceKey).toBe("quantity");
    expect(shown.columns[1]?.className).toContain("chemical-col-quantity");
    expect(shown.columns[2]?.className).toContain("chemical-col-unit");

    const hidden = chemicalTableModel(["name", "location", "note", "actions"], "room");
    expect(hidden.columns.map((column) => column.id)).toEqual(["name", "location", "note", "actions"]);
  });

  it("hides the room Type column and the detail inline type chip by the same selection", () => {
    const shown = chemicalTableModel(["name", "type", "actions"], "room");
    const hidden = chemicalTableModel(["name", "actions"], "room");
    expect(shown.columns.map((column) => column.id)).toEqual(["name", "type", "actions"]);
    expect(hidden.columns.map((column) => column.id)).toEqual(["name", "actions"]);

    const detail = chemicalTableModel(["name", "actions"], "detail");
    expect(detail.selected.has("type")).toBe(false);
    expect(detail.columns.map((column) => column.id)).toEqual(["name", "actions"]);
    expect(chemicalTableModel(["name", "type", "actions"], "detail").selected.has("type")).toBe(true);
  });

  it("uses Pos. for detail tables and preserves Rack/Box plus Pos. only while location is selected", () => {
    const selected = chemicalTableModel(["name", "location", "actions"], "deepfreezer-search");
    expect(selected.columns.map((column) => column.id)).toEqual(["location", "position", "name", "actions"]);
    expect(selected.columns[0]?.label).toBe("Location");
    expect(selected.columns[1]?.label).toBe("Pos.");

    const hidden = chemicalTableModel(["name", "note", "actions"], "deepfreezer-search");
    expect(hidden.columns.map((column) => column.id)).toEqual(["name", "note", "actions"]);
    expect(hidden.columns.map((column) => column.id)).not.toContain("location");
    expect(hidden.columns.map((column) => column.id)).not.toContain("position");
  });

  it("keeps legacy layouts while account state is unconfirmed", () => {
    expect(chemicalTableModel(["name", "actions"], "room", true).columns.map((column) => column.label)).toEqual([
      "Name",
      "Type",
      "Quantity",
      "Unit",
      "Location",
      "Actions",
    ]);
    expect(chemicalTableModel(["name", "actions"], "detail", true).columns.map((column) => column.label)).toEqual([
      "Pos.",
      "Name",
      "Formula",
      "Qty",
      "Unit",
      "Conc.",
      "CAS",
      "Note",
      "Actions",
    ]);
  });
});

describe("actual room chemical cell values", () => {
  it("uses the real stock Note and only Other's descriptor fallback", () => {
    expect(chemicalNoteText(chemical({ note: "  Actual room stock note  ", attributes: { custom_notes: "Wrong descriptor" } }))).toBe(
      "Actual room stock note",
    );
    expect(chemicalNoteText(chemical({ note: null, attributes: { custom_notes: "Do not leak chemical descriptor" } }))).toBe("—");
    expect(chemicalNoteText(chemical({ type: "other", note: null, attributes: { custom_notes: "Other fallback" } }))).toBe(
      "Other fallback",
    );
    expect(chemicalNoteText(chemical({ type: "other", note: " Other stock note ", attributes: { custom_notes: "Other fallback" } }))).toBe(
      "Other stock note",
    );
  });

  it("uses typed CAS/formula first with legacy top-level fallbacks", () => {
    const casField: MaterialFieldDef = { key: "cas_number", label: "CAS number", dataType: "string" };
    expect(chemicalDescriptorText(chemical({ cas: "50-00-0", attributes: { cas_number: "77-86-1" } }), casField)).toBe(
      "77-86-1",
    );
    expect(chemicalDescriptorText(chemical({ cas: "50-00-0", attributes: { cas_number: " " } }), casField)).toBe("50-00-0");
    expect(chemicalFormulaSource(chemical({ formula: "H2O", attributes: { molecular_formula: "C6H12O6" } }))).toBe(
      "C6H12O6",
    );
    expect(chemicalFormulaSource(chemical({ formula: "H2O", attributes: {} }))).toBe("H2O");
  });

  it("formats real typed descriptor values, including target_species and legitimate zero/false", () => {
    const species: MaterialFieldDef = { key: "target_species", label: "Target species", dataType: "string" };
    const weight: MaterialFieldDef = { key: "molecular_weight", label: "Molecular weight", dataType: "number", unit: "g/mol" };
    const flag: MaterialFieldDef = { key: "flag", label: "Flag", dataType: "boolean" };
    const sequence: MaterialFieldDef = { key: "sequence", label: "Sequence", dataType: "sequence" };
    const row = chemical({ attributes: { target_species: " tobacco ", molecular_weight: 0, flag: false, sequence: "acgu" } });
    expect(chemicalDescriptorText(row, species)).toBe("tobacco");
    expect(chemicalDescriptorText(row, weight)).toBe("0 g/mol");
    expect(chemicalDescriptorText(row, flag)).toBe("No");
    expect(chemicalDescriptorText(row, sequence)).toBe("ACGU");
    expect(chemicalDescriptorText(chemical({ target_species: "guessed legacy top-level field" }), species)).toBe("—");
    expect(formatChemicalAttribute(species, null)).toBe("—");
  });

  it("reads product/batch values and existing date semantics without inventing data", () => {
    const row = chemical({
      product: { manufacturer: "Synthetic manufacturer", catalogNumber: "CAT-0" },
      batchInfo: { lotCode: "LOT-0", receivedAt: 0, expiresAt: Date.UTC(2027, 0, 2) },
    });
    expect(row.product?.manufacturer).toBe("Synthetic manufacturer");
    expect(chemicalDateText(row.batchInfo?.receivedAt)).toBe("1970-01-01");
    expect(chemicalDateText(row.batchInfo?.expiresAt)).toBe("2027-01-02");
    expect(chemicalDateText(null)).toBe("—");
  });

  it("preserves zero concentration with its unit and uses an em dash only when absent", () => {
    expect(chemicalConcentrationText(chemical({ concentration: 0, concUnit: "mM" }))).toBe("0 mM");
    expect(chemicalConcentrationText(chemical({ concentration: 2.5, concUnit: " µM " }))).toBe("2.5 µM");
    expect(chemicalConcentrationText(chemical({ concentration: 1, concUnit: null }))).toBe("1");
    expect(chemicalConcentrationText(chemical({ concentration: null, concUnit: "mM" }))).toBe("—");
    expect(chemicalConcentrationText(chemical({ concentration: Number.NaN, concUnit: "mM" }))).toBe("—");
  });

  it("displays only an actual legacy status string, never quantity-derived availability", () => {
    expect(chemicalLegacyStatusText(chemical({ quantity: 0 }))).toBe("—");
    expect(chemicalLegacyStatusText(chemical({ quantity: 100 }))).toBe("—");
    expect(chemicalLegacyStatusText(chemical({ quantity: 100, status: " archived " }))).toBe("archived");
    expect(chemicalLegacyStatusText(chemical({ status: 7 }))).toBe("—");
  });
});
