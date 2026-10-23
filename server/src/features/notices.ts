import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { CreateNoticeBodySchema, ReactionBodySchema, UpdateNoticeBodySchema } from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import type { InventoryHub } from "../inventory/ws.js";

interface NoticeRow {
  id: string;
  scope: string;
  group_id: string | null;
  title: string | null;
  content: string | null;
  category: string | null;
  author_name: string | null;
  author_uid: string | null;
  author_lab: string | null;
  author_avatar: string | null;
  timestamp: number;
}

export function registerNoticeRoutes(app: FastifyInstance, config: ServerConfig, hub: InventoryHub): void {
  const db = (): Database.Database => getDatabase(config.dbPath);

  const loadNotice = (id: string): NoticeRow | undefined =>
    db().prepare("SELECT * FROM notices WHERE id = ?").get(id) as NoticeRow | undefined;

  const withReactions = (notice: NoticeRow): unknown => ({
    id: notice.id,
    title: notice.title,
    content: notice.content,
    category: notice.category,
    authorName: notice.author_name,
    authorUid: notice.author_uid,
    authorLab: notice.author_lab,
    authorAvatar: notice.author_avatar,
    timestamp: notice.timestamp,
    reactions: db()
      .prepare("SELECT id, text, timestamp, user_id, user_name, user_avatar FROM notice_reactions WHERE notice_id = ? ORDER BY timestamp")
      .all(notice.id),
  });

  app.get("/api/notices", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const rows = db()
      .prepare("SELECT * FROM notices WHERE scope = 'shared' ORDER BY timestamp DESC")
      .all() as NoticeRow[];
    return { notices: rows.map(withReactions) };
  });

  app.post("/api/notices", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const body = CreateNoticeBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const id = `n_${randomBytes(9).toString("hex")}`;
    const group = user.group_id === null
      ? undefined
      : (db().prepare("SELECT name FROM groups WHERE id = ?").get(user.group_id) as { name: string } | undefined);
    db()
      .prepare(
        "INSERT INTO notices (id, scope, group_id, title, content, category, author_name, author_uid, author_lab, author_avatar, timestamp) VALUES (?, 'shared', NULL, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, body.data.title, body.data.content, body.data.category, user.name ?? user.uid, user.uid, group?.name ?? null, null, Date.now());
    hub.broadcastAll({ type: "reload", resource: "notices" });
    return reply.status(201).send({ id });
  });

  app.put("/api/notices/:id", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const id = (request.params as { id: string }).id;
    const notice = loadNotice(id);
    if (notice === undefined) {
      return reply.status(404).send({ error: "Notice not found" });
    }
    if (user.role !== "superadmin" && notice.author_uid !== user.uid) {
      return reply.status(403).send({ error: "Only the author or a superadmin can edit this notice" });
    }
    const body = UpdateNoticeBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    db()
      .prepare("UPDATE notices SET title = ?, content = ?, category = ? WHERE id = ?")
      .run(
        body.data.title ?? notice.title,
        body.data.content ?? notice.content,
        body.data.category ?? notice.category,
        id,
      );
    hub.broadcastAll({ type: "reload", resource: "notices" });
    return { ok: true };
  });

  app.delete("/api/notices/:id", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const id = (request.params as { id: string }).id;
    const notice = loadNotice(id);
    if (notice === undefined) {
      return reply.status(404).send({ error: "Notice not found" });
    }
    if (user.role !== "superadmin" && notice.author_uid !== user.uid) {
      return reply.status(403).send({ error: "Only the author or a superadmin can delete this notice" });
    }
    const remove = db().transaction((): void => {
      db().prepare("DELETE FROM notices WHERE id = ?").run(id);
      db().prepare("DELETE FROM notice_reactions WHERE notice_id = ?").run(id);
    });
    remove();
    hub.broadcastAll({ type: "reload", resource: "notices" });
    return { ok: true };
  });

  app.post("/api/notices/:id/reactions", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const id = (request.params as { id: string }).id;
    const notice = loadNotice(id);
    if (notice === undefined) {
      return reply.status(404).send({ error: "Notice not found" });
    }
    const body = ReactionBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const reactionId = `r_${randomBytes(9).toString("hex")}`;
    db()
      .prepare(
        "INSERT INTO notice_reactions (id, notice_id, text, timestamp, user_id, user_name, user_avatar) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(reactionId, id, body.data.text, Date.now(), user.uid, user.name ?? user.uid, null);
    hub.broadcastAll({ type: "reload", resource: "notices" });
    return reply.status(201).send({ id: reactionId });
  });

  app.delete("/api/notices/:id/reactions/:reactionId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const params = request.params as { id: string; reactionId: string };
    const reaction = db()
      .prepare("SELECT id, user_id FROM notice_reactions WHERE id = ? AND notice_id = ?")
      .get(params.reactionId, params.id) as { id: string; user_id: string | null } | undefined;
    if (reaction === undefined) {
      return reply.status(404).send({ error: "Reaction not found" });
    }
    if (reaction.user_id !== user.uid) {
      return reply.status(403).send({ error: "Only your own reactions can be removed" });
    }
    db().prepare("DELETE FROM notice_reactions WHERE id = ?").run(params.reactionId);
    hub.broadcastAll({ type: "reload", resource: "notices" });
    return { ok: true };
  });
}
