import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import {
  hashPasswordArgon2,
  verifyPasswordArgon2,
  verifyPasswordDummy,
  verifyPasswordFirebaseScrypt,
} from "./passwords.js";
import {
  createSession,
  deleteSession,
  deleteSessionsForUser,
  getSessionUser,
  type SessionUserRow,
} from "./sessions.js";
import { createLoginRateLimiter } from "./rate-limit.js";
import type { Emailer } from "./emails.js";

const LoginBody = z.object({ email: z.string().min(3).max(254), password: z.string().min(1).max(1024) });
const ForgotBody = z.object({ email: z.string().min(3).max(254) });
const ResetBody = z.object({ token: z.string().min(10).max(256), password: z.string().min(8).max(1024) });

const RESET_TTL_MS = 60 * 60 * 1000;
const COOKIE_NAME = "bioscom_session";
const GENERIC_LOGIN_ERROR = { error: "Invalid email or password" };

export interface AuthDeps {
  config: ServerConfig;
  emailer: Emailer;
}

interface PasswordResetRow {
  token_hash: string;
  uid: string;
  expires_at: number;
  used_at: number | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function publicUser(user: SessionUserRow) {
  return { uid: user.uid, name: user.name, role: user.role, groupId: user.group_id, email: user.email };
}

function findUserByEmail(db: Database.Database, email: string): SessionUserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email) as SessionUserRow | undefined;
}

function createResetToken(db: Database.Database, uid: string): string {
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO password_resets (token_hash, uid, expires_at) VALUES (?, ?, ?)").run(
    sha256(token),
    uid,
    Date.now() + RESET_TTL_MS,
  );
  return token;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const limiter = createLoginRateLimiter(deps.config.loginRateLimit);
  const db = (): Database.Database => getDatabase(deps.config.dbPath);

  app.post("/api/login", async (request, reply) => {
    const body = LoginBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    if (!limiter.check(request.ip)) {
      return reply.status(429).send({ error: "Too many login attempts. Try again in a minute." });
    }
    const { email, password } = body.data;
    const user = findUserByEmail(db(), email);
    if (user === undefined || user.password_hash === null || user.hash_version === null) {
      await verifyPasswordDummy(password);
      return reply.status(401).send(GENERIC_LOGIN_ERROR);
    }
    if (user.hash_version === "unverified") {
      if (user.email !== null) {
        const token = createResetToken(db(), user.uid);
        const link = `${deps.config.publicUrl}/#/reset-password?token=${token}`;
        try {
          await deps.emailer.sendResetEmail(user.email, link);
        } catch (error) {
          request.log.warn(error, "failed to send reset email for unverified account");
        }
      }
      return reply
        .status(401)
        .send({ error: "A password reset is required for this account. Check your email for a reset link." });
    }
    const ok =
      user.hash_version === "argon2id"
        ? await verifyPasswordArgon2(user.password_hash, password)
        : verifyPasswordFirebaseScrypt(password, user.password_salt ?? "", user.password_hash, deps.config.firebaseScrypt);
    if (!ok) {
      return reply.status(401).send(GENERIC_LOGIN_ERROR);
    }
    if (user.hash_version === "firebase-scrypt") {
      const newHash = await hashPasswordArgon2(password);
      db()
        .prepare("UPDATE users SET password_hash = ?, password_salt = NULL, hash_version = 'argon2id' WHERE uid = ?")
        .run(newHash, user.uid);
    }
    const sessionId = createSession(db(), user.uid);
    reply.setCookie(COOKIE_NAME, sessionId, { path: "/", httpOnly: true, secure: true, sameSite: "lax" });
    return { user: publicUser(user) };
  });

  app.post("/api/logout", async (request, reply) => {
    deleteSession(db(), request.cookies[COOKIE_NAME]);
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (request, reply) => {
    const user = getSessionUser(db(), request.cookies[COOKIE_NAME]);
    if (user === null) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    return { user: publicUser(user) };
  });

  app.post("/api/forgot-password", async (request, reply) => {
    const body = ForgotBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const user = findUserByEmail(db(), body.data.email);
    if (user !== undefined && user.email !== null) {
      const token = createResetToken(db(), user.uid);
      const link = `${deps.config.publicUrl}/#/reset-password?token=${token}`;
      try {
        await deps.emailer.sendResetEmail(user.email, link);
      } catch (error) {
        request.log.warn(error, "failed to send reset email");
      }
    }
    return { ok: true };
  });

  app.post("/api/reset-password", async (request, reply) => {
    const body = ResetBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const row = db()
      .prepare("SELECT * FROM password_resets WHERE token_hash = ?")
      .get(sha256(body.data.token)) as PasswordResetRow | undefined;
    if (row === undefined || row.used_at !== null || row.expires_at < Date.now()) {
      return reply.status(400).send({ error: "Invalid or expired reset link" });
    }
    const newHash = await hashPasswordArgon2(body.data.password);
    const applyReset = db().transaction(() => {
      db()
        .prepare("UPDATE users SET password_hash = ?, password_salt = NULL, hash_version = 'argon2id' WHERE uid = ?")
        .run(newHash, row.uid);
      db().prepare("UPDATE password_resets SET used_at = ? WHERE token_hash = ?").run(Date.now(), row.token_hash);
      deleteSessionsForUser(db(), row.uid);
    });
    applyReset();
    return { ok: true };
  });
}
