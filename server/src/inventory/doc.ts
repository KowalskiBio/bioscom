import type Database from "better-sqlite3";
import { InventoryTreeSchema, relocateDeepFreezers, type Container, type InventoryTree, type Room, type Shelf, type Chemical } from "@bioscom/shared";
import type { SessionUserRow } from "../auth/sessions.js";
import { syncGroupInventoryDocument, markSynced } from "./sync.js";

export class OpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export interface MutationResult {
  version: number;
  tree: InventoryTree;
  mirrorGroupId: string | null;
}

export interface MutationContext {
  mirrorGroupId: string | null;
}

export function loadDoc(db: Database.Database, groupId: string): { tree: InventoryTree; version: number } {
  const row = db
    .prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = ?")
    .get(groupId) as { tree: string; version: number } | undefined;
  if (row === undefined) {
    throw new OpError(404, "Inventory not found");
  }
  const parsed = InventoryTreeSchema.safeParse(JSON.parse(row.tree));
  if (!parsed.success) {
    throw new OpError(500, "Inventory document is corrupt");
  }
  return { tree: parsed.data, version: row.version };
}

export function findRoomOrThrow(tree: InventoryTree, roomId: string): Room {
  const room = tree.rooms.find((candidate) => candidate.id === roomId);
  if (room !== undefined) {
    return room;
  }
  const freezer = tree.deepFreezers?.find((candidate) => candidate.id === roomId);
  if (freezer !== undefined) {
    return { id: freezer.id, name: freezer.name ?? freezer.id, containers: [freezer], __pseudo: true } as Room;
  }
  throw new OpError(404, "Room not found");
}

export function isPseudoRoom(room: Room | undefined | null): room is Room & { __pseudo: true } {
  return room !== undefined && room !== null && (room as unknown as { __pseudo?: boolean }).__pseudo === true;
}

export function findContainerOrThrow(tree: InventoryTree, roomId: string, containerId: string): Container {
  const room = findRoomOrThrow(tree, roomId);
  const container = room.containers.find((candidate) => candidate.id === containerId);
  if (container === undefined) {
    throw new OpError(404, "Container not found");
  }
  return container;
}

export function findShelfOrThrow(tree: InventoryTree, roomId: string, containerId: string, shelfId: string): Shelf {
  const container = findContainerOrThrow(tree, roomId, containerId);
  const shelf = container.shelves.find((candidate) => candidate.id === shelfId);
  if (shelf === undefined) {
    throw new OpError(404, "Shelf not found");
  }
  return shelf;
}

export function findBarcodeOwner(tree: InventoryTree, barcode: string, excludeChemicalId: string | null): string | undefined {
  const check = (chem: Chemical, contextName: string): string | undefined => {
    if (chem.id !== excludeChemicalId && typeof chem.barcode === "string" && chem.barcode === barcode) {
      return chem.name ?? contextName;
    }
    return undefined;
  };
  for (const room of tree.rooms) {
    for (const ch of room.chemicals ?? []) {
      const hit = check(ch, `room-level of ${room.name ?? room.id}`);
      if (hit !== undefined) return hit;
    }
    for (const container of room.containers) {
      for (const ch of container.chemicals ?? []) {
        const hit = check(ch, `direct-in-${container.name ?? container.id}`);
        if (hit !== undefined) return hit;
      }
      for (const shelf of container.shelves ?? []) {
        for (const ch of shelf.chemicals ?? []) {
          const hit = check(ch, `shelf ${shelf.name ?? shelf.id}`);
          if (hit !== undefined) return hit;
        }
      }
    }
  }
  for (const freezer of tree.deepFreezers ?? []) {
    for (const ch of freezer.chemicals ?? []) {
      const hit = check(ch, `direct-in-${freezer.name ?? freezer.id}`);
      if (hit !== undefined) return hit;
    }
    for (const shelf of freezer.shelves ?? []) {
      for (const ch of shelf.chemicals ?? []) {
        const hit = check(ch, `rack-box ${shelf.name ?? shelf.id}`);
        if (hit !== undefined) return hit;
      }
    }
  }
  return undefined;
}

export function findChemicalOrThrow(
  tree: InventoryTree,
  roomId: string,
  containerId: string,
  shelfId: string,
  chemicalId: string,
): { shelf: Shelf; chemical: Chemical } {
  const shelf = findShelfOrThrow(tree, roomId, containerId, shelfId);
  const chemical = shelf.chemicals.find((candidate) => candidate.id === chemicalId);
  if (chemical === undefined) {
    throw new OpError(404, "Chemical not found");
  }
  return { shelf, chemical };
}

export interface ResolvedStockTarget {
  room: Room;
  container: Container | null;
  shelf: Shelf | null;
  box: Shelf | null;
}

export function resolveStockTarget(
  tree: InventoryTree,
  roomId: string,
  containerId?: string | null,
  shelfId?: string | null,
  boxId?: string | null,
): ResolvedStockTarget {
  const room = findRoomOrThrow(tree, roomId);
  if (isPseudoRoom(room) && containerId !== room.id) {
    throw new OpError(404, "Room not found");
  }
  if (containerId === undefined || containerId === null || containerId === "") {
    if (isPseudoRoom(room)) {
      throw new OpError(404, "Room not found");
    }
    return { room, container: null, shelf: null, box: null };
  }
  const container = room.containers.find((candidate) => candidate.id === containerId);
  if (container === undefined) {
    throw new OpError(404, "Container not found");
  }
  if (shelfId === undefined || shelfId === null || shelfId === "") {
    return { room, container, shelf: null, box: null };
  }
  const shelf = (container.shelves ?? []).find((candidate) => candidate.id === shelfId);
  if (shelf === undefined) {
    throw new OpError(404, "Shelf not found");
  }
  if (boxId === undefined || boxId === null || boxId === "") {
    return { room, container, shelf, box: null };
  }
  const box = (container.shelves ?? []).find(
    (candidate) => candidate.id === boxId && candidate.parentShelfId === shelf.id,
  );
  if (box === undefined) {
    throw new OpError(404, "Box not found");
  }
  return { room, container, shelf, box };
}

export function locationChemicals(target: ResolvedStockTarget): Chemical[] {
  if (target.box !== null) {
    return (target.box.chemicals ??= []);
  }
  if (target.shelf !== null) {
    return (target.shelf.chemicals ??= []);
  }
  if (target.container !== null) {
    return (target.container.chemicals ??= []);
  }
  return (target.room.chemicals ??= []);
}

export interface FoundChemical {
  room: Room;
  container: Container | null;
  shelf: Shelf | null;
  list: Chemical[];
  index: number;
  chemical: Chemical;
}

export function findChemicalAnywhere(tree: InventoryTree, roomId: string, chemicalId: string): FoundChemical {
  const room = findRoomOrThrow(tree, roomId);
  for (const ch of room.chemicals ?? []) {
    if (ch.id === chemicalId) {
      const list = (room.chemicals ??= []);
      return { room, container: null, shelf: null, list, index: list.findIndex((c) => c.id === chemicalId), chemical: ch };
    }
  }
  for (const container of room.containers) {
    for (const ch of container.chemicals ?? []) {
      if (ch.id === chemicalId) {
        const list = (container.chemicals ??= []);
        return { room, container, shelf: null, list, index: list.findIndex((c) => c.id === chemicalId), chemical: ch };
      }
    }
    for (const shelf of container.shelves ?? []) {
      for (const ch of shelf.chemicals ?? []) {
        if (ch.id === chemicalId) {
          return { room, container, shelf, list: shelf.chemicals, index: shelf.chemicals.findIndex((c) => c.id === chemicalId), chemical: ch };
        }
      }
    }
  }
  throw new OpError(404, "Chemical not found");
}

export function isMemberOrSuperadmin(user: SessionUserRow, groupId: string): boolean {
  return user.role === "superadmin" || user.group_id === groupId;
}

export function checkSharedContainerAccess(
  user: SessionUserRow,
  groupId: string,
  container: Container,
  context: MutationContext,
  isMember: boolean,
): void {
  if (isMember) {
    return;
  }
  if (user.group_id === null || !container.sharedWithGroupIds.includes(user.group_id)) {
    throw new OpError(404, "Container not found");
  }
  context.mirrorGroupId = user.group_id;
}

export function createMutator(dbAccessor: () => Database.Database) {
  return (groupId: string, user: SessionUserRow, apply: (tree: InventoryTree, context: MutationContext) => string): MutationResult => {
    const transactional = dbAccessor().transaction((): MutationResult => {
      const { tree, version } = loadDoc(dbAccessor(), groupId);
      relocateDeepFreezers(tree);
      const context: MutationContext = { mirrorGroupId: null };
      const action = apply(tree, context);
      const check = InventoryTreeSchema.safeParse(tree);
      if (!check.success) {
        throw new OpError(500, "Mutation produced an invalid tree");
      }
      const nextVersion = version + 1;
      dbAccessor()
        .prepare("UPDATE group_inventory_docs SET tree = ?, version = ? WHERE group_id = ?")
        .run(JSON.stringify(tree), nextVersion, groupId);
      const savepoint = dbAccessor().transaction((): void => {
        syncGroupInventoryDocument(dbAccessor(), groupId, tree);
        markSynced(dbAccessor(), groupId, nextVersion);
      });
      try {
        savepoint();
      } catch (error) {
        console.error(
          `[inventory-sync] mirror failed for group ${groupId} (will re-sync at next boot): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const baseName = user.name ?? user.uid;
      const insertHistory = dbAccessor().prepare(
        "INSERT INTO history (group_id, timestamp, user_name, action) VALUES (?, ?, ?, ?)",
      );
      if (context.mirrorGroupId !== null && context.mirrorGroupId !== groupId) {
        const actingGroup = dbAccessor()
          .prepare("SELECT name FROM groups WHERE id = ?")
          .get(context.mirrorGroupId) as { name: string } | undefined;
        const fromLab = actingGroup?.name ?? "Neighbor";
        insertHistory.run(groupId, Date.now(), `${baseName} (from Lab ${fromLab})`, action);
        insertHistory.run(context.mirrorGroupId, Date.now(), baseName, action);
      } else {
        insertHistory.run(groupId, Date.now(), baseName, action);
      }
      return { version: nextVersion, tree, mirrorGroupId: context.mirrorGroupId };
    });
    return transactional();
  };
}
