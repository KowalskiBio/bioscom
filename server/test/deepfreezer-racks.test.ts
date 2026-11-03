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
let dfId: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-dfrb-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  db = getDatabase(dbPath);
  db.prepare("INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)").run(
    "uid-1",
    "admin@dfrb.test",
    await argonHash("pw"),
    "Admin",
    "admin",
    "group-df",
  );
  db.prepare("INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)").run(
    "uid-2",
    "writer-other@dfrb.test",
    await argonHash("pw2"),
    "Other Writer",
    "admin",
    "group-other",
  );
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-df', 'DF Lab', 'DF', 1), ('group-other', 'Other Lab', 'OT', 2)").run();
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-df', ?, 0)").run(
    JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [], deepFreezers: [] }),
  );
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-other', ?, 0)").run(
    JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] }),
  );
  const res = await request(baseUrl).post("/api/login").set(XRW).send({ email: "admin@dfrb.test", password: "pw" });
  const setCookie = res.headers["set-cookie"];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";
  const create = await request(baseUrl)
    .post("/api/groups/group-df/inventory/deepfreezers")
    .set("Cookie", cookie)
    .set(XRW)
    .send({ name: "Arctic 80" });
  console.log("DF-CREATE", create.status, JSON.stringify(create.body).slice(0, 300));
  dfId = (create.body.tree.deepFreezers as Array<{ id: string }>).at(-1)!.id;
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("deep freezer racks (POST /deepfreezers/:id/racks)", () => {
  it("assigns the first free slots on creation, rejects duplicates and reports the doc update", async () => {
    const ra = await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${dfId}/racks`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ name: "A" });
    expect(ra.status).toBe(201);
    const rb = await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${dfId}/racks`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ name: "B" });
    expect(rb.status).toBe(201);
    const pos = (rb.body.tree.deepFreezers as Array<{ id: string; rackPositions: Record<string, number> }>).find((c) => c.id === dfId)!.rackPositions;
    expect(pos).toEqual({ A: 0, B: 1 });
    const dup = await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${dfId}/racks`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ name: "A" });
    expect(dup.status).toBe(400);
  });
});

describe("deep freezer boxes inside a named rack (POST /deepfreezers/:id/boxes)", () => {
  it("creates boxes with structured naming, sequential numbering and a color", async () => {
    const b1 = await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${dfId}/boxes`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ rackName: "A", color: "#ff0000" });
    expect(b1.status).toBe(201);
    const b2 = await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${dfId}/boxes`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ rackName: "A" });
    expect(b2.status).toBe(201);
    const df = (b2.body.tree.deepFreezers as Array<{ id: string; shelves: Array<{ name?: string; rackName?: string; boxName?: string; color?: string }> }>).find((c) => c.id === dfId)!;
    expect(df.shelves.map((s) => s.name)).toEqual(["Rack A / Box 1", "Rack A / Box 2"]);
    expect(df.shelves[0]!.boxName).toBe("1");
    expect(df.shelves[1]!.boxName).toBe("2");
    expect(df.shelves[0]!.color).toBe("#ff0000");
    expect(df.shelves[1]!.color).toBeUndefined();
  });

  it("404s for an unknown rack", async () => {
    const res = await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${dfId}/boxes`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ rackName: "ZZZ" });
    expect(res.status).toBe(404);
  });
});

describe("pseudo-room write facade is closed (T1-5)", () => {
  it("room-level mutations with a freezer id are 404s, not silent edits", async () => {
    const edit = await request(baseUrl)
      .put(`/api/groups/group-df/inventory/rooms/${dfId}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ name: "Tampered room name" });
    expect(edit.status).toBe(404);
    const del = await request(baseUrl)
      .delete(`/api/groups/group-df/inventory/rooms/${dfId}`)
      .set("Cookie", cookie)
      .set(XRW);
    expect(del.status).toBe(404);
    const added = await request(baseUrl)
      .post("/api/groups/group-df/inventory/containers")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: dfId, name: "Ghost Cont", type: "cabinet", shelves: ["A"] });
    expect(added.status).toBe(404);
    const doc = db.prepare("SELECT tree FROM group_inventory_docs WHERE group_id = 'group-df'").get() as { tree: string };
    expect(JSON.parse(doc.tree).deepFreezers.find((c: { id: string }) => c.id === dfId).name).not.toBe("Tampered room name");
    expect((db.prepare("SELECT COUNT(*) AS n FROM locations WHERE kind = 'container' AND name = 'Ghost Cont'").get() as { n: number }).n).toBe(0);
  });

  it("chemical placement with freezer-as-room and no container is a 404 with no ghost item", async () => {
    const post = await request(baseUrl)
      .post("/api/groups/group-df/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: dfId, name: "Ghost chem", quantity: 1 });
    expect(post.status).toBe(404);
    const bulk = await request(baseUrl)
      .post("/api/groups/group-df/inventory/bulk-import")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: dfId, items: [{ name: "Ghost bulk" }] });
    expect(JSON.stringify(bulk.body)).not.toContain('"created":1');
    const doc = db.prepare("SELECT tree FROM group_inventory_docs WHERE group_id = 'group-df'").get() as { tree: string };
    const df = JSON.parse(doc.tree).deepFreezers.find((c: { id: string }) => c.id === dfId);
    expect(JSON.stringify(df)).not.toContain("Ghost chem");
    expect(JSON.stringify(df)).not.toContain("Ghost bulk");
  });

  it("cross-lab writer is denied without mutation (403/404, state untouched)", async () => {
    const writerRes = await request(baseUrl).post("/api/login").set(XRW).send({ email: "writer-other@dfrb.test", password: "pw2" });
    const otherCookie = (Array.isArray(writerRes.headers["set-cookie"]) ? writerRes.headers["set-cookie"][0] : writerRes.headers["set-cookie"] ?? "").split(";")[0] ?? "";
    const before = (db.prepare("SELECT tree FROM group_inventory_docs WHERE group_id = 'group-df'").get() as { tree: string }).tree;
    const res = await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${dfId}/racks`)
      .set("Cookie", otherCookie)
      .set(XRW)
      .send({ name: "C" });
    expect(res.status).not.toBe(201);
    const res2 = await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${dfId}/boxes`)
      .set("Cookie", otherCookie)
      .set(XRW)
      .send({ rackName: "A" });
    expect(res2.status).not.toBe(201);
    const after = (db.prepare("SELECT tree FROM group_inventory_docs WHERE group_id = 'group-df'").get() as { tree: string }).tree;
    expect(after).toBe(before);
  });
});

describe("shared deep freezers between labs", () => {
  it("a root deep freezer shares and shows up in the receiving lab's listing", async () => {
    const share = await request(baseUrl)
      .post(`/api/groups/group-df/inventory/containers/${dfId}/share`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: dfId, sharedWithGroupId: "group-other" });
    expect(share.status).toBe(200);

    const otherRes = await request(baseUrl).post("/api/login").set(XRW).send({ email: "writer-other@dfrb.test", password: "pw2" });
    const otherCookie = (Array.isArray(otherRes.headers["set-cookie"]) ? otherRes.headers["set-cookie"][0] : otherRes.headers["set-cookie"] ?? "").split(";")[0] ?? "";
    const list = await request(baseUrl).get("/api/groups/group-other/shared-containers").set("Cookie", otherCookie);
    expect(list.status).toBe(200);
    const shared = list.body.sharedContainers as Array<{ container: { id: string }; roomId: string; roomName: string }>;
    expect(shared.some((entry) => entry.container.id === dfId)).toBe(true);
    expect(shared.find((entry) => entry.container.id === dfId)?.roomName.length).toBeGreaterThan(0);
  });
});
