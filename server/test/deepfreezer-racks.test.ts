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

interface FreezerView {
  id: string;
  name: string;
  rackRows?: number;
  rackColumns?: number;
  rackShelves?: number;
  rackPositions?: Record<string, number>;
  shelves?: Array<{
    id: string;
    name?: string;
    rackName?: string;
    boxName?: string;
    rackShelf?: number;
    chemicals?: Array<{ id: string; name?: string }>;
  }>;
}

function readFreezer(body: { tree?: { deepFreezers?: FreezerView[] } }, id: string): FreezerView {
  return (body.tree?.deepFreezers ?? []).find((candidate) => candidate.id === id)!;
}

function docState(): { version: number; tree: string } {
  return db.prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = 'group-df'").get() as {
    version: number;
    tree: string;
  };
}

async function createGridFreezer(
  name: string,
  rackRows: number,
  rackColumns: number,
  rackShelves?: number,
): Promise<FreezerView> {
  const res = await request(baseUrl)
    .post("/api/groups/group-df/inventory/deepfreezers")
    .set("Cookie", cookie)
    .set(XRW)
    .send(rackShelves === undefined ? { name, rackRows, rackColumns } : { name, rackRows, rackColumns, rackShelves });
  expect(res.status).toBe(201);
  const freezers = (res.body as { tree: { deepFreezers: FreezerView[] } }).tree.deepFreezers;
  return freezers.at(-1)!;
}

function addRack(freezerId: string, name: string, slot?: number) {
  return request(baseUrl)
    .post(`/api/groups/group-df/inventory/deepfreezers/${freezerId}/racks`)
    .set("Cookie", cookie)
    .set(XRW)
    .send(slot === undefined ? { name } : { name, slot });
}

function moveRack(freezerId: string, rackName: string, slot: number) {
  return request(baseUrl)
    .post(`/api/groups/group-df/inventory/deepfreezers/${freezerId}/racks/${rackName}/move`)
    .set("Cookie", cookie)
    .set(XRW)
    .send({ slot });
}

function resizeFreezer(freezerId: string, rackRows: number, rackColumns: number, rackShelves?: number) {
  return request(baseUrl)
    .put(`/api/groups/group-df/inventory/deepfreezers/${freezerId}`)
    .set("Cookie", cookie)
    .set(XRW)
    .send(rackShelves === undefined ? { rackRows, rackColumns } : { rackRows, rackColumns, rackShelves });
}

function addBox(freezerId: string, rackName: string) {
  return request(baseUrl)
    .post(`/api/groups/group-df/inventory/deepfreezers/${freezerId}/boxes`)
    .set("Cookie", cookie)
    .set(XRW)
    .send({ rackName });
}

function moveBox(freezerId: string, boxId: string, shelf: number) {
  return request(baseUrl)
    .post(`/api/groups/group-df/inventory/deepfreezers/${freezerId}/boxes/${boxId}/move`)
    .set("Cookie", cookie)
    .set(XRW)
    .send({ shelf });
}

describe("deep freezer grid layout (slots, move and resize)", () => {
  it("auto-assigns first free slots inside a larger custom grid and reports full", async () => {
    const freezer = await createGridFreezer("Grid Auto", 2, 3);
    expect(freezer.rackRows).toBe(2);
    expect(freezer.rackColumns).toBe(3);

    let lastResponse: { body: unknown } | null = null;
    for (const name of ["A", "B", "C", "D", "E", "F"]) {
      const res = await addRack(freezer.id, name);
      expect(res.status).toBe(201);
      lastResponse = res;
    }
    const filled = readFreezer(lastResponse!.body as never, freezer.id);
    expect(filled.rackPositions).toEqual({ A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 });
    expect((await addRack(freezer.id, "G")).status).toBe(409);
  });

  it("honours an explicit free slot and rejects bounds or collisions without mutation", async () => {
    const freezer = await createGridFreezer("Grid Explicit", 2, 2);
    expect((await addRack(freezer.id, "A")).status).toBe(201);
    const placed = await addRack(freezer.id, "B", 3);
    expect(placed.status).toBe(201);
    expect(readFreezer(placed.body as never, freezer.id).rackPositions).toEqual({ A: 0, B: 3 });

    const before = docState();
    const outOfBounds = await addRack(freezer.id, "C", 4);
    expect(outOfBounds.status).toBe(409);
    expect(docState()).toEqual(before);

    const collision = await addRack(freezer.id, "C", 0);
    expect(collision.status).toBe(409);
    expect(docState()).toEqual(before);

    const negative = await addRack(freezer.id, "C", -1);
    expect(negative.status).toBe(400);
    expect(docState()).toEqual(before);

    const accepted = await addRack(freezer.id, "C", 2);
    expect(accepted.status).toBe(201);
    expect(readFreezer(accepted.body as never, freezer.id).rackPositions).toEqual({ A: 0, B: 3, C: 2 });
  });

  it("moves a rack to a free slot, no-ops on the same slot, and rejects conflicts/missing racks", async () => {
    const freezer = await createGridFreezer("Grid Move", 2, 2);
    await addRack(freezer.id, "A");
    await addRack(freezer.id, "B");

    const moved = await moveRack(freezer.id, "A", 2);
    expect(moved.status).toBe(200);
    expect(readFreezer(moved.body as never, freezer.id).rackPositions).toEqual({ A: 2, B: 1 });

    const versionAfterMove = docState().version;
    const historyAfterMove = (db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n;
    const noop = await moveRack(freezer.id, "A", 2);
    expect(noop.status).toBe(200);
    expect(docState().version).toBe(versionAfterMove);
    expect((db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n).toBe(historyAfterMove);

    const conflict = await moveRack(freezer.id, "A", 1);
    expect(conflict.status).toBe(409);
    expect(docState().version).toBe(versionAfterMove);
    expect(readFreezer((await request(baseUrl).get("/api/groups/group-df/inventory").set("Cookie", cookie)).body as never, freezer.id).rackPositions).toEqual({
      A: 2,
      B: 1,
    });

    expect((await moveRack(freezer.id, "Missing", 0)).status).toBe(404);
    expect((await moveRack(freezer.id, "A", 4)).status).toBe(409);
    expect((await moveRack(freezer.id, "A", -1)).status).toBe(400);
    expect((await moveRack(freezer.id, "A", 1.5)).status).toBe(400);
    expect((await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${freezer.id}/racks/A/move`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({})).status).toBe(400);
  });

  it("rejects a shrink that cannot fit current racks and preserves shelves, placements and history", async () => {
    const freezer = await createGridFreezer("Grid Shrink", 2, 2);
    for (const [name, slot] of [["A", 0], ["B", 1], ["C", 2], ["D", 3]] as const) {
      expect((await addRack(freezer.id, name, slot)).status).toBe(201);
    }
    const box = await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${freezer.id}/boxes`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ rackName: "A" });
    expect(box.status).toBe(201);

    const before = docState();
    const historyBefore = (db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n;
    const res = await resizeFreezer(freezer.id, 1, 2);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("slot 2");
    expect(docState()).toEqual(before);
    expect((db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n).toBe(historyBefore);
    const unchanged = readFreezer({ tree: JSON.parse(before.tree) as { deepFreezers?: FreezerView[] } }, freezer.id);
    expect(unchanged.rackRows).toBe(2);
    expect(unchanged.rackColumns).toBe(2);
    expect(unchanged.rackPositions).toEqual({ A: 0, B: 1, C: 2, D: 3 });
    expect(unchanged.shelves).toHaveLength(1);
  });

  it("expands safely, retains every index and persists dimensions to the relational mirror", async () => {
    const freezer = await createGridFreezer("Grid Expand", 2, 2);
    await addRack(freezer.id, "A", 0);
    await addRack(freezer.id, "B", 3);

    expect((await resizeFreezer(freezer.id, 0, 4)).status).toBe(400);
    expect((await resizeFreezer(freezer.id, 4, 0)).status).toBe(400);
    expect((await resizeFreezer(freezer.id, 33, 4)).status).toBe(400);
    expect((await resizeFreezer(freezer.id, 4, 33)).status).toBe(400);
    expect((await request(baseUrl)
      .put(`/api/groups/group-df/inventory/deepfreezers/${freezer.id}`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({ rackRows: 4 })).status).toBe(400);

    const res = await resizeFreezer(freezer.id, 4, 4);
    expect(res.status).toBe(200);
    const expanded = readFreezer(res.body as never, freezer.id);
    expect(expanded.rackRows).toBe(4);
    expect(expanded.rackColumns).toBe(4);
    expect(expanded.rackPositions).toEqual({ A: 0, B: 3 });
    const row = db.prepare("SELECT rack_rows, rack_columns FROM locations WHERE id = ?").get(freezer.id) as {
      rack_rows: number;
      rack_columns: number;
    };
    expect(row).toEqual({ rack_rows: 4, rack_columns: 4 });

    const next = await addRack(freezer.id, "C");
    expect(next.status).toBe(201);
    expect(readFreezer(next.body as never, freezer.id).rackPositions).toEqual({ A: 0, B: 3, C: 1 });
  });

  it("keeps reader and cross-lab writers out of move and resize", async () => {
    const freezer = await createGridFreezer("Grid Guard", 2, 2);
    await addRack(freezer.id, "A");

    db.prepare(
      "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
    ).run("uid-reader-dfrb", "reader@dfrb.test", await argonHash("pwr"), "Reader", "reader", "group-df");
    const readerLogin = await request(baseUrl).post("/api/login").set(XRW).send({ email: "reader@dfrb.test", password: "pwr" });
    const readerCookie = (Array.isArray(readerLogin.headers["set-cookie"]) ? readerLogin.headers["set-cookie"][0] : readerLogin.headers["set-cookie"] ?? "").split(";")[0] ?? "";
    expect((await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${freezer.id}/racks/A/move`)
      .set("Cookie", readerCookie)
      .set(XRW)
      .send({ slot: 1 })).status).toBe(403);
    expect((await request(baseUrl)
      .put(`/api/groups/group-df/inventory/deepfreezers/${freezer.id}`)
      .set("Cookie", readerCookie)
      .set(XRW)
      .send({ rackRows: 4, rackColumns: 4 })).status).toBe(403);

    const writerLogin = await request(baseUrl).post("/api/login").set(XRW).send({ email: "writer-other@dfrb.test", password: "pw2" });
    const writerCookie = (Array.isArray(writerLogin.headers["set-cookie"]) ? writerLogin.headers["set-cookie"][0] : writerLogin.headers["set-cookie"] ?? "").split(";")[0] ?? "";
    const before = docState();
    expect((await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${freezer.id}/racks/A/move`)
      .set("Cookie", writerCookie)
      .set(XRW)
      .send({ slot: 1 })).status).not.toBe(200);
    expect((await request(baseUrl)
      .put(`/api/groups/group-df/inventory/deepfreezers/${freezer.id}`)
      .set("Cookie", writerCookie)
      .set(XRW)
      .send({ rackRows: 4, rackColumns: 4 })).status).not.toBe(200);
    expect(docState()).toEqual(before);
  });
});

interface BoxShelfView {
  id: string;
  name?: string;
  rackName?: string;
  boxName?: string;
  rackShelf?: number;
  chemicals?: Array<{ id: string; name?: string }>;
}

function boxesOf(freezer: FreezerView): BoxShelfView[] {
  return freezer.shelves ?? [];
}

describe("deep freezer box shelf positions", () => {
  it("assigns the first free shelf per rack and rejects a full rack without history", async () => {
    const freezer = await createGridFreezer("Box Slots", 2, 2, 3);
    await addRack(freezer.id, "A");
    const first = await addBox(freezer.id, "A");
    const second = await addBox(freezer.id, "A");
    const third = await addBox(freezer.id, "A");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(201);
    const filled = readFreezer(third.body as never, freezer.id);
    expect(filled.rackShelves).toBe(3);
    expect(boxesOf(filled).map((box) => box.boxName)).toEqual(["1", "2", "3"]);
    expect(boxesOf(filled).map((box) => box.rackShelf)).toEqual([1, 2, 3]);

    const before = docState();
    const historyBefore = (db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n;
    const full = await addBox(freezer.id, "A");
    expect(full.status).toBe(409);
    expect(JSON.stringify(full.body)).toContain("no free shelf position");
    expect(docState()).toEqual(before);
    expect((db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n).toBe(historyBefore);
  });

  it("enforces shelf count even when a legacy custom-named box has no assignment", async () => {
    const freezer = await createGridFreezer("Box Legacy Capacity", 2, 2, 1);
    await addRack(freezer.id, "A");
    expect((await addBox(freezer.id, "A")).status).toBe(201);
    const current = (await request(baseUrl).get("/api/groups/group-df/inventory").set("Cookie", cookie)).body as {
      tree: { deepFreezers: Array<{ id: string; shelves: Array<Record<string, unknown>> }> };
    };
    const legacy = current.tree.deepFreezers.find((candidate) => candidate.id === freezer.id)!.shelves.find(
      (candidate) => candidate.rackName === "A",
    )!;
    legacy.boxName = "Legacy Beta";
    delete legacy.rackShelf;
    db.prepare("UPDATE group_inventory_docs SET tree = ?, version = version + 1 WHERE group_id = 'group-df'").run(JSON.stringify(current.tree));

    const before = docState();
    const historyBefore = (db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n;
    expect((await addBox(freezer.id, "A")).status).toBe(409);
    expect(docState()).toEqual(before);
    expect((db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n).toBe(historyBefore);
  });

  it("moves a box between shelves while preserving its identity, rack and chemicals", async () => {
    const freezer = await createGridFreezer("Box Move", 2, 2, 3);
    await addRack(freezer.id, "A");
    const first = await addBox(freezer.id, "A");
    await addBox(freezer.id, "A");
    const original = boxesOf(readFreezer(first.body as never, freezer.id))[0]!;
    const chemical = await request(baseUrl)
      .post("/api/groups/group-df/inventory/chemicals")
      .set("Cookie", cookie)
      .set(XRW)
      .send({ roomId: freezer.id, containerId: freezer.id, shelfId: original.id, name: "Glycerol stock", quantity: 2 });
    expect(chemical.status).toBe(201);

    const moved = await moveBox(freezer.id, original.id, 3);
    expect(moved.status).toBe(200);
    const box = boxesOf(readFreezer(moved.body as never, freezer.id)).find((candidate) => candidate.id === original.id)!;
    expect(box.rackShelf).toBe(3);
    expect(box.rackName).toBe("A");
    expect(box.boxName).toBe("1");
    expect(box.name).toBe(original.name);
    expect(box.chemicals?.map((entry) => entry.name)).toContain("Glycerol stock");
    const other = boxesOf(readFreezer(moved.body as never, freezer.id)).find((candidate) => candidate.id !== original.id)!;
    expect(other.rackShelf).toBe(2);

    const versionAfterMove = docState().version;
    const historyAfterMove = (db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n;
    const noop = await moveBox(freezer.id, original.id, 3);
    expect(noop.status).toBe(200);
    expect(docState().version).toBe(versionAfterMove);
    expect((db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n).toBe(historyAfterMove);
  });

  it("rejects collisions, out-of-range shelves and unknown boxes without mutation", async () => {
    const freezer = await createGridFreezer("Box Reject", 2, 2, 2);
    await addRack(freezer.id, "A");
    const first = await addBox(freezer.id, "A");
    await addBox(freezer.id, "A");
    const box = boxesOf(readFreezer(first.body as never, freezer.id))[0]!;

    const before = docState();
    const historyBefore = (db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n;
    expect((await moveBox(freezer.id, box.id, 2)).status).toBe(409);
    expect((await moveBox(freezer.id, box.id, 3)).status).toBe(409);
    expect((await moveBox(freezer.id, box.id, 0)).status).toBe(400);
    expect((await moveBox(freezer.id, box.id, 1.5)).status).toBe(400);
    expect((await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${freezer.id}/boxes/${box.id}/move`)
      .set("Cookie", cookie)
      .set(XRW)
      .send({})).status).toBe(400);
    expect((await moveBox(freezer.id, "missing-box", 1)).status).toBe(404);
    expect((await moveBox("missing-freezer", box.id, 1)).status).toBe(404);
    expect(docState()).toEqual(before);
    expect((db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n).toBe(historyBefore);
    const unchanged = boxesOf(readFreezer({ tree: JSON.parse(before.tree) }, freezer.id));
    expect(unchanged.map((entry) => entry.rackShelf)).toEqual([1, 2]);
  });

  it("rejects a shrink that cannot fit boxes and expands safely without renumbering", async () => {
    const freezer = await createGridFreezer("Box Resize", 2, 2, 4);
    await addRack(freezer.id, "A");
    await addRack(freezer.id, "B");
    for (let index = 0; index < 3; index += 1) expect((await addBox(freezer.id, "A")).status).toBe(201);
    for (let index = 0; index < 2; index += 1) expect((await addBox(freezer.id, "B")).status).toBe(201);

    const before = docState();
    const historyBefore = (db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n;
    const shrink = await resizeFreezer(freezer.id, 2, 2, 2);
    expect(shrink.status).toBe(409);
    expect(JSON.stringify(shrink.body)).toContain("has 3 boxes but only 2 shelf positions");
    expect(docState()).toEqual(before);
    expect((db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-df'").get() as { n: number }).n).toBe(historyBefore);
    const unchanged = readFreezer({ tree: JSON.parse(before.tree) }, freezer.id);
    expect(unchanged.rackShelves).toBe(4);
    expect(boxesOf(unchanged)).toHaveLength(5);

    const expand = await resizeFreezer(freezer.id, 2, 2, 6);
    expect(expand.status).toBe(200);
    const expanded = readFreezer(expand.body as never, freezer.id);
    expect(expanded.rackShelves).toBe(6);
    expect(boxesOf(expanded).map((box) => box.rackShelf)).toEqual([1, 2, 3, 1, 2]);
    expect(boxesOf(expanded).map((box) => box.boxName)).toEqual(["1", "2", "3", "1", "2"]);
    const row = db.prepare("SELECT rack_shelves FROM locations WHERE id = ?").get(freezer.id) as { rack_shelves: number | null };
    expect(row.rack_shelves).toBe(6);
    expect(checkParity(db, "group-df")).toEqual([]);
  });

  it("validates shelf capacity per rack rather than across the whole freezer", async () => {
    const freezer = await createGridFreezer("Box Per Rack", 2, 2, 3);
    await addRack(freezer.id, "A");
    await addRack(freezer.id, "B");
    for (let index = 0; index < 2; index += 1) expect((await addBox(freezer.id, "A")).status).toBe(201);
    for (let index = 0; index < 2; index += 1) expect((await addBox(freezer.id, "B")).status).toBe(201);

    const resized = await resizeFreezer(freezer.id, 2, 2, 2);
    expect(resized.status).toBe(200);
    expect(readFreezer(resized.body as never, freezer.id).rackShelves).toBe(2);
    expect((await addBox(freezer.id, "A")).status).toBe(409);
    expect((await addBox(freezer.id, "B")).status).toBe(409);
  });

  it("uses 13 shelves by default while leaving missing metadata unmodified", async () => {
    const freezer = await createGridFreezer("Box Legacy Default", 2, 2);
    expect(freezer.rackShelves).toBeUndefined();
    await addRack(freezer.id, "A");
    let response: { body: unknown } | null = null;
    for (let index = 1; index <= 13; index += 1) {
      const added = await addBox(freezer.id, "A");
      expect(added.status).toBe(201);
      response = added;
    }
    const filled = readFreezer(response!.body as never, freezer.id);
    expect(boxesOf(filled).map((box) => box.rackShelf)).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
    expect(filled.rackShelves).toBeUndefined();
    expect((await addBox(freezer.id, "A")).status).toBe(409);
    const row = db.prepare("SELECT rack_shelves FROM locations WHERE id = ?").get(freezer.id) as { rack_shelves: number | null };
    expect(row.rack_shelves).toBeNull();
    expect(checkParity(db, "group-df")).toEqual([]);
  });

  it("keeps readers and cross-lab writers out of box moves", async () => {
    const freezer = await createGridFreezer("Box Guard", 2, 2, 3);
    await addRack(freezer.id, "A");
    const first = await addBox(freezer.id, "A");
    await addBox(freezer.id, "A");
    const box = boxesOf(readFreezer(first.body as never, freezer.id))[0]!;

    db.prepare(
      "INSERT OR IGNORE INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
    ).run("uid-reader-boxrb", "reader-box@dfrb.test", await argonHash("pwr"), "Reader", "reader", "group-df");
    const readerLogin = await request(baseUrl).post("/api/login").set(XRW).send({ email: "reader-box@dfrb.test", password: "pwr" });
    const readerCookie = (Array.isArray(readerLogin.headers["set-cookie"]) ? readerLogin.headers["set-cookie"][0] : readerLogin.headers["set-cookie"] ?? "").split(";")[0] ?? "";
    expect((await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${freezer.id}/boxes/${box.id}/move`)
      .set("Cookie", readerCookie)
      .set(XRW)
      .send({ shelf: 3 })).status).toBe(403);

    const writerLogin = await request(baseUrl).post("/api/login").set(XRW).send({ email: "writer-other@dfrb.test", password: "pw2" });
    const writerCookie = (Array.isArray(writerLogin.headers["set-cookie"]) ? writerLogin.headers["set-cookie"][0] : writerLogin.headers["set-cookie"] ?? "").split(";")[0] ?? "";
    const before = docState();
    expect((await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${freezer.id}/boxes/${box.id}/move`)
      .set("Cookie", writerCookie)
      .set(XRW)
      .send({ shelf: 3 })).status).not.toBe(200);
    expect(docState()).toEqual(before);
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

    const moved = await request(baseUrl)
      .post(`/api/groups/group-df/inventory/deepfreezers/${dfId}/racks/A/move`)
      .set("Cookie", otherCookie)
      .set(XRW)
      .send({ slot: 5 });
    expect(moved.status).toBe(200);
    const resized = await request(baseUrl)
      .put(`/api/groups/group-df/inventory/deepfreezers/${dfId}`)
      .set("Cookie", otherCookie)
      .set(XRW)
      .send({ rackRows: 8, rackColumns: 8 });
    expect(resized.status).toBe(200);
    const ownerTree = JSON.parse(
      (db.prepare("SELECT tree FROM group_inventory_docs WHERE group_id = 'group-df'").get() as { tree: string }).tree,
    ) as { deepFreezers?: FreezerView[] };
    const ownerFreezer = readFreezer({ tree: ownerTree }, dfId);
    expect(ownerFreezer.rackRows).toBe(8);
    expect(ownerFreezer.rackColumns).toBe(8);
    expect(ownerFreezer.rackPositions).toEqual({ A: 5, B: 1 });
  });
});
