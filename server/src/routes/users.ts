import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  CATALOG_COLUMN_SCOPES,
  CatalogColumnUpdateSchema,
  DASHBOARD_DISMISSED_ALERTS_SETTINGS_KEY,
  DashboardDismissalKeysError,
  DashboardDismissalLimitError,
  DashboardDismissalUpdateBodySchema,
  RegisterBodySchema,
  UpdateProfileBodySchema,
  UpdateRoleBodySchema,
  applyDashboardDismissal,
  defaultCatalogColumnSelections,
  normalizeDashboardDismissalKeys,
  type CatalogColumnScope,
  type CatalogColumnSelections,
  type DashboardDismissalsResponse,
} from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireSuperadmin, requireUser } from "../auth/guards.js";
import { hashPasswordArgon2 } from "../auth/passwords.js";
import { createSession, SESSION_COOKIE_NAME, type SessionUserRow } from "../auth/sessions.js";

function publicProfile(user: SessionUserRow) {
  return { uid: user.uid, name: user.name, role: user.role, groupId: user.group_id, email: user.email };
}

interface UserSettingsRow {
  settings: string;
  updated_at: number;
}

interface CatalogColumnPreferences {
  columnsByType: CatalogColumnSelections;
  updatedAt: number;
}

const MAX_USER_SETTINGS_LENGTH = 64 * 1024;
const CATALOG_COLUMN_SCOPE_SET: ReadonlySet<string> = new Set(CATALOG_COLUMN_SCOPES);

class StoredSettingsError extends Error {}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredSettings(raw: string): Record<string, unknown> {
  if (raw.length > MAX_USER_SETTINGS_LENGTH) {
    throw new StoredSettingsError("stored settings exceed the size limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StoredSettingsError("stored settings are not valid JSON");
  }
  if (!isPlainRecord(parsed)) {
    throw new StoredSettingsError("stored settings must be an object");
  }
  return parsed;
}

/**
 * This document is account-scoped, never lab-scoped. Unknown root properties are
 * preserved so the document can grow additively, while missing scopes are
 * normalised to current defaults and present-but-invalid data is rejected.
 */
function normalizeColumnsByType(raw: unknown): CatalogColumnSelections {
  const selections = defaultCatalogColumnSelections();
  if (raw === undefined) {
    return selections;
  }
  if (!isPlainRecord(raw)) {
    throw new StoredSettingsError("columnsByType must be an object");
  }
  for (const [scope, columns] of Object.entries(raw)) {
    if (!CATALOG_COLUMN_SCOPE_SET.has(scope)) {
      throw new StoredSettingsError(`unknown catalog column scope: ${scope}`);
    }
    const parsed = CatalogColumnUpdateSchema.safeParse({ scope, columns });
    if (!parsed.success) {
      throw new StoredSettingsError(`invalid catalog column preference for scope: ${scope}`);
    }
    selections[parsed.data.scope] = [...parsed.data.columns];
  }
  return selections;
}

function readSettingsRoot(
  db: Database.Database,
  uid: string,
): { root: Record<string, unknown>; updatedAt: number } {
  const row = db
    .prepare("SELECT settings, updated_at FROM user_settings WHERE uid = ?")
    .get(uid) as UserSettingsRow | undefined;
  if (row === undefined) {
    return { root: {}, updatedAt: 0 };
  }
  return { root: parseStoredSettings(row.settings), updatedAt: row.updated_at };
}

function readCatalogColumnPreferences(db: Database.Database, uid: string): CatalogColumnPreferences {
  const { root, updatedAt } = readSettingsRoot(db, uid);
  return { columnsByType: normalizeColumnsByType(root.columnsByType), updatedAt };
}

function writeCatalogColumnPreferences(
  db: Database.Database,
  uid: string,
  scope: CatalogColumnScope,
  columns: readonly string[],
): CatalogColumnPreferences {
  // Read/merge/write in one transaction so concurrent updates for other scopes
  // cannot clobber each other.
  const save = db.transaction((): CatalogColumnPreferences => {
    const { root } = readSettingsRoot(db, uid);
    const columnsByType = normalizeColumnsByType(root.columnsByType);
    columnsByType[scope] = [...columns];
    const serialized = JSON.stringify({ ...root, columnsByType });
    if (serialized.length > MAX_USER_SETTINGS_LENGTH) {
      throw new StoredSettingsError("stored settings would exceed the size limit");
    }
    const updatedAt = Date.now();
    db.prepare(
      `INSERT INTO user_settings (uid, settings, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
    ).run(uid, serialized, updatedAt);
    return { columnsByType, updatedAt };
  });
  // Acquire the write lock before reading so a concurrent process cannot merge
  // against the same stale document.
  return save.immediate();
}

function normalizeStoredDismissals(raw: unknown): string[] {
  try {
    return normalizeDashboardDismissalKeys(raw);
  } catch (error) {
    if (error instanceof DashboardDismissalKeysError) {
      throw new StoredSettingsError("dashboardDismissedAlerts is invalid");
    }
    throw error;
  }
}

function readDashboardDismissals(db: Database.Database, uid: string): DashboardDismissalsResponse {
  const { root, updatedAt } = readSettingsRoot(db, uid);
  return {
    dismissals: normalizeStoredDismissals(root[DASHBOARD_DISMISSED_ALERTS_SETTINGS_KEY]),
    updatedAt,
  };
}

function writeDashboardDismissal(
  db: Database.Database,
  uid: string,
  key: string,
  dismissed: boolean,
): DashboardDismissalsResponse {
  // Keep the read/merge/write atomic so dismissing an alert cannot clobber a
  // concurrent catalog-column update or any other additive root property.
  const save = db.transaction((): DashboardDismissalsResponse => {
    const { root, updatedAt } = readSettingsRoot(db, uid);
    const current = normalizeStoredDismissals(root[DASHBOARD_DISMISSED_ALERTS_SETTINGS_KEY]);
    const result = applyDashboardDismissal(current, key, dismissed);
    if (!result.changed) {
      return { dismissals: result.dismissals, updatedAt };
    }
    const serialized = JSON.stringify({
      ...root,
      [DASHBOARD_DISMISSED_ALERTS_SETTINGS_KEY]: result.dismissals,
    });
    if (serialized.length > MAX_USER_SETTINGS_LENGTH) {
      // This is a client-facing capacity limit, not corrupt persisted data:
      // the stored document is valid, but this new dismissal cannot fit.
      throw new DashboardDismissalLimitError("too many dismissed dashboard alerts");
    }
    const nextUpdatedAt = Date.now();
    db.prepare(
      `INSERT INTO user_settings (uid, settings, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
    ).run(uid, serialized, nextUpdatedAt);
    return { dismissals: result.dismissals, updatedAt: nextUpdatedAt };
  });
  return save.immediate();
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

  app.get("/api/users/me/catalog-columns", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    try {
      return readCatalogColumnPreferences(db(), user.uid);
    } catch (error) {
      if (error instanceof StoredSettingsError) {
        request.log.error({ err: error }, "invalid stored user settings");
        return reply.status(500).send({ error: "Stored user settings are invalid" });
      }
      throw error;
    }
  });

  app.put("/api/users/me/catalog-columns", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const body = CatalogColumnUpdateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    try {
      return writeCatalogColumnPreferences(db(), user.uid, body.data.scope, body.data.columns);
    } catch (error) {
      if (error instanceof StoredSettingsError) {
        request.log.error({ err: error }, "invalid stored user settings");
        return reply.status(500).send({ error: "Stored user settings are invalid" });
      }
      throw error;
    }
  });

  app.get("/api/users/me/dashboard-dismissals", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    try {
      return readDashboardDismissals(db(), user.uid);
    } catch (error) {
      if (error instanceof StoredSettingsError) {
        request.log.error({ err: error }, "invalid stored user settings");
        return reply.status(500).send({ error: "Stored user settings are invalid" });
      }
      throw error;
    }
  });

  app.put("/api/users/me/dashboard-dismissals", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const body = DashboardDismissalUpdateBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    try {
      return writeDashboardDismissal(db(), user.uid, body.data.key, body.data.dismissed);
    } catch (error) {
      if (error instanceof StoredSettingsError) {
        request.log.error({ err: error }, "invalid stored user settings");
        return reply.status(500).send({ error: "Stored user settings are invalid" });
      }
      if (error instanceof DashboardDismissalLimitError) {
        return reply.status(400).send({ error: "Too many dismissed dashboard alerts" });
      }
      throw error;
    }
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
      // No FK enforcement is assumed, so account settings are removed explicitly.
      db().prepare("DELETE FROM user_settings WHERE uid = ?").run(params.uid);
    });
    remove();
    return { ok: true };
  });
}
