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
const GROUP = "group-grid";

let app: FastifyInstance;
let baseUrl: string;
let db: ReturnType<typeof getDatabase>;
let ownerCookie: string;
let readerCookie: string;
let foreignCookie: string;

interface SeedContainer {
  id: string;
  name: string;
  type?: string;
  shelves?: Array<{ id: string; name: string; chemicals?: unknown[] }>;
}

interface SeedRoom {
  id: string;
  name: string;
  containers?: SeedContainer[];
  containerGrid?: GridView;
}

interface GridView {
  rows: number;
  columns: number;
  positions: Record<string, number>;
  hideEmptySlots?: boolean;
}

interface TreeView {
  rooms: Array<{
    id: string;
    name: string;
    containers: Array<{
      id: string;
      name: string;
      shelves?: Array<{ id: string; name: string; chemicals?: unknown[] }>;
    }>;
    containerGrid?: GridView;
  }>;
  roomGrid?: GridView;
  deepFreezers?: Array<{ id: string; name: string }>;
}

async function login(email: string, password: string): Promise<string> {
  const response = await request(baseUrl).post("/api/login").set(XRW).send({ email, password });
  expect(response.status).toBe(200);
  const setCookie = response.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (first ?? "").split(";")[0] ?? "";
}

function seedContainer(container: SeedContainer): Record<string, unknown> {
  return {
    id: container.id,
    name: container.name,
    type: container.type ?? "cabinet",
    sharedWithGroupIds: [],
    shelves: (container.shelves ?? []).map((shelf) => ({
      id: shelf.id,
      name: shelf.name,
      chemicals: shelf.chemicals ?? [],
    })),
  };
}

function seedDoc(rooms: SeedRoom[], roomGrid?: GridView, deepFreezers?: SeedContainer[]): void {
  const tree: Record<string, unknown> = {
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      containers: (room.containers ?? []).map(seedContainer),
      ...(room.containerGrid !== undefined ? { containerGrid: room.containerGrid } : {}),
    })),
    deepFreezers: (deepFreezers ?? []).map((freezer) => ({ ...seedContainer(freezer), type: "deepfreezer" })),
    assetRooms: [],
    assets: [],
    protocols: [],
  };
  if (roomGrid !== undefined) {
    tree.roomGrid = roomGrid;
  }
  db.prepare("UPDATE group_inventory_docs SET tree = ?, version = version + 1 WHERE group_id = ?").run(
    JSON.stringify(tree),
    GROUP,
  );
}

function docState(): { tree: string; version: number } {
  return db.prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = ?").get(GROUP) as {
    tree: string;
    version: number;
  };
}

function historyCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = ?").get(GROUP) as { n: number }).n;
}

function putRoomGrid(body: unknown) {
  return request(baseUrl)
    .put(`/api/groups/${GROUP}/inventory/room-grid`)
    .set("Cookie", ownerCookie)
    .set(XRW)
    .send(body as object);
}

function deleteRoomGrid() {
  return request(baseUrl).delete(`/api/groups/${GROUP}/inventory/room-grid`).set("Cookie", ownerCookie).set(XRW);
}

function moveRoom(roomId: string, slot: number) {
  return request(baseUrl)
    .post(`/api/groups/${GROUP}/inventory/room-grid/move`)
    .set("Cookie", ownerCookie)
    .set(XRW)
    .send({ roomId, slot });
}

function putContainerGrid(roomId: string, body: unknown) {
  return request(baseUrl)
    .put(`/api/groups/${GROUP}/inventory/rooms/${roomId}/container-grid`)
    .set("Cookie", ownerCookie)
    .set(XRW)
    .send(body as object);
}

function deleteContainerGrid(roomId: string) {
  return request(baseUrl)
    .delete(`/api/groups/${GROUP}/inventory/rooms/${roomId}/container-grid`)
    .set("Cookie", ownerCookie)
    .set(XRW);
}

function moveContainer(roomId: string, containerId: string, slot: number) {
  return request(baseUrl)
    .post(`/api/groups/${GROUP}/inventory/rooms/${roomId}/container-grid/move`)
    .set("Cookie", ownerCookie)
    .set(XRW)
    .send({ containerId, slot });
}

function createRoom(name: string) {
  return request(baseUrl)
    .post(`/api/groups/${GROUP}/inventory/rooms`)
    .set("Cookie", ownerCookie)
    .set(XRW)
    .send({ name });
}

function createContainer(roomId: string, name: string) {
  return request(baseUrl)
    .post(`/api/groups/${GROUP}/inventory/containers`)
    .set("Cookie", ownerCookie)
    .set(XRW)
    .send({ roomId, name, type: "cabinet" });
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-room-grid-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  db = getDatabase(dbPath);

  const insertUser = db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  );
  insertUser.run("uid-grid-owner", "owner@grid.test", await argonHash("pw"), "Owner", "admin", GROUP);
  insertUser.run("uid-grid-reader", "reader@grid.test", await argonHash("pwr"), "Reader", "reader", GROUP);
  insertUser.run("uid-grid-foreign", "foreign@grid.test", await argonHash("pwf"), "Foreign", "admin", "group-foreign");
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)").run(GROUP, "Grid Lab", "GRID", 1);
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)").run(
    "group-foreign",
    "Foreign Lab",
    "FOREIGN",
    2,
  );
  const emptyTree = JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] });
  const insertDoc = db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)");
  insertDoc.run(GROUP, emptyTree);
  insertDoc.run("group-foreign", emptyTree);

  ownerCookie = await login("owner@grid.test", "pw");
  readerCookie = await login("reader@grid.test", "pwr");
  foreignCookie = await login("foreign@grid.test", "pwf");
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("room grid settings", () => {
  it("initializes positions in room array order on first settings PUT", async () => {
    seedDoc([{ id: "r1", name: "Room One" }, { id: "r2", name: "Room Two" }, { id: "r3", name: "Room Three" }]);
    const before = docState().version;
    const res = await putRoomGrid({ rows: 2, columns: 2 });
    expect(res.status).toBe(200);
    const tree = (res.body as { tree: TreeView }).tree;
    expect(tree.roomGrid).toEqual({
      rows: 2,
      columns: 2,
      positions: { r1: 0, r2: 1, r3: 2 },
      hideEmptySlots: false,
    });
    expect(tree.rooms.map((room) => room.id)).toEqual(["r1", "r2", "r3"]);
    expect(docState().version).toBe(before + 1);
    const action = (db
      .prepare("SELECT action FROM history WHERE group_id = ? ORDER BY rowid DESC LIMIT 1")
      .get(GROUP) as { action: string }).action;
    expect(action).toContain("Created room grid");
  });

  it("updates dimensions while preserving positions and rejects unsafe shrinks", async () => {
    seedDoc(
      [{ id: "r1", name: "A" }, { id: "r2", name: "B" }, { id: "r3", name: "C" }, { id: "r4", name: "D" }],
      { rows: 2, columns: 3, positions: { r1: 0, r2: 2, r3: 4, r4: 5 } },
    );
    const expanded = await putRoomGrid({ rows: 3, columns: 2 });
    expect(expanded.status).toBe(200);
    expect((expanded.body as { tree: TreeView }).tree.roomGrid).toEqual({
      rows: 3,
      columns: 2,
      positions: { r1: 0, r2: 2, r3: 4, r4: 5 },
    });

    const before = docState();
    const historyBefore = historyCount();
    const shrink = await putRoomGrid({ rows: 1, columns: 2 });
    expect(shrink.status).toBe(409);
    expect(JSON.stringify(shrink.body)).toContain("slot 2");
    expect(docState()).toEqual(before);
    expect(historyCount()).toBe(historyBefore);
  });

  it("rejects rows above 20 and columns above 5 without mutation", async () => {
    seedDoc([{ id: "r1", name: "A" }]);
    const before = docState();
    expect((await putRoomGrid({ rows: 21, columns: 2 })).status).toBe(400);
    expect((await putRoomGrid({ rows: 2, columns: 6 })).status).toBe(400);
    expect((await putRoomGrid({ rows: 0, columns: 1 })).status).toBe(400);
    expect(docState()).toEqual(before);
  });

  it("persists hideEmptySlots on first creation and defaults it to false", async () => {
    seedDoc([{ id: "r1", name: "A" }, { id: "r2", name: "B" }]);
    const hidden = await putRoomGrid({ rows: 1, columns: 2, hideEmptySlots: true });
    expect(hidden.status).toBe(200);
    expect((hidden.body as { tree: TreeView }).tree.roomGrid).toEqual({
      rows: 1,
      columns: 2,
      positions: { r1: 0, r2: 1 },
      hideEmptySlots: true,
    });

    seedDoc([{ id: "r1", name: "A" }, { id: "r2", name: "B" }]);
    const shown = await putRoomGrid({ rows: 1, columns: 2, hideEmptySlots: false });
    expect(shown.status).toBe(200);
    expect((shown.body as { tree: TreeView }).tree.roomGrid).toEqual({
      rows: 1,
      columns: 2,
      positions: { r1: 0, r2: 1 },
      hideEmptySlots: false,
    });

    seedDoc([{ id: "r1", name: "A" }, { id: "r2", name: "B" }]);
    const defaulted = await putRoomGrid({ rows: 1, columns: 2 });
    expect(defaulted.status).toBe(200);
    expect((defaulted.body as { tree: TreeView }).tree.roomGrid).toEqual({
      rows: 1,
      columns: 2,
      positions: { r1: 0, r2: 1 },
      hideEmptySlots: false,
    });
  });

  it("updates hideEmptySlots without moving positions or document order", async () => {
    seedDoc(
      [{ id: "r1", name: "A" }, { id: "r2", name: "B" }, { id: "r3", name: "C" }],
      { rows: 2, columns: 2, positions: { r1: 2, r2: 0, r3: 1 }, hideEmptySlots: false },
    );
    const res = await putRoomGrid({ rows: 2, columns: 2, hideEmptySlots: true });
    expect(res.status).toBe(200);
    const tree = (res.body as { tree: TreeView }).tree;
    expect(tree.roomGrid).toEqual({
      rows: 2,
      columns: 2,
      positions: { r1: 2, r2: 0, r3: 1 },
      hideEmptySlots: true,
    });
    expect(tree.rooms.map((room) => room.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("preserves hideEmptySlots when an update omits it", async () => {
    seedDoc(
      [{ id: "r1", name: "A" }, { id: "r2", name: "B" }],
      { rows: 2, columns: 2, positions: { r1: 0, r2: 1 }, hideEmptySlots: true },
    );
    const res = await putRoomGrid({ rows: 2, columns: 2 });
    expect(res.status).toBe(200);
    expect((res.body as { tree: TreeView }).tree.roomGrid).toEqual({
      rows: 2,
      columns: 2,
      positions: { r1: 0, r2: 1 },
      hideEmptySlots: true,
    });
  });

  it("rejects a non-boolean hideEmptySlots without mutation", async () => {
    seedDoc(
      [{ id: "r1", name: "A" }],
      { rows: 1, columns: 1, positions: { r1: 0 }, hideEmptySlots: false },
    );
    const before = docState();
    const historyBefore = historyCount();
    expect((await putRoomGrid({ rows: 1, columns: 1, hideEmptySlots: "yes" })).status).toBe(400);
    expect(docState()).toEqual(before);
    expect(historyCount()).toBe(historyBefore);
  });
});

describe("room grid moves", () => {
  it("moves, swaps, reorders rooms, and treats same-slot moves as a no-op", async () => {
    seedDoc(
      [{ id: "r1", name: "A" }, { id: "r2", name: "B" }, { id: "r3", name: "C" }],
      { rows: 2, columns: 2, positions: { r1: 0, r2: 1, r3: 2 } },
    );

    const swapped = await moveRoom("r1", 1);
    expect(swapped.status).toBe(200);
    const swappedTree = (swapped.body as { tree: TreeView }).tree;
    expect(swappedTree.roomGrid?.positions).toEqual({ r1: 1, r2: 0, r3: 2 });
    expect(swappedTree.rooms.map((room) => room.id)).toEqual(["r2", "r1", "r3"]);

    const versionAfterSwap = docState().version;
    const historyAfterSwap = historyCount();
    const noop = await moveRoom("r1", 1);
    expect(noop.status).toBe(200);
    expect(docState().version).toBe(versionAfterSwap);
    expect(historyCount()).toBe(historyAfterSwap);

    const moved = await moveRoom("r1", 3);
    expect(moved.status).toBe(200);
    const movedTree = (moved.body as { tree: TreeView }).tree;
    expect(movedTree.roomGrid?.positions).toEqual({ r1: 3, r2: 0, r3: 2 });
    expect(movedTree.rooms.map((room) => room.id)).toEqual(["r2", "r3", "r1"]);
  });

  it("rejects unknown rooms, out-of-range slots and malformed bodies", async () => {
    seedDoc([{ id: "r1", name: "A" }, { id: "r2", name: "B" }], {
      rows: 1,
      columns: 2,
      positions: { r1: 0, r2: 1 },
    });
    const before = docState();
    expect((await moveRoom("missing", 0)).status).toBe(404);
    expect((await moveRoom("r1", 2)).status).toBe(409);
    expect((await moveRoom("r1", -1)).status).toBe(400);
    const malformed = await request(baseUrl)
      .post(`/api/groups/${GROUP}/inventory/room-grid/move`)
      .set("Cookie", ownerCookie)
      .set(XRW)
      .send({});
    expect(malformed.status).toBe(400);
    expect(docState()).toEqual(before);
  });

  it("404s a move when no room grid is configured", async () => {
    seedDoc([{ id: "r1", name: "A" }]);
    expect((await moveRoom("r1", 0)).status).toBe(404);
  });

  it("removes grid metadata on DELETE and keeps room array order", async () => {
    seedDoc([{ id: "r1", name: "A" }, { id: "r2", name: "B" }], {
      rows: 1,
      columns: 2,
      positions: { r1: 0, r2: 1 },
    });
    const before = docState().version;
    const removed = await deleteRoomGrid();
    expect(removed.status).toBe(200);
    const tree = (removed.body as { tree: TreeView }).tree;
    expect(tree.roomGrid).toBeUndefined();
    expect(tree.rooms.map((room) => room.id)).toEqual(["r1", "r2"]);
    expect(docState().version).toBe(before + 1);

    const versionAfterDelete = docState().version;
    expect((await deleteRoomGrid()).status).toBe(200);
    expect(docState().version).toBe(versionAfterDelete);
    expect((await moveRoom("r1", 0)).status).toBe(404);
  });
});

describe("room create/delete integration", () => {
  it("auto-assigns a new room and expands rows when the grid is full", async () => {
    seedDoc([{ id: "r1", name: "First" }], { rows: 1, columns: 1, positions: { r1: 0 } });

    const first = await createRoom("Second");
    expect(first.status).toBe(201);
    const firstTree = (first.body as { tree: TreeView }).tree;
    const second = firstTree.rooms.find((room) => room.name === "Second");
    expect(second).toBeDefined();
    expect(firstTree.roomGrid).toEqual({ rows: 2, columns: 1, positions: { r1: 0, [second!.id]: 1 } });

    const third = await createRoom("Third");
    expect(third.status).toBe(201);
    const thirdTree = (third.body as { tree: TreeView }).tree;
    const newest = thirdTree.rooms.find((room) => room.name === "Third");
    expect(thirdTree.roomGrid).toEqual({
      rows: 3,
      columns: 1,
      positions: { r1: 0, [second!.id]: 1, [newest!.id]: 2 },
    });
  });

  it("lets creation succeed unpositioned once rows are at the maximum", async () => {
    const fullRooms = Array.from({ length: 20 }, (_, index) => ({ id: `r${index}`, name: `Room ${index}` }));
    seedDoc(fullRooms, {
      rows: 20,
      columns: 1,
      positions: Object.fromEntries(fullRooms.map((room, index) => [room.id, index])),
    });
    const res = await createRoom("Overflow");
    expect(res.status).toBe(201);
    const tree = (res.body as { tree: TreeView }).tree;
    const overflow = tree.rooms.find((room) => room.name === "Overflow");
    expect(overflow).toBeDefined();
    expect(tree.roomGrid?.rows).toBe(20);
    expect(tree.roomGrid?.positions[overflow!.id]).toBeUndefined();
  });

  it("removes a deleted room from the grid without touching other slots", async () => {
    seedDoc(
      [{ id: "r1", name: "A" }, { id: "r2", name: "B" }, { id: "r3", name: "C" }],
      { rows: 2, columns: 2, positions: { r1: 0, r2: 1, r3: 2 } },
    );
    const res = await request(baseUrl)
      .delete(`/api/groups/${GROUP}/inventory/rooms/r2`)
      .set("Cookie", ownerCookie)
      .set(XRW);
    expect(res.status).toBe(200);
    const tree = (res.body as { tree: TreeView }).tree;
    expect(tree.roomGrid?.positions).toEqual({ r1: 0, r3: 2 });
    expect(tree.rooms.map((room) => room.id)).toEqual(["r1", "r3"]);
  });
});

describe("container grid settings and moves", () => {
  it("initializes container positions in array order", async () => {
    seedDoc([
      {
        id: "lab",
        name: "Lab",
        containers: [
          { id: "c1", name: "Cabinet One" },
          { id: "c2", name: "Cabinet Two" },
          { id: "c3", name: "Fridge" },
        ],
      },
    ]);
    const res = await putContainerGrid("lab", { rows: 2, columns: 2 });
    expect(res.status).toBe(200);
    const tree = (res.body as { tree: TreeView }).tree;
    const room = tree.rooms.find((candidate) => candidate.id === "lab");
    expect(room?.containerGrid).toEqual({
      rows: 2,
      columns: 2,
      positions: { c1: 0, c2: 1, c3: 2 },
      hideEmptySlots: false,
    });
    expect(room?.containers.map((container) => container.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("moves, swaps, reorders containers and no-ops on the same slot", async () => {
    seedDoc([
      {
        id: "lab",
        name: "Lab",
        containers: [
          { id: "c1", name: "One" },
          { id: "c2", name: "Two" },
          { id: "c3", name: "Three" },
        ],
      },
    ]);
    await putContainerGrid("lab", { rows: 2, columns: 2 });

    const swapped = await moveContainer("lab", "c1", 1);
    expect(swapped.status).toBe(200);
    const swappedRoom = (swapped.body as { tree: TreeView }).tree.rooms.find((candidate) => candidate.id === "lab");
    expect(swappedRoom?.containerGrid?.positions).toEqual({ c1: 1, c2: 0, c3: 2 });
    expect(swappedRoom?.containers.map((container) => container.id)).toEqual(["c2", "c1", "c3"]);

    const versionAfterSwap = docState().version;
    const historyAfterSwap = historyCount();
    const noop = await moveContainer("lab", "c1", 1);
    expect(noop.status).toBe(200);
    expect(docState().version).toBe(versionAfterSwap);
    expect(historyCount()).toBe(historyAfterSwap);

    expect((await moveContainer("lab", "missing", 0)).status).toBe(404);
    expect((await moveContainer("lab", "c1", 4)).status).toBe(409);
  });

  it("rejects containers that belong to another room", async () => {
    seedDoc([
      { id: "lab", name: "Lab", containers: [{ id: "c1", name: "One" }] },
      { id: "other", name: "Other", containers: [{ id: "c9", name: "Nine" }] },
    ]);
    await putContainerGrid("lab", { rows: 1, columns: 2 });
    expect((await moveContainer("lab", "c9", 0)).status).toBe(404);
  });

  it("rejects unsafe container-grid shrinks without mutation", async () => {
    seedDoc(
      [
        {
          id: "lab",
          name: "Lab",
          containers: [
            { id: "c1", name: "One" },
            { id: "c2", name: "Two" },
            { id: "c3", name: "Three" },
          ],
          containerGrid: { rows: 2, columns: 2, positions: { c1: 0, c2: 1, c3: 2 } },
        },
      ],
    );
    const before = docState();
    const historyBefore = historyCount();
    const res = await putContainerGrid("lab", { rows: 1, columns: 2 });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("slot 2");
    expect(docState()).toEqual(before);
    expect(historyCount()).toBe(historyBefore);
  });

  it("persists hideEmptySlots on container-grid creation and defaults it to false", async () => {
    seedDoc([
      {
        id: "lab",
        name: "Lab",
        containers: [{ id: "c1", name: "One" }, { id: "c2", name: "Two" }],
      },
    ]);
    const hidden = await putContainerGrid("lab", { rows: 1, columns: 2, hideEmptySlots: true });
    expect(hidden.status).toBe(200);
    expect((hidden.body as { tree: TreeView }).tree.rooms[0]?.containerGrid).toEqual({
      rows: 1,
      columns: 2,
      positions: { c1: 0, c2: 1 },
      hideEmptySlots: true,
    });

    seedDoc([
      {
        id: "lab",
        name: "Lab",
        containers: [{ id: "c1", name: "One" }, { id: "c2", name: "Two" }],
      },
    ]);
    const shown = await putContainerGrid("lab", { rows: 1, columns: 2, hideEmptySlots: false });
    expect(shown.status).toBe(200);
    expect((shown.body as { tree: TreeView }).tree.rooms[0]?.containerGrid).toEqual({
      rows: 1,
      columns: 2,
      positions: { c1: 0, c2: 1 },
      hideEmptySlots: false,
    });

    seedDoc([
      {
        id: "lab",
        name: "Lab",
        containers: [{ id: "c1", name: "One" }, { id: "c2", name: "Two" }],
      },
    ]);
    const defaulted = await putContainerGrid("lab", { rows: 1, columns: 2 });
    expect(defaulted.status).toBe(200);
    expect((defaulted.body as { tree: TreeView }).tree.rooms[0]?.containerGrid).toEqual({
      rows: 1,
      columns: 2,
      positions: { c1: 0, c2: 1 },
      hideEmptySlots: false,
    });
  });

  it("updates hideEmptySlots without moving positions or document order", async () => {
    seedDoc([
      {
        id: "lab",
        name: "Lab",
        containers: [
          { id: "c1", name: "One" },
          { id: "c2", name: "Two" },
          { id: "c3", name: "Three" },
        ],
        containerGrid: {
          rows: 2,
          columns: 2,
          positions: { c1: 2, c2: 0, c3: 1 },
          hideEmptySlots: false,
        },
      },
    ]);
    const res = await putContainerGrid("lab", { rows: 2, columns: 2, hideEmptySlots: true });
    expect(res.status).toBe(200);
    const room = (res.body as { tree: TreeView }).tree.rooms.find((candidate) => candidate.id === "lab");
    expect(room?.containerGrid).toEqual({
      rows: 2,
      columns: 2,
      positions: { c1: 2, c2: 0, c3: 1 },
      hideEmptySlots: true,
    });
    expect(room?.containers.map((container) => container.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("preserves hideEmptySlots when a container-grid update omits it", async () => {
    seedDoc([
      {
        id: "lab",
        name: "Lab",
        containers: [{ id: "c1", name: "One" }, { id: "c2", name: "Two" }],
        containerGrid: {
          rows: 1,
          columns: 2,
          positions: { c1: 0, c2: 1 },
          hideEmptySlots: true,
        },
      },
    ]);
    const res = await putContainerGrid("lab", { rows: 1, columns: 2 });
    expect(res.status).toBe(200);
    expect(
      (res.body as { tree: TreeView }).tree.rooms.find((candidate) => candidate.id === "lab")?.containerGrid,
    ).toEqual({
      rows: 1,
      columns: 2,
      positions: { c1: 0, c2: 1 },
      hideEmptySlots: true,
    });
  });

  it("rejects a non-boolean hideEmptySlots on container-grid update without mutation", async () => {
    seedDoc([
      {
        id: "lab",
        name: "Lab",
        containers: [{ id: "c1", name: "One" }],
        containerGrid: {
          rows: 1,
          columns: 1,
          positions: { c1: 0 },
          hideEmptySlots: false,
        },
      },
    ]);
    const before = docState();
    const historyBefore = historyCount();
    expect((await putContainerGrid("lab", { rows: 1, columns: 1, hideEmptySlots: 1 })).status).toBe(400);
    expect(docState()).toEqual(before);
    expect(historyCount()).toBe(historyBefore);
  });

  it("DELETE removes only container-grid metadata and preserves containers and their data", async () => {
    seedDoc(
      [
        {
          id: "lab",
          name: "Lab",
          containers: [
            {
              id: "c1",
              name: "Cabinet One",
              shelves: [{ id: "s1", name: "Shelf A", chemicals: [{ id: "chem1", name: "Ethanol" }] }],
            },
            { id: "c2", name: "Fridge" },
          ],
        },
      ],
      { rows: 1, columns: 1, positions: { lab: 0 } },
    );
    const configured = await putContainerGrid("lab", { rows: 1, columns: 2, hideEmptySlots: true });
    expect(configured.status).toBe(200);
    const configuredRoom = (configured.body as { tree: TreeView }).tree.rooms.find(
      (candidate) => candidate.id === "lab",
    );
    expect(configuredRoom?.containerGrid?.hideEmptySlots).toBe(true);
    const before = docState().version;

    const res = await deleteContainerGrid("lab");
    expect(res.status).toBe(200);
    const tree = (res.body as { tree: TreeView }).tree;
    const room = tree.rooms.find((candidate) => candidate.id === "lab");
    expect(room?.containerGrid).toBeUndefined();
    expect(room?.containers).toEqual(configuredRoom?.containers);
    expect(room?.containers.map((container) => container.id)).toEqual(["c1", "c2"]);
    expect(room?.containers[0]?.shelves).toEqual([
      { id: "s1", name: "Shelf A", chemicals: [{ id: "chem1", name: "Ethanol" }] },
    ]);
    expect(tree.roomGrid).toEqual({ rows: 1, columns: 1, positions: { lab: 0 } });
    expect(docState().version).toBe(before + 1);

    const versionAfterDelete = docState().version;
    expect((await deleteContainerGrid("lab")).status).toBe(200);
    expect(docState().version).toBe(versionAfterDelete);
    expect(
      (db.prepare("SELECT tree FROM group_inventory_docs WHERE group_id = ?").get(GROUP) as { tree: string }).tree,
    ).toContain("Shelf A");
  });
});

describe("container create/delete integration", () => {
  it("auto-assigns and expands the container grid, then leaves overflow unpositioned at max rows", async () => {
    seedDoc([{ id: "lab", name: "Lab", containers: [{ id: "c1", name: "One" }] }]);
    await putContainerGrid("lab", { rows: 1, columns: 1 });

    const first = await createContainer("lab", "Two");
    expect(first.status).toBe(201);
    const firstRoom = (first.body as { tree: TreeView }).tree.rooms.find((candidate) => candidate.id === "lab");
    const added = firstRoom?.containers.find((container) => container.name === "Two");
    expect(added).toBeDefined();
    expect(firstRoom?.containerGrid).toEqual({
      rows: 2,
      columns: 1,
      positions: { c1: 0, [added!.id]: 1 },
      hideEmptySlots: false,
    });

    const second = await createContainer("lab", "Three");
    expect(second.status).toBe(201);
    const secondRoom = (second.body as { tree: TreeView }).tree.rooms.find((candidate) => candidate.id === "lab");
    const addedTwo = secondRoom?.containers.find((container) => container.name === "Three");
    expect(secondRoom?.containerGrid).toEqual({
      rows: 3,
      columns: 1,
      positions: { c1: 0, [added!.id]: 1, [addedTwo!.id]: 2 },
      hideEmptySlots: false,
    });

    const fullContainers = Array.from({ length: 20 }, (_, index) => ({
      id: `c${index}`,
      name: `Container ${index}`,
    }));
    seedDoc([
      {
        id: "lab",
        name: "Lab",
        containers: fullContainers,
        containerGrid: {
          rows: 20,
          columns: 1,
          positions: Object.fromEntries(fullContainers.map((container, index) => [container.id, index])),
        },
      },
    ]);
    const overflow = await createContainer("lab", "Overflow");
    expect(overflow.status).toBe(201);
    const overflowRoom = (overflow.body as { tree: TreeView }).tree.rooms.find((candidate) => candidate.id === "lab");
    const overflowContainer = overflowRoom?.containers.find((container) => container.name === "Overflow");
    expect(overflowContainer).toBeDefined();
    expect(overflowRoom?.containerGrid?.rows).toBe(20);
    expect(overflowRoom?.containerGrid?.positions[overflowContainer!.id]).toBeUndefined();
    expect(Object.keys(overflowRoom?.containerGrid?.positions ?? {})).toHaveLength(20);
  });

  it("does not leave an orphaned grid slot when a deep freezer is created in a gridded room", async () => {
    seedDoc([{ id: "lab", name: "Lab", containers: [{ id: "c1", name: "One" }] }]);
    await putContainerGrid("lab", { rows: 1, columns: 1 });

    const created = await request(baseUrl)
      .post(`/api/groups/${GROUP}/inventory/containers`)
      .set("Cookie", ownerCookie)
      .set(XRW)
      .send({ roomId: "lab", name: "Nested Freezer", type: "deepfreezer" });
    expect(created.status).toBe(201);
    const createdTree = (created.body as { tree: TreeView }).tree;
    const createdRoom = createdTree.rooms.find((candidate) => candidate.id === "lab");
    const nestedFreezer = createdTree.deepFreezers?.find((freezer) => freezer.name === "Nested Freezer");
    expect(nestedFreezer).toBeDefined();
    expect(createdRoom?.containers.some((container) => container.id === nestedFreezer?.id)).toBe(false);
    expect(createdRoom?.containerGrid).toEqual({
      rows: 1,
      columns: 1,
      positions: { c1: 0 },
      hideEmptySlots: false,
    });

    // A later mutation must not resurrect an orphaned slot for the relocated freezer.
    const relocated = await putContainerGrid("lab", { rows: 1, columns: 1 });
    expect(relocated.status).toBe(200);
    const tree = (relocated.body as { tree: TreeView }).tree;
    const room = tree.rooms.find((candidate) => candidate.id === "lab");
    expect(tree.deepFreezers?.some((freezer) => freezer.id === nestedFreezer?.id)).toBe(true);
    expect(room?.containers.some((container) => container.id === nestedFreezer?.id)).toBe(false);
    expect(room?.containerGrid?.positions).toEqual({ c1: 0 });
    expect(Object.keys(room?.containerGrid?.positions ?? {})).toHaveLength(1);
  });

  it("removes a deleted container from the grid", async () => {
    seedDoc([
      {
        id: "lab",
        name: "Lab",
        containers: [
          { id: "c1", name: "One" },
          { id: "c2", name: "Two" },
          { id: "c3", name: "Three" },
        ],
        containerGrid: { rows: 2, columns: 2, positions: { c1: 0, c2: 1, c3: 2 } },
      },
    ]);
    const res = await request(baseUrl)
      .delete(`/api/groups/${GROUP}/inventory/containers/c2`)
      .set("Cookie", ownerCookie)
      .set(XRW)
      .send({ roomId: "lab" });
    expect(res.status).toBe(200);
    const room = (res.body as { tree: TreeView }).tree.rooms.find((candidate) => candidate.id === "lab");
    expect(room?.containerGrid?.positions).toEqual({ c1: 0, c3: 2 });
    expect(room?.containers.map((container) => container.id)).toEqual(["c1", "c3"]);
  });
});

describe("container grid ownership guards", () => {
  it("404s deep-freezer pseudo rooms and the virtual shared-assets room", async () => {
    seedDoc([{ id: "lab", name: "Lab" }], undefined, [{ id: "df-1", name: "Deep Freezer" }]);
    expect((await putContainerGrid("df-1", { rows: 1, columns: 1 })).status).toBe(404);
    expect((await putContainerGrid("shared-assets", { rows: 1, columns: 1 })).status).toBe(404);
    expect((await deleteContainerGrid("df-1")).status).toBe(404);
    expect((await moveContainer("df-1", "df-1", 0)).status).toBe(404);
  });

  it("keeps readers and foreign labs out of room and container grid writes", async () => {
    seedDoc(
      [{ id: "lab", name: "Lab", containers: [{ id: "c1", name: "One" }] }],
      { rows: 1, columns: 2, positions: { lab: 0 } },
    );
    await putContainerGrid("lab", { rows: 1, columns: 2 });

    const before = docState();
    const historyBefore = historyCount();
    const calls = [
      () => request(baseUrl).put(`/api/groups/${GROUP}/inventory/room-grid`).set("Cookie", readerCookie).set(XRW).send({ rows: 2, columns: 2 }),
      () => request(baseUrl).delete(`/api/groups/${GROUP}/inventory/room-grid`).set("Cookie", readerCookie).set(XRW),
      () => request(baseUrl).post(`/api/groups/${GROUP}/inventory/room-grid/move`).set("Cookie", readerCookie).set(XRW).send({ roomId: "lab", slot: 1 }),
      () => request(baseUrl).put(`/api/groups/${GROUP}/inventory/rooms/lab/container-grid`).set("Cookie", readerCookie).set(XRW).send({ rows: 2, columns: 2 }),
      () => request(baseUrl).delete(`/api/groups/${GROUP}/inventory/rooms/lab/container-grid`).set("Cookie", readerCookie).set(XRW),
      () => request(baseUrl).post(`/api/groups/${GROUP}/inventory/rooms/lab/container-grid/move`).set("Cookie", readerCookie).set(XRW).send({ containerId: "c1", slot: 1 }),
    ];
    for (const call of calls) {
      expect((await call()).status).toBe(403);
    }

    const foreignCalls = [
      () => request(baseUrl).put(`/api/groups/${GROUP}/inventory/room-grid`).set("Cookie", foreignCookie).set(XRW).send({ rows: 2, columns: 2 }),
      () => request(baseUrl).delete(`/api/groups/${GROUP}/inventory/room-grid`).set("Cookie", foreignCookie).set(XRW),
      () => request(baseUrl).post(`/api/groups/${GROUP}/inventory/room-grid/move`).set("Cookie", foreignCookie).set(XRW).send({ roomId: "lab", slot: 1 }),
      () => request(baseUrl).put(`/api/groups/${GROUP}/inventory/rooms/lab/container-grid`).set("Cookie", foreignCookie).set(XRW).send({ rows: 2, columns: 2 }),
      () => request(baseUrl).delete(`/api/groups/${GROUP}/inventory/rooms/lab/container-grid`).set("Cookie", foreignCookie).set(XRW),
      () => request(baseUrl).post(`/api/groups/${GROUP}/inventory/rooms/lab/container-grid/move`).set("Cookie", foreignCookie).set(XRW).send({ containerId: "c1", slot: 1 }),
    ];
    for (const call of foreignCalls) {
      expect((await call()).status).toBe(403);
    }

    expect(docState()).toEqual(before);
    expect(historyCount()).toBe(historyBefore);
  });
});

describe("grid growth auto-fill", () => {
  it("positions overflow rooms on capacity growth without renumbering existing slots", async () => {
    seedDoc(
      [{ id: "r1", name: "A" }, { id: "r2", name: "B" }, { id: "r3", name: "C" }],
      { rows: 2, columns: 2, positions: { r1: 2 } },
    );
    const res = await putRoomGrid({ rows: 3, columns: 2 });
    expect(res.status).toBe(200);
    const tree = (res.body as { tree: TreeView }).tree;
    expect(tree.roomGrid?.positions).toEqual({ r1: 2, r2: 0, r3: 1 });
    expect(tree.rooms.map((room) => room.id)).toEqual(["r2", "r3", "r1"]);
  });

  it("leaves positions and document order unchanged when nothing is unpositioned", async () => {
    seedDoc(
      [{ id: "r1", name: "A" }, { id: "r2", name: "B" }],
      { rows: 2, columns: 2, positions: { r1: 0, r2: 1 } },
    );
    const before = docState().version;
    const res = await putRoomGrid({ rows: 3, columns: 2 });
    expect(res.status).toBe(200);
    const tree = (res.body as { tree: TreeView }).tree;
    expect(tree.roomGrid?.positions).toEqual({ r1: 0, r2: 1 });
    expect(tree.rooms.map((room) => room.id)).toEqual(["r1", "r2"]);
    expect(docState().version).toBe(before + 1);
  });

  it("positions overflow containers on capacity growth and preserves existing slots", async () => {
    seedDoc([
      {
        id: "lab",
        name: "Lab",
        containers: [
          { id: "c1", name: "One" },
          { id: "c2", name: "Two" },
          { id: "c3", name: "Three" },
        ],
        containerGrid: { rows: 1, columns: 1, positions: { c1: 0 } },
      },
    ]);
    const res = await putContainerGrid("lab", { rows: 2, columns: 2 });
    expect(res.status).toBe(200);
    const room = (res.body as { tree: TreeView }).tree.rooms.find((candidate) => candidate.id === "lab");
    expect(room?.containerGrid?.positions).toEqual({ c1: 0, c2: 1, c3: 2 });
    expect(room?.containers.map((container) => container.id)).toEqual(["c1", "c2", "c3"]);
  });
});

describe("parity", () => {
  it("stays clean after grid mutations because grid metadata is doc-only", async () => {
    seedDoc([
      {
        id: "parity-room",
        name: "Parity Room",
        containers: [{ id: "parity-container", name: "Parity Cabinet" }],
      },
    ]);
    expect((await putContainerGrid("parity-room", { rows: 2, columns: 2 })).status).toBe(200);
    expect((await putRoomGrid({ rows: 2, columns: 2 })).status).toBe(200);
    expect((await moveRoom("parity-room", 0)).status).toBe(200);

    const parity = await request(baseUrl).get(`/api/groups/${GROUP}/inventory/parity`).set("Cookie", ownerCookie);
    expect(parity.status).toBe(200);
    expect(parity.body).toEqual({ ok: true, issues: [] });
  });
});
