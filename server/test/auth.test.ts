import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { FastifyInstance } from "fastify";
import { hash as argonHash } from "@node-rs/argon2";
import { firebaseScryptHash, type FirebaseScryptParams } from "@bioscom/shared";
import { buildApp } from "../src/app.js";
import { closeDatabase, getDatabase } from "../src/db.js";
import type { Emailer } from "../src/auth/emails.js";

const XRW = { "X-Requested-With": "XMLHttpRequest" };

const scryptParams: FirebaseScryptParams = {
  signerKey: Buffer.alloc(32, 7).toString("base64"),
  saltSeparator: "Bw==",
  rounds: 8,
  memCost: 9,
};
const FIREBASE_PASSWORD = "firebase-user-password";
const fbSalt = Buffer.alloc(16, 3).toString("base64");
const fbHash = firebaseScryptHash(FIREBASE_PASSWORD, fbSalt, scryptParams).toString("base64");

const sentEmails: Array<{ to: string; link: string }> = [];
const emailer: Emailer = {
  async sendResetEmail(to: string, link: string): Promise<void> {
    sentEmails.push({ to, link });
  },
};

let app: FastifyInstance;
let baseUrl: string;
let dbPath: string;

async function listen(instance: FastifyInstance): Promise<string> {
  await instance.listen({ port: 0, host: "127.0.0.1" });
  const address = instance.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("server did not return an address");
  }
  return `http://127.0.0.1:${address.port}`;
}

function cookieFrom(response: request.Response): string {
  const setCookie = response.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (first === undefined) {
    throw new Error("no set-cookie header");
  }
  return first.split(";")[0] ?? "";
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-auth-test-"));
  dbPath = join(dir, "test.db");
  app = await buildApp({
    config: {
      dbPath,
      logLevel: "silent",
      firebaseScrypt: scryptParams,
      publicUrl: "https://test.example",
      loginRateLimit: 1000,
    },
    emailer,
  });
  baseUrl = await listen(app);
  const db = getDatabase(dbPath);
  const insert = db.prepare(
    "INSERT INTO users (uid, email, password_hash, password_salt, hash_version, name, role, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run("uid-argon", "argon@test.example", await argonHash("argon-password"), null, "argon2id", "Argon User", "admin", "group-a");
  insert.run("uid-fb", "fb@test.example", fbHash, fbSalt, "firebase-scrypt", "Firebase User", "reader", "group-a");
  insert.run("uid-unverified", "unverified@test.example", "leftover", null, "unverified", "Unverified User", "reader", "group-a");
  insert.run("uid-nohash", "nohash@test.example", null, null, null, "No Hash User", "reader", "group-a");
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("POST /api/login", () => {
  it("logs in an argon2id user and sets the session cookie", async () => {
    const response = await request(baseUrl)
      .post("/api/login")
      .set(XRW)
      .send({ email: "argon@test.example", password: "argon-password" });
    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      uid: "uid-argon",
      name: "Argon User",
      role: "admin",
      groupId: "group-a",
      email: "argon@test.example",
    });
    const cookie = cookieFrom(response);
    expect(cookie).toContain("bioscom_session=");
    expect(String(response.headers["set-cookie"])).toContain("HttpOnly");
  });

  it("verifies a firebase-scrypt hash, rehashes to argon2id and keeps the login working", async () => {
    const response = await request(baseUrl)
      .post("/api/login")
      .set(XRW)
      .send({ email: "fb@test.example", password: FIREBASE_PASSWORD });
    expect(response.status).toBe(200);
    const row = getDatabase(dbPath)
      .prepare("SELECT hash_version, password_salt FROM users WHERE uid = ?")
      .get("uid-fb") as { hash_version: string; password_salt: string | null };
    expect(row.hash_version).toBe("argon2id");
    expect(row.password_salt).toBeNull();
    const again = await request(baseUrl)
      .post("/api/login")
      .set(XRW)
      .send({ email: "fb@test.example", password: FIREBASE_PASSWORD });
    expect(again.status).toBe(200);
  });

  it("rejects a wrong password with 401", async () => {
    const response = await request(baseUrl)
      .post("/api/login")
      .set(XRW)
      .send({ email: "argon@test.example", password: "wrong-password" });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid email or password" });
  });

  it("rejects an unknown user with 401 and the identical body", async () => {
    const response = await request(baseUrl)
      .post("/api/login")
      .set(XRW)
      .send({ email: "ghost@test.example", password: "whatever" });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid email or password" });
  });

  it("rejects a passwordless user with 401", async () => {
    const response = await request(baseUrl)
      .post("/api/login")
      .set(XRW)
      .send({ email: "nohash@test.example", password: "whatever" });
    expect(response.status).toBe(401);
  });

  it("requires a reset for hash_version=unverified and sends the reset email", async () => {
    const response = await request(baseUrl)
      .post("/api/login")
      .set(XRW)
      .send({ email: "unverified@test.example", password: "whatever" });
    expect(response.status).toBe(401);
    expect(response.body.error).toContain("password reset is required");
    expect(sentEmails.some((mail) => mail.to === "unverified@test.example")).toBe(true);
  });
});

describe("GET /api/me", () => {
  it("returns the session user with a cookie", async () => {
    const login = await request(baseUrl)
      .post("/api/login")
      .set(XRW)
      .send({ email: "argon@test.example", password: "argon-password" });
    const cookie = cookieFrom(login);
    const response = await request(baseUrl).get("/api/me").set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body.user.uid).toBe("uid-argon");
  });

  it("returns 401 without a cookie", async () => {
    const response = await request(baseUrl).get("/api/me");
    expect(response.status).toBe(401);
  });
});

describe("POST /api/logout", () => {
  it("clears the session server-side", async () => {
    const login = await request(baseUrl)
      .post("/api/login")
      .set(XRW)
      .send({ email: "argon@test.example", password: "argon-password" });
    const cookie = cookieFrom(login);
    const logout = await request(baseUrl).post("/api/logout").set(XRW).set("Cookie", cookie);
    expect(logout.status).toBe(200);
    const after = await request(baseUrl).get("/api/me").set("Cookie", cookie);
    expect(after.status).toBe(401);
  });
});

describe("expired sessions", () => {
  it("returns 401 and the sweep deletes the row", async () => {
    const db = getDatabase(dbPath);
    db.prepare("INSERT INTO sessions (id, uid, expires_at) VALUES (?, ?, ?)").run(
      "expired-session-id",
      "uid-argon",
      Date.now() - 1000,
    );
    const response = await request(baseUrl).get("/api/me").set("Cookie", "bioscom_session=expired-session-id");
    expect(response.status).toBe(401);
    const count = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = ?").get("expired-session-id") as { n: number };
    expect(count.n).toBe(0);
  });
});

describe("CSRF guard", () => {
  it("rejects mutations without X-Requested-With", async () => {
    const response = await request(baseUrl)
      .post("/api/login")
      .send({ email: "argon@test.example", password: "argon-password" });
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Missing X-Requested-With header" });
  });
});

describe("password reset flow", () => {
  it("sends a single-use reset link and changes the password", async () => {
    sentEmails.length = 0;
    const forgot = await request(baseUrl).post("/api/forgot-password").set(XRW).send({ email: "argon@test.example" });
    expect(forgot.status).toBe(200);
    expect(forgot.body).toEqual({ ok: true });
    expect(sentEmails).toHaveLength(1);
    const token = sentEmails[0]?.link.split("token=")[1] ?? "";
    expect(token.length).toBeGreaterThan(10);
    const reset = await request(baseUrl).post("/api/reset-password").set(XRW).send({ token, password: "brand-new-password" });
    expect(reset.status).toBe(200);
    const reuse = await request(baseUrl).post("/api/reset-password").set(XRW).send({ token, password: "another-password" });
    expect(reuse.status).toBe(400);
    const login = await request(baseUrl)
      .post("/api/login")
      .set(XRW)
      .send({ email: "argon@test.example", password: "brand-new-password" });
    expect(login.status).toBe(200);
  });

  it("responds identically for unknown emails (no enumeration)", async () => {
    sentEmails.length = 0;
    const response = await request(baseUrl)
      .post("/api/forgot-password")
      .set(XRW)
      .send({ email: "ghost@test.example" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(sentEmails).toHaveLength(0);
  });
});

describe("login rate limiting", () => {
  it("blocks the 6th attempt within a minute", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bioscom-rate-test-"));
    const rateApp = await buildApp({
      config: { dbPath: join(dir, "rate.db"), logLevel: "silent", firebaseScrypt: null, loginRateLimit: 5 },
      emailer,
    });
    const rateUrl = await listen(rateApp);
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await request(rateUrl)
          .post("/api/login")
          .set(XRW)
          .send({ email: "argon@test.example", password: "wrong" });
        expect(response.status).toBe(401);
      }
      const sixth = await request(rateUrl)
        .post("/api/login")
        .set(XRW)
        .send({ email: "argon@test.example", password: "wrong" });
      expect(sixth.status).toBe(429);
    } finally {
      await rateApp.close();
    }
  });
});

describe("RESET_REDIRECT_EMAIL", () => {
  it("delivers unverified-login and forgot-password resets to the configured address", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bioscom-redirect-test-"));
    const redirectDbPath = join(dir, "test.db");
    const redirectApp = await buildApp({
      config: {
        dbPath: redirectDbPath,
        logLevel: "silent",
        publicUrl: "https://test.example",
        loginRateLimit: 1000,
        resetRedirectEmail: "trial-inbox@test.example",
      },
      emailer,
    });
    const redirectUrl = await listen(redirectApp);
    try {
      const db = getDatabase(redirectDbPath);
      db.prepare(
        "INSERT INTO users (uid, email, password_hash, password_salt, hash_version, name, role, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run("uid-redirect", "redirected@test.example", "leftover", null, "unverified", "Redirected User", "reader", "group-a");
      const login = await request(redirectUrl)
        .post("/api/login")
        .set(XRW)
        .send({ email: "redirected@test.example", password: "whatever" });
      expect(login.status).toBe(401);
      expect(login.body.error).toContain("password reset is required");
      const forgot = await request(redirectUrl)
        .post("/api/forgot-password")
        .set(XRW)
        .send({ email: "redirected@test.example" });
      expect(forgot.status).toBe(200);
      const redirected = sentEmails.filter((mail) => mail.to === "trial-inbox@test.example");
      expect(redirected.length).toBe(2);
      expect(redirected.every((mail) => mail.link.includes("token="))).toBe(true);
      expect(sentEmails.some((mail) => mail.to === "redirected@test.example")).toBe(false);
    } finally {
      await redirectApp.close();
      closeDatabase();
      getDatabase(dbPath);
    }
  });
});
