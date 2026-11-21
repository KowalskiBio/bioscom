import type { ChemicalAvailability, Container } from "@bioscom/shared";
import { api, ApiError } from "./api";
import { currentGroup } from "./stores/currentGroup.svelte";
import { session } from "./stores/session.svelte";
import { showToast } from "./stores/toast.svelte";
import { getFirstLetter, findRangeShelf, countChems } from "./inventoryUtils";
import type { GridSettings } from "./grid";
import type { HighlightColorId } from "./highlight";

const gid = (): string => {
  const id = currentGroup.groupId;
  if (id === null) {
    throw new ApiError(400, "No lab selected");
  }
  return id;
};

async function run(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (error) {
    if (error instanceof ApiError) {
      showToast(error.message, "error");
    } else {
      showToast(label, "error");
    }
    return false;
  }
}

async function runGridSettings(label: string, path: string, settings: GridSettings): Promise<boolean> {
  try {
    await api.put(path, settings);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      showToast("The grid can’t be shrunk because items still use slots outside the new size. Move those items first or choose a larger grid.", "error");
    } else if (error instanceof ApiError) {
      showToast(error.message, "error");
    } else {
      showToast(label, "error");
    }
    return false;
  }
}

export function opAddRoom(name: string, description?: string, highlightColor?: HighlightColorId): Promise<boolean> {
  return run("Failed to add room", () =>
    api.post(`/api/groups/${gid()}/inventory/rooms`, {
      name,
      description,
      ...(highlightColor !== undefined ? { highlightColor } : {}),
    }),
  );
}

export function opEditRoom(
  roomId: string,
  name: string,
  description?: string,
  highlightColor?: HighlightColorId | null,
): Promise<boolean> {
  return run("Failed to save room", () =>
    api.put(`/api/groups/${gid()}/inventory/rooms/${roomId}`, {
      name,
      description,
      ...(highlightColor !== undefined ? { highlightColor } : {}),
    }),
  );
}

export function opDeleteRoom(roomId: string): Promise<boolean> {
  return run("Failed to delete room", () => api.del(`/api/groups/${gid()}/inventory/rooms/${roomId}`));
}

export function opSetRoomGrid(settings: GridSettings): Promise<boolean> {
  return runGridSettings("Failed to save room grid", `/api/groups/${gid()}/inventory/room-grid`, settings);
}

export function opMoveRoomGrid(roomId: string, slot: number): Promise<boolean> {
  return run("Failed to move room", () =>
    api.post(`/api/groups/${gid()}/inventory/room-grid/move`, { roomId, slot }),
  );
}

export type ShelfSpec = string | { name: string; isRangeShelf?: boolean; rangeStart?: string; rangeEnd?: string };

export function opAddContainer(body: {
  roomId: string;
  name: string;
  description?: string;
  emoji?: string;
  highlightColor?: HighlightColorId;
  type: "cabinet" | "fridge" | "freezer" | "deepfreezer";
  cabinetMethod?: "numerical" | "alphabetical" | "custom";
  customRangeType?: "alphabetical" | "numerical";
  shelves?: ShelfSpec[];
}): Promise<boolean> {
  return run("Failed to add container", () => {
    const { highlightColor, ...requestBody } = body;
    return api.post(`/api/groups/${gid()}/inventory/containers`, {
      ...requestBody,
      ...(highlightColor !== undefined ? { highlightColor } : {}),
    });
  });
}

export function opEditContainer(
  roomId: string,
  containerId: string,
  body: { name?: string; description?: string; emoji?: string; highlightColor?: HighlightColorId | null },
): Promise<boolean> {
  return run("Failed to save container", () =>
    api.put(`/api/groups/${gid()}/inventory/containers/${containerId}`, { roomId, ...body }),
  );
}

export function opDeleteContainer(roomId: string, containerId: string): Promise<boolean> {
  return run("Failed to delete container", () =>
    api.del(`/api/groups/${gid()}/inventory/containers/${containerId}`, { roomId }),
  );
}

export function opSetContainerGrid(roomId: string, settings: GridSettings): Promise<boolean> {
  return runGridSettings(
    "Failed to save container grid",
    `/api/groups/${gid()}/inventory/rooms/${encodeURIComponent(roomId)}/container-grid`,
    settings,
  );
}

export function opMoveContainerGrid(roomId: string, containerId: string, slot: number): Promise<boolean> {
  return run("Failed to move container", () =>
    api.post(`/api/groups/${gid()}/inventory/rooms/${encodeURIComponent(roomId)}/container-grid/move`, { containerId, slot }),
  );
}

export function opDeleteContainerGrid(roomId: string): Promise<boolean> {
  return run("Failed to restore default container view", () =>
    api.del(`/api/groups/${gid()}/inventory/rooms/${encodeURIComponent(roomId)}/container-grid`),
  );
}

export async function opAddDeepFreezer(
  name: string,
  description?: string,
  emoji?: string,
  grid?: { rackRows: number; rackColumns: number; rackShelves?: number },
): Promise<string | null> {
  try {
    const result = await api.post<{ tree: { deepFreezers?: Container[] } }>(
      `/api/groups/${gid()}/inventory/deepfreezers`,
      {
        name,
        ...(description !== undefined ? { description } : {}),
        ...(emoji !== undefined ? { emoji } : {}),
        ...(grid !== undefined ? grid : {}),
      },
    );
    const freezers = result.tree.deepFreezers ?? [];
    return freezers[freezers.length - 1]?.id ?? null;
  } catch (error) {
    if (error instanceof ApiError) {
      showToast(error.message, "error");
    } else {
      showToast("Failed to add deep freezer", "error");
    }
    return null;
  }
}

export async function opAddDeepFreezerRack(freezerId: string, name: string, slot?: number): Promise<boolean> {
  try {
    await api.post(`/api/groups/${gid()}/inventory/deepfreezers/${encodeURIComponent(freezerId)}/racks`, {
      name,
      ...(slot !== undefined ? { slot } : {}),
    });
    return true;
  } catch (error) {
    if (error instanceof ApiError) {
      showToast(error.message, "error");
    } else {
      showToast("Failed to add rack", "error");
    }
    return false;
  }
}

export function opUpdateDeepFreezerGrid(
  freezerId: string,
  rackRows: number,
  rackColumns: number,
  rackShelves?: number,
): Promise<boolean> {
  return run("Failed to update rack grid", () =>
    api.put(`/api/groups/${gid()}/inventory/deepfreezers/${encodeURIComponent(freezerId)}`, {
      rackRows,
      rackColumns,
      ...(rackShelves !== undefined ? { rackShelves } : {}),
    }),
  );
}

export function opMoveDeepFreezerRack(freezerId: string, rackName: string, slot: number): Promise<boolean> {
  return run("Failed to move rack", () =>
    api.post(
      `/api/groups/${gid()}/inventory/deepfreezers/${encodeURIComponent(freezerId)}/racks/${encodeURIComponent(rackName)}/move`,
      { slot },
    ),
  );
}

export async function opAddDeepFreezerBox(freezerId: string, rackName: string, color?: string): Promise<boolean> {
  try {
    await api.post(`/api/groups/${gid()}/inventory/deepfreezers/${encodeURIComponent(freezerId)}/boxes`, {
      rackName,
      ...(color !== undefined && color !== "" ? { color } : {}),
    });
    return true;
  } catch (error) {
    if (error instanceof ApiError) {
      showToast(error.message, "error");
    } else {
      showToast("Failed to add box", "error");
    }
    return false;
  }
}

export function opMoveDeepFreezerBox(freezerId: string, boxId: string, shelf: number): Promise<boolean> {
  return run("Failed to move box", () =>
    api.post(
      `/api/groups/${gid()}/inventory/deepfreezers/${encodeURIComponent(freezerId)}/boxes/${encodeURIComponent(boxId)}/move`,
      { shelf },
    ),
  );
}

export function opAddShelf(body: {
  roomId: string;
  containerId: string;
  name: string;
  type?: "shelf" | "door_shelf" | "crate" | "box";
  parentShelfId?: string;
  rackName?: string;
  boxName?: string;
  isRangeShelf?: boolean;
  rangeStart?: string;
  rangeEnd?: string;
}): Promise<boolean> {
  return run("Failed to add shelf", () => api.post(`/api/groups/${gid()}/inventory/shelves`, body));
}

export function opDeleteShelf(roomId: string, containerId: string, shelfId: string): Promise<boolean> {
  return run("Failed to delete shelf", () =>
    api.del(`/api/groups/${gid()}/inventory/shelves/${shelfId}`, { roomId, containerId }),
  );
}

export function opRenameShelf(
  roomId: string,
  containerId: string,
  shelfId: string,
  name: string,
): Promise<boolean> {
  return opEditShelfMeta(roomId, containerId, shelfId, { name });
}

function opEditShelfMeta(
  roomId: string,
  containerId: string,
  shelfId: string,
  body: { name?: string; color?: string },
): Promise<boolean> {
  return run("Failed to save shelf", () =>
    api.put(`/api/groups/${gid()}/inventory/shelves/${shelfId}`, { roomId, containerId, ...body }),
  );
}

export function opChangeBoxColor(roomId: string, containerId: string, shelfId: string, color: string): Promise<boolean> {
  return opEditShelfMeta(roomId, containerId, shelfId, { color });
}

export type ChemicalProductFormValue = {
  manufacturer?: string;
  supplier?: string;
  catalogNumber?: string;
  productName?: string;
  variant?: string;
};

export type ChemicalBatchInfoFormValue = {
  lotCode?: string;
  originType?: "purchased" | "prepared" | "derived" | "unknown";
  expiresAt?: number;
  receivedAt?: number;
  preparedAt?: number;
  preparedBy?: string;
};

export interface ChemicalFormValues {
  name: string;
  formula: string;
  quantity: number | null;
  availability: ChemicalAvailability;
  unit: string;
  concentration: number | null;
  concUnit: string;
  cas: string;
  note: string;
  customPosition: string;
  barcode?: string;
  type: string;
  attributes: Record<string, string | number | boolean | null>;
  product?: ChemicalProductFormValue | null;
  batchInfo?: ChemicalBatchInfoFormValue;
}

export function opAddChemical(
  roomId: string,
  containerId: string,
  shelfId: string,
  values: ChemicalFormValues,
  boxId?: string,
): Promise<boolean> {
  return run("Failed to add chemical", () =>
    api.post(`/api/groups/${gid()}/inventory/chemicals`, {
      roomId,
      ...(containerId !== "" ? { containerId } : {}),
      ...(shelfId !== "" ? { shelfId } : {}),
      ...(boxId !== undefined && boxId !== "" ? { boxId } : {}),
      name: values.name,
      cas: values.cas === "" ? undefined : values.cas,
      formula: values.formula === "" ? undefined : values.formula,
      quantity: values.quantity ?? undefined,
      availability: values.availability,
      unit: values.unit,
      concentration: values.concentration ?? undefined,
      concUnit: values.concUnit,
      customPosition: values.customPosition === "" ? undefined : values.customPosition,
      note: values.note === "" ? undefined : values.note,
      barcode: values.barcode === "" ? undefined : values.barcode,
      type: values.type,
      attributes: values.attributes,
      ...(values.product !== null && values.product !== undefined ? { product: values.product } : {}),
      ...(values.batchInfo !== undefined ? { batchInfo: values.batchInfo } : {}),
    }),
  );
}

export function opEditChemical(
  roomId: string,
  containerId: string,
  shelfId: string,
  chemicalId: string,
  values: ChemicalFormValues,
  moveTargetShelfId?: string,
  moveTargetBoxId?: string,
  originalBoxId?: string,
): Promise<boolean> {
  return run("Failed to save chemical", async () => {
    await api.put(`/api/groups/${gid()}/inventory/chemicals/${chemicalId}`, {
      roomId,
      ...(containerId !== "" ? { containerId } : {}),
      ...(shelfId !== "" ? { shelfId } : {}),
      ...(originalBoxId !== undefined && originalBoxId !== "" ? { boxId: originalBoxId } : {}),
      name: values.name,
      cas: values.cas,
      formula: values.formula,
      quantity: values.quantity ?? 0,
      availability: values.availability,
      unit: values.unit,
      concentration: values.concentration ?? undefined,
      concUnit: values.concUnit,
      customPosition: values.customPosition,
      note: values.note,
      barcode: values.barcode,
      type: values.type,
      attributes: values.attributes,
      batchInfo: values.batchInfo,
      ...(values.product === null
        ? { product: null }
        : values.product !== undefined
          ? { product: values.product }
          : {}),
    });
    const fromKey = `${containerId}|${shelfId}|${originalBoxId ?? ""}`;
    const toShelf = moveTargetShelfId ?? "";
    const toBox = moveTargetBoxId ?? "";
    if (moveTargetShelfId !== undefined && `${containerId}|${toShelf}|${toBox}` !== fromKey) {
      await api.post(`/api/groups/${gid()}/inventory/chemicals/${chemicalId}/move`, {
        fromRoomId: roomId,
        ...(containerId !== "" ? { fromContainerId: containerId } : {}),
        ...(shelfId !== "" ? { fromShelfId: shelfId } : {}),
        ...(originalBoxId !== undefined && originalBoxId !== "" ? { fromBoxId: originalBoxId } : {}),
        toRoomId: roomId,
        ...(containerId !== "" ? { toContainerId: containerId } : {}),
        ...(toShelf !== "" ? { toShelfId: toShelf } : {}),
        ...(toBox !== "" ? { toBoxId: toBox } : {}),
      });
    }
  });
}

export function opDeleteChemical(roomId: string, containerId: string, shelfId: string, chemicalId: string, boxId?: string): Promise<boolean> {
  return run("Failed to delete chemical", () =>
    api.del(`/api/groups/${gid()}/inventory/chemicals/${chemicalId}`, {
      roomId,
      ...(containerId !== "" ? { containerId } : {}),
      ...(shelfId !== "" ? { shelfId } : {}),
      ...(boxId !== undefined && boxId !== "" ? { boxId } : {}),
    }),
  );
}

export function opAdjustQty(roomId: string, containerId: string, shelfId: string, chemicalId: string, delta: number, boxId?: string): Promise<boolean> {
  return run("Failed to adjust quantity", () =>
    api.post(`/api/groups/${gid()}/inventory/chemicals/${chemicalId}/adjust-qty`, {
      roomId,
      ...(containerId !== "" ? { containerId } : {}),
      ...(shelfId !== "" ? { shelfId } : {}),
      ...(boxId !== undefined && boxId !== "" ? { boxId } : {}),
      delta,
    }),
  );
}

export function opSetChemicalAvailability(
  roomId: string,
  containerId: string,
  shelfId: string,
  chemicalId: string,
  availability: ChemicalAvailability,
  boxId?: string,
): Promise<boolean> {
  return run("Failed to update availability", () =>
    api.put(`/api/groups/${gid()}/inventory/chemicals/${chemicalId}/availability`, {
      roomId,
      ...(containerId !== "" ? { containerId } : {}),
      ...(shelfId !== "" ? { shelfId } : {}),
      ...(boxId !== undefined && boxId !== "" ? { boxId } : {}),
      availability,
    }),
  );
}

export function opMoveChemical(
  from: { roomId: string; containerId: string; shelfId: string },
  to: { roomId: string; containerId: string; shelfId: string },
  chemicalId: string,
): Promise<boolean> {
  return run("Failed to move chemical", () =>
    api.post(`/api/groups/${gid()}/inventory/chemicals/${chemicalId}/move`, {
      fromRoomId: from.roomId,
      fromContainerId: from.containerId,
      fromShelfId: from.shelfId,
      toRoomId: to.roomId,
      toContainerId: to.containerId,
      toShelfId: to.shelfId,
    }),
  );
}

export function opShareContainer(roomId: string, containerId: string, sharedWithGroupId: string): Promise<boolean> {
  return run("Failed to share container", () =>
    api.post(`/api/groups/${gid()}/inventory/containers/${containerId}/share`, { roomId, sharedWithGroupId }),
  );
}

export function opUnshareContainer(roomId: string, containerId: string, sharedWithGroupId: string): Promise<boolean> {
  return run("Failed to unshare container", () =>
    api.post(`/api/groups/${gid()}/inventory/containers/${containerId}/unshare`, { roomId, sharedWithGroupId }),
  );
}

export function opAddProtocol(body: {
  title: string;
  description?: string;
  tags?: string[];
  content?: string;
}): Promise<boolean> {
  return run("Failed to add protocol", () =>
    api.post(`/api/groups/${gid()}/inventory/protocols`, body),
  );
}

export function opEditProtocol(
  protocolId: string,
  body: { title?: string; description?: string; tags?: string[]; content?: string },
): Promise<boolean> {
  return run("Failed to save protocol", () =>
    api.put(`/api/groups/${gid()}/inventory/protocols/${protocolId}`, body),
  );
}

export function opDeleteProtocol(protocolId: string): Promise<boolean> {
  return run("Failed to delete protocol", () => api.del(`/api/groups/${gid()}/inventory/protocols/${protocolId}`));
}

export function opAddAssetRoom(name: string, linkedRoomId?: string | null): Promise<boolean> {
  return run("Failed to add asset room", () =>
    api.post(`/api/groups/${gid()}/inventory/asset-rooms`, {
      name,
      ...(linkedRoomId !== undefined ? { linkedRoomId } : {}),
    }),
  );
}

export function opEditAssetRoom(roomId: string, name: string, linkedRoomId?: string | null): Promise<boolean> {
  return run("Failed to save asset room", () =>
    api.put(`/api/groups/${gid()}/inventory/asset-rooms/${roomId}`, {
      name,
      ...(linkedRoomId !== undefined ? { linkedRoomId } : {}),
    }),
  );
}

export function opDeleteAssetRoom(roomId: string): Promise<boolean> {
  return run("Failed to delete asset room", () => api.del(`/api/groups/${gid()}/inventory/asset-rooms/${roomId}`));
}

export function opAddAsset(body: {
  name: string;
  model?: string;
  barcode?: string;
  description?: string;
  roomId?: string;
}): Promise<boolean> {
  return run("Failed to add asset", () => api.post(`/api/groups/${gid()}/inventory/assets`, body));
}

export function opEditAsset(
  assetId: string,
  body: { name?: string; model?: string; barcode?: string; description?: string; roomId?: string },
): Promise<boolean> {
  return run("Failed to save asset", () => api.put(`/api/groups/${gid()}/inventory/assets/${assetId}`, body));
}

export function opDeleteAsset(assetId: string): Promise<boolean> {
  return run("Failed to delete asset", () => api.del(`/api/groups/${gid()}/inventory/assets/${assetId}`));
}

export function resolveAutoShelf(cont: Container, name: string): string | undefined {
  const letter = getFirstLetter(name);
  const perfect = cont.shelves.find((sh) => {
    const n = sh.name.toUpperCase().trim();
    return n === letter || n === `SHELF ${letter}` || n.endsWith(` ${letter}`);
  });
  if (perfect !== undefined) {
    return perfect.id;
  }
  const permissive = cont.shelves.find((sh) => {
    const n = sh.name.toUpperCase().trim();
    const regex = new RegExp(`(^|[^A-Z])${letter}([^A-Z]|$)`);
    return regex.test(n) || n.startsWith(`${letter} -`) || n.startsWith(`${letter}–`);
  });
  if (permissive !== undefined) {
    return permissive.id;
  }
  const range = findRangeShelf(cont, name);
  return (range ?? cont.shelves[0])?.id;
}

export function roleCanWrite(): boolean {
  return session.user?.role !== undefined && session.user.role !== "reader";
}

export { countChems };
