import type { Container, InventoryTree, SharedContainerRef } from "@bioscom/shared";
import { api } from "../api";
import type { InventoryBroadcast } from "../ws";

export interface SharedContainerListItem {
  roomId: string;
  roomName: string;
  ownerGroupId: string;
  ownerGroupName: string;
  container: Container;
}

let tree = $state<InventoryTree | null>(null);
let version = $state(0);
let loaded = $state(false);
let sharedContainers = $state<SharedContainerListItem[]>([]);
let subscribedGroupId: string | null = null;

export const inventory = {
  get tree(): InventoryTree | null {
    return tree;
  },
  get version(): number {
    return version;
  },
  get loaded(): boolean {
    return loaded;
  },
  get sharedContainers(): SharedContainerListItem[] {
    return sharedContainers;
  },
};

export async function fetchInventory(groupId: string): Promise<void> {
  const body = await api.get<{ version: number; tree: InventoryTree }>(
    `/api/groups/${encodeURIComponent(groupId)}/inventory`,
  );
  tree = body.tree;
  version = body.version;
  subscribedGroupId = groupId;
  loaded = true;
}

export async function fetchSharedContainers(groupId: string): Promise<void> {
  const body = await api.get<{ sharedContainers: SharedContainerListItem[] }>(
    `/api/groups/${encodeURIComponent(groupId)}/shared-containers`,
  );
  sharedContainers = body.sharedContainers;
}

export function applyBroadcast(message: InventoryBroadcast, activeGroupId: string | null): void {
  if (message.groupId !== activeGroupId) {
    return;
  }
  tree = message.tree as InventoryTree;
  version = message.version;
  subscribedGroupId = message.groupId;
  loaded = true;
}

export function clearInventory(): void {
  tree = null;
  version = 0;
  loaded = false;
  sharedContainers = [];
  subscribedGroupId = null;
}

export function inventoryFor(groupId: string | null): InventoryTree | null {
  return groupId !== null && subscribedGroupId === groupId ? tree : null;
}
