import type { Container, InventoryTree, SharedContainerRef } from "@bioscom/shared";
import { ApiError, api } from "../api";
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
let loadError = $state("");
let sharedContainers = $state<SharedContainerListItem[]>([]);
// Reactive so inventoryFor() re-runs when the first tree for the selected lab
// arrives after mount. As a plain variable it changed silently: inventoryFor()
// short-circuits before reading `tree` while unsubscribed, so the Dashboard
// derived never tracked `tree` and stayed at zero until an unrelated change.
let subscribedGroupId = $state<string | null>(null);
let requestGeneration = 0;
let requestedGroupId: string | null = null;

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
  get loadError(): string {
    return loadError;
  },
  get sharedContainers(): SharedContainerListItem[] {
    return sharedContainers;
  },
};

export async function fetchInventory(groupId: string): Promise<void> {
  const generation = ++requestGeneration;
  requestedGroupId = groupId;
  loadError = "";
  try {
    const body = await api.get<{ version: number; tree: InventoryTree }>(
      `/api/groups/${encodeURIComponent(groupId)}/inventory`,
    );
    // A broadcast or another request/group switch may supersede this response.
    // Only the current request may commit it. Same-group document versions must
    // also move forward, so an older refresh cannot undo a newer link/update.
    if (generation !== requestGeneration || requestedGroupId !== groupId) return;
    if (subscribedGroupId === groupId && body.version < version) return;
    tree = body.tree;
    version = body.version;
    subscribedGroupId = groupId;
    loaded = true;
  } catch (error) {
    // A refresh failure must not turn the last confirmed document into an empty
    // inventory. Callers retain the existing rejection semantics.
    if (generation === requestGeneration && requestedGroupId === groupId) {
      loadError = error instanceof ApiError ? error.message : "Couldn’t load room assignments.";
    }
    throw error;
  }
}

export async function fetchSharedContainers(groupId: string): Promise<void> {
  const body = await api.get<{ sharedContainers: SharedContainerListItem[] }>(
    `/api/groups/${encodeURIComponent(groupId)}/shared-containers`,
  );
  sharedContainers = body.sharedContainers;
}

export function applyBroadcast(message: InventoryBroadcast, activeGroupId: string | null): void {
  if (message.groupId !== activeGroupId) return;
  if (subscribedGroupId === message.groupId && message.version < version) return;
  // This accepted live document supersedes any in-flight GET. Do not let an
  // older request restore the previous links or the previous lab's contents.
  requestGeneration += 1;
  requestedGroupId = message.groupId;
  tree = message.tree as InventoryTree;
  version = message.version;
  subscribedGroupId = message.groupId;
  loaded = true;
  loadError = "";
}

export function clearInventory(): void {
  requestGeneration += 1;
  requestedGroupId = null;
  tree = null;
  version = 0;
  loaded = false;
  loadError = "";
  sharedContainers = [];
  subscribedGroupId = null;
}

export function inventoryFor(groupId: string | null): InventoryTree | null {
  return groupId !== null && subscribedGroupId === groupId ? tree : null;
}
