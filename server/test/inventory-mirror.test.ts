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
let cookie: string;
let db: ReturnType<typeof getDatabase>;

function one<T>(sql: string, ...params: unknown[]): T {
  return db.prepare(sql).get(...params) as T;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-mirror-test-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  db = getDatabase(dbPath);
  db.prepare("INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)").run(
    "uid-1",
    "admin@mirror.test",
    await argonHash("pw"),
    "Admin",
    "admin",
    "group-m",
  );
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-m', 'Mirror Lab', 'BIOS-M', 1)").run();
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-m', ?, 0)").run(
    JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] }),
  );
  const res = await request(baseUrl).post("/api/login").set(XRW).send({ email: "admin@mirror.test", password: "pw" });
  const setCookie = res.headers["set-cookie"];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("relational mirror follows API mutations", () => {
  let roomId: string;
  let contA: string;
  let contB: string;
  let shelfA1: string;
  let shelfB: string;
  let chemId: string;

  it("POST room/container/chemical populates locations/stocks/materials/batches/map", async () => {
    const roomRes = await request(baseUrl).post("/api/groups/group-m/inventory/rooms").set("Cookie", cookie).set(XRW).send({ name: "Main" });
    expect(roomRes.status).toBe(201);
    roomId = roomRes.body.tree.rooms[0].id;
    const contRes = await request(baseUrl)
      .post("/api/groups/group-m/inventory/containers")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId, name: "Fridge", type: "fridge", shelves: ["C1"] });
    expect(contRes.status).toBe(201);
    const room = contRes.body.tree.rooms[0];
    contA = room.containers[0].id;
    shelfA1 = room.containers[0].shelves[0].id;
    const chemRes = await request(baseUrl)
      .post("/api/groups/group-m/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId, containerId: contA, shelfId: shelfA1, name: "Tris base", cas: "77-86-1", formula: "C4H11NO3", quantity: 250, unit: "g" });
    expect(chemRes.status).toBe(201);
    chemId = chemRes.body.tree.rooms[0].containers[0].shelves[0].chemicals[0].id;

    expect(one<{ kind: string }>("SELECT kind FROM locations WHERE id=?", roomId).kind).toBe("room");
    expect(one<{ kind: string; parent_id: string }>("SELECT kind, parent_id FROM locations WHERE id=?", contA)).toEqual({
      kind: "container",
      parent_id: roomId,
    });
    expect(one<{ parent_id: string }>("SELECT parent_id FROM locations WHERE id=?", shelfA1).parent_id).toBe(contA);
    const stock = one<{ batch_id: string; current_quantity: number; quantity_unit: string }>(
      "SELECT * FROM stocks WHERE id=?",
      chemId,
    );
    expect(stock.batch_id).toBe(`b-${chemId}`);
    expect(stock.current_quantity).toBe(250);
    const material = one<{ name: string; attributes: string }>("SELECT * FROM materials WHERE id=?", `m-${chemId}`);
    expect(material.name).toBe("Tris base");
    expect(JSON.parse(material.attributes).cas_number).toBe("77-86-1");
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM legacy_chemical_map WHERE chemical_id=?", chemId).n).toBe(1);
  });

  it("PUT chemical edits material descriptors", async () => {
    const res = await request(baseUrl)
      .put(`/api/groups/group-m/inventory/chemicals/${chemId}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId, containerId: contA, shelfId: shelfA1, name: "Tris base ultra", cas: "77-86-1" });
    expect(res.status).toBe(200);
    expect(one<{ name: string }>("SELECT name FROM materials WHERE id=?", `m-${chemId}`).name).toBe("Tris base ultra");
  });

  it("adjust-qty updates current_quantity", async () => {
    const res = await request(baseUrl)
      .post(`/api/groups/group-m/inventory/chemicals/${chemId}/adjust-qty`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId, containerId: contA, shelfId: shelfA1, delta: -50 });
    expect(res.status).toBe(200);
    expect(one<{ q: number }>("SELECT current_quantity AS q FROM stocks WHERE id=?", chemId).q).toBe(200);
  });

  it("stock move re-parents stock location only", async () => {
    const contRes = await request(baseUrl)
      .post("/api/groups/group-m/inventory/containers")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId, name: "Cabinet", type: "cabinet", shelves: ["Top"] });
    const room = contRes.body.tree.rooms[0];
    contB = room.containers[1].id;
    shelfB = room.containers[1].shelves[0].id;
    const res = await request(baseUrl)
      .post(`/api/groups/group-m/inventory/chemicals/${chemId}/move`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ fromRoomId: roomId, fromContainerId: contA, fromShelfId: shelfA1, toRoomId: roomId, toContainerId: contB, toShelfId: shelfB });
    expect(res.status).toBe(200);
    expect(one<{ location_id: string; batch_id: string }>("SELECT location_id, batch_id FROM stocks WHERE id=?", chemId)).toEqual({
      location_id: shelfB,
      batch_id: `b-${chemId}`,
    });
  });

  it("delete removes stock/batch/material/map", async () => {
    const res = await request(baseUrl)
      .delete(`/api/groups/group-m/inventory/chemicals/${chemId}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId, containerId: contB, shelfId: shelfB });
    expect(res.status).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks WHERE id=?", chemId).n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM batches WHERE id=?", `b-${chemId}`).n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM materials WHERE id=?", `m-${chemId}`).n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM legacy_chemical_map WHERE chemical_id=?", chemId).n).toBe(0);
  });
});
