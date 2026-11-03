import { z } from "zod";
import {
  idSchema,
  optionalIdSchema,
  looseTextSchema,
  optionalTextSchema,
  optionalNumberSchema,
  optionalBooleanSchema,
  rtdbArray,
} from "./common.js";
import { InstrumentSchema } from "./instrument.js";
import { NoticeSchema } from "./notice.js";
import { PrintCatalogItemSchema, PrintRequestSchema } from "./print.js";

export const ContainerTypeSchema = z.enum(["cabinet", "fridge", "freezer", "crate", "deepfreezer"]);
export const SubContainerTypeSchema = z.enum(["shelf", "door_shelf", "crate", "box"]);
export type SubContainerType = z.infer<typeof SubContainerTypeSchema>;

export const StockProductSchema = z.looseObject({
  manufacturer: optionalTextSchema,
  supplier: optionalTextSchema,
  catalogNumber: optionalTextSchema,
  productName: optionalTextSchema,
  variant: optionalTextSchema,
});

export const BatchInfoSchema = z.looseObject({
  lotCode: optionalTextSchema,
  originType: z.enum(["purchased", "prepared", "derived", "unknown"]).optional(),
  receivedAt: optionalNumberSchema,
  preparedAt: optionalNumberSchema,
  preparedBy: optionalTextSchema,
  expiresAt: optionalNumberSchema,
});

const ChemicalAttributesDocSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .nullish()
  .catch(undefined);

export const ChemicalSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
  cas: optionalTextSchema,
  formula: optionalTextSchema,
  quantity: optionalNumberSchema,
  unit: optionalTextSchema,
  concentration: optionalNumberSchema,
  concUnit: optionalTextSchema,
  position: optionalTextSchema,
  customPosition: optionalTextSchema,
  _shelfOverride: optionalTextSchema,
  note: optionalTextSchema,
  barcode: optionalTextSchema,
  type: optionalTextSchema,
  attributes: ChemicalAttributesDocSchema,
  product: StockProductSchema.nullish().catch(undefined),
  batchInfo: BatchInfoSchema.nullish().catch(undefined),
});

export const ShelfSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
  type: SubContainerTypeSchema.optional(),
  color: optionalTextSchema,
  parentShelfId: optionalIdSchema,
  boxName: optionalTextSchema,
  rackName: optionalTextSchema,
  isRangeShelf: optionalBooleanSchema,
  rangeStart: optionalTextSchema,
  rangeEnd: optionalTextSchema,
  chemicals: rtdbArray(ChemicalSchema).catch([]),
});

const containerFields = {
  id: idSchema,
  name: looseTextSchema,
  description: optionalTextSchema,
  emoji: optionalTextSchema,
  type: ContainerTypeSchema,
  cabinetMethod: optionalTextSchema,
  customRangeType: optionalTextSchema,
  ownerGroupId: optionalTextSchema,
  ownerGroupName: optionalTextSchema,
  sharedWithGroupId: optionalTextSchema,
  sharedWithGroupIds: rtdbArray(idSchema).catch([]),
  rackPositions: z.record(z.string(), z.coerce.number()).nullish().catch(undefined),
  shelves: z.array(ShelfSchema),
  chemicals: rtdbArray(ChemicalSchema).nullish().catch(undefined),
};

export const ContainerSchema = z.looseObject(containerFields);

export const SharedContainerRefSchema = z.looseObject({
  ...containerFields,
  ownerGroupId: idSchema,
});

export const RoomSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
  description: optionalTextSchema,
  containers: rtdbArray(ContainerSchema).catch([]),
  chemicals: rtdbArray(ChemicalSchema).nullish().catch(undefined),
});

export const AssetRoomSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
});

export const AssetSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
  model: optionalTextSchema,
  description: optionalTextSchema,
  barcode: optionalTextSchema,
  barcodeImg: optionalTextSchema,
  roomId: optionalTextSchema,
});

export const ProtocolSchema = z.looseObject({
  id: idSchema,
  title: looseTextSchema,
  content: optionalTextSchema,
});

export const InventoryTreeSchema = z.looseObject({
  rooms: rtdbArray(RoomSchema).catch([]),
  assetRooms: rtdbArray(AssetRoomSchema).catch([]),
  assets: rtdbArray(AssetSchema).catch([]),
  protocols: rtdbArray(ProtocolSchema).catch([]),
  instruments: rtdbArray(InstrumentSchema).catch([]),
  notices: rtdbArray(NoticeSchema).catch([]),
  printCatalog: rtdbArray(PrintCatalogItemSchema).catch([]),
  printRequests: rtdbArray(PrintRequestSchema).catch([]),
});

export const SandboxTreeSchema = InventoryTreeSchema;

export type Chemical = z.infer<typeof ChemicalSchema>;
export type StockProduct = z.infer<typeof StockProductSchema>;
export type BatchInfo = z.infer<typeof BatchInfoSchema>;
export type Shelf = z.infer<typeof ShelfSchema>;
export type Container = z.infer<typeof ContainerSchema>;
export type SharedContainerRef = z.infer<typeof SharedContainerRefSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type AssetRoom = z.infer<typeof AssetRoomSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Protocol = z.infer<typeof ProtocolSchema>;
export type InventoryTree = z.infer<typeof InventoryTreeSchema>;
export type SandboxTree = InventoryTree;
export type ContainerType = z.infer<typeof ContainerTypeSchema>;
