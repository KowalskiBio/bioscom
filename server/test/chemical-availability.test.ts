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
const GROUP = "group-avail";

let app: FastifyInstance;
let baseUrl: string;
let cookie: string;
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

function one<T>(sql: string, ...params: unknown[]): T {
  return db.prepare(sql).get(...params) as T;
}

function stockStatus(id: string): string {
  return one<{ status: string }>("SELECT status FROM stocks WHERE id=?", id).status;
}

function responseChemical(res: request.Response, name: string): ChemicalDoc {
  const chemicals = res.body.tree.rooms[0].containers[0].shelves[0].chemicals as ChemicalDoc[];
  const found = chemicals.find((chemical) => chemical.name === name);
  if (found === undefined) throw new Error(`chemical "${name}" not found in response`);
  return found;
}

async function inventoryChemical(id: string): Promise<ChemicalDoc | undefined> {
  const res = await request(baseUrl).get(`/api/groups/${GROUP}/inventory`).set("Cookie", cookie).set(XRW);
  expect(res.status).toBe(200);
  for (const room of res.body.tree.rooms ?? []) {
    for (const container of room.containers ?? []) {
      for (const shelf of container.shelves ?? []) {
        const found = (shelf.chemicals ?? []).find((chemical: ChemicalDoc) => chemical.id === id);
        if (found !== undefined) return found;
      }
    }
  }
  return undefined;
}

function createChemical(payload: Record<string, unknown>) {
  return request(baseUrl)
    .post(`/api/groups/${GROUP}/inventory/chemicals`)
    .set("Cookie", cookie)
    .set(XRW)
    .send({ roomId, containerId, shelfId, ...payload });
}

function editChemical(id: string, payload: Record<string, unknown>) {
  return request(baseUrl)
    .put(`/api/groups/${GROUP}/inventory/chemicals/${id}`)
    .set("Cookie", cookie)
    .set(XRW)
    .send({ roomId, containerId, shelfId, ...payload });
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-availability-test-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  db = getDatabase(dbPath);
  db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  ).run("uid-avail", "admin@avail.test", await argonHash("pw"), "Admin", "admin", GROUP);
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, 'Availability Lab', 'BIOS-AV', 1)").run(GROUP);
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)").run(
    GROUP,
    JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] }),
  );
  const login = await request(baseUrl)
    .post("/api/login")
    .set(XRW)
    .send({ email: "admin@avail.test", password: "pw" });
  const setCookie = login.headers["set-cookie"];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";

  const roomRes = await request(baseUrl)
    .post(`/api/groups/${GROUP}/inventory/rooms`)
    .set("Cookie", cookie)
    .set(XRW)
    .send({ name: "Main" });
  roomId = roomRes.body.tree.rooms[0].id;
  const contRes = await request(baseUrl)
    .post(`/api/groups/${GROUP}/inventory/containers`)
    .set("Cookie", cookie)
    .set(XRW)
    .send({ roomId, name: "Fridge", type: "fridge", shelves: ["A"] });
  containerId = contRes.body.tree.rooms[0].containers[0].id;
  shelfId = contRes.body.tree.rooms[0].containers[0].shelves[0].id;
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("chemical availability create/edit", () => {
  it("creates a positive-quantity chemical with an explicit low mark", async () => {
    const res = await createChemical({ name: "Low stock", quantity: 5, availability: "low" });
    expect(res.status).toBe(201);
    const chemical = responseChemical(res, "Low stock");
    expect(chemical.availability).toBe("low");
    expect(stockStatus(chemical.id)).toBe("low");
  });

  it("defaults an omitted availability to available behaviour", async () => {
    const res = await createChemical({ name: "Default stock", quantity: 50 });
    expect(res.status).toBe(201);
    const chemical = responseChemical(res, "Default stock");
    expect(chemical.availability).toBeUndefined();
    expect(stockStatus(chemical.id)).toBe("available");
  });

  it("derives out_of_stock for a zero quantity even with a stored low mark", async () => {
    const zero = await createChemical({ name: "Zero stock", quantity: 0 });
    expect(zero.status).toBe(201);
    expect(stockStatus(responseChemical(zero, "Zero stock").id)).toBe("out_of_stock");

    const zeroLow = await createChemical({ name: "Zero low", quantity: 0, availability: "low" });
    expect(zeroLow.status).toBe(201);
    const zeroLowChemical = responseChemical(zeroLow, "Zero low");
    expect(zeroLowChemical.availability).toBe("low");
    expect(stockStatus(zeroLowChemical.id)).toBe("out_of_stock");
  });

  it("derives out_of_stock when the quantity is missing", async () => {
    const res = await createChemical({ name: "No quantity" });
    expect(res.status).toBe(201);
    const chemical = responseChemical(res, "No quantity");
    expect(chemical.quantity).toBeUndefined();
    expect(stockStatus(chemical.id)).toBe("out_of_stock");
  });

  it("lets an edit set availability low and then available", async () => {
    const created = await createChemical({ name: "Editable", quantity: 10 });
    const id = responseChemical(created, "Editable").id;

    const low = await editChemical(id, { availability: "low" });
    expect(low.status).toBe(200);
    expect((await inventoryChemical(id))?.availability).toBe("low");
    expect(stockStatus(id)).toBe("low");

    const available = await editChemical(id, { availability: "available" });
    expect(available.status).toBe(200);
    expect((await inventoryChemical(id))?.availability).toBe("available");
    expect(stockStatus(id)).toBe("available");
  });

  it("preserves the stored availability when an edit omits it", async () => {
    const created = await createChemical({ name: "Preserved", quantity: 10, availability: "low" });
    const id = responseChemical(created, "Preserved").id;

    const res = await editChemical(id, { name: "Preserved renamed" });
    expect(res.status).toBe(200);
    const chemical = await inventoryChemical(id);
    expect(chemical?.name).toBe("Preserved renamed");
    expect(chemical?.availability).toBe("low");
    expect(stockStatus(id)).toBe("low");
  });

  it("rejects an invalid availability without mutating the document or the mirror", async () => {
    const created = await createChemical({ name: "Guarded", quantity: 10, availability: "low" });
    const id = responseChemical(created, "Guarded").id;

    const invalidEdit = await editChemical(id, { availability: "plenty" });
    expect(invalidEdit.status).toBe(400);
    expect((await inventoryChemical(id))?.availability).toBe("low");
    expect(stockStatus(id)).toBe("low");

    const stockCountBefore = one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks WHERE group_id=?", GROUP).n;
    const invalidCreate = await createChemical({ name: "Invalid", quantity: 10, availability: "plenty" });
    expect(invalidCreate.status).toBe(400);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks WHERE group_id=?", GROUP).n).toBe(stockCountBefore);
    expect(await inventoryChemical("Invalid")).toBeUndefined();
  });
});
