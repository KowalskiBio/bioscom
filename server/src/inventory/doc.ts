import type Database from "better-sqlite3";
import { InventoryTreeSchema, type Container, type InventoryTree, type Room, type Shelf, type Chemical } from "@bioscom/shared";
import type { SessionUserRow } from "../auth/sessions.js";

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
  if (room === undefined) {
    throw new OpError(404, "Room not found");
  }
  return room;
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
