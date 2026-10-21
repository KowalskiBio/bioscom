import { z } from "zod";

export const idSchema = z.string().min(1);

export const epochMsSchema = z.coerce.number().catch(0);

export const looseTextSchema = z.string().catch("");

export const optionalTextSchema = z.string().nullish().catch(undefined);

export const optionalNumberSchema = z.coerce.number().nullish().catch(undefined);

export const optionalBooleanSchema = z.boolean().nullish().catch(undefined);

export const optionalIdSchema = z.string().nullish().catch(undefined);

export function rtdbArray<T extends z.ZodType>(element: T) {
  return z
    .union([z.array(element), z.record(z.string(), element)])
    .transform((value) => (Array.isArray(value) ? value : Object.values(value)));
}

export const LegacyArraySchema = rtdbArray(z.unknown()).catch([]);

export function legacyArray(value: unknown): unknown[] {
  const result = LegacyArraySchema.safeParse(value);
  return result.success ? result.data : [];
}
