import { z } from "zod";
import {
  idSchema,
  looseTextSchema,
  optionalTextSchema,
  optionalNumberSchema,
  optionalBooleanSchema,
} from "./common.js";

export const PrintCatalogItemSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
  description: optionalTextSchema,
  category: optionalTextSchema,
  material: optionalTextSchema,
  estimatedTime: optionalTextSchema,
  image: optionalTextSchema,
});

export const PrintRequestSchema = z.looseObject({
  id: idSchema,
  catalogItemId: optionalTextSchema,
  catalogItemName: optionalTextSchema,
  customDesign: optionalBooleanSchema,
  note: optionalTextSchema,
  quantity: optionalNumberSchema,
  requestDate: optionalTextSchema,
  requestedBy: optionalTextSchema,
  requestedByUid: optionalTextSchema,
  requestedByLabName: optionalTextSchema,
  status: optionalTextSchema,
});

export type PrintCatalogItem = z.infer<typeof PrintCatalogItemSchema>;
export type PrintRequest = z.infer<typeof PrintRequestSchema>;
