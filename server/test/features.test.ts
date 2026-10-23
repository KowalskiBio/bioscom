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
let adminCookie: string;
let readerCookie: string;
let superCookie: string;
let outsiderCookie: string;
let roomId = "";
let containerId = "";
let shelfId = "";

interface InventoryState {
  version: number;
  tree: {
    rooms: Array<{
      id: string;
      containers: Array<{ id: string; shelves: Array<{ id: string; chemicals: Array<{ id: string; name: string }> }> }>;
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

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-features-test-"));
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
  insertUser.run("uid-f-admin", "admin@feat.test", await argonHash("admin-password"), "Feat Admin", "admin", "group-a");
  insertUser.run("uid-f-reader", "reader@feat.test", await argonHash("reader-password"), "Feat Reader", "reader", "group-a");
  insertUser.run("uid-f-super", "super@feat.test", await argonHash("super-password"), "Feat Super", "superadmin", null);
  insertUser.run("uid-f-opponent", "opponent@feat.test", await argonHash("opponent-password"), "Feat Opponent", "admin", "group-a");
  insertUser.run("uid-f-outsider", "outsider@feat.test", await argonHash("outsider-password"), "Feat Outsider", "admin", "group-b");
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-a', 'Lab A', 'BIOS-301', ?)").run(Date.now());
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-b', 'Lab B', 'BIOS-302', ?)").run(Date.now());
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-a', ?, 0)").run(
    JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] }),
  );
  adminCookie = await login("admin@feat.test", "admin-password");
  readerCookie = await login("reader@feat.test", "reader-password");
  superCookie = await login("super@feat.test", "super-password");
  outsiderCookie = await login("outsider@feat.test", "outsider-password");

  const room = (await (
    await request(baseUrl)
      .post("/api/groups/group-a/inventory/rooms")
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ name: "Feature Room" })
  ).body) as InventoryState;
  roomId = room.tree.rooms[0]?.id ?? "";
  const container = (
    await (
      await request(baseUrl)
        .post("/api/groups/group-a/inventory/containers")
        .set(XRW)
        .set("Cookie", adminCookie)
        .send({ roomId, name: "Feature Fridge", type: "fridge", shelves: ["Shelf 1"] })
    ).body
  ) as InventoryState;
  containerId = container.tree.rooms[0]?.containers[0]?.id ?? "";
  shelfId = container.tree.rooms[0]?.containers[0]?.shelves[0]?.id ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("notices", () => {
  let noticeId = "";

  it("creates a notice and lists it", async () => {
    const unauth = await request(baseUrl).get("/api/notices");
    expect(unauth.status).toBe(401);
    const invalid = await request(baseUrl).post("/api/notices").set(XRW).set("Cookie", adminCookie).send({ title: "" });
    expect(invalid.status).toBe(400);
    const create = await request(baseUrl)
      .post("/api/notices")
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ title: "Hello", content: "World", category: "info" });
    expect(create.status).toBe(201);
    noticeId = create.body.id;
    const list = await request(baseUrl).get("/api/notices").set("Cookie", readerCookie);
    expect(list.status).toBe(200);
    expect((list.body.notices as unknown[]).length).toBe(1);
  });

  it("adds and removes reactions", async () => {
    const react = await request(baseUrl)
      .post(`/api/notices/${noticeId}/reactions`)
      .set(XRW)
      .set("Cookie", readerCookie)
      .send({ text: "👍" });
    expect(react.status).toBe(201);
    const reactionId = react.body.id;
    const wrongUser = await request(baseUrl)
      .delete(`/api/notices/${noticeId}/reactions/${reactionId}`)
      .set(XRW)
      .set("Cookie", adminCookie);
    expect(wrongUser.status).toBe(403);
    const own = await request(baseUrl)
      .delete(`/api/notices/${noticeId}/reactions/${reactionId}`)
      .set(XRW)
      .set("Cookie", readerCookie);
    expect(own.status).toBe(200);
  });

  it("edits and deletes only for the author or superadmin", async () => {
    const forbidden = await request(baseUrl)
      .put(`/api/notices/${noticeId}`)
      .set(XRW)
      .set("Cookie", readerCookie)
      .send({ title: "Nope" });
    expect(forbidden.status).toBe(403);
    const edit = await request(baseUrl)
      .put(`/api/notices/${noticeId}`)
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ title: "Edited" });
    expect(edit.status).toBe(200);
    const remove = await request(baseUrl).delete(`/api/notices/${noticeId}`).set(XRW).set("Cookie", adminCookie);
    expect(remove.status).toBe(200);
  });
});

describe("instruments and bookings", () => {
  let instrumentId = "";

  it("creates instruments (admins only) and lists them", async () => {
    const readerCreate = await request(baseUrl)
      .post("/api/instruments")
      .set(XRW)
      .set("Cookie", readerCookie)
      .send({ name: "Reader Scope", location: "X" });
    expect(readerCreate.status).toBe(403);
    const invalid = await request(baseUrl)
      .post("/api/instruments")
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ name: "" });
    expect(invalid.status).toBe(400);
    const create = await request(baseUrl)
      .post("/api/instruments")
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ name: "HPLC", location: "B302" });
    expect(create.status).toBe(201);
    instrumentId = create.body.id;
    const list = await request(baseUrl).get("/api/instruments").set("Cookie", readerCookie);
    expect(list.status).toBe(200);
    expect((list.body.instruments as unknown[]).length).toBe(1);
  });

  it("rejects double-booking and cancels own bookings", async () => {
    const book = await request(baseUrl)
      .post(`/api/instruments/${instrumentId}/bookings`)
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ date: "2026-06-01", startTime: "09:00", endTime: "12:00" });
    expect(book.status).toBe(201);
    const conflict = await request(baseUrl)
      .post(`/api/instruments/${instrumentId}/bookings`)
      .set(XRW)
      .set("Cookie", readerCookie)
      .send({ date: "2026-06-01", startTime: "10:00", endTime: "13:00" });
    expect(conflict.status).toBe(409);
    const later = await request(baseUrl)
      .post(`/api/instruments/${instrumentId}/bookings`)
      .set(XRW)
      .set("Cookie", readerCookie)
      .send({ date: "2026-06-01", startTime: "13:00", endTime: "14:00" });
    expect(later.status).toBe(201);
    const bookingId = later.body.id;
    const wrongCancel = await request(baseUrl)
      .delete(`/api/instruments/${instrumentId}/bookings/${bookingId}`)
      .set(XRW)
      .set("Cookie", outsiderCookie);
    expect(wrongCancel.status).toBe(403);
    const cancel = await request(baseUrl)
      .delete(`/api/instruments/${instrumentId}/bookings/${bookingId}`)
      .set(XRW)
      .set("Cookie", readerCookie);
    expect(cancel.status).toBe(200);
  });
});

describe("print", () => {
  let itemId = "";
  let requestId = "";

  it("manages the catalog as superadmin only", async () => {
    const forbidden = await request(baseUrl)
      .post("/api/print/catalog")
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ name: "Rack" });
    expect(forbidden.status).toBe(403);
    const create = await request(baseUrl)
      .post("/api/print/catalog")
      .set(XRW)
      .set("Cookie", superCookie)
      .send({ name: "Test tube rack", category: "Racks & Holders", material: "PETG" });
    expect(create.status).toBe(201);
    itemId = create.body.id;
    const list = await request(baseUrl).get("/api/print/catalog").set("Cookie", readerCookie);
    expect(list.status).toBe(200);
    expect((list.body.catalog as unknown[]).length).toBe(1);
  });

  it("creates requests and updates statuses as superadmin", async () => {
    const create = await request(baseUrl)
      .post("/api/print/requests")
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ catalogItemId: itemId, quantity: 2 });
    expect(create.status).toBe(201);
    requestId = create.body.id;
    const list = await request(baseUrl).get("/api/print/requests").set("Cookie", readerCookie);
    expect(list.status).toBe(200);
    expect((list.body.requests as Array<{ status: string; catalogItemName: string | null }>)[0]?.status).toBe("pending");
    expect((list.body.requests as Array<{ catalogItemName: string | null }>)[0]?.catalogItemName).toBe("Test tube rack");
    const forbidden = await request(baseUrl)
      .post(`/api/print/requests/${requestId}/status`)
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ status: "printing" });
    expect(forbidden.status).toBe(403);
    const update = await request(baseUrl)
      .post(`/api/print/requests/${requestId}/status`)
      .set(XRW)
      .set("Cookie", superCookie)
      .send({ status: "done" });
    expect(update.status).toBe(200);
    const unknown = await request(baseUrl)
      .post("/api/print/requests/missing/status")
      .set(XRW)
      .set("Cookie", superCookie)
      .send({ status: "done" });
    expect(unknown.status).toBe(404);
  });
});

describe("games", () => {
  it("creates, lists, plays and finishes challenges", async () => {
    const create = await request(baseUrl)
      .post("/api/games")
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ gameType: "chess", opponentUid: "uid-f-opponent" });
    expect(create.status).toBe(201);
    const gameId = create.body.id;
    const list = await request(baseUrl).get("/api/games").set("Cookie", readerCookie);
    const game = (list.body.games as Array<{ id: string; gameType: string; turn: string | null; board: string[][] | null }>)[0];
    expect(game?.id).toBe(gameId);
    expect(game?.gameType).toBe("chess");
    expect(game?.turn).toBe("white");
    expect(game?.board).toHaveLength(8);
    const move = await request(baseUrl)
      .post(`/api/games/${gameId}/chess-move`)
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ board: game?.board ?? [], turn: "white" });
    expect(move.status).toBe(200);
    const outsiderMove = await request(baseUrl)
      .post(`/api/games/${gameId}/chess-move`)
      .set(XRW)
      .set("Cookie", superCookie)
      .send({ board: game?.board ?? [], turn: "black" });
    expect(outsiderMove.status).toBe(403);
    const finish = await request(baseUrl)
      .post(`/api/games/${gameId}/finish`)
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ winnerUid: "uid-f-admin" });
    expect(finish.status).toBe(200);
  });
});

describe("history", () => {
  it("lists paginated history for members only", async () => {
    const unauth = await request(baseUrl).get("/api/groups/group-a/history");
    expect(unauth.status).toBe(401);
    const response = await request(baseUrl)
      .get("/api/groups/group-a/history?limit=5&page=1")
      .set("Cookie", adminCookie);
    expect(response.status).toBe(200);
    expect(response.body.limit).toBe(5);
    expect((response.body.entries as unknown[]).length).toBeLessThanOrEqual(5);
    expect(response.body.total).toBeGreaterThan(0);
  });
});

describe("backups", () => {
  it("snapshots, mutates, restores with version bump, and 404s unknown ids", async () => {
    const create = await request(baseUrl).post("/api/groups/group-a/backups").set(XRW).set("Cookie", adminCookie);
    expect(create.status).toBe(201);
    const backupId = create.body.id;
    const readerAttempt = await request(baseUrl).post("/api/groups/group-a/backups").set(XRW).set("Cookie", readerCookie);
    expect(readerAttempt.status).toBe(403);

    const addChemical = await request(baseUrl)
      .post("/api/groups/group-a/inventory/chemicals")
      .set(XRW)
      .set("Cookie", adminCookie)
      .send({ roomId, containerId, shelfId, name: "Backup Test Chemical" });
    expect(addChemical.status).toBe(201);
    const versionBeforeRestore = (addChemical.body as InventoryState).version;

    const restore = await request(baseUrl)
      .post(`/api/groups/group-a/backups/${backupId}/restore`)
      .set(XRW)
      .set("Cookie", adminCookie);
    expect(restore.status).toBe(200);
    const restored = restore.body as InventoryState;
    expect(restored.version).toBe(versionBeforeRestore + 1);
    const chemicalNames = restored.tree.rooms[0]?.containers[0]?.shelves[0]?.chemicals.map((chemical) => chemical.name) ?? [];
    expect(chemicalNames).toEqual([]);

    const before = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", adminCookie);
    const unknown = await request(baseUrl)
      .post("/api/groups/group-a/backups/missing/restore")
      .set(XRW)
      .set("Cookie", adminCookie);
    expect(unknown.status).toBe(404);
    const after = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", adminCookie);
    expect((after.body as InventoryState).version).toBe((before.body as InventoryState).version);
  });
});

describe("sandbox and admin inventory", () => {
  it("exposes the sandbox to authed users and admin inventory to superadmins only", async () => {
    const unauth = await request(baseUrl).get("/api/sandbox");
    expect(unauth.status).toBe(401);
    const sandbox = await request(baseUrl).get("/api/sandbox").set("Cookie", readerCookie);
    expect(sandbox.status).toBe(200);
    expect(sandbox.body.tree.rooms).toEqual([]);

    const forbiddenPut = await request(baseUrl)
      .put("/api/sandbox")
      .set(XRW)
      .set("Cookie", readerCookie)
      .send({ tree: { rooms: [] } });
    expect(forbiddenPut.status).toBe(403);

    const adminDenied = await request(baseUrl).get("/api/admin/inventory").set("Cookie", adminCookie);
    expect(adminDenied.status).toBe(403);
    const adminOk = await request(baseUrl).get("/api/admin/inventory").set("Cookie", superCookie);
    expect(adminOk.status).toBe(200);
    const put = await request(baseUrl)
      .put("/api/admin/inventory")
      .set(XRW)
      .set("Cookie", superCookie)
      .send({ tree: { rooms: [{ id: "global-room", name: "Global Room", containers: [] }] } });
    expect(put.status).toBe(200);
    const reloaded = await request(baseUrl).get("/api/admin/inventory").set("Cookie", superCookie);
    expect((reloaded.body.tree.rooms as unknown[]).length).toBe(1);
  });
});
