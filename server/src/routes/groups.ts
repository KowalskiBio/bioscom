import { randomBytes, randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { CreateGroupBodySchema, JoinGroupBodySchema } from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";

const EMPTY_TREE = JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] });

export function registerGroupRoutes(app: FastifyInstance, config: ServerConfig): void {
  const db = (): Database.Database => getDatabase(config.dbPath);

  app.get("/api/groups", async (request, reply) => {
    if (requireUser(db(), request, reply) === null) return;
    const rows = db()
      .prepare("SELECT id, name, created FROM groups ORDER BY name")
      .all() as Array<{ id: string; name: string; created: number }>;
    return { groups: rows };
  });

  app.post("/api/groups", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const body = CreateGroupBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const groupId = randomBytes(9).toString("base64url");
    let joinCode = "";
    const create = db().transaction((): void => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = `BIOS-${randomInt(100, 1000)}`;
        const taken = db().prepare("SELECT 1 FROM groups WHERE join_code = ?").get(candidate);
        if (taken === undefined) {
          joinCode = candidate;
          break;
        }
      }
      if (joinCode === "") {
        joinCode = `BIOS-${randomInt(100000, 1000000)}`;
      }
      db()
        .prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)")
        .run(groupId, body.data.name, joinCode, Date.now());
      db().prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)").run(groupId, EMPTY_TREE);
      db().prepare("UPDATE users SET group_id = ? WHERE uid = ?").run(groupId, user.uid);
    });
    create();
    return reply.status(201).send({ group: { id: groupId, name: body.data.name, joinCode } });
  });

  app.post("/api/groups/join", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const body = JoinGroupBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const group = db()
      .prepare("SELECT id, name FROM groups WHERE join_code = ? COLLATE NOCASE")
      .get(body.data.code) as { id: string; name: string } | undefined;
    if (group === undefined) {
      return reply.status(404).send({ error: "No lab matches this join code" });
    }
    if (user.group_id === group.id) {
      return reply.status(409).send({ error: "You are already a member of this lab" });
    }
    db().prepare("UPDATE users SET group_id = ? WHERE uid = ?").run(group.id, user.uid);
    return { group: { id: group.id, name: group.name } };
  });

  app.get("/api/groups/:id/members", async (request, reply) => {
    if (requireUser(db(), request, reply) === null) return;
    const id = (request.params as { id: string }).id;
    const members = db()
      .prepare("SELECT uid, name, role FROM users WHERE group_id = ? ORDER BY name")
      .all(id) as Array<{ uid: string; name: string | null; role: string }>;
    return { members };
  });
}
