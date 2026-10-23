import { z } from "zod";

export const RegisterBodySchema = z.object({
  email: z.email().max(254),
  password: z.string().min(6).max(1024),
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

const ShelfSpecSchema = z.union([
  z.string().trim().min(1).max(100),
  z.object({
    name: z.string().trim().min(1).max(100),
    isRangeShelf: z.boolean().optional(),
    rangeStart: z.string().trim().max(16).optional(),
    rangeEnd: z.string().trim().max(16).optional(),
  }),
]);

export const AddContainerBodySchema = z.object({
  roomId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  emoji: z.string().trim().max(16).optional(),
  type: z.enum(["cabinet", "fridge", "freezer", "deepfreezer"]),
  cabinetMethod: z.enum(["numerical", "alphabetical", "custom"]).optional(),
  customRangeType: z.enum(["alphabetical", "numerical"]).optional(),
  shelves: z.array(ShelfSpecSchema).max(50).optional(),
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

export const EditShelfBodySchema = z
  .object({
    roomId: z.string().min(1),
    containerId: z.string().min(1),
    name: z.string().trim().min(1).max(100).optional(),
    color: z.string().trim().max(32).optional(),
  })
  .refine((value) => value.name !== undefined || value.color !== undefined, { message: "empty update" });

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

export const AddProtocolBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(8000).optional(),
});

export const EditProtocolBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().max(8000).optional(),
  })
  .refine((value) => value.title !== undefined || value.content !== undefined, { message: "empty update" });

export const AddAssetRoomBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const EditAssetRoomBodySchema = z
  .object({ name: z.string().trim().min(1).max(100).optional() })
  .refine((value) => value.name !== undefined, { message: "empty update" });

export const AddAssetBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  model: z.string().trim().max(200).optional(),
  barcode: z.string().trim().max(64).optional(),
  description: z.string().max(4000).optional(),
  roomId: z.string().trim().max(64).optional(),
});

export const EditAssetBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    model: z.string().trim().max(200).optional(),
    barcode: z.string().trim().max(64).optional(),
    description: z.string().max(4000).optional(),
    roomId: z.string().trim().max(64).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "empty update" });

export const CreateNoticeBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(4000),
  category: z.enum(["suggestion", "issue", "info", "general"]),
});

export const UpdateNoticeBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(4000).optional(),
    category: z.enum(["suggestion", "issue", "info", "general"]).optional(),
  })
  .refine((value) => value.title !== undefined || value.content !== undefined || value.category !== undefined, {
    message: "empty update",
  });

export const ReactionBodySchema = z.object({
  text: z.string().trim().min(1).max(16),
});

export const CreateInstrumentBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  location: z.string().trim().min(1).max(200),
  contactPerson: z.string().trim().max(200).optional(),
  contactEmail: z.string().trim().max(254).optional(),
});

export const UpdateInstrumentBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).optional(),
    location: z.string().trim().min(1).max(200).optional(),
    contactPerson: z.string().trim().max(200).optional(),
    contactEmail: z.string().trim().max(254).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "empty update" });

export const BookingBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  note: z.string().trim().max(1000).optional(),
});

export const CreateCatalogItemBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  category: z.string().trim().max(100).optional(),
  material: z.string().trim().max(100).optional(),
  estimatedTime: z.string().trim().max(100).optional(),
  image: z.string().max(1_000_000).optional(),
});

export const UpdateCatalogItemBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).optional(),
    category: z.string().trim().max(100).optional(),
    material: z.string().trim().max(100).optional(),
    estimatedTime: z.string().trim().max(100).optional(),
    image: z.string().max(1_000_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "empty update" });

export const CreatePrintRequestBodySchema = z.object({
  catalogItemId: z.string().trim().max(100).optional(),
  catalogItemName: z.string().trim().max(200).optional(),
  customDesign: z.boolean().optional(),
  note: z.string().trim().max(2000).optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
});

export const PrintStatusBodySchema = z.object({
  status: z.string().trim().min(1).max(32),
});

export const CreateGameBodySchema = z.object({
  gameType: z.enum(["chess", "frog"]),
  opponentUid: z.string().min(1),
});

export const ChessMoveBodySchema = z.object({
  board: z.array(z.array(z.string())).min(8).max(8),
  turn: z.enum(["white", "black"]),
});

export const FrogAnswerBodySchema = z.object({
  round: z.number().int().min(0).max(100),
  score: z.number().int().min(0).max(100),
});

export const FinishGameBodySchema = z.object({
  winnerUid: z.string().min(1).optional(),
});

export const TreeReplaceBodySchema = z.object({
  tree: z.custom<unknown>(),
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
export type EditShelfBody = z.infer<typeof EditShelfBodySchema>;
export type AddChemicalBody = z.infer<typeof AddChemicalBodySchema>;
export type EditChemicalBody = z.infer<typeof EditChemicalBodySchema>;
export type AdjustQtyBody = z.infer<typeof AdjustQtyBodySchema>;
export type MoveChemicalBody = z.infer<typeof MoveChemicalBodySchema>;
export type AddProtocolBody = z.infer<typeof AddProtocolBodySchema>;
export type EditProtocolBody = z.infer<typeof EditProtocolBodySchema>;
export type AddAssetRoomBody = z.infer<typeof AddAssetRoomBodySchema>;
export type EditAssetRoomBody = z.infer<typeof EditAssetRoomBodySchema>;
export type AddAssetBody = z.infer<typeof AddAssetBodySchema>;
export type EditAssetBody = z.infer<typeof EditAssetBodySchema>;
