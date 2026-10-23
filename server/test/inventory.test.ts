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

async function login(email: string, password: string): Promise<string> {
  const response = await request(baseUrl).post("/api/login").set(XRW).send({ email, password });
  if (response.status !== 200) {
    throw new Error(`login failed for ${email}: ${response.status}`);
  }
  const setCookie = response.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (first ?? "").split(";")[0] ?? "";
}

interface InventoryState {
  version: number;
  tree: {
    rooms: Array<{
      id: string;
      name: string;
      containers: Array<{
        id: string;
        name: string;
        shelves: Array<{ id: string; name: string; chemicals: Array<{ id: string; name: string; position?: string; quantity?: number }> }>;
      }>;
    }>;
  };
}

let ownerCookie: string;
let otherCookie: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-inventory-test-"));
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
  insertUser.run("uid-inv-owner", "owner@inv.test", await argonHash("owner-password"), "Owner", "admin", "group-a");
  insertUser.run("uid-inv-other", "other@inv.test", await argonHash("other-password"), "Other", "admin", "group-b");
  const insertGroup = db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)");
  insertGroup.run("group-a", "Lab A", "BIOS-101", Date.now());
  insertGroup.run("group-b", "Lab B", "BIOS-102", Date.now());
  const emptyTree = JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] });
  const insertDoc = db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)");
  insertDoc.run("group-a", emptyTree);
  insertDoc.run("group-b", emptyTree);
  ownerCookie = await login("owner@inv.test", "owner-password");
  otherCookie = await login("other@inv.test", "other-password");
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("GET /api/groups/:id/inventory", () => {
  it("returns the typed tree for a member", async () => {
    const response = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", ownerCookie);
    expect(response.status).toBe(200);
    expect(response.body.version).toBe(0);
    expect(response.body.tree.rooms).toEqual([]);
  });

  it("rejects non-members with 403", async () => {
    const response = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", otherCookie);
    expect(response.status).toBe(403);
  });
});

describe("room ops", () => {
  it("adds, edits and deletes a room with version bumps and history rows", async () => {
    const add = await request(baseUrl)
      .post("/api/groups/group-a/inventory/rooms")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ name: "Cold Room", description: "4C" });
    expect(add.status).toBe(201);
    const added = add.body as InventoryState;
    expect(added.version).toBe(1);
    expect(added.tree.rooms).toHaveLength(1);
    const roomId = added.tree.rooms[0]?.id ?? "";
    const historyRow = getDatabase(dbPath)
      .prepare("SELECT action FROM history WHERE group_id = 'group-a'")
      .get() as { action: string };
    expect(historyRow.action).toBe('Added room "Cold Room"');

    const edit = await request(baseUrl)
      .put(`/api/groups/group-a/inventory/rooms/${roomId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ name: "Warm Room" });
    expect(edit.status).toBe(200);
    expect((edit.body as InventoryState).version).toBe(2);
    expect((edit.body as InventoryState).tree.rooms[0]?.name).toBe("Warm Room");

    const remove = await request(baseUrl)
      .delete(`/api/groups/group-a/inventory/rooms/${roomId}`)
      .set(XRW)
      .set("Cookie", ownerCookie);
    expect(remove.status).toBe(200);
    expect((remove.body as InventoryState).version).toBe(3);
    expect((remove.body as InventoryState).tree.rooms).toEqual([]);
  });

  it("rejects an invalid body without bumping the version", async () => {
    const before = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", ownerCookie);
    const response = await request(baseUrl)
      .post("/api/groups/group-a/inventory/rooms")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ name: "" });
    expect(response.status).toBe(400);
    const after = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", ownerCookie);
    expect((after.body as InventoryState).version).toBe((before.body as InventoryState).version);
  });
});

describe("container, shelf and chemical ops", () => {
  it("walks the full chain with auto-generated positions", async () => {
    const room = (await (
      await request(baseUrl)
        .post("/api/groups/group-a/inventory/rooms")
        .set(XRW)
        .set("Cookie", ownerCookie)
        .send({ name: "Lab" })
    ).body) as InventoryState;
    const roomId = room.tree.rooms[0]?.id ?? "";

    const container = (
      await (
        await request(baseUrl)
          .post("/api/groups/group-a/inventory/containers")
          .set(XRW)
          .set("Cookie", ownerCookie)
          .send({ roomId, name: "Main Cabinet", type: "cabinet", cabinetMethod: "alphabetical", shelves: ["Shelf A-D", "Shelf E-L"] })
      ).body
    ) as InventoryState;
    const containerId = container.tree.rooms[0]?.containers[0]?.id ?? "";
    const shelfId = container.tree.rooms[0]?.containers[0]?.shelves[0]?.id ?? "";

    const chemical = (
      await (
        await request(baseUrl)
          .post("/api/groups/group-a/inventory/chemicals")
          .set(XRW)
          .set("Cookie", ownerCookie)
          .send({ roomId, containerId, shelfId, name: "Hydrochloric acid", quantity: 5, unit: "ml" })
      ).body
    ) as InventoryState;
    const stored = chemical.tree.rooms[0]?.containers[0]?.shelves[0]?.chemicals[0];
    expect(stored?.position).toBe("AH1");
    const chemicalId = stored?.id ?? "";

    const adjusted = await request(baseUrl)
      .post(`/api/groups/group-a/inventory/chemicals/${chemicalId}/adjust-qty`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, containerId, shelfId, delta: -2 });
    expect(adjusted.status).toBe(200);
    expect(
      ((adjusted.body as InventoryState).tree.rooms[0]?.containers[0]?.shelves[0]?.chemicals[0]?.quantity),
    ).toBe(3);

    const clamped = await request(baseUrl)
      .post(`/api/groups/group-a/inventory/chemicals/${chemicalId}/adjust-qty`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, containerId, shelfId, delta: -99 });
    expect(
      ((clamped.body as InventoryState).tree.rooms[0]?.containers[0]?.shelves[0]?.chemicals[0]?.quantity),
    ).toBe(0);

    const edited = await request(baseUrl)
      .put(`/api/groups/group-a/inventory/chemicals/${chemicalId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, containerId, shelfId, name: "HCl", cas: "7647-01-0" });
    expect(
      ((edited.body as InventoryState).tree.rooms[0]?.containers[0]?.shelves[0]?.chemicals[0]?.name),
    ).toBe("HCl");

    const shelf2 = (
      await (
        await request(baseUrl)
          .post("/api/groups/group-a/inventory/shelves")
          .set(XRW)
          .set("Cookie", ownerCookie)
          .send({ roomId, containerId, name: "Shelf M-P" })
      ).body
    ) as InventoryState;
    const otherShelfId = shelf2.tree.rooms[0]?.containers[0]?.shelves[1]?.id ?? "";

    const moved = await request(baseUrl)
      .post(`/api/groups/group-a/inventory/chemicals/${chemicalId}/move`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ fromRoomId: roomId, fromContainerId: containerId, fromShelfId: shelfId, toRoomId: roomId, toContainerId: containerId, toShelfId: otherShelfId });
    expect(moved.status).toBe(200);
    const movedTree = (moved.body as InventoryState).tree;
    expect(movedTree.rooms[0]?.containers[0]?.shelves[0]?.chemicals).toEqual([]);
    expect(movedTree.rooms[0]?.containers[0]?.shelves[1]?.chemicals).toHaveLength(1);

    const deleted = await request(baseUrl)
      .delete(`/api/groups/group-a/inventory/chemicals/${chemicalId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, containerId, shelfId: otherShelfId });
    expect(deleted.status).toBe(200);
    expect((deleted.body as InventoryState).tree.rooms[0]?.containers[0]?.shelves[1]?.chemicals).toEqual([]);

    const removedShelf = await request(baseUrl)
      .delete(`/api/groups/group-a/inventory/shelves/${otherShelfId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, containerId });
    expect(removedShelf.status).toBe(200);

    const removedContainer = await request(baseUrl)
      .delete(`/api/groups/group-a/inventory/containers/${containerId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId });
    expect(removedContainer.status).toBe(200);
    expect((removedContainer.body as InventoryState).tree.rooms[0]?.containers).toEqual([]);
  });
});

describe("concurrency", () => {
  it("commits 20 parallel mutations per group with zero lost updates", async () => {
    const beforeA = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", ownerCookie);
    const beforeB = await request(baseUrl).get("/api/groups/group-b/inventory").set("Cookie", otherCookie);
    const versionA = (beforeA.body as InventoryState).version;
    const versionB = (beforeB.body as InventoryState).version;
    const roomsBeforeA = (beforeA.body as InventoryState).tree.rooms.length;
    const roomsBeforeB = (beforeB.body as InventoryState).tree.rooms.length;

    const requests = [
      ...Array.from({ length: 20 }, (_, index) =>
        request(baseUrl)
          .post("/api/groups/group-a/inventory/rooms")
          .set(XRW)
          .set("Cookie", ownerCookie)
          .send({ name: `Room A${index}` })
          .then((response) => response.status),
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        request(baseUrl)
          .post("/api/groups/group-b/inventory/rooms")
          .set(XRW)
          .set("Cookie", otherCookie)
          .send({ name: `Room B${index}` })
          .then((response) => response.status),
      ),
    ];
    const statuses = await Promise.all(requests);
    expect(statuses.every((status) => status === 201)).toBe(true);

    const afterA = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", ownerCookie);
    const afterB = await request(baseUrl).get("/api/groups/group-b/inventory").set("Cookie", otherCookie);
    expect((afterA.body as InventoryState).version).toBe(versionA + 20);
    expect((afterA.body as InventoryState).tree.rooms).toHaveLength(roomsBeforeA + 20);
    expect((afterB.body as InventoryState).version).toBe(versionB + 20);
    expect((afterB.body as InventoryState).tree.rooms).toHaveLength(roomsBeforeB + 20);
    const db = getDatabase(dbPath);
    const historyA = db
      .prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-a'")
      .get() as { n: number };
    expect(historyA.n).toBeGreaterThanOrEqual(20);
  });
});

describe("websocket hub", () => {
  interface WsMessage {
    groupId?: string;
    version?: number;
    tree?: unknown;
    error?: string;
  }

  function collectMessages(socket: WebSocket): {
    messages: WsMessage[];
    waitFor: (predicate: (message: WsMessage) => boolean, timeoutMs?: number) => Promise<WsMessage>;
  } {
    const messages: WsMessage[] = [];
    socket.on("message", (data: unknown) => {
      messages.push(JSON.parse(String(data)) as WsMessage);
    });
    return {
      messages,
      waitFor: (predicate: (message: WsMessage) => boolean, timeoutMs = 2000): Promise<WsMessage> =>
        new Promise((resolve, reject) => {
          const found = messages.find(predicate);
          if (found !== undefined) {
            resolve(found);
            return;
          }
          const timer = setTimeout(() => reject(new Error("message not received within timeout")), timeoutMs);
          const interval = setInterval(() => {
            const found = messages.find(predicate);
            if (found !== undefined) {
              clearInterval(interval);
              clearTimeout(timer);
              resolve(found);
            }
          }, 5);
        }),
    };
  }

  it("subscribes, returns state, and receives a broadcast after an http mutation within 200ms", async () => {
    const wsUrl = baseUrl.replace("http", "ws") + "/ws";
    const socket = new WebSocket(wsUrl, { headers: { Cookie: ownerCookie } });
    const collector = collectMessages(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (error: Error) => reject(error));
    });
    try {
      const current = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", ownerCookie);
      const versionBefore = (current.body as InventoryState).version;
      socket.send(JSON.stringify({ subscribe: "group-a" }));
      const initial = await collector.waitFor((message) => message.version === versionBefore);
      expect(initial.groupId).toBe("group-a");
      expect(initial.tree).toBeDefined();

      const startedAt = Date.now();
      const mutation = await request(baseUrl)
        .post("/api/groups/group-a/inventory/rooms")
        .set(XRW)
        .set("Cookie", ownerCookie)
        .send({ name: "WS Room" });
      expect(mutation.status).toBe(201);
      const broadcast = await collector.waitFor(
        (message) => message.version === (mutation.body as InventoryState).version,
      );
      expect(broadcast.groupId).toBe("group-a");
      expect(broadcast.tree).toBeDefined();
      expect(Date.now() - startedAt).toBeLessThan(200);
    } finally {
      socket.close();
    }
  });

  it("rejects the upgrade without a session cookie with 401", async () => {
    const wsUrl = baseUrl.replace("http", "ws") + "/ws";
    const socket = new WebSocket(wsUrl);
    const status = await new Promise<number>((resolve) => {
      socket.on("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
      });
      socket.on("error", () => {});
    });
    expect(status).toBe(401);
    socket.close();
  });
});
