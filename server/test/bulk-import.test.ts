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
function all<T>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-bulk-test-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  db = getDatabase(dbPath);
  db.prepare("INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)").run(
    "uid-1",
    "admin@bulk.test",
    await argonHash("pw"),
    "Admin",
    "admin",
    "group-b",
  );
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-b', 'Bulk Lab', 'B', 1)").run();
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-b', ?, 0)").run(
    JSON.stringify({
      rooms: [{ id: "r-1", name: "Main", containers: [{ id: "c-1", name: "Fridge", type: "fridge", shelves: [{ id: "s-1", name: "Top", chemicals: [] }] }] }],
      assetRooms: [],
      assets: [],
      protocols: [],
    }),
  );
  const res = await request(baseUrl).post("/api/login").set(XRW).send({ email: "admin@bulk.test", password: "pw" });
  const setCookie = res.headers["set-cookie"];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("POST /api/groups/:id/inventory/bulk-import", () => {
  it("imports valid rows into doc + relational mirror in one mutation, reports and skips invalid ones", async () => {
    const res = await request(baseUrl)
      .post("/api/groups/group-b/inventory/bulk-import")
      .set("Cookie", cookie)
      .set(XRW)
      .send({
        roomId: "r-1",
        containerId: "c-1",
        shelfId: "s-1",
        items: [
          { name: "Tris base", cas: "77-86-1", quantity: 250, unit: "g" },
          { name: "Anti-GAPDH", type: "antibody", attributes: { target: "GAPDH", host_species: "Rabbit" }, product: { manufacturer: "Sigma", catalogNumber: "AB-001" }, batchInfo: { lotCode: "LOT-1", originType: "purchased" } },
          { name: "PBS 1x", type: "solution", attributes: { ph: 7.4 }, quantity: 500, unit: "mL" },
          { name: "Tiger ab", type: "antibody", attributes: { host_species: "Tiger" } },
          { name: "Fungus jar", type: "fungus" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(3);
    expect(res.body.skipped.length).toBe(2);
    expect(res.body.skipped[0].name).toBe("Tiger ab");
    expect(res.body.skipped[1].name).toBe("Fungus jar");

    const doc = one<{ tree: string }>("SELECT tree FROM group_inventory_docs WHERE group_id='group-b'");
    const chems = (JSON.parse(doc.tree) as { rooms: Array<{ containers: Array<{ shelves: Array<{ chemicals: unknown[] }> }> }> }).rooms[0]!.containers[0]!.shelves[0]!.chemicals;
    expect(chems.length).toBe(3);

    expect(all<{ name: string }>("SELECT name FROM materials WHERE group_id='group-b' ORDER BY name").map((r) => r.name)).toEqual([
      "Anti-GAPDH",
      "PBS 1x",
      "Tris base",
    ]);
    const gapdh = one<{ name: string; type_key: string }>("SELECT name, type_key FROM materials WHERE name='Anti-GAPDH'");
    expect(gapdh.type_key).toBe("antibody");
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM products WHERE catalog_number='AB-001'").n).toBe(1);
    expect(one<{ lot_code: string }>("SELECT b.lot_code FROM batches b JOIN materials m ON m.id=b.material_id WHERE m.name='Anti-GAPDH'").lot_code).toBe("LOT-1");
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks").n).toBe(3);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM legacy_chemical_map").n).toBe(3);
  });

  it("fully-invalid payloads short-circuit with zero created and no side effects", async () => {
    const res = await request(baseUrl)
      .post("/api/groups/group-b/inventory/bulk-import")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", items: [{ name: "bad", type: "fungus" }] });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM stocks").n).toBe(3);
  });

  it("rejects wrong shelf, wrong group writer and payload schema violations", async () => {
    const wrongShelf = await request(baseUrl)
      .post("/api/groups/group-b/inventory/bulk-import")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "nope", items: [{ name: "x" }] });
    expect(wrongShelf.status).toBe(404);
    const schemaBad = await request(baseUrl)
      .post("/api/groups/group-b/inventory/bulk-import")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: "r-1", containerId: "c-1", shelfId: "s-1", items: [] });
    expect(schemaBad.status).toBe(400);
  });
});
