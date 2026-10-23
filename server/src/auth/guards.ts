import type { FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import { getSessionUser, SESSION_COOKIE_NAME, type SessionUserRow } from "./sessions.js";

export function requireUser(
  db: Database.Database,
  request: FastifyRequest,
  reply: FastifyReply,
): SessionUserRow | null {
  const user = getSessionUser(db, request.cookies[SESSION_COOKIE_NAME]);
  if (user === null) {
    void reply.status(401).send({ error: "Not authenticated" });
    return null;
  }
  return user;
}

export function requireSuperadmin(
  db: Database.Database,
  request: FastifyRequest,
  reply: FastifyReply,
): SessionUserRow | null {
  const user = requireUser(db, request, reply);
  if (user === null) {
    return null;
  }
  if (user.role !== "superadmin") {
    void reply.status(403).send({ error: "Superadmin only" });
    return null;
  }
  return user;
}
