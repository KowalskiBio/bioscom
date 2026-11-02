import { z } from "zod";
import {
  idSchema,
  optionalIdSchema,
  optionalNumberSchema,
  optionalTextSchema,
  optionalBooleanSchema,
  looseTextSchema,
  epochMsSchema,
} from "./common.js";

export const MATERIAL_FIELD_DATA_TYPES = [
  "string",
  "text",
  "number",
  "boolean",
  "date",
  "enum",
  "sequence",
] as const;

export type MaterialFieldDataType = (typeof MATERIAL_FIELD_DATA_TYPES)[number];

export interface MaterialFieldDef {
  key: string;
  label: string;
  dataType: MaterialFieldDataType;
  required?: boolean;
  searchable?: boolean;
  unit?: string;
  options?: readonly string[];
}

export interface MaterialTypeDef {
  key: string;
  label: string;
  schemaVersion: 1;
  fields: readonly MaterialFieldDef[];
}

export const MATERIAL_TYPES = [
  {
    key: "chemical",
    label: "Chemical / compound",
    schemaVersion: 1,
    fields: [
      { key: "cas_number", label: "CAS number", dataType: "string", required: false, searchable: true },
      { key: "molecular_formula", label: "Molecular formula", dataType: "string", required: false },
      {
        key: "molecular_weight",
        label: "Molecular weight",
        dataType: "number",
        required: false,
        unit: "g/mol",
      },
      { key: "safety_notes", label: "Safety notes", dataType: "text", required: false },
    ],
  },
  {
    key: "reagent",
    label: "Commercial reagent / kit",
    schemaVersion: 1,
    fields: [
      { key: "formulation", label: "Formulation", dataType: "string", required: false },
      { key: "kit_components", label: "Kit components", dataType: "text", required: false },
      { key: "application", label: "Application", dataType: "string", required: false },
    ],
  },
  {
    key: "antibody",
    label: "Antibody",
    schemaVersion: 1,
    fields: [
      { key: "target", label: "Target", dataType: "string", required: false, searchable: true },
      {
        key: "host_species",
        label: "Host species",
        dataType: "enum",
        required: false,
        options: ["Rabbit", "Mouse", "Goat", "Rat", "Chicken", "Sheep", "Donkey", "Guinea pig", "Other"],
      },
      {
        key: "clonality",
        label: "Clonality",
        dataType: "enum",
        required: false,
        options: ["Monoclonal", "Polyclonal", "Recombinant"],
      },
      { key: "clone_id", label: "Clone", dataType: "string", required: false },
      { key: "conjugate", label: "Conjugate", dataType: "string", required: false },
      { key: "species_reactivity", label: "Species reactivity", dataType: "string", required: false },
      { key: "applications", label: "Applications", dataType: "string", required: false },
    ],
  },
  {
    key: "primer",
    label: "Primer / oligonucleotide",
    schemaVersion: 1,
    fields: [
      { key: "sequence", label: "Sequence (5' to 3')", dataType: "sequence", required: false, searchable: true },
      { key: "sequence_length", label: "Sequence length", dataType: "number", required: false, unit: "nt" },
      { key: "modifications", label: "Modifications", dataType: "string", required: false },
      {
        key: "purification",
        label: "Purification",
        dataType: "enum",
        required: false,
        options: ["Desalted", "HPLC", "PAGE", "Other"],
      },
      { key: "tm_celsius", label: "Tm", dataType: "number", required: false, unit: "°C" },
    ],
  },
  {
    key: "solution",
    label: "Prepared solution / buffer",
    schemaVersion: 1,
    fields: [
      { key: "composition", label: "Composition", dataType: "text", required: false },
      { key: "ph", label: "pH", dataType: "number", required: false },
      { key: "recipe_reference", label: "Recipe reference", dataType: "string", required: false },
      { key: "preparation_notes", label: "Preparation notes", dataType: "text", required: false },
    ],
  },
  {
    key: "biological_stock",
    label: "Biological / glycerol stock",
    schemaVersion: 1,
    fields: [
      { key: "organism", label: "Organism", dataType: "string", required: false, searchable: true },
      { key: "strain", label: "Strain", dataType: "string", required: false },
      { key: "genotype", label: "Genotype", dataType: "string", required: false },
      { key: "plasmid", label: "Plasmid", dataType: "string", required: false },
      { key: "selection_marker", label: "Selection marker", dataType: "string", required: false },
      {
        key: "preservation_method",
        label: "Preservation method",
        dataType: "enum",
        required: false,
        options: ["Glycerol -80°C", "Cryovial LN2", "Lyophilized", "Other"],
      },
    ],
  },
  {
    key: "other",
    label: "Other material",
    schemaVersion: 1,
    fields: [{ key: "custom_notes", label: "Notes", dataType: "text", required: false }],
  },
] as const satisfies readonly MaterialTypeDef[];

export type MaterialTypeKey = (typeof MATERIAL_TYPES)[number]["key"];

export const AttributeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const AttributesSchema = z.record(z.string(), AttributeValueSchema);

export type AttributeValue = z.infer<typeof AttributeValueSchema>;
export type Attributes = z.infer<typeof AttributesSchema>;

export interface AttributeValidationResult {
  ok: boolean;
  errors: string[];
  value: Record<string, AttributeValue>;
}

const SEQUENCE_PATTERN = /^[ACGTURYSWKMBDHVN]+$/i;

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAttributeValue(value: unknown): value is AttributeValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
}

function readAttributeRecord(attrs: unknown, errors: string[]): Record<string, unknown> {
  if (attrs === undefined || attrs === null) return {};
  if (!isPlainRecord(attrs)) {
    errors.push("attributes must be an object");
    return {};
  }
  return attrs;
}

interface FieldValidation {
  present: boolean;
  value?: AttributeValue;
  error?: string;
}

function validateField(field: MaterialFieldDef, raw: unknown): FieldValidation {
  if (raw === undefined) {
    return field.required ? { present: false, error: "required" } : { present: false };
  }
  if (raw === null) {
    return field.required ? { present: false, error: "required" } : { present: true, value: null };
  }

  switch (field.dataType) {
    case "string":
    case "text": {
      if (typeof raw !== "string") return { present: false, error: "expected a string" };
      const trimmed = raw.trim();
      if (field.required && trimmed === "") return { present: false, error: "required" };
      return { present: true, value: trimmed };
    }
    case "number": {
      if (typeof raw !== "string" && typeof raw !== "number") {
        return { present: false, error: "expected a finite number" };
      }
      if (typeof raw === "string" && raw.trim() === "") {
        return { present: false, error: "expected a finite number" };
      }
      const parsed = z.coerce.number().safeParse(raw);
      if (!parsed.success || !Number.isFinite(parsed.data)) {
        return { present: false, error: "expected a finite number" };
      }
      return { present: true, value: parsed.data };
    }
    case "boolean": {
      if (typeof raw !== "boolean") return { present: false, error: "expected a boolean" };
      return { present: true, value: raw };
    }
    case "date": {
      if (typeof raw !== "string") return { present: false, error: "expected YYYY-MM or YYYY-MM-DD" };
      const trimmed = raw.trim();
      if (!DATE_PATTERN.test(trimmed)) return { present: false, error: "expected YYYY-MM or YYYY-MM-DD" };
      return { present: true, value: trimmed };
    }
    case "enum": {
      if (typeof raw !== "string") {
        return { present: false, error: `expected one of ${(field.options ?? []).join(", ")}` };
      }
      const trimmed = raw.trim();
      if (!field.options?.includes(trimmed)) {
        return { present: false, error: `expected one of ${(field.options ?? []).join(", ")}` };
      }
      return { present: true, value: trimmed };
    }
    case "sequence": {
      if (typeof raw !== "string") {
        return { present: false, error: "expected a DNA/IUPAC nucleotide sequence" };
      }
      const trimmed = raw.trim();
      if (!SEQUENCE_PATTERN.test(trimmed)) {
        return { present: false, error: "expected a DNA/IUPAC nucleotide sequence" };
      }
      return { present: true, value: trimmed.toUpperCase() };
    }
    default:
      return { present: false, error: `unsupported data type ${String(field.dataType)}` };
  }
}

export function validateAttributesAgainstType(
  type: MaterialTypeDef,
  attrs: unknown,
): AttributeValidationResult {
  const errors: string[] = [];
  const value: Record<string, AttributeValue> = {};
  const source = readAttributeRecord(attrs, errors);
  const fieldsByKey = new Map(type.fields.map((field) => [field.key, field]));

  for (const [key, raw] of Object.entries(source)) {
    const field = fieldsByKey.get(key);
    if (!field) {
      if (isAttributeValue(raw)) value[key] = raw;
      else errors.push(`${key}: unsupported attribute value`);
      continue;
    }
    const result = validateField(field, raw);
    if (result.error) errors.push(`${key}: ${result.error}`);
    else if (result.present) value[key] = result.value ?? null;
  }

  for (const field of type.fields) {
    if (field.required && !(field.key in source)) errors.push(`${field.key}: required`);
  }

  return { ok: errors.length === 0, errors, value };
}

export function validateAttributes(typeKey: string, attrs: unknown): AttributeValidationResult {
  const type = MATERIAL_TYPES.find((entry) => entry.key === typeKey);
  if (!type) return { ok: false, errors: [`unknown material type: ${typeKey}`], value: {} };
  return validateAttributesAgainstType(type, attrs);
}

export function materialTypeLabels(): Record<string, string> {
  return Object.fromEntries(MATERIAL_TYPES.map((type) => [type.key, type.label]));
}

export const OriginTypeSchema = z.enum(["purchased", "prepared", "derived", "unknown"]).catch("unknown");

export const StockStatusSchema = z
  .enum(["available", "depleted", "discarded", "reserved", "unknown"])
  .catch("unknown");

export const LocationKindSchema = z.enum(["room", "container", "shelf"]);

export const MaterialSchema = z.looseObject({
  id: idSchema,
  group_id: idSchema,
  type_key: z.string().min(1),
  name: looseTextSchema,
  description: optionalTextSchema,
  attributes: AttributesSchema.default({}),
  created_at: epochMsSchema,
  updated_at: epochMsSchema,
  archived_at: optionalNumberSchema,
});

export const ProductSchema = z.looseObject({
  id: idSchema,
  material_id: idSchema,
  manufacturer_name: looseTextSchema,
  supplier_name: optionalTextSchema,
  catalog_number: optionalTextSchema,
  product_name: optionalTextSchema,
  variant: optionalTextSchema,
  attributes: AttributesSchema.default({}),
  created_at: epochMsSchema,
  updated_at: epochMsSchema,
});

export const BatchSchema = z.looseObject({
  id: idSchema,
  material_id: idSchema,
  product_id: optionalIdSchema,
  lot_code: optionalTextSchema,
  origin_type: OriginTypeSchema,
  received_at: optionalNumberSchema,
  prepared_at: optionalNumberSchema,
  prepared_by: optionalTextSchema,
  expires_at: optionalNumberSchema,
  attributes: AttributesSchema.default({}),
  created_at: epochMsSchema,
  updated_at: epochMsSchema,
});

export const StockSchema = z.looseObject({
  id: idSchema,
  group_id: idSchema,
  batch_id: idSchema,
  location_id: idSchema,
  position: optionalTextSchema,
  custom_position: optionalTextSchema,
  shelf_override: optionalTextSchema,
  current_quantity: optionalNumberSchema,
  quantity_unit: optionalTextSchema,
  concentration: optionalNumberSchema,
  concentration_unit: optionalTextSchema,
  note: optionalTextSchema,
  status: StockStatusSchema,
  container_type: optionalTextSchema,
  created_at: epochMsSchema,
  updated_at: epochMsSchema,
});

export const LocationSchema = z.looseObject({
  id: idSchema,
  group_id: idSchema,
  parent_id: optionalIdSchema,
  kind: LocationKindSchema,
  name: looseTextSchema,
  description: optionalTextSchema,
  container_type: optionalTextSchema,
  emoji: optionalTextSchema,
  color: optionalTextSchema,
  rack_name: optionalTextSchema,
  box_name: optionalTextSchema,
  parent_shelf_id: optionalIdSchema,
  is_range_shelf: optionalBooleanSchema,
  range_start: optionalTextSchema,
  range_end: optionalTextSchema,
  owner_group_id: optionalIdSchema,
  owner_group_name: optionalTextSchema,
  rack_positions: z.record(z.string(), z.coerce.number()).nullish().catch(undefined),
  sort_index: optionalNumberSchema,
  created_at: epochMsSchema,
  updated_at: epochMsSchema,
});

export const LegacyChemicalMapSchema = z.looseObject({
  group_id: idSchema,
  chemical_id: idSchema,
  material_id: idSchema,
  batch_id: idSchema,
  stock_id: idSchema,
  migrated_at: epochMsSchema,
});

export type Material = z.infer<typeof MaterialSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type Batch = z.infer<typeof BatchSchema>;
export type Stock = z.infer<typeof StockSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type LegacyChemicalMap = z.infer<typeof LegacyChemicalMapSchema>;
export type OriginType = z.infer<typeof OriginTypeSchema>;
export type StockStatus = z.infer<typeof StockStatusSchema>;
export type LocationKind = z.infer<typeof LocationKindSchema>;
