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
import { syncGroupInventoryDocument } from "../src/inventory/sync.js";

const XRW = { "X-Requested-With": "XMLHttpRequest" };

let app: FastifyInstance;
let baseUrl: string;
let db: ReturnType<typeof getDatabase>;
let cookie: string;

function one<T>(sql: string, ...params: unknown[]): T {
  return db.prepare(sql).get(...params) as T;
}

function treeFixture() {
  return {
    rooms: [
      {
        id: "r-1",
        name: "Main",
        containers: [
          {
            id: "c-1",
            name: "Fridge",
            type: "fridge",
            shelves: [
              {
                id: "s-1",
                name: "Top",
                chemicals: [
                  {
                    id: "ch-old",
                    name: "Tris (old bottle)",
                    cas: "77-86-1",
                    quantity: 40,
                    unit: "g",
                    product: { manufacturer: "Sigma", catalogNumber: "T999" },
                    batchInfo: { lotCode: "LOT-OLD", originType: "purchased" },
                  },
                  { id: "ch-new", name: "Tris base", cas: "77-86-1", quantity: 250, unit: "g" },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-merge-test-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  db = getDatabase(dbPath);
  db.prepare("INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)").run(
    "uid-1",
    "admin@merge.test",
    await argonHash("pw"),
    "Admin",
    "admin",
    "group-mg",
  );
  db.prepare("INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)").run(
    "uid-2",
    "reader@merge.test",
    await argonHash("pw2"),
    "Reader",
    "reader",
    "group-mg",
  );
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-mg', 'Merge Lab', 'MG', 1)").run();
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-mg', ?, 0)").run(
    JSON.stringify(treeFixture()),
  );
  syncGroupInventoryDocument(db, "group-mg", treeFixture() as never);

  const res = await request(baseUrl).post("/api/login").set(XRW).send({ email: "admin@merge.test", password: "pw" });
  const setCookie = res.headers["set-cookie"];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("POST /api/groups/:id/materials/merge", () => {
  it("rejects bad requests vigorously", async () => {
    const self = await request(baseUrl)
      .post("/api/groups/group-mg/materials/merge")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ sourceMaterialId: "m-ch-old", targetMaterialId: "m-ch-old" });
    expect(self.status).toBe(400);
    const missing = await request(baseUrl)
      .post("/api/groups/group-mg/materials/merge")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ sourceMaterialId: "m-nope", targetMaterialId: "m-ch-new" });
    expect(missing.status).toBe(404);
  });

  it("merges batches/products/stocks/linkage into target and archives source; resync does not resurrect source mapping", async () => {
    const res = await request(baseUrl)
      .post("/api/groups/group-mg/materials/merge")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ sourceMaterialId: "m-ch-old", targetMaterialId: "m-ch-new" });
    expect(res.status).toBe(200);
    expect(res.body.moved).toEqual({ products: 1, batches: 1, stocks: 1 });
    expect(res.body.source.archived).toBe(true);

    expect(one<{ archived_at: number | null }>("SELECT archived_at FROM materials WHERE id='m-ch-old'").archived_at).not.toBeNull();
    expect(one<{ product_id: string | null }>("SELECT product_id FROM batches WHERE id='b-ch-old'").product_id).toBe("p-ch-old");
    expect(one<{ material_id: string }>("SELECT material_id FROM batches WHERE id='b-ch-old'").material_id).toBe("m-ch-new");
    expect(one<{ material_id: string }>("SELECT material_id FROM products WHERE id='p-ch-old'").material_id).toBe("m-ch-new");
    expect(one<{ material_id: string }>("SELECT material_id FROM legacy_chemical_map WHERE chemical_id='ch-old'").material_id).toBe("m-ch-new");
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM history WHERE action LIKE 'Merged material%'").n).toBe(1);

    const before = one<{ name: string; attributes: string }>("SELECT name, attributes FROM materials WHERE id='m-ch-new'");
    syncGroupInventoryDocument(db, "group-mg", treeFixture() as never);
    expect(one<{ material_id: string }>("SELECT material_id FROM batches WHERE id='b-ch-old'").material_id).toBe("m-ch-new");
    expect(one<{ material_id: string }>("SELECT material_id FROM batches WHERE id='b-ch-new'").material_id).toBe("m-ch-new");
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM materials WHERE id='m-ch-new'").n).toBe(1);
    const after = one<{ name: string; attributes: string }>("SELECT name, attributes FROM materials WHERE id='m-ch-new'");
    expect(after.name).toBe(before.name);
  });

  it("rejects merging a different-typed pair and an already archived source", async () => {    db.prepare("INSERT INTO materials (id, group_id, type_key, name, created_at, updated_at) VALUES ('m-ab-1','group-mg','antibody','X','1',1)").run();
    const cross = await request(baseUrl)
      .post("/api/groups/group-mg/materials/merge")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ sourceMaterialId: "m-ab-1", targetMaterialId: "m-ch-new" });
    expect(cross.status).toBe(400);
    const again = await request(baseUrl)
      .post("/api/groups/group-mg/materials/merge")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ sourceMaterialId: "m-ch-old", targetMaterialId: "m-ch-new" });
    expect(again.status).toBe(400);
  });

  it("merged chemicals do not poison the parity check (merge-aware)", () => {
    const issues = checkParity(db, "group-mg");
    expect(
      issues.filter((i) => i.entity === "chemical" && ["ch-old", "ch-new"].includes(i.id)),
    ).toEqual([]);
  });

  it("parity still catches true location drift for non-merged chemicals", () => {
    const current = one<{ location_id: string }>("SELECT location_id FROM stocks WHERE id = 'ch-new'");
    db.prepare("UPDATE stocks SET location_id = 'c-1' WHERE id = 'ch-new'").run();
    const issues = checkParity(db, "group-mg");
    expect(issues.some((i) => i.entity === "chemical" && i.id === "ch-new" && i.kind !== "missing-in-relational")).toBe(true);
    db.prepare("UPDATE stocks SET location_id = ? WHERE id = 'ch-new'").run(current.location_id);
    expect(checkParity(db, "group-mg")).toEqual([]);
  });

  it("readers and guests are forbidden", async () => {
    const readerRes = await request(baseUrl).post("/api/login").set(XRW).send({ email: "reader@merge.test", password: "pw2" });
    const rc = (Array.isArray(readerRes.headers["set-cookie"]) ? readerRes.headers["set-cookie"][0] : readerRes.headers["set-cookie"] ?? "").split(";")[0] ?? "";
    const res = await request(baseUrl)
      .post("/api/groups/group-mg/materials/merge")
      .set("Cookie", rc)
      .set(XRW)
      .send({ sourceMaterialId: "a", targetMaterialId: "b" });
    expect(res.status).toBe(403);
    const guest = await request(baseUrl)
      .post("/api/groups/group-mg/materials/merge")
      .set(XRW)
      .send({ sourceMaterialId: "a", targetMaterialId: "b" });
    expect(guest.status).not.toBe(200);
  });
});
