import { z } from "zod";
import { idSchema, epochMsSchema } from "./common.js";

export const BackupSchema = z.looseObject({
  id: idSchema,
  timestamp: epochMsSchema,
  data: z.unknown(),
});

export type Backup = z.infer<typeof BackupSchema>;
