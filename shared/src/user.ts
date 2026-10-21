import { z } from "zod";
import { idSchema, optionalTextSchema } from "./common.js";

export const UserRoleSchema = z.enum(["admin", "reader", "superadmin"]).catch("reader");

export const UserSchema = z.looseObject({
  uid: idSchema,
  email: optionalTextSchema,
  name: optionalTextSchema,
  role: UserRoleSchema,
  groupId: optionalTextSchema,
  status: optionalTextSchema,
  avatar: optionalTextSchema,
});

export type User = z.infer<typeof UserSchema>;
