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
const GROUP = "group-quick";
const FOREIGN_GROUP = "group-quick-foreign";

let app: FastifyInstance;
let baseUrl: string;
let writerCookie: string;
let readerCookie: string;
let foreignCookie: string;
let db: ReturnType<typeof getDatabase>;
let roomId: string;
let containerId: string;
let shelfId: string;

interface ChemicalDoc {
  id: string;
  name: string;
  quantity?: number;
  availability?: string;
}

interface RoomDoc {
  id: string;
  chemicals?: ChemicalDoc[];
  containers: Array<{
    id: string;
    chemicals?: ChemicalDoc[];
    shelves: Array<{ id: string; chemicals?: ChemicalDoc[] }>;
  }>;
}

interface TreeResponse {
  version: number;
  tree: { rooms: RoomDoc[] };
}

function one<T>(sql: string, ...params: unknown[]): T {
  return db.prepare(sql).get(...params) as T;
}

function stockStatus(id: string): string {
  return one<{ status: string }>("SELECT status FROM stocks WHERE id=?", id).status;
}

function findChemical(tree: TreeResponse["tree"], predicate: (chemical: ChemicalDoc) => boolean): ChemicalDoc | undefined {
  for (const room of tree.rooms ?? []) {
    const roomChemical = (room.chemicals ?? []).find(predicate);
    if (roomChemical !== undefined) return roomChemical;
    for (const container of room.containers ?? []) {
      const direct = (container.chemicals ?? []).find(predicate);
      if (direct !== undefined) return direct;
      for (const shelf of container.shelves ?? []) {
        const found = (shelf.chemicals ?? []).find(predicate);
        if (found !== undefined) return found;
      }
    }
  }
  return undefined;
}

function responseChemicalByName(res: request.Response, name: string): ChemicalDoc {
  const found = findChemical((res.body as TreeResponse).tree, (chemical) => chemical.name === name);
  if (found === undefined) throw new Error(`chemical "${name}" not found in response`);
  return found;
}

async function inventory(id: string): Promise<{ version: number; chemical: ChemicalDoc | undefined }> {
  const res = await request(baseUrl).get(`/api/groups/${GROUP}/inventory`).set("Cookie", writerCookie).set(XRW);
  expect(res.status).toBe(200);
  const body = res.body as TreeResponse;
  return { version: body.version, chemical: findChemical(body.tree, (chemical) => chemical.id === id) };
}

function createChemical(payload: Record<string, unknown>) {
  return request(baseUrl)
    .post(`/api/groups/${GROUP}/inventory/chemicals`)
    .set("Cookie", writerCookie)
    .set(XRW)
    .send({ roomId, containerId, shelfId, ...payload });
}

function setAvailability(id: string, payload: Record<string, unknown>, cookie = writerCookie) {
  return request(baseUrl)
    .put(`/api/groups/${GROUP}/inventory/chemicals/${id}/availability`)
    .set("Cookie", cookie)
    .set(XRW)
    .send(payload);
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
  const dir = mkdtempSync(join(tmpdir(), "bioscom-availability-quick-test-"));
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
  insertUser.run("uid-quick-writer", "writer@quick.test", await argonHash("pw"), "Quick Writer", "admin", GROUP);
  insertUser.run("uid-quick-reader", "reader@quick.test", await argonHash("pw"), "Quick Reader", "reader", GROUP);
  insertUser.run("uid-quick-foreign", "foreign@quick.test", await argonHash("pw"), "Foreign Admin", "admin", FOREIGN_GROUP);
  const insertGroup = db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)");
  insertGroup.run(GROUP, "Quick Lab", "BIOS-QU", 1);
  insertGroup.run(FOREIGN_GROUP, "Foreign Lab", "BIOS-QF", 1);
  const emptyTree = JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] });
  const insertDoc = db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)");
  insertDoc.run(GROUP, emptyTree);
  insertDoc.run(FOREIGN_GROUP, emptyTree);

  writerCookie = await login("writer@quick.test", "pw");
  readerCookie = await login("reader@quick.test", "pw");
  foreignCookie = await login("foreign@quick.test", "pw");

  const roomRes = await request(baseUrl)
    .post(`/api/groups/${GROUP}/inventory/rooms`)
    .set("Cookie", writerCookie)
    .set(XRW)
    .send({ name: "Main" });
  roomId = (roomRes.body as TreeResponse).tree.rooms[0]?.id ?? "";
  const contRes = await request(baseUrl)
    .post(`/api/groups/${GROUP}/inventory/containers`)
    .set("Cookie", writerCookie)
    .set(XRW)
    .send({ roomId, name: "Fridge", type: "fridge", shelves: ["A"] });
  const container = (contRes.body as TreeResponse).tree.rooms[0]?.containers[0];
  containerId = container?.id ?? "";
  shelfId = container?.shelves[0]?.id ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("PUT chemical availability", () => {
  it("sets availability to low and mirrors it onto the SQL stock status", async () => {
    const created = await createChemical({ name: "Quick low", quantity: 10 });
    expect(created.status).toBe(201);
    const { id } = responseChemicalByName(created, "Quick low");
    expect(stockStatus(id)).toBe("available");

    const res = await setAvailability(id, { roomId, containerId, shelfId, availability: "low" });
    expect(res.status).toBe(200);
    expect(responseChemicalByName(res, "Quick low").availability).toBe("low");

    const current = await inventory(id);
    expect(current.chemical?.availability).toBe("low");
    expect(stockStatus(id)).toBe("low");
  });

  it("sets availability back to available", async () => {
    const created = await createChemical({ name: "Quick toggle", quantity: 10 });
    const { id } = responseChemicalByName(created, "Quick toggle");

    const low = await setAvailability(id, { roomId, containerId, shelfId, availability: "low" });
    expect(low.status).toBe(200);
    expect((await inventory(id)).chemical?.availability).toBe("low");

    const available = await setAvailability(id, { roomId, containerId, shelfId, availability: "available" });
    expect(available.status).toBe(200);
    expect((await inventory(id)).chemical?.availability).toBe("available");
    expect(stockStatus(id)).toBe("available");
  });

  it("accepts omitted optional location fields for room-level chemicals", async () => {
    const created = await createChemical({
      name: "Room level",
      quantity: 7,
      containerId: undefined,
      shelfId: undefined,
    });
    expect(created.status).toBe(201);
    const { id } = responseChemicalByName(created, "Room level");

    const res = await setAvailability(id, { roomId, availability: "low" });
    expect(res.status).toBe(200);
    expect((await inventory(id)).chemical?.availability).toBe("low");
    expect(stockStatus(id)).toBe("low");
  });

  it("rejects a reader with 403 and leaves the document untouched", async () => {
    const created = await createChemical({ name: "Reader guarded", quantity: 10, availability: "low" });
    const { id } = responseChemicalByName(created, "Reader guarded");
    const before = await inventory(id);

    const res = await setAvailability(id, { roomId, containerId, shelfId, availability: "available" }, readerCookie);
    expect(res.status).toBe(403);

    const after = await inventory(id);
    expect(after.version).toBe(before.version);
    expect(after.chemical?.availability).toBe("low");
    expect(stockStatus(id)).toBe("low");
  });

  it("rejects an invalid availability with 400 without mutating", async () => {
    const created = await createChemical({ name: "Invalid guarded", quantity: 10, availability: "low" });
    const { id } = responseChemicalByName(created, "Invalid guarded");
    const before = await inventory(id);

    const res = await setAvailability(id, { roomId, containerId, shelfId, availability: "plenty" });
    expect(res.status).toBe(400);

    const after = await inventory(id);
    expect(after.version).toBe(before.version);
    expect(after.chemical?.availability).toBe("low");
    expect(stockStatus(id)).toBe("low");
  });

  it("rejects zero and missing quantities with 409 without mutating", async () => {
    const zero = await createChemical({ name: "Zero guarded", quantity: 0 });
    const { id: zeroId } = responseChemicalByName(zero, "Zero guarded");
    const zeroBefore = await inventory(zeroId);

    const zeroRes = await setAvailability(zeroId, { roomId, containerId, shelfId, availability: "low" });
    expect(zeroRes.status).toBe(409);

    const zeroAfter = await inventory(zeroId);
    expect(zeroAfter.version).toBe(zeroBefore.version);
    expect(zeroAfter.chemical?.availability).toBeUndefined();
    expect(stockStatus(zeroId)).toBe("out_of_stock");

    const missing = await createChemical({ name: "Missing qty guarded" });
    const { id: missingId } = responseChemicalByName(missing, "Missing qty guarded");
    const missingBefore = await inventory(missingId);

    const missingRes = await setAvailability(missingId, { roomId, containerId, shelfId, availability: "low" });
    expect(missingRes.status).toBe(409);

    const missingAfter = await inventory(missingId);
    expect(missingAfter.version).toBe(missingBefore.version);
    expect(missingAfter.chemical?.availability).toBeUndefined();
    expect(stockStatus(missingId)).toBe("out_of_stock");
  });

  it("blocks a foreign lab with 404 without mutating", async () => {
    const created = await createChemical({ name: "Foreign guarded", quantity: 10, availability: "low" });
    const { id } = responseChemicalByName(created, "Foreign guarded");
    const before = await inventory(id);

    const res = await setAvailability(id, { roomId, containerId, shelfId, availability: "available" }, foreignCookie);
    expect(res.status).toBe(404);

    const after = await inventory(id);
    expect(after.version).toBe(before.version);
    expect(after.chemical?.availability).toBe("low");
    expect(stockStatus(id)).toBe("low");
  });
});
