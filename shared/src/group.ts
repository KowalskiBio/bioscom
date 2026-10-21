import { z } from "zod";
import { idSchema, looseTextSchema, epochMsSchema, optionalTextSchema } from "./common.js";

export const GroupSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
  joinCode: optionalTextSchema,
  created: epochMsSchema,
});

export type Group = z.infer<typeof GroupSchema>;
