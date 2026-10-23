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
      const parsed = InventoryTreeSchema.safeParse(JSON.parse(backup.data));
      if (!parsed.success) {
        throw new Error("Backup data is corrupt");
      }
      const current = db()
        .prepare("SELECT version FROM group_inventory_docs WHERE group_id = ?")
        .get(groupId) as { version: number } | undefined;
      if (current === undefined) {
        throw new Error("Inventory not found");
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
      const message = error instanceof Error ? error.message : "restore failed";
      if (message === "Backup not found") {
        return reply.status(404).send({ error: "Backup not found" });
      }
      request.log.error(error, "backup restore failed");
      return reply.status(500).send({ error: "Internal error" });
    }
  });
}
