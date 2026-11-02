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
let db: ReturnType<typeof getDatabase>;
let cookie: string;

function one<T>(sql: string, ...params: unknown[]): T {
  return db.prepare(sql).get(...params) as T;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-typed-test-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  db = getDatabase(dbPath);
  db.prepare("INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)").run(
    "uid-1",
    "admin@typed.test",
    await argonHash("pw"),
    "Admin",
    "admin",
    "group-t",
  );
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-t', 'Typed Lab', 'T', 1)").run();
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-t', ?, 0)").run(
    JSON.stringify({
      rooms: [
        { id: "r-1", name: "Main", containers: [{ id: "c-1", name: "Fridge", type: "fridge", shelves: [{ id: "s-1", name: "Top", chemicals: [] }] }] },
      ],
      assetRooms: [],
      assets: [],
      protocols: [],
    }),
  );
  const res = await request(baseUrl).post("/api/login").set(XRW).send({ email: "admin@typed.test", password: "pw" });
  const setCookie = res.headers["set-cookie"];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("typed item write flows", () => {
  let antibodyId: string;

  it("creates an antibody with attributes, product and batch info; doc row + relational mirror agree", async () => {
    const res = await request(baseUrl)
      .post("/api/groups/group-t/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({
        roomId: "r-1",
        containerId: "c-1",
        shelfId: "s-1",
        name: "Anti-GAPDH",
        type: "antibody",
        attributes: { target: "GAPDH", host_species: "Rabbit", clonality: "Polyclonal" },
        product: { manufacturer: "Sigma", catalogNumber: "AB-001", productName: "GAPDH pAb" },
        batchInfo: { lotCode: "LOT-77", originType: "purchased", expiresAt: 1893456000000 },
        quantity: 80,
        unit: "uL",
      });
    expect(res.status).toBe(201);
    antibodyId = res.body.tree.rooms[0].containers[0].shelves[0].chemicals[0].id;
    const docRow = res.body.tree.rooms[0].containers[0].shelves[0].chemicals[0];
    expect(docRow.type).toBe("antibody");
    expect(docRow.attributes.host_species).toBe("Rabbit");
    expect(docRow.product.manufacturer).toBe("Sigma");
    expect(docRow.batchInfo.lotCode).toBe("LOT-77");

    const material = one<{ type_key: string; attributes: string }>(
      "SELECT type_key, attributes FROM materials WHERE id = ?",
      `m-${antibodyId}`,
    );
    expect(material.type_key).toBe("antibody");
    expect(JSON.parse(material.attributes).target).toBe("GAPDH");
    const batch = one<{ lot_code: string; origin_type: string; expires_at: number; product_id: string }>(
      "SELECT * FROM batches WHERE id = ?",
      `b-${antibodyId}`,
    );
    expect(batch.lot_code).toBe("LOT-77");
    expect(batch.origin_type).toBe("purchased");
    expect(batch.expires_at).toBe(1893456000000);
    expect(batch.product_id).toBe(`p-${antibodyId}`);
    const product = one<{ manufacturer_name: string; catalog_number: string }>(
      "SELECT * FROM products WHERE id = ?",
      `p-${antibodyId}`,
    );
    expect(product.manufacturer_name).toBe("Sigma");
    expect(product.catalog_number).toBe("AB-001");
  });

  it("rejects invalid type-specific attributes with 400 and field errors", async () => {
    const badEnum = await request(baseUrl)
      .post("/api/groups/group-t/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", name: "X", type: "antibody", attributes: { host_species: "Tiger" } });
    expect(badEnum.status).toBe(400);
    expect(badEnum.body.error).toContain("host_species");
    const badSeq = await request(baseUrl)
      .post("/api/groups/group-t/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", name: "P1", type: "primer", attributes: { sequence: "XYZ123" } });
    expect(badSeq.status).toBe(400);
    expect((await request(baseUrl)
      .post("/api/groups/group-t/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", name: "P2", type: "fungus" })).status).toBe(400);
    const stocks = one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks").n;
    expect(stocks).toBe(1);
  });

  it("rejects invalid type key on create with 400", async () => {
    const res = await request(baseUrl)
      .post("/api/groups/group-t/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", name: "Z", type: "fungus", attributes: {} });
    expect(res.status).toBe(400);
  });

  it("edit updates product/batchInfo maps; product removal prunes orphan product", async () => {
    const res = await request(baseUrl)
      .put(`/api/groups/group-t/inventory/chemicals/${antibodyId}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", batchInfo: { lotCode: "LOT-88", originType: "purchased", expiresAt: 1893456000000 }, product: null });
    expect(res.status).toBe(200);
    const batch = one<{ lot_code: string; product_id: string | null }>("SELECT * FROM batches WHERE id = ?", `b-${antibodyId}`);
    expect(batch.lot_code).toBe("LOT-88");
    expect(batch.product_id).toBeNull();
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM products WHERE id = ?", `p-${antibodyId}`).n).toBe(0);
  });

  it("edit validates merged attribute updates server-side", async () => {
    const ok = await request(baseUrl)
      .put(`/api/groups/group-t/inventory/chemicals/${antibodyId}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", attributes: { target: "GAPDH", host_species: "Mouse", clonality: "Polyclonal", conjugate: "HRP" } });
    expect(ok.status).toBe(200);
    const bad = await request(baseUrl)
      .put(`/api/groups/group-t/inventory/chemicals/${antibodyId}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", attributes: { host_species: "Camel" } });
    expect(bad.status).toBe(400);
  });

  it("type changes keep mirror consistent", async () => {
    const res = await request(baseUrl)
      .put(`/api/groups/group-t/inventory/chemicals/${antibodyId}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", type: "reagent", attributes: { application: "WB loading control" } });
    expect(res.status).toBe(200);
    expect(one<{ type_key: string }>("SELECT type_key FROM materials WHERE id = ?", `m-${antibodyId}`).type_key).toBe("reagent");
  });
});
