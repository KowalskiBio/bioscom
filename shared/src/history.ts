import { z } from "zod";
import { looseTextSchema, epochMsSchema } from "./common.js";

export const HistoryEntrySchema = z.looseObject({
  timestamp: epochMsSchema,
  user: looseTextSchema,
  action: looseTextSchema,
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
