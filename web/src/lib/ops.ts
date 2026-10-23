import type { Container } from "@bioscom/shared";
import { api, ApiError } from "./api";
import { currentGroup } from "./stores/currentGroup.svelte";
import { session } from "./stores/session.svelte";
import { showToast } from "./stores/toast.svelte";
import { getFirstLetter, findRangeShelf, countChems } from "./inventoryUtils";

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

export function opAddRoom(name: string, description?: string): Promise<boolean> {
  return run("Failed to add room", () => api.post(`/api/groups/${gid()}/inventory/rooms`, { name, description }));
}

export function opEditRoom(roomId: string, name: string, description?: string): Promise<boolean> {
  return run("Failed to save room", () =>
    api.put(`/api/groups/${gid()}/inventory/rooms/${roomId}`, { name, description }),
  );
}

export function opDeleteRoom(roomId: string): Promise<boolean> {
  return run("Failed to delete room", () => api.del(`/api/groups/${gid()}/inventory/rooms/${roomId}`));
}

export type ShelfSpec = string | { name: string; isRangeShelf?: boolean; rangeStart?: string; rangeEnd?: string };

export function opAddContainer(body: {
  roomId: string;
  name: string;
  description?: string;
  emoji?: string;
  type: "cabinet" | "fridge" | "freezer" | "deepfreezer";
  cabinetMethod?: "numerical" | "alphabetical" | "custom";
  customRangeType?: "alphabetical" | "numerical";
  shelves?: ShelfSpec[];
}): Promise<boolean> {
  return run("Failed to add container", () => api.post(`/api/groups/${gid()}/inventory/containers`, body));
}

export function opEditContainer(
  roomId: string,
  containerId: string,
  body: { name?: string; description?: string; emoji?: string },
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

export function opAddShelf(body: {
  roomId: string;
  containerId: string;
  name: string;
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

export interface ChemicalFormValues {
  name: string;
  formula: string;
  quantity: number | null;
  unit: string;
  concentration: number | null;
  concUnit: string;
  cas: string;
  note: string;
  customPosition: string;
}

export function opAddChemical(
  roomId: string,
  containerId: string,
  shelfId: string,
  values: ChemicalFormValues,
): Promise<boolean> {
  return run("Failed to add chemical", () =>
    api.post(`/api/groups/${gid()}/inventory/chemicals`, {
      roomId,
      containerId,
      shelfId,
      name: values.name,
      cas: values.cas === "" ? undefined : values.cas,
      formula: values.formula === "" ? undefined : values.formula,
      quantity: values.quantity ?? undefined,
      unit: values.unit,
      concentration: values.concentration ?? undefined,
      concUnit: values.concUnit,
      customPosition: values.customPosition === "" ? undefined : values.customPosition,
      note: values.note === "" ? undefined : values.note,
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
): Promise<boolean> {
  return run("Failed to save chemical", async () => {
    await api.put(`/api/groups/${gid()}/inventory/chemicals/${chemicalId}`, {
      roomId,
      containerId,
      shelfId,
      name: values.name,
      cas: values.cas,
      formula: values.formula,
      quantity: values.quantity ?? 0,
      unit: values.unit,
      concentration: values.concentration ?? undefined,
      concUnit: values.concUnit,
      customPosition: values.customPosition,
      note: values.note,
    });
    if (moveTargetShelfId !== undefined && moveTargetShelfId !== shelfId) {
      await api.post(`/api/groups/${gid()}/inventory/chemicals/${chemicalId}/move`, {
        fromRoomId: roomId,
        fromContainerId: containerId,
        fromShelfId: shelfId,
        toRoomId: roomId,
        toContainerId: containerId,
        toShelfId: moveTargetShelfId,
      });
    }
  });
}

export function opDeleteChemical(roomId: string, containerId: string, shelfId: string, chemicalId: string): Promise<boolean> {
  return run("Failed to delete chemical", () =>
    api.del(`/api/groups/${gid()}/inventory/chemicals/${chemicalId}`, { roomId, containerId, shelfId }),
  );
}

export function opAdjustQty(roomId: string, containerId: string, shelfId: string, chemicalId: string, delta: number): Promise<boolean> {
  return run("Failed to adjust quantity", () =>
    api.post(`/api/groups/${gid()}/inventory/chemicals/${chemicalId}/adjust-qty`, {
      roomId,
      containerId,
      shelfId,
      delta,
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

export function opAddProtocol(title: string, content: string): Promise<boolean> {
  return run("Failed to add protocol", () =>
    api.post(`/api/groups/${gid()}/inventory/protocols`, { title, content }),
  );
}

export function opEditProtocol(protocolId: string, title: string, content: string): Promise<boolean> {
  return run("Failed to save protocol", () =>
    api.put(`/api/groups/${gid()}/inventory/protocols/${protocolId}`, { title, content }),
  );
}

export function opDeleteProtocol(protocolId: string): Promise<boolean> {
  return run("Failed to delete protocol", () => api.del(`/api/groups/${gid()}/inventory/protocols/${protocolId}`));
}

export function opAddAssetRoom(name: string): Promise<boolean> {
  return run("Failed to add asset room", () => api.post(`/api/groups/${gid()}/inventory/asset-rooms`, { name }));
}

export function opEditAssetRoom(roomId: string, name: string): Promise<boolean> {
  return run("Failed to save asset room", () =>
    api.put(`/api/groups/${gid()}/inventory/asset-rooms/${roomId}`, { name }),
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
