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
let cookieA: string;
let cookieB: string;

const NOW = Date.now();
const SOON = NOW + 10 * 24 * 3600e3;
const LATER = NOW + 400 * 24 * 3600e3;

function seed(): void {
  const loc = db.prepare(
    "INSERT INTO locations (id, group_id, parent_id, kind, name, container_type, rack_name, box_name, sort_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1)",
  );
  loc.run("room-1", "group-a", null, "room", "Room One", null, null, null);
  loc.run("fridge-1", "group-a", "room-1", "container", "Fridge 2", "fridge", null, null);
  loc.run("shelf-b", "group-a", "fridge-1", "shelf", "B", null, null, null);
  loc.run("room-2", "group-a", null, "room", "Room Two", null, null, null);
  loc.run("cab-1", "group-a", "room-2", "container", "Cabinet", "cabinet", null, null);
  loc.run("shelf-top", "group-a", "cab-1", "shelf", "Top", null, null, null);

  const mat = db.prepare(
    "INSERT INTO materials (id, group_id, type_key, name, attributes, created_at, updated_at) VALUES (?, 'group-a', ?, ?, ?, 1, 1)",
  );
  mat.run("m-tris", "chemical", "Tris base", JSON.stringify({ cas_number: "77-86-1", molecular_formula: "C4H11NO3" }));
  mat.run("m-gapdh", "antibody", "Anti-GAPDH", JSON.stringify({ target: "GAPDH", host_species: "Rabbit", clonality: "Polyclonal" }));
  mat.run("m-pbs", "solution", "PBS 1x", JSON.stringify({ composition: "137 mM NaCl" }));
  mat.run("m-primer", "primer", "GeneX_F", JSON.stringify({ sequence: "ACGTGGATCCAAAN" }));

  db.prepare("INSERT INTO products (id, material_id, manufacturer_name, catalog_number, created_at, updated_at) VALUES ('p-tris-sigma', 'm-tris', 'Sigma', 'T123', 1, 1)").run();

  const batch = db.prepare(
    "INSERT INTO batches (id, material_id, product_id, lot_code, origin_type, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)",
  );
  batch.run("b-tris-1", "m-tris", "p-tris-sigma", "LOT-01", "purchased", LATER);
  batch.run("b-tris-2", "m-tris", null, "LOT-02", "purchased", null);
  batch.run("b-gapdh", "m-gapdh", null, "LOT-AB-7", "purchased", SOON);
  batch.run("b-pbs", "m-pbs", null, "PREP-014", "prepared", null);
  batch.run("b-primer", "m-primer", null, null, "unknown", null);

  const stock = db.prepare(
    "INSERT INTO stocks (id, group_id, batch_id, location_id, position, current_quantity, quantity_unit, status, created_at, updated_at) VALUES (?, 'group-a', ?, ?, ?, ?, ?, 'available', 1, 1)",
  );
  stock.run("st-tris-1", "b-tris-1", "shelf-b", "B1", 250, "g");
  stock.run("st-tris-2", "b-tris-2", "shelf-top", "T1", 900, "g");
  stock.run("st-gapdh", "b-gapdh", "shelf-b", "B2", 80, "uL");
  stock.run("st-pbs", "b-pbs", "shelf-b", "B3", 500, "mL");
  stock.run("st-primer", "b-primer", "shelf-top", "T2", 10, "nmol");

  db.prepare(
    "INSERT INTO materials (id, group_id, type_key, name, attributes, created_at, updated_at) VALUES ('m-foreign', 'group-b', 'chemical', 'Foreign chem', '{}', 1, 1)",
  ).run();
  db.prepare(
    "INSERT INTO batches (id, material_id, origin_type, created_at, updated_at) VALUES ('b-foreign', 'm-foreign', 'unknown', 1, 1)",
  ).run();
  db.prepare(
    "INSERT INTO stocks (id, group_id, batch_id, location_id, created_at, updated_at) VALUES ('st-foreign', 'group-b', 'b-foreign', 'shelf-b', 1, 1)",
  ).run();
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(baseUrl).post("/api/login").set(XRW).send({ email, password });
  const setCookie = res.headers["set-cookie"];
  return (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-catalog-test-"));
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
  insertUser.run("uid-a", "a@cat.test", await argonHash("pw-a"), "A", "admin", "group-a");
  insertUser.run("uid-b", "b@cat.test", await argonHash("pw-b"), "B", "admin", "group-b");
  insertUser.run("uid-r", "r@cat.test", await argonHash("pw-r"), "R", "reader", "group-a");
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-a', 'Lab A', 'A', 1), ('group-b', 'Lab B', 'B', 2)").run();
  seed();
  cookieA = await login("a@cat.test", "pw-a");
  cookieB = await login("b@cat.test", "pw-b");
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("GET /api/groups/:id/material-types", () => {
  it("serves the 7 seeded types with canonical fields", async () => {
    const res = await request(baseUrl).get("/api/groups/group-a/material-types").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body.types.map((t: { key: string }) => t.key).sort()).toEqual([
      "antibody",
      "biological_stock",
      "chemical",
      "other",
      "primer",
      "reagent",
      "solution",
    ]);
    const chem = res.body.types.find((t: { key: string }) => t.key === "chemical");
    expect(chem.fields[0]).toMatchObject({ key: "cas_number", dataType: "string" });
  });

  it("rejects unauthenticated and foreign members", async () => {
    expect((await request(baseUrl).get("/api/groups/group-a/material-types")).status).not.toBe(200);
    expect((await request(baseUrl).get("/api/groups/group-a/material-types").set("Cookie", cookieB)).status).toBe(403);
  });
});

describe("GET /api/groups/:id/materials", () => {
  it("lists catalog entries with counts and no foreign materials", async () => {
    const res = await request(baseUrl).get("/api/groups/group-a/materials").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    const names = res.body.materials.map((m: { name: string }) => m.name);
    expect(names).toEqual(["Anti-GAPDH", "GeneX_F", "PBS 1x", "Tris base"]);
    const tris = res.body.materials.find((m: { id: string }) => m.id === "m-tris");
    expect(tris.counts).toEqual({ products: 1, batches: 2, stocks: 2, locations: 2 });
  });

  it("filters by type and by name query", async () => {
    const byType = await request(baseUrl).get("/api/groups/group-a/materials?type=antibody").set("Cookie", cookieA);
    expect(byType.body.materials.map((m: { id: string }) => m.id)).toEqual(["m-gapdh"]);
    const byQuery = await request(baseUrl).get("/api/groups/group-a/materials?q=tris").set("Cookie", cookieA);
    expect(byQuery.body.total).toBe(1);
    expect(byQuery.body.materials[0].attributes.cas_number).toBe("77-86-1");
  });
});

describe("GET /api/groups/:id/materials/:materialId", () => {
  it("returns material with products, batches and physical stocks incl. location path", async () => {
    const res = await request(baseUrl).get("/api/groups/group-a/materials/m-tris").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body.material.name).toBe("Tris base");
    expect(res.body.products).toEqual([
      expect.objectContaining({ manufacturer: "Sigma", catalogNumber: "T123" }),
    ]);
    expect(res.body.batches.length).toBe(2);
    const lotBatch = res.body.batches.find((b: { lotCode: string }) => b.lotCode === "LOT-01");
    expect(lotBatch.product.manufacturer).toBe("Sigma");
    expect(res.body.stocks.length).toBe(2);
    const s1 = res.body.stocks.find((s: { id: string }) => s.id === "st-tris-1");
    expect(s1.location.path).toBe("Room One / Fridge 2 / B");
    expect(s1.batch.lotCode).toBe("LOT-01");
  });

  it("404s for foreign-group material", async () => {
    const res = await request(baseUrl).get("/api/groups/group-a/materials/m-foreign").set("Cookie", cookieA);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/groups/:id/stocks", () => {
  it("mixed location query returns all types with shared columns", async () => {
    const res = await request(baseUrl).get("/api/groups/group-a/stocks?locationId=fridge-1").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const map = Object.fromEntries(res.body.stocks.map((s: { name: string; type: string }) => [s.name, s.type]));
    expect(map).toEqual({ "Anti-GAPDH": "antibody", "PBS 1x": "solution", "Tris base": "chemical" });
    for (const row of res.body.stocks) {
      expect(row.location.path).toBe("Room One / Fridge 2 / B");
      expect(row.batch).toBeDefined();
      expect(row.status).toBe("available");
    }
  });

  it("location subtree includes descendant shelves of a room", async () => {
    const res = await request(baseUrl).get("/api/groups/group-a/stocks?locationId=room-1").set("Cookie", cookieA);
    expect(res.body.total).toBe(3);
    const res2 = await request(baseUrl).get("/api/groups/group-a/stocks?locationId=room-2").set("Cookie", cookieA);
    expect(res2.body.total).toBe(2);
  });

  it("filters by type, status and expiry window", async () => {
    const byType = await request(baseUrl).get("/api/groups/group-a/stocks?type=antibody").set("Cookie", cookieA);
    expect(byType.body.stocks.map((s: { id: string }) => s.id)).toEqual(["st-gapdh"]);
    const byExpiry = await request(baseUrl)
      .get(`/api/groups/group-a/stocks?expiresBefore=${NOW + 30 * 24 * 3600e3}`)
      .set("Cookie", cookieA);
    expect(byExpiry.body.stocks.map((s: { id: string }) => s.id)).toEqual(["st-gapdh"]);
    expect(byExpiry.body.stocks[0].batch.expiresAt).toBe(SOON);
  });

  it("searches name, cas, catalog number, lot code, sequence", async () => {
    const cases: Array<[string, string[]]> = [
      ["tris", ["st-tris-1", "st-tris-2"]],
      ["77-86-1", ["st-tris-1", "st-tris-2"]],
      ["T123", ["st-tris-1"]],
      ["LOT-02", ["st-tris-2"]],
      ["GGATCC", ["st-primer"]],
      ["GAPDH", ["st-gapdh"]],
    ];
    for (const [q, expected] of cases) {
      const res = await request(baseUrl).get(`/api/groups/group-a/stocks?q=${encodeURIComponent(q)}`).set("Cookie", cookieA);
      expect(res.body.stocks.map((s: { id: string }) => s.id).sort()).toEqual(expected.sort());
    }
  });

  it("paginates", async () => {
    const p1 = await request(baseUrl).get("/api/groups/group-a/stocks?limit=3&page=1").set("Cookie", cookieA);
    const p2 = await request(baseUrl).get("/api/groups/group-a/stocks?limit=3&page=2").set("Cookie", cookieA);
    expect(p1.body.total).toBe(5);
    expect(p1.body.stocks.length).toBe(3);
    expect(p2.body.stocks.length).toBe(2);
    const ids1 = p1.body.stocks.map((s: { id: string }) => s.id);
    const ids2 = p2.body.stocks.map((s: { id: string }) => s.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]);
  });

  it("scopes to group: foreign stocks invisible; foreign users 403", async () => {
    const mine = await request(baseUrl).get("/api/groups/group-a/stocks").set("Cookie", cookieA);
    expect(mine.body.stocks.some((s: { id: string }) => s.id === "st-foreign")).toBe(false);
    expect((await request(baseUrl).get("/api/groups/group-a/stocks").set("Cookie", cookieB)).status).toBe(403);
  });

  it("readers may read", async () => {
    const reader = await login("r@cat.test", "pw-r");
    const res = await request(baseUrl).get("/api/groups/group-a/stocks").set("Cookie", reader);
    expect(res.status).toBe(200);
  });
});
