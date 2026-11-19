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
const GROUP = "group-highlight";

let app: FastifyInstance;
let baseUrl: string;
let cookie: string;

interface ContainerView {
  id: string;
  name: string;
  highlightColor?: string;
}

interface RoomView {
  id: string;
  name: string;
  highlightColor?: string;
  containers: ContainerView[];
}

interface TreeView {
  rooms: RoomView[];
}

function api(method: "get" | "post" | "put", path: string, body?: Record<string, unknown>): request.Test {
  const call = request(baseUrl)[method](path).set("Cookie", cookie).set(XRW);
  return body === undefined ? call : call.send(body);
}

async function currentTree(): Promise<TreeView> {
  const response = await api("get", `/api/groups/${GROUP}/inventory`);
  expect(response.status).toBe(200);
  return response.body.tree as TreeView;
}

function roomByName(tree: TreeView, id: string): RoomView {
  const room = tree.rooms.find((candidate) => candidate.id === id);
  if (room === undefined) throw new Error(`room "${id}" not found`);
  return room;
}

function containerById(tree: TreeView, roomId: string, containerId: string): ContainerView {
  const container = roomByName(tree, roomId).containers.find((candidate) => candidate.id === containerId);
  if (container === undefined) throw new Error(`container "${containerId}" not found`);
  return container;
}

async function createRoom(name: string, highlightColor?: string): Promise<RoomView> {
  const response = await api("post", `/api/groups/${GROUP}/inventory/rooms`, {
    name,
    ...(highlightColor === undefined ? {} : { highlightColor }),
  });
  expect(response.status).toBe(201);
  const room = (response.body.tree as TreeView).rooms.find((candidate) => candidate.name === name);
  if (room === undefined) throw new Error(`created room "${name}" missing from response`);
  return room;
}

async function createContainer(roomId: string, name: string, highlightColor?: string): Promise<ContainerView> {
  const response = await api("post", `/api/groups/${GROUP}/inventory/containers`, {
    roomId,
    name,
    type: "fridge",
    ...(highlightColor === undefined ? {} : { highlightColor }),
  });
  expect(response.status).toBe(201);
  const container = (response.body.tree as TreeView).rooms
    .find((candidate) => candidate.id === roomId)
    ?.containers.find((candidate) => candidate.name === name);
  if (container === undefined) throw new Error(`created container "${name}" missing from response`);
  return container;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-highlight-test-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const db = getDatabase(dbPath);
  db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  ).run("uid-highlight", "admin@highlight.test", await argonHash("pw"), "Admin", "admin", GROUP);
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, 'Highlight Lab', 'BIOS-HL', 1)").run(GROUP);
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)").run(
    GROUP,
    JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] }),
  );
  const login = await request(baseUrl)
    .post("/api/login")
    .set(XRW)
    .send({ email: "admin@highlight.test", password: "pw" });
  const setCookie = login.headers["set-cookie"];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("room highlight persistence", () => {
  it("creates a room with a palette highlight and GET returns it", async () => {
    const room = await createRoom("Room Orange", "orange");
    expect(room.highlightColor).toBe("orange");
    expect(roomByName(await currentTree(), room.id).highlightColor).toBe("orange");
  });

  it("creates a legacy room without a highlight key when omitted", async () => {
    const room = await createRoom("Room Legacy");
    expect(Object.prototype.hasOwnProperty.call(room, "highlightColor")).toBe(false);
  });

  it("preserves the stored highlight when an edit omits the field", async () => {
    const room = await createRoom("Room Preserve", "bluishGreen");
    const response = await api("put", `/api/groups/${GROUP}/inventory/rooms/${room.id}`, {
      description: "renamed description",
    });
    expect(response.status).toBe(200);
    const stored = roomByName(await currentTree(), room.id);
    expect(stored.highlightColor).toBe("bluishGreen");
  });

  it("resets a room highlight to default when an edit sends null", async () => {
    const room = await createRoom("Room Reset", "blue");
    const response = await api("put", `/api/groups/${GROUP}/inventory/rooms/${room.id}`, {
      highlightColor: null,
    });
    expect(response.status).toBe(200);
    const stored = roomByName(await currentTree(), room.id);
    expect(Object.prototype.hasOwnProperty.call(stored, "highlightColor")).toBe(false);
  });

  it("stores an explicit none room highlight", async () => {
    const room = await createRoom("Room None", "vermillion");
    const response = await api("put", `/api/groups/${GROUP}/inventory/rooms/${room.id}`, {
      highlightColor: "none",
    });
    expect(response.status).toBe(200);
    expect(roomByName(await currentTree(), room.id).highlightColor).toBe("none");
  });

  it("rejects an invalid room highlight on create and edit", async () => {
    const invalidCreate = await api("post", `/api/groups/${GROUP}/inventory/rooms`, {
      name: "Room Invalid",
      highlightColor: "purple",
    });
    expect(invalidCreate.status).toBe(400);

    const room = await createRoom("Room Guarded", "yellow");
    const invalidEdit = await api("put", `/api/groups/${GROUP}/inventory/rooms/${room.id}`, {
      highlightColor: "purple",
    });
    expect(invalidEdit.status).toBe(400);
    expect(roomByName(await currentTree(), room.id).highlightColor).toBe("yellow");
  });
});

describe("container highlight persistence", () => {
  it("creates a container with a palette highlight and GET returns it", async () => {
    const room = await createRoom("Container Room A");
    const container = await createContainer(room.id, "Fridge Orange", "orange");
    expect(container.highlightColor).toBe("orange");
    expect(containerById(await currentTree(), room.id, container.id).highlightColor).toBe("orange");
  });

  it("creates a legacy container without a highlight key when omitted", async () => {
    const room = await createRoom("Container Room Legacy");
    const container = await createContainer(room.id, "Legacy Fridge");
    expect(Object.prototype.hasOwnProperty.call(container, "highlightColor")).toBe(false);
  });

  it("preserves the stored highlight when an edit omits the field", async () => {
    const room = await createRoom("Container Room Preserve");
    const container = await createContainer(room.id, "Preserved Fridge", "skyBlue");
    const response = await api(
      "put",
      `/api/groups/${GROUP}/inventory/containers/${container.id}`,
      { roomId: room.id, name: "Preserved Fridge Renamed" },
    );
    expect(response.status).toBe(200);
    const stored = containerById(await currentTree(), room.id, container.id);
    expect(stored.name).toBe("Preserved Fridge Renamed");
    expect(stored.highlightColor).toBe("skyBlue");
  });

  it("resets a container highlight to default when an edit sends null", async () => {
    const room = await createRoom("Container Room Reset");
    const container = await createContainer(room.id, "Reset Fridge", "reddishPurple");
    const response = await api(
      "put",
      `/api/groups/${GROUP}/inventory/containers/${container.id}`,
      { roomId: room.id, highlightColor: null },
    );
    expect(response.status).toBe(200);
    const stored = containerById(await currentTree(), room.id, container.id);
    expect(Object.prototype.hasOwnProperty.call(stored, "highlightColor")).toBe(false);
  });

  it("stores an explicit none container highlight", async () => {
    const room = await createRoom("Container Room None");
    const container = await createContainer(room.id, "None Fridge", "black");
    const response = await api(
      "put",
      `/api/groups/${GROUP}/inventory/containers/${container.id}`,
      { roomId: room.id, highlightColor: "none" },
    );
    expect(response.status).toBe(200);
    expect(containerById(await currentTree(), room.id, container.id).highlightColor).toBe("none");
  });

  it("rejects an invalid container highlight on create and edit", async () => {
    const room = await createRoom("Container Room Guarded");
    const invalidCreate = await api("post", `/api/groups/${GROUP}/inventory/containers`, {
      roomId: room.id,
      name: "Invalid Fridge",
      type: "fridge",
      highlightColor: "purple",
    });
    expect(invalidCreate.status).toBe(400);

    const container = await createContainer(room.id, "Guarded Fridge", "bluishGreen");
    const invalidEdit = await api(
      "put",
      `/api/groups/${GROUP}/inventory/containers/${container.id}`,
      { roomId: room.id, highlightColor: "purple" },
    );
    expect(invalidEdit.status).toBe(400);
    expect(containerById(await currentTree(), room.id, container.id).highlightColor).toBe("bluishGreen");
  });
});
