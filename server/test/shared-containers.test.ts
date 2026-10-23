import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { FastifyInstance } from "fastify";
import { hash as argonHash } from "@node-rs/argon2";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
import { closeDatabase, getDatabase } from "../src/db.js";

const XRW = { "X-Requested-With": "XMLHttpRequest" };

let app: FastifyInstance;
let baseUrl: string;
let dbPath: string;
let ownerCookie: string;
let memberCookie: string;
let outsiderCookie: string;
let readerCookie: string;
let roomId = "";
let containerId = "";
let shelfId = "";

interface InventoryState {
  version: number;
  tree: {
    rooms: Array<{
      id: string;
      containers: Array<{
        id: string;
        name: string;
        ownerGroupId?: string;
        sharedWithGroupIds?: string[];
        shelves: Array<{ id: string; name: string; chemicals: Array<{ id: string; name: string; quantity?: number }> }>;
      }>;
    }>;
  };
}

async function login(email: string, password: string): Promise<string> {
  const response = await request(baseUrl).post("/api/login").set(XRW).send({ email, password });
  if (response.status !== 200) {
    throw new Error(`login failed for ${email}: ${response.status}`);
  }
  const setCookie = response.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (first ?? "").split(";")[0] ?? "";
}

function containerOf(state: InventoryState): InventoryState["tree"]["rooms"][number]["containers"][number] {
  const container = state.tree.rooms[0]?.containers[0];
  if (container === undefined) {
    throw new Error("container missing");
  }
  return container;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-shared-test-"));
  dbPath = join(dir, "test.db");
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
  insertUser.run("uid-b-owner", "owner@shared.test", await argonHash("owner-password"), "B Owner", "admin", "group-b");
  insertUser.run("uid-a-member", "member@shared.test", await argonHash("member-password"), "A Member", "admin", "group-a");
  insertUser.run("uid-a-reader", "reader@shared.test", await argonHash("reader-password"), "A Reader", "reader", "group-a");
  insertUser.run("uid-c-outsider", "outsider@shared.test", await argonHash("outsider-password"), "C Outsider", "admin", "group-c");
  const insertGroup = db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)");
  insertGroup.run("group-a", "Lab A", "BIOS-201", Date.now());
  insertGroup.run("group-b", "Lab B", "BIOS-202", Date.now());
  insertGroup.run("group-c", "Lab C", "BIOS-203", Date.now());
  const emptyTree = JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] });
  const insertDoc = db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)");
  insertDoc.run("group-a", emptyTree);
  insertDoc.run("group-b", emptyTree);
  insertDoc.run("group-c", emptyTree);
  ownerCookie = await login("owner@shared.test", "owner-password");
  memberCookie = await login("member@shared.test", "member-password");
  readerCookie = await login("reader@shared.test", "reader-password");
  outsiderCookie = await login("outsider@shared.test", "outsider-password");

  const room = (await (
    await request(baseUrl)
      .post("/api/groups/group-b/inventory/rooms")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ name: "B Room" })
  ).body) as InventoryState;
  roomId = room.tree.rooms[0]?.id ?? "";
  const container = (
    await (
      await request(baseUrl)
        .post("/api/groups/group-b/inventory/containers")
        .set(XRW)
        .set("Cookie", ownerCookie)
        .send({ roomId, name: "Shared Freezer", type: "freezer", shelves: ["Box 1"] })
    ).body
  ) as InventoryState;
  containerId = containerOf(container).id;
  shelfId = containerOf(container).shelves[0]?.id ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("share / unshare", () => {
  it("shares a container with another lab", async () => {
    const response = await request(baseUrl)
      .post(`/api/groups/group-b/inventory/containers/${containerId}/share`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, sharedWithGroupId: "group-a" });
    expect(response.status).toBe(200);
    const container = containerOf(response.body as InventoryState);
    expect(container.sharedWithGroupIds).toEqual(["group-a"]);
    expect(container.ownerGroupId).toBe("group-b");
  });

  it("lists the shared container for the receiving lab only", async () => {
    const response = await request(baseUrl).get("/api/groups/group-a/shared-containers").set("Cookie", memberCookie);
    expect(response.status).toBe(200);
    const list = response.body.sharedContainers as Array<{ container: { id: string }; ownerGroupId: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.container.id).toBe(containerId);
    expect(list[0]?.ownerGroupId).toBe("group-b");
    const outsider = await request(baseUrl).get("/api/groups/group-a/shared-containers").set("Cookie", outsiderCookie);
    expect(outsider.status).toBe(403);
  });
});

describe("cross-group mutation", () => {
  it("applies a mutation by the receiving lab to the owner's doc with mirrored history and dual broadcasts", async () => {
    const ownerSocket = new WebSocket(baseUrl.replace("http", "ws") + "/ws", { headers: { Cookie: ownerCookie } });
    const memberSocket = new WebSocket(baseUrl.replace("http", "ws") + "/ws", { headers: { Cookie: memberCookie } });
    const ownerMessages: Array<{ groupId?: string; version?: number }> = [];
    const memberMessages: Array<{ groupId?: string; version?: number }> = [];
    ownerSocket.on("message", (data: unknown) => ownerMessages.push(JSON.parse(String(data))));
    memberSocket.on("message", (data: unknown) => memberMessages.push(JSON.parse(String(data))));
    await Promise.all([
      new Promise<void>((resolve) => ownerSocket.once("open", () => resolve())),
      new Promise<void>((resolve) => memberSocket.once("open", () => resolve())),
    ]);
    try {
      ownerSocket.send(JSON.stringify({ subscribe: "group-b" }));
      memberSocket.send(JSON.stringify({ subscribe: "group-a" }));
      await new Promise((resolve) => setTimeout(resolve, 150));

      const response = await request(baseUrl)
        .post("/api/groups/group-b/inventory/chemicals")
        .set(XRW)
        .set("Cookie", memberCookie)
        .send({ roomId, containerId, shelfId, name: "Shared Chemical", quantity: 10, unit: "ml" });
      expect(response.status).toBe(201);
      const state = response.body as InventoryState;
      expect(containerOf(state).shelves[0]?.chemicals[0]?.name).toBe("Shared Chemical");
      expect(state.version).toBeGreaterThan(0);

      await new Promise((resolve) => setTimeout(resolve, 200));
      const db = getDatabase(dbPath);
      const ownerHistory = db
        .prepare("SELECT user_name, action FROM history WHERE group_id = 'group-b' ORDER BY id DESC LIMIT 1")
        .get() as { user_name: string; action: string };
      expect(ownerHistory.action).toContain("Shared Chemical");
      expect(ownerHistory.user_name).toBe("A Member (from Lab Lab A)");
      const memberHistory = db
        .prepare("SELECT user_name, action FROM history WHERE group_id = 'group-a' ORDER BY id DESC LIMIT 1")
        .get() as { user_name: string; action: string };
      expect(memberHistory.user_name).toBe("A Member");
      expect(memberHistory.action).toContain("Shared Chemical");

      expect(ownerMessages.some((message) => message.groupId === "group-b" && message.version === state.version)).toBe(true);
      expect(memberMessages.some((message) => message.groupId === "group-b" && message.version === state.version)).toBe(true);

      const outsider = await request(baseUrl)
        .post("/api/groups/group-b/inventory/chemicals")
        .set(XRW)
        .set("Cookie", outsiderCookie)
        .send({ roomId, containerId, shelfId, name: "Hack Attempt" });
      expect(outsider.status).toBe(404);
    } finally {
      ownerSocket.close();
      memberSocket.close();
    }
  });

  it("lets a reader of the receiving lab adjust quantities on the shared container", async () => {
    const chemicalId = containerOf(
      (await (
        await request(baseUrl).get("/api/groups/group-b/inventory").set("Cookie", ownerCookie)
      ).body) as InventoryState,
    ).shelves[0]?.chemicals[0]?.id;
    const response = await request(baseUrl)
      .post(`/api/groups/group-b/inventory/chemicals/${chemicalId}/adjust-qty`)
      .set(XRW)
      .set("Cookie", readerCookie)
      .send({ roomId, containerId, shelfId, delta: -3 });
    expect(response.status).toBe(200);
    expect(containerOf(response.body as InventoryState).shelves[0]?.chemicals[0]?.quantity).toBe(7);
  });

  it("rejects a reader mutating their own group's containers", async () => {
    const response = await request(baseUrl)
      .post("/api/groups/group-a/inventory/rooms")
      .set(XRW)
      .set("Cookie", readerCookie)
      .send({ name: "Reader Room" });
    expect(response.status).toBe(403);
  });
});

describe("unshare", () => {
  it("removes the container from the receiving list and blocks further mutation with 404", async () => {
    const unshare = await request(baseUrl)
      .post(`/api/groups/group-b/inventory/containers/${containerId}/unshare`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, sharedWithGroupId: "group-a" });
    expect(unshare.status).toBe(200);
    expect(containerOf(unshare.body as InventoryState).sharedWithGroupIds).toEqual([]);

    const list = await request(baseUrl).get("/api/groups/group-a/shared-containers").set("Cookie", memberCookie);
    expect((list.body.sharedContainers as unknown[]).length).toBe(0);

    const response = await request(baseUrl)
      .post("/api/groups/group-b/inventory/chemicals")
      .set(XRW)
      .set("Cookie", memberCookie)
      .send({ roomId, containerId, shelfId, name: "After Unshare" });
    expect(response.status).toBe(404);
  });
});
