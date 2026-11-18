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
  const dir = mkdtempSync(join(tmpdir(), "bioscom-barcode-test-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  db = getDatabase(dbPath);
  db.prepare("INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)").run(
    "uid-1",
    "admin@bc.test",
    await argonHash("pw"),
    "Admin",
    "admin",
    "group-bc",
  );
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-bc', 'BC Lab', 'BC', 1)").run();
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-bc', ?, 0)").run(
    JSON.stringify({
      rooms: [{ id: "r-1", name: "Main", containers: [{ id: "c-1", name: "Fridge", type: "freezer", shelves: [{ id: "s-1", name: "Top", chemicals: [] }] }] }],
      deepFreezers: [
        {
          id: "df-root-1",
          name: "Root DF",
          type: "deepfreezer",
          sharedWithGroupIds: [],
          rackPositions: { A: 0 },
          shelves: [{ id: "df-box-1", name: "Rack A / Box 1", rackName: "A", boxName: "1", chemicals: [{ id: "df-chem-1", name: "Frozen vial", barcode: "BSC-FREEZER-1" }] }],
        },
      ],
      assetRooms: [],
      assets: [],
      protocols: [],
    }),
  );
  const res = await request(baseUrl).post("/api/login").set(XRW).send({ email: "admin@bc.test", password: "pw" });
  const setCookie = res.headers["set-cookie"];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("stock barcodes", () => {
  let chemId: string;

  it("create with barcode mirrors into stocks.barcode and searchable stocks", async () => {
    const res = await request(baseUrl)
      .post("/api/groups/group-bc/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", name: "Tris S-42", barcode: "BSC-0001", quantity: 100, unit: "g" });
    expect(res.status).toBe(201);
    chemId = res.body.tree.rooms[0].containers[0].shelves[0].chemicals[0].id;
    expect(one<{ barcode: string }>("SELECT barcode FROM stocks WHERE id = ?", chemId).barcode).toBe("BSC-0001");
    const search = await request(baseUrl).get("/api/groups/group-bc/stocks?q=BSC-0001").set("Cookie", cookie);
    expect(search.status).toBe(200);
    expect(search.body.stocks.length).toBe(1);
    expect(search.body.stocks[0].id).toBe(chemId);
    expect(search.body.stocks[0].barcode).toBe("BSC-0001");
    expect(checkParity(db, "group-bc")).toEqual([]);
  });

  it("duplicate barcode is rejected on create with the owner name", async () => {
    const res = await request(baseUrl)
      .post("/api/groups/group-bc/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", name: "Another Tris", barcode: "BSC-0001" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("BSC-0001");
    expect(res.body.error).toContain("Tris S-42");
  });

  it("edit sets, changes and clears barcode; duplicates rejected on edit", async () => {
    const res2 = await request(baseUrl)
      .post("/api/groups/group-bc/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", name: "Second chem", barcode: "BSC-0002" });
    const secondId = res2.body.tree.rooms[0].containers[0].shelves[0].chemicals[1].id;
    const dup = await request(baseUrl)
      .put(`/api/groups/group-bc/inventory/chemicals/${chemId}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", barcode: "BSC-0002" });
    expect(dup.status).toBe(400);
    const ok = await request(baseUrl)
      .put(`/api/groups/group-bc/inventory/chemicals/${chemId}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", barcode: "BSC-0042" });
    expect(ok.status).toBe(200);
    expect(one<{ barcode: string }>("SELECT barcode FROM stocks WHERE id = ?", chemId).barcode).toBe("BSC-0042");
    const clear = await request(baseUrl)
      .put(`/api/groups/group-bc/inventory/chemicals/${chemId}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", barcode: "" });
    expect(clear.status).toBe(200);
    expect(one<{ barcode: string | null }>("SELECT barcode FROM stocks WHERE id = ?", chemId).barcode).toBeNull();
    expect(checkParity(db, "group-bc")).toEqual([]);
    void secondId;
  });

  it("bulk import skips doc-owner and payload-duplicate barcodes with reasons", async () => {
    const res = await request(baseUrl)
      .post("/api/groups/group-bc/inventory/bulk-import")
      .set("Cookie", cookie)
      .set(XRW)
      .send({
        roomId: "r-1",
        containerId: "c-1",
        shelfId: "s-1",
        items: [
          { name: "Fresh A", barcode: "BSC-0100" },
          { name: "ClashDoc", barcode: "BSC-0002" },
          { name: "ClashPayload", barcode: "BSC-0100" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.skipped.length).toBe(2);
    expect(res.body.skipped.map((s: { name: string }) => s.name).sort()).toEqual(["ClashDoc", "ClashPayload"]);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks WHERE barcode = 'BSC-0100'").n).toBe(1);
  });
});
