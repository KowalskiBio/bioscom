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
  const dir = mkdtempSync(join(tmpdir(), "bioscom-df-test-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  db = getDatabase(dbPath);
  db.prepare("INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)").run(
    "uid-1",
    "admin@df.test",
    await argonHash("pw"),
    "Admin",
    "admin",
    "group-df",
  );
  db.prepare("INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)").run(
    "uid-2",
    "reader@df.test",
    await argonHash("pw2"),
    "Reader",
    "reader",
    "group-df",
  );
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-df', 'DF Lab', 'DF', 1)").run();
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-df', ?, 4)").run(
    JSON.stringify({
      rooms: [
        { id: "r-1", name: "Main lab", containers: [{ id: "c-1", name: "Fridge A", type: "fridge", shelves: [{ id: "s-1", name: "Top", chemicals: [] }] }] },
      ],
      assetRooms: [],
      assets: [],
      protocols: [],
    }),
  );
  const res = await request(baseUrl).post("/api/login").set(XRW).send({ email: "admin@df.test", password: "pw" });
  const setCookie = res.headers["set-cookie"];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("root-level deep freezers (POST /api/groups/:id/inventory/deepfreezers)", () => {
  it("creates a deep freezer as a peer of rooms, mirrored with parent NULL and parity-clean", async () => {
    const res = await request(baseUrl)
      .post("/api/groups/group-df/inventory/deepfreezers")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ name: "Tiefkuhl West", description: "Archive freezer", emoji: "❄️" });
    expect(res.status).toBe(201);

    const doc = res.body.tree as {
      rooms: Array<{ id: string; containers: Array<{ id: string }> }>;
      deepFreezers?: Array<{ id: string; name: string; type: string; shelves: unknown[] }>;
    };
    expect(doc.rooms[0]!.containers.map((c) => c.id)).toEqual(["c-1"]);
    expect(doc.deepFreezers?.length).toBe(1);
    const df = doc.deepFreezers![0]!;
    expect(df.type).toBe("deepfreezer");
    expect(df.shelves).toEqual([]);

    const row = one<{ parent_id: string | null; container_type: string }>(
      "SELECT parent_id, container_type FROM locations WHERE id = ?",
      df.id,
    );
    expect(row.parent_id).toBeNull();
    expect(row.container_type).toBe("deepfreezer");
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM history WHERE action LIKE 'Added deep freezer%'").n).toBe(1);
    expect(checkParity(db, "group-df")).toEqual([]);
  });

  it("reader cannot create a deep freezer (403)", async () => {
    const readerRes = await request(baseUrl).post("/api/login").set(XRW).send({ email: "reader@df.test", password: "pw2" });
    const rc = (Array.isArray(readerRes.headers["set-cookie"]) ? readerRes.headers["set-cookie"][0] : readerRes.headers["set-cookie"] ?? "").split(";")[0] ?? "";
    const res = await request(baseUrl)
      .post("/api/groups/group-df/inventory/deepfreezers")
      .set("Cookie", rc)
      .set(XRW)
      .send({ name: "should fail" });
    expect(res.status).toBe(403);
  });
});
