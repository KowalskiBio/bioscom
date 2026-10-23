import { z } from "zod";

export const RegisterBodySchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(1024),
  name: z.string().trim().min(1).max(100),
});

export const CreateGroupBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const JoinGroupBodySchema = z.object({
  code: z.string().trim().min(4).max(32),
});

export const UpdateProfileBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    avatar: z.string().max(500_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "empty update" });

export const UpdateRoleBodySchema = z.object({
  role: z.enum(["admin", "reader", "superadmin"]),
});

export type RegisterBody = z.infer<typeof RegisterBodySchema>;
export type CreateGroupBody = z.infer<typeof CreateGroupBodySchema>;
export type JoinGroupBody = z.infer<typeof JoinGroupBodySchema>;
export type UpdateProfileBody = z.infer<typeof UpdateProfileBodySchema>;
export type UpdateRoleBody = z.infer<typeof UpdateRoleBodySchema>;
