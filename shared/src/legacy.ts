import { z } from "zod";
import { LegacyArraySchema } from "./common.js";

export const LegacyGroupDocSchema = z.looseObject({
  rooms: LegacyArraySchema,
  assetRooms: LegacyArraySchema,
  assets: LegacyArraySchema,
  protocols: LegacyArraySchema,
  instruments: LegacyArraySchema,
  notices: LegacyArraySchema,
  printCatalog: LegacyArraySchema,
  printRequests: LegacyArraySchema,
});

export type LegacyGroupDoc = z.infer<typeof LegacyGroupDocSchema>;
