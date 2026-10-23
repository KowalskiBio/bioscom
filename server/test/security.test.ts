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
let attackerCookie: string;
let victimCookie: string;
let roomId = "";
let containerId = "";
let shelfId = "";

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
  const dir = mkdtempSync(join(tmpdir(), "bioscom-security-test-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("no address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  const db = getDatabase(dbPath);
  const insertUser = db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  );
  insertUser.run("uid-s-attacker", "attacker@sec.test", await argonHash("attacker-password"), "Attacker", "admin", "group-a");
  insertUser.run("uid-s-victim", "victim@sec.test", await argonHash("victim-password"), "Victim", "admin", "group-b");
  const insertGroup = db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)");
  insertGroup.run("group-a", "Lab A", "BIOS-401", Date.now());
  insertGroup.run("group-b", "Lab B", "BIOS-402", Date.now());
  const emptyTree = JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] });
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-a', ?, 0)").run(emptyTree);
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-b', ?, 0)").run(emptyTree);
  attackerCookie = await login("attacker@sec.test", "attacker-password");
  victimCookie = await login("victim@sec.test", "victim-password");

  const room = (await (
    await request(baseUrl)
      .post("/api/groups/group-b/inventory/rooms")
      .set(XRW)
      .set("Cookie", victimCookie)
      .send({ name: "Victim Room" })
  ).body) as { tree: { rooms: Array<{ id: string; containers: Array<{ id: string; shelves: Array<{ id: string }> }> }> } };
  roomId = room.tree.rooms[0]?.id ?? "";
  const container = (
    await (
      await request(baseUrl)
        .post("/api/groups/group-b/inventory/containers")
        .set(XRW)
        .set("Cookie", victimCookie)
        .send({ roomId, name: "Victim Fridge", type: "fridge", shelves: ["Shelf 1"] })
    ).body
  ) as { tree: { rooms: Array<{ containers: Array<{ id: string; shelves: Array<{ id: string }> }> }> } };
  containerId = container.tree.rooms[0]?.containers[0]?.id ?? "";
  shelfId = container.tree.rooms[0]?.containers[0]?.shelves[0]?.id ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("authorization fuzz", () => {
  it("never lets lab A touch lab B's resources", async () => {
    const attempts: Array<{ method: string; url: string; body?: Record<string, unknown>; label: string }> = [
      { method: "GET", url: "/api/groups/group-b/inventory", label: "read inventory" },
      { method: "POST", url: "/api/groups/group-b/inventory/rooms", body: { name: "Stolen" }, label: "add room" },
      { method: "PUT", url: "/api/groups/group-b/inventory/rooms/whatever", body: { name: "Stolen" }, label: "edit room" },
      { method: "DELETE", url: "/api/groups/group-b/inventory/rooms/whatever", label: "delete room" },
      { method: "POST", url: "/api/groups/group-b/inventory/containers", body: { roomId: "x", name: "S", type: "fridge" }, label: "add container" },
      { method: "POST", url: "/api/groups/group-b/inventory/shelves", body: { roomId: "x", containerId: "y", name: "S" }, label: "add shelf" },
      { method: "POST", url: "/api/groups/group-b/inventory/chemicals", body: { roomId, containerId, shelfId, name: "Stolen" }, label: "add chemical" },
      { method: "GET", url: "/api/groups/group-b/history", label: "read history" },
      { method: "GET", url: "/api/groups/group-b/backups", label: "read backups" },
      { method: "POST", url: "/api/groups/group-b/backups", body: {}, label: "create backup" },
      { method: "POST", url: "/api/groups/group-b/backups/whatever/restore", body: {}, label: "restore backup" },
      { method: "GET", url: "/api/groups/group-b/shared-containers", label: "list shared containers" },
      { method: "POST", url: "/api/groups/group-b/inventory/containers/whatever/share", body: { roomId, sharedWithGroupId: "group-a" }, label: "share container" },
      { method: "POST", url: "/api/groups/group-b/inventory/containers/whatever/unshare", body: { roomId, sharedWithGroupId: "group-a" }, label: "unshare container" },
    ];
    for (const attempt of attempts) {
      const response = await request(baseUrl)
        [attempt.method.toLowerCase() as "get" | "post" | "put" | "delete"](attempt.url)
        .set(XRW)
        .set("Cookie", attackerCookie)
        .send(attempt.body);
      expect(
        [403, 404].includes(response.status),
        `${attempt.label} leaked with status ${response.status}`,
      ).toBe(true);
    }
  });
});

describe("xss guard", () => {
  it("stores markup as inert JSON text, never html", async () => {
    const payload = "<script>alert('x')</script>";
    const add = await request(baseUrl)
      .post("/api/groups/group-a/inventory/rooms")
      .set(XRW)
      .set("Cookie", attackerCookie)
      .send({ name: payload });
    expect(add.status).toBe(201);
    expect(add.headers["content-type"]).toContain("application/json");
    const room = (add.body as { tree: { rooms: Array<{ id: string; name: string }> } }).tree.rooms[0];
    expect(room?.name).toBe(payload);
    const list = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", attackerCookie);
    expect(list.status).toBe(200);
    expect(list.headers["content-type"]).toContain("application/json");
    const parsed = JSON.parse(list.text) as { tree: { rooms: Array<{ name: string }> } };
    expect(parsed.tree.rooms.some((candidate) => candidate.name === payload)).toBe(true);
    const notFound = await request(baseUrl).get("/api/definitely-not-a-route").set("Cookie", attackerCookie);
    expect(notFound.headers["content-type"]).toContain("application/json");
  });
});

describe("load smoke", () => {
  it("performs 100 sequential mutations in under 2 seconds", async () => {
    const startedAt = Date.now();
    for (let index = 0; index < 100; index += 1) {
      const response = await request(baseUrl)
        .post("/api/groups/group-a/inventory/rooms")
        .set(XRW)
        .set("Cookie", attackerCookie)
        .send({ name: `Load ${index}` });
      expect(response.status).toBe(201);
    }
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(2000);
  });
});
