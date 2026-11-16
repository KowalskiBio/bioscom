import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { InventoryTreeSchema } from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import { isMemberOrSuperadmin } from "../inventory/doc.js";
import type { InventoryHub } from "../inventory/ws.js";

interface HistoryRow {
  id: number;
  group_id: string;
  src_id: string | null;
  timestamp: number;
  user_name: string | null;
  action: string;
}

const ROOM_LINK_RESTORE_CONFLICT =
  "Restore would leave room links pointing to missing rooms. Unlink or reassign the affected instrument and asset-room links, or choose a compatible backup.";

class RoomLinkRestoreConflictError extends Error {
  constructor() {
    super(ROOM_LINK_RESTORE_CONFLICT);
    this.name = "RoomLinkRestoreConflictError";
  }
}

export function registerHistoryAndBackupRoutes(app: FastifyInstance, config: ServerConfig, hub: InventoryHub): void {
  const db = (): Database.Database => getDatabase(config.dbPath);

  app.get("/api/groups/:id/history", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    if (!isMemberOrSuperadmin(user, groupId)) {
      return reply.status(403).send({ error: "Not a member of this lab" });
    }
    const query = request.query as { limit?: string; page?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 100) || 100, 1), 500);
    const page = Math.max(Number(query.page ?? 1) || 1, 1);
    const total = (db().prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = ?").get(groupId) as { n: number }).n;
    const rows = db()
      .prepare("SELECT id, group_id, src_id, timestamp, user_name, action FROM history WHERE group_id = ? ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?")
      .all(groupId, limit, (page - 1) * limit) as HistoryRow[];
    return {
      entries: rows.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        user: row.user_name,
        action: row.action,
      })),
      total,
      page,
      limit,
    };
  });

  app.get("/api/groups/:id/backups", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    if (!isMemberOrSuperadmin(user, groupId)) {
      return reply.status(403).send({ error: "Not a member of this lab" });
    }
    const rows = db()
      .prepare("SELECT id, timestamp FROM group_backups WHERE group_id = ? ORDER BY timestamp DESC LIMIT 100")
      .all(groupId) as Array<{ id: string; timestamp: number }>;
    return { backups: rows };
  });

  app.post("/api/groups/:id/backups", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    if (!isMemberOrSuperadmin(user, groupId)) {
      return reply.status(403).send({ error: "Not a member of this lab" });
    }
    if (user.role === "reader") {
      return reply.status(403).send({ error: "Readers cannot make changes" });
    }
    const id = `bk_${randomBytes(9).toString("hex")}`;
    const create = db().transaction((): void => {
      const row = db()
        .prepare("SELECT tree FROM group_inventory_docs WHERE group_id = ?")
        .get(groupId) as { tree: string } | undefined;
      if (row === undefined) {
        throw new Error("Inventory not found");
      }
      db()
        .prepare("INSERT INTO group_backups (id, group_id, timestamp, data) VALUES (?, ?, ?, ?)")
        .run(id, groupId, Date.now(), row.tree);
    });
    try {
      create();
    } catch {
      return reply.status(404).send({ error: "Inventory not found" });
    }
    hub.broadcastAll({ type: "reload", resource: "history" });
    return reply.status(201).send({ id });
  });

  app.post("/api/groups/:id/backups/:backupId/restore", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const backupId = (request.params as { backupId: string }).backupId;
    if (!isMemberOrSuperadmin(user, groupId)) {
      return reply.status(403).send({ error: "Not a member of this lab" });
    }
    if (user.role === "reader") {
      return reply.status(403).send({ error: "Readers cannot make changes" });
    }
    const restore = db().transaction((): { version: number } => {
      const backup = db()
        .prepare("SELECT data FROM group_backups WHERE id = ? AND group_id = ?")
        .get(backupId, groupId) as { data: string } | undefined;
      if (backup === undefined) {
        throw new Error("Backup not found");
      }
      const rawBackup: unknown = JSON.parse(backup.data);
      const parsed = InventoryTreeSchema.safeParse(rawBackup);
      if (!parsed.success) {
        throw new Error("Backup data is corrupt");
      }

      const current = db()
        .prepare("SELECT version FROM group_inventory_docs WHERE group_id = ?")
        .get(groupId) as { version: number } | undefined;
      if (current === undefined) {
        throw new Error("Inventory not found");
      }

      // Only physical chemical rooms count as restore targets. Deep freezers,
      // shared/pseudo rooms and asset rooms are separate id spaces.
      const restoredRoomIds = new Set(parsed.data.rooms.map((room) => room.id));
      const linkedInstruments = db()
        .prepare("SELECT room_id AS roomId FROM instruments WHERE room_group_id = ? AND room_id IS NOT NULL")
        .all(groupId) as Array<{ roomId: string }>;
      if (linkedInstruments.some((instrument) => !restoredRoomIds.has(instrument.roomId))) {
        throw new RoomLinkRestoreConflictError();
      }

      // Inspect the raw payload so empty or malformed assigned values fail
      // closed instead of being silently cleared by schema coercion.
      const rawAssetRooms =
        rawBackup !== null && typeof rawBackup === "object" && !Array.isArray(rawBackup)
          ? (rawBackup as { assetRooms?: unknown }).assetRooms
          : undefined;
      const rawAssetRoomEntries = Array.isArray(rawAssetRooms)
        ? rawAssetRooms
        : rawAssetRooms !== null && typeof rawAssetRooms === "object"
          ? Object.values(rawAssetRooms as Record<string, unknown>)
          : [];
      for (const rawAssetRoom of rawAssetRoomEntries) {
        if (rawAssetRoom === null || typeof rawAssetRoom !== "object") continue;
        const entry = rawAssetRoom as { linkedRoomId?: unknown };
        if (!Object.prototype.hasOwnProperty.call(entry, "linkedRoomId")) continue;
        const linkedRoomId = entry.linkedRoomId;
        if (linkedRoomId === null || linkedRoomId === undefined) continue;
        if (typeof linkedRoomId !== "string" || !restoredRoomIds.has(linkedRoomId)) {
          throw new RoomLinkRestoreConflictError();
        }
      }

      const nextVersion = current.version + 1;
      db()
        .prepare("UPDATE group_inventory_docs SET tree = ?, version = ? WHERE group_id = ?")
        .run(JSON.stringify(parsed.data), nextVersion, groupId);
      db()
        .prepare("INSERT INTO history (group_id, timestamp, user_name, action) VALUES (?, ?, ?, ?)")
        .run(groupId, Date.now(), user.name ?? user.uid, `Restored backup ${backupId}`);
      return { version: nextVersion };
    });
    try {
      const result = restore();
      const row = db()
        .prepare("SELECT tree FROM group_inventory_docs WHERE group_id = ?")
        .get(groupId) as { tree: string };
      const tree = InventoryTreeSchema.parse(JSON.parse(row.tree));
      hub.broadcast(groupId, { groupId, version: result.version, tree });
      return { version: result.version, tree };
    } catch (error) {
      if (error instanceof RoomLinkRestoreConflictError) {
        return reply.status(409).send({ error: error.message });
      }
      const message = error instanceof Error ? error.message : "restore failed";
      if (message === "Backup not found") {
        return reply.status(404).send({ error: "Backup not found" });
      }
      request.log.error(error, "backup restore failed");
      return reply.status(500).send({ error: "Internal error" });
    }
  });
}
