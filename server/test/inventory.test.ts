import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { FastifyInstance } from "fastify";
import { hash as argonHash } from "@node-rs/argon2";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
import { closeDatabase, getDatabase } from "../src/db.js";

const XRW = { "X-Requested-With": "XMLHttpRequest" };

let app: FastifyInstance;
let baseUrl: string;
let dbPath: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(baseUrl).post("/api/login").set(XRW).send({ email, password });
  if (response.status !== 200) {
    throw new Error(`login failed for ${email}: ${response.status}`);
  }
  const setCookie = response.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (first ?? "").split(";")[0] ?? "";
}

interface InventoryState {
  version: number;
  tree: {
    rooms: Array<{
      id: string;
      name: string;
      chemicals?: Array<{
        id: string;
        name: string;
        cas?: string;
        quantity?: number;
        unit?: string;
        position?: string;
        customPosition?: string;
      }>;
      containers: Array<{
        id: string;
        name: string;
        chemicals?: Array<{ id: string; name: string; position?: string; customPosition?: string }>;
        shelves: Array<{
          id: string;
          name: string;
          chemicals: Array<{ id: string; name: string; position?: string; customPosition?: string; quantity?: number }>;
        }>;
      }>;
    }>;
  };
}

let ownerCookie: string;
let otherCookie: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-inventory-test-"));
  dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000, compressThreshold: 0 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("no address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  const db = getDatabase(dbPath);
  const insertUser = db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  );
  insertUser.run("uid-inv-owner", "owner@inv.test", await argonHash("owner-password"), "Owner", "admin", "group-a");
  insertUser.run("uid-inv-other", "other@inv.test", await argonHash("other-password"), "Other", "admin", "group-b");
  const insertGroup = db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)");
  insertGroup.run("group-a", "Lab A", "BIOS-101", Date.now());
  insertGroup.run("group-b", "Lab B", "BIOS-102", Date.now());
  const emptyTree = JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] });
  const insertDoc = db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)");
  insertDoc.run("group-a", emptyTree);
  insertDoc.run("group-b", emptyTree);
  ownerCookie = await login("owner@inv.test", "owner-password");
  otherCookie = await login("other@inv.test", "other-password");
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("GET /api/groups/:id/inventory", () => {
  it("returns the typed tree for a member", async () => {
    const response = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", ownerCookie);
    expect(response.status).toBe(200);
    expect(response.body.version).toBe(0);
    expect(response.body.tree.rooms).toEqual([]);
  });

  it("rejects non-members with 403", async () => {
    const response = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", otherCookie);
    expect(response.status).toBe(403);
  });

  it("compresses the tree payload when the client accepts gzip", async () => {
    const response = await request(baseUrl)
      .get("/api/groups/group-a/inventory")
      .set("Cookie", ownerCookie)
      .set("accept-encoding", "gzip");
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.body.tree.rooms).toEqual([]);
  });
});

describe("room ops", () => {
  it("adds, edits and deletes a room with version bumps and history rows", async () => {
    const add = await request(baseUrl)
      .post("/api/groups/group-a/inventory/rooms")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ name: "Cold Room", description: "4C" });
    expect(add.status).toBe(201);
    const added = add.body as InventoryState;
    expect(added.version).toBe(1);
    expect(added.tree.rooms).toHaveLength(1);
    const roomId = added.tree.rooms[0]?.id ?? "";
    const historyRow = getDatabase(dbPath)
      .prepare("SELECT action FROM history WHERE group_id = 'group-a'")
      .get() as { action: string };
    expect(historyRow.action).toBe('Added room "Cold Room"');

    const edit = await request(baseUrl)
      .put(`/api/groups/group-a/inventory/rooms/${roomId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ name: "Warm Room" });
    expect(edit.status).toBe(200);
    expect((edit.body as InventoryState).version).toBe(2);
    expect((edit.body as InventoryState).tree.rooms[0]?.name).toBe("Warm Room");

    const remove = await request(baseUrl)
      .delete(`/api/groups/group-a/inventory/rooms/${roomId}`)
      .set(XRW)
      .set("Cookie", ownerCookie);
    expect(remove.status).toBe(200);
    expect((remove.body as InventoryState).version).toBe(3);
    expect((remove.body as InventoryState).tree.rooms).toEqual([]);
  });

  it("rejects an invalid body without bumping the version", async () => {
    const before = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", ownerCookie);
    const response = await request(baseUrl)
      .post("/api/groups/group-a/inventory/rooms")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ name: "" });
    expect(response.status).toBe(400);
    const after = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", ownerCookie);
    expect((after.body as InventoryState).version).toBe((before.body as InventoryState).version);
  });
});

describe("container, shelf and chemical ops", () => {
  it("walks the full chain with auto-generated positions", async () => {
    const room = (await (
      await request(baseUrl)
        .post("/api/groups/group-a/inventory/rooms")
        .set(XRW)
        .set("Cookie", ownerCookie)
        .send({ name: "Lab" })
    ).body) as InventoryState;
    const roomId = room.tree.rooms[0]?.id ?? "";

    const container = (
      await (
        await request(baseUrl)
          .post("/api/groups/group-a/inventory/containers")
          .set(XRW)
          .set("Cookie", ownerCookie)
          .send({ roomId, name: "Main Cabinet", type: "cabinet", cabinetMethod: "alphabetical", shelves: ["Shelf A-D", "Shelf E-L"] })
      ).body
    ) as InventoryState;
    const containerId = container.tree.rooms[0]?.containers[0]?.id ?? "";
    const shelfId = container.tree.rooms[0]?.containers[0]?.shelves[0]?.id ?? "";

    const chemical = (
      await (
        await request(baseUrl)
          .post("/api/groups/group-a/inventory/chemicals")
          .set(XRW)
          .set("Cookie", ownerCookie)
          .send({ roomId, containerId, shelfId, name: "Hydrochloric acid", quantity: 5, unit: "ml" })
      ).body
    ) as InventoryState;
    const stored = chemical.tree.rooms[0]?.containers[0]?.shelves[0]?.chemicals[0];
    expect(stored?.position).toBe("AH1");
    const chemicalId = stored?.id ?? "";

    const adjusted = await request(baseUrl)
      .post(`/api/groups/group-a/inventory/chemicals/${chemicalId}/adjust-qty`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, containerId, shelfId, delta: -2 });
    expect(adjusted.status).toBe(200);
    expect(
      ((adjusted.body as InventoryState).tree.rooms[0]?.containers[0]?.shelves[0]?.chemicals[0]?.quantity),
    ).toBe(3);

    const clamped = await request(baseUrl)
      .post(`/api/groups/group-a/inventory/chemicals/${chemicalId}/adjust-qty`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, containerId, shelfId, delta: -99 });
    expect(
      ((clamped.body as InventoryState).tree.rooms[0]?.containers[0]?.shelves[0]?.chemicals[0]?.quantity),
    ).toBe(0);

    const edited = await request(baseUrl)
      .put(`/api/groups/group-a/inventory/chemicals/${chemicalId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, containerId, shelfId, name: "HCl", cas: "7647-01-0" });
    expect(
      ((edited.body as InventoryState).tree.rooms[0]?.containers[0]?.shelves[0]?.chemicals[0]?.name),
    ).toBe("HCl");

    const shelf2 = (
      await (
        await request(baseUrl)
          .post("/api/groups/group-a/inventory/shelves")
          .set(XRW)
          .set("Cookie", ownerCookie)
          .send({ roomId, containerId, name: "Shelf M-P" })
      ).body
    ) as InventoryState;
    const otherShelfId = shelf2.tree.rooms[0]?.containers[0]?.shelves[1]?.id ?? "";

    const moved = await request(baseUrl)
      .post(`/api/groups/group-a/inventory/chemicals/${chemicalId}/move`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ fromRoomId: roomId, fromContainerId: containerId, fromShelfId: shelfId, toRoomId: roomId, toContainerId: containerId, toShelfId: otherShelfId });
    expect(moved.status).toBe(200);
    const movedTree = (moved.body as InventoryState).tree;
    expect(movedTree.rooms[0]?.containers[0]?.shelves[0]?.chemicals).toEqual([]);
    expect(movedTree.rooms[0]?.containers[0]?.shelves[1]?.chemicals).toHaveLength(1);

    const deleted = await request(baseUrl)
      .delete(`/api/groups/group-a/inventory/chemicals/${chemicalId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, containerId, shelfId: otherShelfId });
    expect(deleted.status).toBe(200);
    expect((deleted.body as InventoryState).tree.rooms[0]?.containers[0]?.shelves[1]?.chemicals).toEqual([]);

    const removedShelf = await request(baseUrl)
      .delete(`/api/groups/group-a/inventory/shelves/${otherShelfId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, containerId });
    expect(removedShelf.status).toBe(200);

    const removedContainer = await request(baseUrl)
      .delete(`/api/groups/group-a/inventory/containers/${containerId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId });
    expect(removedContainer.status).toBe(200);
    expect((removedContainer.body as InventoryState).tree.rooms[0]?.containers).toEqual([]);
  });
});

describe("generated and manual position overrides", () => {
  interface AlphabeticalShelf {
    roomId: string;
    containerId: string;
    shelfId: string;
  }

  async function makeAlphabeticalShelf(roomName: string): Promise<AlphabeticalShelf> {
    const room = (
      await request(baseUrl)
        .post("/api/groups/group-a/inventory/rooms")
        .set(XRW)
        .set("Cookie", ownerCookie)
        .send({ name: roomName })
    ).body as InventoryState;
    const roomId = room.tree.rooms[room.tree.rooms.length - 1]?.id ?? "";
    const container = (
      await request(baseUrl)
        .post("/api/groups/group-a/inventory/containers")
        .set(XRW)
        .set("Cookie", ownerCookie)
        .send({ roomId, name: "Position Cabinet", type: "cabinet", cabinetMethod: "alphabetical", shelves: ["Shelf A-D"] })
    ).body as InventoryState;
    const created = container.tree.rooms.find((candidate) => candidate.id === roomId)?.containers[0];
    return { roomId, containerId: created?.id ?? "", shelfId: created?.shelves[0]?.id ?? "" };
  }

  function readDoc(): {
    rooms: Array<{
      id: string;
      containers: Array<{
        id: string;
        shelves: Array<{ id: string; chemicals: Array<{ id: string; name: string; position?: string; customPosition?: string }> }>;
      }>;
    }>;
  } {
    const row = getDatabase(dbPath)
      .prepare("SELECT tree FROM group_inventory_docs WHERE group_id = 'group-a'")
      .get() as { tree: string };
    return JSON.parse(row.tree) as ReturnType<typeof readDoc>;
  }

  function writeDoc(doc: unknown): void {
    getDatabase(dbPath)
      .prepare("UPDATE group_inventory_docs SET tree = ? WHERE group_id = 'group-a'")
      .run(JSON.stringify(doc));
  }

  function storedChemical(
    state: InventoryState,
    target: AlphabeticalShelf,
    chemicalId: string,
  ): { id: string; name: string; position?: string; customPosition?: string } {
    const room = state.tree.rooms.find((candidate) => candidate.id === target.roomId);
    const container = room?.containers.find((candidate) => candidate.id === target.containerId);
    const shelf = container?.shelves.find((candidate) => candidate.id === target.shelfId);
    const chemical = shelf?.chemicals.find((candidate) => candidate.id === chemicalId);
    if (chemical === undefined) {
      throw new Error("chemical not found in response");
    }
    return chemical;
  }

  function stockRow(chemicalId: string): { position: string | null; custom_position: string | null } {
    return getDatabase(dbPath)
      .prepare("SELECT position, custom_position FROM stocks WHERE id = ?")
      .get(chemicalId) as { position: string | null; custom_position: string | null };
  }

  it("seeds an automatically generated code into both position fields and the SQL mirror", async () => {
    const target = await makeAlphabeticalShelf("Generated Code Room");
    const created = await request(baseUrl)
      .post("/api/groups/group-a/inventory/chemicals")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId: target.roomId, containerId: target.containerId, shelfId: target.shelfId, name: "Hydrochloric acid" });
    expect(created.status).toBe(201);
    const tree = (created.body as InventoryState).tree;
    const chemicalId = tree.rooms
      .find((candidate) => candidate.id === target.roomId)
      ?.containers.find((candidate) => candidate.id === target.containerId)
      ?.shelves.find((candidate) => candidate.id === target.shelfId)?.chemicals[0]?.id ?? "";
    const stored = storedChemical(created.body as InventoryState, target, chemicalId);
    expect(stored.position).toBe("AH1");
    expect(stored.customPosition).toBe("AH1");
    expect(stockRow(chemicalId)).toEqual({ position: "AH1", custom_position: "AH1" });
  });

  it("treats blank manual custom position as absent so automatic generation still applies", async () => {
    const target = await makeAlphabeticalShelf("Blank Custom Room");
    const created = await request(baseUrl)
      .post("/api/groups/group-a/inventory/chemicals")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({
        roomId: target.roomId,
        containerId: target.containerId,
        shelfId: target.shelfId,
        name: "Hydrochloric acid",
        customPosition: "   ",
      });
    expect(created.status).toBe(201);
    const tree = (created.body as InventoryState).tree;
    const chemicalId = tree.rooms
      .find((candidate) => candidate.id === target.roomId)
      ?.containers.find((candidate) => candidate.id === target.containerId)
      ?.shelves.find((candidate) => candidate.id === target.shelfId)?.chemicals[0]?.id ?? "";
    const stored = storedChemical(created.body as InventoryState, target, chemicalId);
    expect(stored.position).toBe("AH1");
    expect(stored.customPosition).toBe("AH1");
    expect(stockRow(chemicalId)).toEqual({ position: "AH1", custom_position: "AH1" });
  });

  it("keeps an explicit manual position authoritative without cloning it into customPosition", async () => {
    const target = await makeAlphabeticalShelf("Manual Position Room");
    const withCustom = await request(baseUrl)
      .post("/api/groups/group-a/inventory/chemicals")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({
        roomId: target.roomId,
        containerId: target.containerId,
        shelfId: target.shelfId,
        name: "Hydrochloric acid",
        position: "M1",
        customPosition: "M2",
      });
    expect(withCustom.status).toBe(201);
    const withCustomTree = (withCustom.body as InventoryState).tree;
    const firstShelf = withCustomTree.rooms
      .find((candidate) => candidate.id === target.roomId)
      ?.containers.find((candidate) => candidate.id === target.containerId)
      ?.shelves.find((candidate) => candidate.id === target.shelfId);
    const first = firstShelf?.chemicals[0];
    expect(first?.position).toBe("M1");
    expect(first?.customPosition).toBe("M2");

    const positionOnly = await request(baseUrl)
      .post("/api/groups/group-a/inventory/chemicals")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({
        roomId: target.roomId,
        containerId: target.containerId,
        shelfId: target.shelfId,
        name: "Hydrochloric acid",
        position: "M3",
      });
    expect(positionOnly.status).toBe(201);
    const positionOnlyTree = (positionOnly.body as InventoryState).tree;
    const second = positionOnlyTree.rooms
      .find((candidate) => candidate.id === target.roomId)
      ?.containers.find((candidate) => candidate.id === target.containerId)
      ?.shelves.find((candidate) => candidate.id === target.shelfId)?.chemicals[1];
    expect(second?.position).toBe("M3");
    expect(second?.customPosition).toBeUndefined();
  });

  it("does not fabricate a position for direct rooms or containers without a shelf", async () => {
    const room = (
      await request(baseUrl)
        .post("/api/groups/group-a/inventory/rooms")
        .set(XRW)
        .set("Cookie", ownerCookie)
        .send({ name: "No Shelf Position Room" })
    ).body as InventoryState;
    const roomId = room.tree.rooms[room.tree.rooms.length - 1]?.id ?? "";

    const direct = await request(baseUrl)
      .post("/api/groups/group-a/inventory/chemicals")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, name: "Room ethanol", customPosition: "   " });
    expect(direct.status).toBe(201);
    const directChemical = (direct.body as InventoryState).tree.rooms
      .find((candidate) => candidate.id === roomId)?.chemicals?.[0];
    expect(directChemical?.position).toBeUndefined();
    expect(directChemical?.customPosition).toBeUndefined();
    expect(stockRow(directChemical?.id ?? "")).toEqual({ position: null, custom_position: null });

    const container = (
      await request(baseUrl)
        .post("/api/groups/group-a/inventory/containers")
        .set(XRW)
        .set("Cookie", ownerCookie)
        .send({ roomId, name: "Shelf-less Cabinet", type: "cabinet", cabinetMethod: "alphabetical" })
    ).body as InventoryState;
    const containerId = container.tree.rooms.find((candidate) => candidate.id === roomId)?.containers[0]?.id ?? "";

    const withoutShelf = await request(baseUrl)
      .post("/api/groups/group-a/inventory/chemicals")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, containerId, name: "Cabinet ethanol", customPosition: " " });
    expect(withoutShelf.status).toBe(201);
    const withoutShelfChemical = (withoutShelf.body as InventoryState).tree.rooms
      .find((candidate) => candidate.id === roomId)?.containers.find((candidate) => candidate.id === containerId)
      ?.chemicals?.[0];
    expect(withoutShelfChemical?.position).toBeUndefined();
    expect(withoutShelfChemical?.customPosition).toBeUndefined();
    expect(stockRow(withoutShelfChemical?.id ?? "")).toEqual({ position: null, custom_position: null });
  });

  it("clears a legacy empty override without losing an existing generated position", async () => {
    const target = await makeAlphabeticalShelf("Legacy Override Room");
    const created = await request(baseUrl)
      .post("/api/groups/group-a/inventory/chemicals")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId: target.roomId, containerId: target.containerId, shelfId: target.shelfId, name: "Hydrochloric acid" });
    expect(created.status).toBe(201);
    const createdTree = (created.body as InventoryState).tree;
    const chemicalId = createdTree.rooms
      .find((candidate) => candidate.id === target.roomId)
      ?.containers.find((candidate) => candidate.id === target.containerId)
      ?.shelves.find((candidate) => candidate.id === target.shelfId)?.chemicals[0]?.id ?? "";

    const legacy = readDoc();
    const legacyChemical = legacy.rooms
      .find((candidate) => candidate.id === target.roomId)
      ?.containers.find((candidate) => candidate.id === target.containerId)
      ?.shelves.find((candidate) => candidate.id === target.shelfId)?.chemicals.find((candidate) => candidate.id === chemicalId);
    if (legacyChemical === undefined) {
      throw new Error("seeded chemical missing from document");
    }
    legacyChemical.position = "AH1";
    legacyChemical.customPosition = "";
    writeDoc(legacy);

    const cleaned = await request(baseUrl)
      .put(`/api/groups/group-a/inventory/chemicals/${chemicalId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId: target.roomId, containerId: target.containerId, shelfId: target.shelfId, customPosition: "   " });
    expect(cleaned.status).toBe(200);
    const cleanedChemical = storedChemical(cleaned.body as InventoryState, target, chemicalId);
    expect(cleanedChemical.position).toBe("AH1");
    expect(cleanedChemical.customPosition).toBeUndefined();
    expect(stockRow(chemicalId)).toEqual({ position: "AH1", custom_position: null });

    const renamed = await request(baseUrl)
      .put(`/api/groups/group-a/inventory/chemicals/${chemicalId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId: target.roomId, containerId: target.containerId, shelfId: target.shelfId, name: "Hydrochloric acid 2" });
    expect(renamed.status).toBe(200);
    const renamedChemical = storedChemical(renamed.body as InventoryState, target, chemicalId);
    expect(renamedChemical.position).toBe("AH1");
    expect(renamedChemical.customPosition).toBeUndefined();
    expect(stockRow(chemicalId)).toEqual({ position: "AH1", custom_position: null });

    const overridden = await request(baseUrl)
      .put(`/api/groups/group-a/inventory/chemicals/${chemicalId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId: target.roomId, containerId: target.containerId, shelfId: target.shelfId, customPosition: "Z9" });
    expect(overridden.status).toBe(200);
    const overriddenChemical = storedChemical(overridden.body as InventoryState, target, chemicalId);
    expect(overriddenChemical.position).toBe("AH1");
    expect(overriddenChemical.customPosition).toBe("Z9");
    expect(stockRow(chemicalId)).toEqual({ position: "AH1", custom_position: "Z9" });

    const cleared = await request(baseUrl)
      .put(`/api/groups/group-a/inventory/chemicals/${chemicalId}`)
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId: target.roomId, containerId: target.containerId, shelfId: target.shelfId, customPosition: "" });
    expect(cleared.status).toBe(200);
    const clearedChemical = storedChemical(cleared.body as InventoryState, target, chemicalId);
    expect(clearedChemical.position).toBe("AH1");
    expect(clearedChemical.customPosition).toBeUndefined();
    expect(stockRow(chemicalId)).toEqual({ position: "AH1", custom_position: null });
  });
});

describe("direct room chemicals", () => {
  it("stores a chemical on the room and mirrors stock/material without a fabricated container or shelf", async () => {
    const roomResponse = await request(baseUrl)
      .post("/api/groups/group-a/inventory/rooms")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ name: "Direct Stock Room" });
    expect(roomResponse.status).toBe(201);
    const roomsAfterCreate = (roomResponse.body as InventoryState).tree.rooms;
    const room = roomsAfterCreate[roomsAfterCreate.length - 1];
    expect(room?.name).toBe("Direct Stock Room");
    expect(room?.containers).toEqual([]);
    const roomId = room?.id ?? "";
    expect(roomId).not.toBe("");

    const created = await request(baseUrl)
      .post("/api/groups/group-a/inventory/chemicals")
      .set(XRW)
      .set("Cookie", ownerCookie)
      .send({ roomId, name: "Room-only ethanol", cas: "64-17-5", quantity: 500, unit: "ml" });
    expect(created.status).toBe(201);

    const createdRoom = (created.body as InventoryState).tree.rooms.find((candidate) => candidate.id === roomId);
    expect(createdRoom?.containers).toEqual([]);
    expect(createdRoom?.chemicals).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        name: "Room-only ethanol",
        cas: "64-17-5",
        quantity: 500,
        unit: "ml",
      }),
    ]);
    const chemicalId = createdRoom?.chemicals?.[0]?.id ?? "";
    expect(chemicalId).not.toBe("");

    const db = getDatabase(dbPath);
    expect(
      db.prepare("SELECT location_id, batch_id, current_quantity, quantity_unit FROM stocks WHERE id = ?").get(chemicalId),
    ).toEqual({ location_id: roomId, batch_id: `b-${chemicalId}`, current_quantity: 500, quantity_unit: "ml" });
    expect(db.prepare("SELECT name FROM materials WHERE id = ?").get(`m-${chemicalId}`)).toEqual({
      name: "Room-only ethanol",
    });
    expect(db.prepare("SELECT material_id FROM batches WHERE id = ?").get(`b-${chemicalId}`)).toEqual({
      material_id: `m-${chemicalId}`,
    });
    expect(
      db
        .prepare("SELECT stock_id FROM legacy_chemical_map WHERE group_id = 'group-a' AND chemical_id = ?")
        .get(chemicalId),
    ).toEqual({ stock_id: chemicalId });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM locations WHERE parent_id = ? AND kind IN ('container', 'shelf')").get(roomId),
    ).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM stocks WHERE location_id = ?").get(roomId)).toEqual({ n: 1 });

    const parity = await request(baseUrl).get("/api/groups/group-a/inventory/parity").set("Cookie", ownerCookie);
    expect(parity.status).toBe(200);
    expect(parity.body).toEqual({ ok: true, issues: [] });
  });
});

describe("concurrency", () => {
  it("commits 20 parallel mutations per group with zero lost updates", async () => {
    const beforeA = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", ownerCookie);
    const beforeB = await request(baseUrl).get("/api/groups/group-b/inventory").set("Cookie", otherCookie);
    const versionA = (beforeA.body as InventoryState).version;
    const versionB = (beforeB.body as InventoryState).version;
    const roomsBeforeA = (beforeA.body as InventoryState).tree.rooms.length;
    const roomsBeforeB = (beforeB.body as InventoryState).tree.rooms.length;

    const requests = [
      ...Array.from({ length: 20 }, (_, index) =>
        request(baseUrl)
          .post("/api/groups/group-a/inventory/rooms")
          .set(XRW)
          .set("Cookie", ownerCookie)
          .send({ name: `Room A${index}` })
          .then((response) => response.status),
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        request(baseUrl)
          .post("/api/groups/group-b/inventory/rooms")
          .set(XRW)
          .set("Cookie", otherCookie)
          .send({ name: `Room B${index}` })
          .then((response) => response.status),
      ),
    ];
    const statuses = await Promise.all(requests);
    expect(statuses.every((status) => status === 201)).toBe(true);

    const afterA = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", ownerCookie);
    const afterB = await request(baseUrl).get("/api/groups/group-b/inventory").set("Cookie", otherCookie);
    expect((afterA.body as InventoryState).version).toBe(versionA + 20);
    expect((afterA.body as InventoryState).tree.rooms).toHaveLength(roomsBeforeA + 20);
    expect((afterB.body as InventoryState).version).toBe(versionB + 20);
    expect((afterB.body as InventoryState).tree.rooms).toHaveLength(roomsBeforeB + 20);
    const db = getDatabase(dbPath);
    const historyA = db
      .prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-a'")
      .get() as { n: number };
    expect(historyA.n).toBeGreaterThanOrEqual(20);
  });
});

describe("websocket hub", () => {
  interface WsMessage {
    groupId?: string;
    version?: number;
    tree?: unknown;
    error?: string;
  }

  function collectMessages(socket: WebSocket): {
    messages: WsMessage[];
    waitFor: (predicate: (message: WsMessage) => boolean, timeoutMs?: number) => Promise<WsMessage>;
  } {
    const messages: WsMessage[] = [];
    socket.on("message", (data: unknown) => {
      messages.push(JSON.parse(String(data)) as WsMessage);
    });
    return {
      messages,
      waitFor: (predicate: (message: WsMessage) => boolean, timeoutMs = 2000): Promise<WsMessage> =>
        new Promise((resolve, reject) => {
          const found = messages.find(predicate);
          if (found !== undefined) {
            resolve(found);
            return;
          }
          const timer = setTimeout(() => reject(new Error("message not received within timeout")), timeoutMs);
          const interval = setInterval(() => {
            const found = messages.find(predicate);
            if (found !== undefined) {
              clearInterval(interval);
              clearTimeout(timer);
              resolve(found);
            }
          }, 5);
        }),
    };
  }

  it("subscribes, returns state, and receives a broadcast after an http mutation within 200ms", async () => {
    const wsUrl = baseUrl.replace("http", "ws") + "/ws";
    const socket = new WebSocket(wsUrl, { headers: { Cookie: ownerCookie } });
    const collector = collectMessages(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (error: Error) => reject(error));
    });
    try {
      const current = await request(baseUrl).get("/api/groups/group-a/inventory").set("Cookie", ownerCookie);
      const versionBefore = (current.body as InventoryState).version;
      socket.send(JSON.stringify({ subscribe: "group-a" }));
      const initial = await collector.waitFor((message) => message.version === versionBefore);
      expect(initial.groupId).toBe("group-a");
      expect(initial.tree).toBeDefined();

      const startedAt = Date.now();
      const mutation = await request(baseUrl)
        .post("/api/groups/group-a/inventory/rooms")
        .set(XRW)
        .set("Cookie", ownerCookie)
        .send({ name: "WS Room" });
      expect(mutation.status).toBe(201);
      const broadcast = await collector.waitFor(
        (message) => message.version === (mutation.body as InventoryState).version,
      );
      expect(broadcast.groupId).toBe("group-a");
      expect(broadcast.tree).toBeDefined();
      expect(Date.now() - startedAt).toBeLessThan(200);
    } finally {
      socket.close();
    }
  });

  it("rejects the upgrade without a session cookie with 401", async () => {
    const wsUrl = baseUrl.replace("http", "ws") + "/ws";
    const socket = new WebSocket(wsUrl);
    const status = await new Promise<number>((resolve) => {
      socket.on("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
      });
      socket.on("error", () => {});
    });
    expect(status).toBe(401);
    socket.close();
  });

  it("serves snapshots over a permessage-deflate connection", async () => {
    const wsUrl = baseUrl.replace("http", "ws") + "/ws";
    const socket = new WebSocket(wsUrl, {
      headers: { Cookie: ownerCookie },
      perMessageDeflate: true,
    });
    const collector = collectMessages(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (error: Error) => reject(error));
    });
    try {
      socket.send(JSON.stringify({ subscribe: "group-a" }));
      const initial = await collector.waitFor((message) => message.version !== undefined);
      expect(initial.groupId).toBe("group-a");
      expect(initial.tree).toBeDefined();
    } finally {
      socket.close();
    }
  });
});
