import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

export interface SessionUserRow {
  uid: string;
  email: string | null;
  name: string | null;
  role: string;
  group_id: string | null;
  hash_version: string | null;
  password_hash: string | null;
  password_salt: string | null;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "bioscom_session";

export function createSession(db: Database.Database, uid: string): string {
  const id = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (id, uid, expires_at) VALUES (?, ?, ?)").run(id, uid, Date.now() + SESSION_TTL_MS);
  return id;
}

export function purgeExpiredSessions(db: Database.Database): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}

export function getSessionUser(db: Database.Database, sessionId: string | undefined): SessionUserRow | null {
  if (sessionId === undefined || sessionId === "") {
    return null;
  }
  purgeExpiredSessions(db);
  const row = db
    .prepare(
      `SELECT u.uid, u.email, u.name, u.role, u.group_id, u.hash_version, u.password_hash, u.password_salt
       FROM sessions s JOIN users u ON u.uid = s.uid WHERE s.id = ?`,
    )
    .get(sessionId) as SessionUserRow | undefined;
  return row ?? null;
}

export function deleteSession(db: Database.Database, sessionId: string | undefined): void {
  if (sessionId === undefined || sessionId === "") {
    return;
  }
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function deleteSessionsForUser(db: Database.Database, uid: string): void {
  db.prepare("DELETE FROM sessions WHERE uid = ?").run(uid);
}
