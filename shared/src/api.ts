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

export const AddRoomBodySchema = z.object({
  name: z.string().trim().min(1).max(50),
  description: z.string().trim().max(500).optional(),
});

export const EditRoomBodySchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, { message: "empty update" });

export const AddContainerBodySchema = z.object({
  roomId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  emoji: z.string().trim().max(16).optional(),
  type: z.enum(["cabinet", "fridge", "freezer", "deepfreezer"]),
  cabinetMethod: z.enum(["numerical", "alphabetical", "custom"]).optional(),
  customRangeType: z.enum(["alphabetical", "numerical"]).optional(),
  shelves: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
});

export const EditContainerBodySchema = z
  .object({
    roomId: z.string().min(1),
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    emoji: z.string().trim().max(16).optional(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined || value.emoji !== undefined, {
    message: "empty update",
  });

export const AddShelfBodySchema = z.object({
  roomId: z.string().min(1),
  containerId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  parentShelfId: z.string().min(1).optional(),
  rackName: z.string().trim().max(100).optional(),
  boxName: z.string().trim().max(100).optional(),
  isRangeShelf: z.boolean().optional(),
  rangeStart: z.string().trim().max(16).optional(),
  rangeEnd: z.string().trim().max(16).optional(),
});

export const AddChemicalBodySchema = z.object({
  roomId: z.string().min(1),
  containerId: z.string().min(1),
  shelfId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  cas: z.string().trim().max(32).optional(),
  formula: z.string().trim().max(100).optional(),
  quantity: z.number().optional(),
  unit: z.string().trim().max(16).optional(),
  concentration: z.number().optional(),
  concUnit: z.string().trim().max(16).optional(),
  position: z.string().trim().max(32).optional(),
  customPosition: z.string().trim().max(64).optional(),
  note: z.string().max(4000).optional(),
  shelfOverride: z.string().min(1).optional(),
});

export const EditChemicalBodySchema = z
  .object({
    roomId: z.string().min(1),
    containerId: z.string().min(1),
    shelfId: z.string().min(1),
    name: z.string().trim().min(1).max(100).optional(),
    cas: z.string().trim().max(32).optional(),
    formula: z.string().trim().max(100).optional(),
    quantity: z.number().optional(),
    unit: z.string().trim().max(16).optional(),
    concentration: z.number().optional(),
    concUnit: z.string().trim().max(16).optional(),
    position: z.string().trim().max(32).optional(),
    customPosition: z.string().trim().max(64).optional(),
    note: z.string().max(4000).optional(),
    shelfOverride: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.cas !== undefined ||
      value.formula !== undefined ||
      value.quantity !== undefined ||
      value.unit !== undefined ||
      value.concentration !== undefined ||
      value.concUnit !== undefined ||
      value.position !== undefined ||
      value.customPosition !== undefined ||
      value.note !== undefined ||
      value.shelfOverride !== undefined,
    { message: "empty update" },
  );

export const DeleteContainerBodySchema = z.object({
  roomId: z.string().min(1),
});

export const DeleteShelfBodySchema = z.object({
  roomId: z.string().min(1),
  containerId: z.string().min(1),
});

export const DeleteChemicalBodySchema = z.object({
  roomId: z.string().min(1),
  containerId: z.string().min(1),
  shelfId: z.string().min(1),
});

export const AdjustQtyBodySchema = z.object({
  roomId: z.string().min(1),
  containerId: z.string().min(1),
  shelfId: z.string().min(1),
  delta: z.number(),
});

export const MoveChemicalBodySchema = z.object({
  fromRoomId: z.string().min(1),
  fromContainerId: z.string().min(1),
  fromShelfId: z.string().min(1),
  toRoomId: z.string().min(1),
  toContainerId: z.string().min(1),
  toShelfId: z.string().min(1),
  position: z.string().trim().max(32).optional(),
});

export const ShareContainerBodySchema = z.object({
  roomId: z.string().min(1),
  sharedWithGroupId: z.string().min(1),
});

export const UnshareContainerBodySchema = z.object({
  roomId: z.string().min(1),
  sharedWithGroupId: z.string().min(1),
});

export type RegisterBody = z.infer<typeof RegisterBodySchema>;
export type CreateGroupBody = z.infer<typeof CreateGroupBodySchema>;
export type JoinGroupBody = z.infer<typeof JoinGroupBodySchema>;
export type UpdateProfileBody = z.infer<typeof UpdateProfileBodySchema>;
export type UpdateRoleBody = z.infer<typeof UpdateRoleBodySchema>;
export type AddRoomBody = z.infer<typeof AddRoomBodySchema>;
export type EditRoomBody = z.infer<typeof EditRoomBodySchema>;
export type AddContainerBody = z.infer<typeof AddContainerBodySchema>;
export type EditContainerBody = z.infer<typeof EditContainerBodySchema>;
export type AddShelfBody = z.infer<typeof AddShelfBodySchema>;
export type AddChemicalBody = z.infer<typeof AddChemicalBodySchema>;
export type EditChemicalBody = z.infer<typeof EditChemicalBodySchema>;
export type AdjustQtyBody = z.infer<typeof AdjustQtyBodySchema>;
export type MoveChemicalBody = z.infer<typeof MoveChemicalBodySchema>;
