import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { FastifyInstance } from "fastify";
import { hash as argonHash } from "@node-rs/argon2";
import { buildApp } from "../src/app.js";
import { closeDatabase, getDatabase } from "../src/db.js";
import { checkParity } from "../src/inventory/assemble.js";

const XRW = { "X-Requested-With": "XMLHttpRequest" };

let app: FastifyInstance;
let baseUrl: string;
let db: ReturnType<typeof getDatabase>;
let cookie: string;

function one<T>(sql: string, ...params: unknown[]): T {
  return db.prepare(sql).get(...params) as T;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-mat-test-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  db = getDatabase(dbPath);
  db.prepare("INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)").run(
    "uid-1",
    "admin@mat.test",
    await argonHash("pw"),
    "Admin",
    "admin",
    "group-m",
  );
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-m', 'Matrioshka Lab', 'M', 1)").run();
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-m', ?, 0)").run(
    JSON.stringify({
      rooms: [
        {
          id: "r-1",
          name: "Main",
          containers: [
            { id: "c-1", name: "Fridge A", type: "fridge", shelves: [{ id: "s-1", name: "Top", chemicals: [] }] },
            { id: "c-2", name: "Cabinet B", type: "cabinet", shelves: [] },
            { id: "c-3", name: "Crate X", type: "crate", shelves: [{ id: "s-3", name: "Bottom door shelf", type: "door_shelf", chemicals: [] }] },
          ],
        },
      ],
      assetRooms: [],
      assets: [],
      protocols: [],
    }),
  );
  const res = await request(baseUrl).post("/api/login").set(XRW).send({ email: "admin@mat.test", password: "pw" });
  const setCookie = res.headers["set-cookie"];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("matrioshka placements (room → container → shelf → box)", () => {
  it("place at room level (no container needed)", async () => {
    const res = await request(baseUrl)
      .post("/api/groups/group-m/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", name: "Dry bench reagent", quantity: 100, unit: "g" });
    expect(res.status).toBe(201);
    const doc = res.body.tree.rooms[0];
    expect(Array.isArray(doc.chemicals)).toBe(true);
    expect(doc.chemicals.length).toBe(1);
    const id = doc.chemicals[0].id;
    expect(one<{ location_id: string }>("SELECT location_id FROM stocks WHERE id = ?", id).location_id).toBe("r-1");
  });

  it("place directly in a container with no shelf required", async () => {
    const res = await request(baseUrl)
      .post("/api/groups/group-m/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-2", name: "Cabinet loose box", quantity: 2, unit: "pcs" });
    expect(res.status).toBe(201);
    const cont = res.body.tree.rooms[0].containers.find((c: { id: string }) => c.id === "c-2");
    expect(cont.chemicals.length).toBe(1);
    const id = cont.chemicals[0].id;
    expect(one<{ location_id: string }>("SELECT location_id FROM stocks WHERE id = ?", id).location_id).toBe("c-2");
  });

  it("place inside a shelf and inside a nested box of a crate container", async () => {
    const doc0 = db.prepare("SELECT tree FROM group_inventory_docs WHERE group_id = 'group-m'").get() as { tree: string };
    const t0 = JSON.parse(doc0.tree) as { rooms: Array<{ containers: Array<{ shelves?: Array<Record<string, unknown>>; id: string }> }> };
    const crate = t0.rooms[0]!.containers.find((c) => c.id === "c-3")!;
    const doorShelf = crate.shelves![0]!;
    expect(doorShelf.type).toBe("door_shelf");

    const boxRes = await request(baseUrl)
      .post("/api/groups/group-m/inventory/shelves")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-3", parentShelfId: "s-3", name: "Box 1", type: "box" });
    expect(boxRes.status).toBe(201);
    const boxId = boxRes.body.tree.rooms[0].containers.find((c: { id: string }) => c.id === "c-3").shelves.find((s: { type?: string }) => s.type === "box").id;

    const chemRes = await request(baseUrl)
      .post("/api/groups/group-m/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-3", shelfId: "s-3", name: "Door-level stock", quantity: 3, unit: "tubes" });
    expect(chemRes.status).toBe(201);

    const inBoxRes = await request(baseUrl)
      .post("/api/groups/group-m/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-3", shelfId: "s-3", boxId, name: "Boxed sample", quantity: 1, unit: "tube" });
    expect(inBoxRes.status).toBe(201);
    const inBoxId = inBoxRes.body.tree.rooms[0].containers.find((c: { id: string }) => c.id === "c-3").shelves.find((s: { type?: string }) => s.type === "box").chemicals[0].id;
    expect(inBoxId).toBeTruthy();
    expect(one<{ location_id: string }>("SELECT location_id FROM stocks WHERE id = ?", inBoxId).location_id).toBe(boxId);
  });

  it("mixed levels all reconcile to parity and counts across mix", () => {
    const parity = checkParity(db, "group-m");
    expect(parity).toEqual([]);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks").n).toBe(4);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM locations WHERE kind='shelf' AND container_type='box'").n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM locations WHERE kind='shelf' AND container_type='door_shelf'").n).toBe(1);
    expect(one<{ container_type: string }>("SELECT container_type FROM locations WHERE id='c-3'").container_type).toBe("crate");
  });

  it("mutations work on direct placements (edit / adjust-qty / move / delete)", async () => {
    const created = await request(baseUrl)
      .post("/api/groups/group-m/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", name: "Floating bottle", quantity: 2, unit: "pcs" });
    expect(created.status).toBe(201);
    const id = created.body.tree.rooms[0].chemicals.find((c: { name: string }) => c.name === "Floating bottle").id;

    const movedBoxId = one<{ id: string }>("SELECT id FROM locations WHERE container_type='box' LIMIT 1").id;

    const edit = await request(baseUrl)
      .put(`/api/groups/group-m/inventory/chemicals/${id}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", name: "Floating bottle renamed" });
    expect(edit.status).toBe(200);
    expect(
      one<{ name: string }>(
        "SELECT m.name FROM stocks s JOIN batches b ON b.id = s.batch_id JOIN materials m ON m.id = b.material_id WHERE s.id = ?",
        id,
      ).name,
    ).toBe("Floating bottle renamed");

    const adjust = await request(baseUrl)
      .post(`/api/groups/group-m/inventory/chemicals/${id}/adjust-qty`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", delta: -1 });
    expect(adjust.status).toBe(200);

    const boxId = movedBoxId;
    const move = await request(baseUrl)
      .post(`/api/groups/group-m/inventory/chemicals/${id}/move`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ fromRoomId: "r-1", toRoomId: "r-1", toContainerId: "c-3", toShelfId: "s-3", toBoxId: boxId });
    expect(move.status).toBe(200);
    expect(one<{ location_id: string }>("SELECT location_id FROM stocks WHERE id = ?", id).location_id).toBe(boxId);
    expect(one<{ current_quantity: number }>("SELECT current_quantity FROM stocks WHERE id = ?", id).current_quantity).toBe(1);

    const del = await request(baseUrl)
      .delete(`/api/groups/group-m/inventory/chemicals/${id}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1" });
    expect(del.status).toBe(200);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks WHERE id = ?", id).n).toBe(0);
    const parity = checkParity(db, "group-m");
    expect(parity).toEqual([]);
  });
});
