import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { FastifyInstance } from "fastify";
import { hash as argonHash } from "@node-rs/argon2";
import { buildApp } from "../src/app.js";
import { closeDatabase, getDatabase } from "../src/db.js";

const XRW = { "X-Requested-With": "XMLHttpRequest" };

let app: FastifyInstance;
let baseUrl: string;
let dbPath: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(baseUrl).post("/api/login").set(XRW).send({ email, password });
  if (response.status !== 200) {
    throw new Error(`login failed for ${email}: ${response.status}`);
  }
  const setCookie = response.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (first ?? "").split(";")[0] ?? "";
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-groups-test-"));
  dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("no address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  const db = getDatabase(dbPath);
  const insert = db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  );
  insert.run("uid-owner", "owner@test.example", await argonHash("owner-password"), "Owner User", "admin", null);
  insert.run("uid-super", "super@test.example", await argonHash("super-password"), "Super User", "superadmin", null);
    insert.run("uid-other", "other@test.example", await argonHash("other-password"), "Other User", "reader", null);
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)").run("group-old", "Old Lab", "BIOS-111", Date.now());
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("auth guard", () => {
  it("rejects unauthenticated group listing", async () => {
    const response = await request(baseUrl).get("/api/groups");
    expect(response.status).toBe(401);
  });
});

describe("POST /api/groups", () => {
  it("rejects an invalid body", async () => {
    const cookie = await login("owner@test.example", "owner-password");
    const response = await request(baseUrl).post("/api/groups").set(XRW).set("Cookie", cookie).send({ name: "" });
    expect(response.status).toBe(400);
  });

  it("creates the lab, its empty inventory doc and makes the creator a member", async () => {
    const cookie = await login("owner@test.example", "owner-password");
    const response = await request(baseUrl).post("/api/groups").set(XRW).set("Cookie", cookie).send({ name: "New Lab" });
    expect(response.status).toBe(201);
    const group = response.body.group as { id: string; name: string; joinCode: string };
    expect(group.name).toBe("New Lab");
    expect(group.joinCode).toMatch(/^BIOS-\d+$/);
    const db = getDatabase(dbPath);
    const groupRow = db.prepare("SELECT id, name FROM groups WHERE id = ?").get(group.id) as { name: string } | undefined;
    expect(groupRow?.name).toBe("New Lab");
    const doc = db
      .prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = ?")
      .get(group.id) as { tree: string; version: number };
    expect(doc.version).toBe(0);
    expect(JSON.parse(doc.tree)).toEqual({ rooms: [], assetRooms: [], assets: [], protocols: [] });
    const member = db.prepare("SELECT group_id FROM users WHERE uid = 'uid-owner'").get() as { group_id: string };
    expect(member.group_id).toBe(group.id);
  });
});

describe("POST /api/groups/join", () => {
  it("rejects a wrong code with 404", async () => {
    const cookie = await login("other@test.example", "other-password");
    const response = await request(baseUrl).post("/api/groups/join").set(XRW).set("Cookie", cookie).send({ code: "BIOS-999" });
    expect(response.status).toBe(404);
  });

  it("joins by code and updates membership", async () => {
    const cookie = await login("other@test.example", "other-password");
    const response = await request(baseUrl).post("/api/groups/join").set(XRW).set("Cookie", cookie).send({ code: "BIOS-111" });
    expect(response.status).toBe(200);
    const row = getDatabase(dbPath).prepare("SELECT group_id FROM users WHERE uid = 'uid-other'").get() as { group_id: string };
    expect(row.group_id).toBe("group-old");
  });

  it("rejects joining the same lab twice with 409", async () => {
    const cookie = await login("other@test.example", "other-password");
    const response = await request(baseUrl).post("/api/groups/join").set(XRW).set("Cookie", cookie).send({ code: "BIOS-111" });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("already a member");
  });
});

describe("GET /api/groups/:id/members", () => {
  it("returns names and uids only, never emails", async () => {
    const cookie = await login("owner@test.example", "owner-password");
    const response = await request(baseUrl).get("/api/groups/group-old/members").set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body.members).toEqual([{ uid: "uid-other", name: "Other User", role: "reader" }]);
    expect(JSON.stringify(response.body)).not.toContain("email");
    expect(JSON.stringify(response.body)).not.toContain("test.example");
  });
});

describe("superadmin routes", () => {
  it("rejects role changes by non-superadmins", async () => {
    const cookie = await login("owner@test.example", "owner-password");
    const response = await request(baseUrl)
      .put("/api/admin/users/uid-other/role")
      .set(XRW)
      .set("Cookie", cookie)
      .send({ role: "admin" });
    expect(response.status).toBe(403);
  });

  it("lets a superadmin change a role and list users with emails", async () => {
    const cookie = await login("super@test.example", "super-password");
    const change = await request(baseUrl)
      .put("/api/admin/users/uid-other/role")
      .set(XRW)
      .set("Cookie", cookie)
      .send({ role: "admin" });
    expect(change.status).toBe(200);
    const row = getDatabase(dbPath).prepare("SELECT role FROM users WHERE uid = 'uid-other'").get() as { role: string };
    expect(row.role).toBe("admin");
    const list = await request(baseUrl).get("/api/admin/users").set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain("other@test.example");
  });

  it("rejects the admin user list for non-superadmins", async () => {
    const cookie = await login("owner@test.example", "owner-password");
    const response = await request(baseUrl).get("/api/admin/users").set("Cookie", cookie);
    expect(response.status).toBe(403);
  });

  it("deletes a user and their sessions", async () => {
    const cookie = await login("super@test.example", "super-password");
    const victimCookie = await login("other@test.example", "other-password");
    const stillIn = await request(baseUrl).get("/api/me").set("Cookie", victimCookie);
    expect(stillIn.status).toBe(200);
    const response = await request(baseUrl).delete("/api/admin/users/uid-other").set(XRW).set("Cookie", cookie);
    expect(response.status).toBe(200);
    const db = getDatabase(dbPath);
    const userRow = db.prepare("SELECT COUNT(*) AS n FROM users WHERE uid = 'uid-other'").get() as { n: number };
    const sessionRow = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE uid = 'uid-other'").get() as { n: number };
    expect(userRow.n).toBe(0);
    expect(sessionRow.n).toBe(0);
  });
});

describe("POST /api/register", () => {
  it("creates an account, logs it in and rejects duplicates", async () => {
    const response = await request(baseUrl)
      .post("/api/register")
      .set(XRW)
      .send({ email: "fresh@test.example", password: "fresh-password", name: "Fresh User" });
    expect(response.status).toBe(201);
    const cookie = ((response.headers["set-cookie"] as unknown as string[]) ?? [])[0]?.split(";")[0] ?? "";
    expect(cookie).toContain("bioscom_session=");
    const me = await request(baseUrl).get("/api/users/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.name).toBe("Fresh User");
    const duplicate = await request(baseUrl)
      .post("/api/register")
      .set(XRW)
      .send({ email: "fresh@test.example", password: "another-password", name: "Fresh User" });
    expect(duplicate.status).toBe(409);
  });
});

describe("PUT /api/users/me", () => {
  it("updates name and avatar", async () => {
    const cookie = await login("owner@test.example", "owner-password");
    const response = await request(baseUrl)
      .put("/api/users/me")
      .set(XRW)
      .set("Cookie", cookie)
      .send({ name: "Owner Renamed", avatar: "data:image/png;base64,AA==" });
    expect(response.status).toBe(200);
    expect(response.body.user.name).toBe("Owner Renamed");
    const row = getDatabase(dbPath)
      .prepare("SELECT name, avatar FROM users WHERE uid = 'uid-owner'")
      .get() as { name: string; avatar: string | null };
    expect(row.name).toBe("Owner Renamed");
    expect(row.avatar).toBe("data:image/png;base64,AA==");
  });
});
