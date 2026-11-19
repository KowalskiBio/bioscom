import { describe, expect, it } from "vitest";
import {
  AddChemicalBodySchema,
  ChemicalSchema,
  EditChemicalBodySchema,
  StockStatusSchema,
  chemicalAvailability,
  chemicalAvailabilityClass,
} from "../src/index.js";

describe("chemicalAvailability", () => {
  it("derives out_of_stock for zero, missing and non-finite quantities", () => {
    expect(chemicalAvailability({ quantity: 0 })).toBe("out_of_stock");
    expect(chemicalAvailability({})).toBe("out_of_stock");
    expect(chemicalAvailability({ quantity: null })).toBe("out_of_stock");
    expect(chemicalAvailability({ quantity: Number.NaN })).toBe("out_of_stock");
    expect(chemicalAvailability({ quantity: Number.POSITIVE_INFINITY })).toBe("out_of_stock");
  });

  it("honours an explicit low mark on a positive quantity", () => {
    expect(chemicalAvailability({ quantity: 1, availability: "low" })).toBe("low");
    expect(chemicalAvailability({ quantity: 250, availability: "low" })).toBe("low");
  });

  it("treats a missing or explicit available mark as available", () => {
    expect(chemicalAvailability({ quantity: 1 })).toBe("available");
    expect(chemicalAvailability({ quantity: 250, availability: "available" })).toBe("available");
  });

  it("keeps a stored low mark out of stock when the quantity is zero", () => {
    expect(chemicalAvailability({ quantity: 0, availability: "low" })).toBe("out_of_stock");
  });

  it("maps derived availability onto the existing UI class names", () => {
    expect(chemicalAvailabilityClass({ quantity: 0, availability: "low" })).toBe("low");
    expect(chemicalAvailabilityClass({ quantity: 5, availability: "low" })).toBe("medium");
    expect(chemicalAvailabilityClass({ quantity: 5 })).toBe("ok");
    expect(chemicalAvailabilityClass({ quantity: 5, availability: "available" })).toBe("ok");
    expect(chemicalAvailabilityClass({})).toBe("low");
  });
});

describe("ChemicalSchema availability", () => {
  it("accepts explicit available and low values", () => {
    expect(ChemicalSchema.parse({ id: "c1", name: "Tris", quantity: 5, availability: "low" }).availability).toBe("low");
    expect(
      ChemicalSchema.parse({ id: "c2", name: "Tris", quantity: 5, availability: "available" }).availability,
    ).toBe("available");
  });

  it("degrades corrupt or missing availability like other optional fields", () => {
    const corrupt = ChemicalSchema.parse({ id: "c3", name: "Tris", quantity: 5, availability: "plenty" });
    const missing = ChemicalSchema.parse({ id: "c4", name: "Tris", quantity: 5 });
    expect(corrupt.availability).toBeUndefined();
    expect(missing.availability).toBeUndefined();
    expect(chemicalAvailability(corrupt)).toBe("available");
  });
});

describe("StockStatusSchema", () => {
  it("accepts the derived low and out_of_stock statuses", () => {
    expect(StockStatusSchema.parse("low")).toBe("low");
    expect(StockStatusSchema.parse("out_of_stock")).toBe("out_of_stock");
  });

  it("still normalizes unknown values to unknown", () => {
    expect(StockStatusSchema.parse("haunted")).toBe("unknown");
    expect(StockStatusSchema.parse(undefined)).toBe("unknown");
  });
});

describe("chemical body schemas availability", () => {
  it("accepts valid availability on create and edit", () => {
    expect(AddChemicalBodySchema.safeParse({ roomId: "r1", name: "Tris", availability: "low" }).success).toBe(true);
    expect(
      AddChemicalBodySchema.safeParse({ roomId: "r1", name: "Tris", availability: "available" }).success,
    ).toBe(true);
    expect(EditChemicalBodySchema.safeParse({ roomId: "r1", availability: "low" }).success).toBe(true);
    expect(EditChemicalBodySchema.safeParse({ roomId: "r1", availability: "available" }).success).toBe(true);
  });

  it("allows availability to be omitted on create and edit", () => {
    expect(AddChemicalBodySchema.safeParse({ roomId: "r1", name: "Tris" }).success).toBe(true);
    expect(EditChemicalBodySchema.safeParse({ roomId: "r1", name: "Tris" }).success).toBe(true);
  });

  it("rejects invalid availability values", () => {
    expect(AddChemicalBodySchema.safeParse({ roomId: "r1", name: "Tris", availability: "plenty" }).success).toBe(
      false,
    );
    expect(EditChemicalBodySchema.safeParse({ roomId: "r1", availability: "plenty" }).success).toBe(false);
  });
});
