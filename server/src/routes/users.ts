import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { RegisterBodySchema, UpdateProfileBodySchema, UpdateRoleBodySchema } from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireSuperadmin, requireUser } from "../auth/guards.js";
import { hashPasswordArgon2 } from "../auth/passwords.js";
import { createSession, SESSION_COOKIE_NAME, type SessionUserRow } from "../auth/sessions.js";

function publicProfile(user: SessionUserRow) {
  return { uid: user.uid, name: user.name, role: user.role, groupId: user.group_id, email: user.email };
}

export function registerUserRoutes(app: FastifyInstance, config: ServerConfig): void {
  const db = (): Database.Database => getDatabase(config.dbPath);

  app.post("/api/register", async (request, reply) => {
    const body = RegisterBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const existing = db().prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE").get(body.data.email);
    if (existing !== undefined) {
      return reply.status(409).send({ error: "An account with this email already exists" });
    }
    const uid = `u_${randomBytes(12).toString("hex")}`;
    const passwordHash = await hashPasswordArgon2(body.data.password);
    db()
      .prepare(
        "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, 'reader', NULL)",
      )
      .run(uid, body.data.email, passwordHash, body.data.name);
    const sessionId = createSession(db(), uid);
    reply.setCookie(SESSION_COOKIE_NAME, sessionId, { path: "/", httpOnly: true, secure: true, sameSite: "lax" });
    return reply
      .status(201)
      .send({ user: { uid, name: body.data.name, role: "reader", groupId: null, email: body.data.email } });
  });

  app.get("/api/users/me", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    return { user: publicProfile(user) };
  });

  app.put("/api/users/me", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const body = UpdateProfileBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    if (body.data.name !== undefined) {
      db().prepare("UPDATE users SET name = ? WHERE uid = ?").run(body.data.name, user.uid);
    }
    if (body.data.avatar !== undefined) {
      db().prepare("UPDATE users SET avatar = ? WHERE uid = ?").run(body.data.avatar, user.uid);
    }
    const updated = db().prepare("SELECT * FROM users WHERE uid = ?").get(user.uid) as SessionUserRow;
    return { user: publicProfile(updated) };
  });

  app.get("/api/admin/users", async (request, reply) => {
    if (requireSuperadmin(db(), request, reply) === null) return;
    const rows = db()
      .prepare("SELECT uid, email, name, role, group_id FROM users ORDER BY email")
      .all() as Array<{ uid: string; email: string | null; name: string | null; role: string; group_id: string | null }>;
    return { users: rows };
  });

  app.put("/api/admin/users/:uid/role", async (request, reply) => {
    if (requireSuperadmin(db(), request, reply) === null) return;
    const params = request.params as { uid: string };
    const body = UpdateRoleBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const result = db().prepare("UPDATE users SET role = ? WHERE uid = ?").run(body.data.role, params.uid);
    if (result.changes === 0) {
      return reply.status(404).send({ error: "No such user" });
    }
    return { ok: true };
  });

  app.delete("/api/admin/users/:uid", async (request, reply) => {
    if (requireSuperadmin(db(), request, reply) === null) return;
    const params = request.params as { uid: string };
    const target = db().prepare("SELECT uid FROM users WHERE uid = ?").get(params.uid);
    if (target === undefined) {
      return reply.status(404).send({ error: "No such user" });
    }
    const remove = db().transaction((): void => {
      db().prepare("DELETE FROM users WHERE uid = ?").run(params.uid);
      db().prepare("DELETE FROM sessions WHERE uid = ?").run(params.uid);
      db().prepare("DELETE FROM password_resets WHERE uid = ?").run(params.uid);
    });
    remove();
    return { ok: true };
  });
}
