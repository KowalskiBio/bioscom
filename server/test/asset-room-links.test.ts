import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hash as argonHash } from "@node-rs/argon2";
import { buildApp } from "../src/app.js";
import { closeDatabase, getDatabase } from "../src/db.js";

const XRW = { "x-requested-with": "XMLHttpRequest" };

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface AssetRoomView {
  id: string;
  name: string;
  linkedRoomId?: string | null;
}

interface AssetView {
  id: string;
  name: string;
  barcode?: string;
  roomId?: string;
}

interface TreeResponse {
  version: number;
  tree: {
    rooms: Array<{ id: string; name: string }>;
    deepFreezers?: Array<{ id: string; name: string }>;
    assetRooms: AssetRoomView[];
    assets: AssetView[];
  };
}

let app: FastifyInstance;
let tempDir = "";
let dbPath = "";
let ownerCookie = "";
let readerCookie = "";
let outsiderCookie = "";
let roomAId = "";
let roomBId = "";
let freezerId = "";

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: XRW,
    payload: { email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login failed for ${email}: ${response.statusCode}`);
  }
  const raw = response.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return (first ?? "").split(";")[0] ?? "";
}

async function api(
  method: Method,
  url: string,
  cookie: string,
  payload?: unknown,
): Promise<{ status: number; body: TreeResponse }> {
  const response = await app.inject({
    method,
    url,
    headers: { ...XRW, cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  const body =
    response.body === ""
      ? ({ version: -1, tree: { rooms: [], assetRooms: [], assets: [] } } as TreeResponse)
      : (JSON.parse(response.body) as TreeResponse);
  return { status: response.statusCode, body };
}

async function getTree(cookie: string, groupId: string): Promise<TreeResponse> {
  const response = await api("GET", `/api/groups/${groupId}/inventory`, cookie);
  expect(response.status).toBe(200);
  return response.body;
}

function findRoom(tree: TreeResponse["tree"], name: string): { id: string; name: string } {
  const room = tree.rooms.find((candidate) => candidate.name === name);
  if (room === undefined) {
    throw new Error(`room ${name} missing`);
  }
  return room;
}

function findAssetRoom(tree: TreeResponse["tree"], name: string): AssetRoomView {
  const room = tree.assetRooms.find((candidate) => candidate.name === name);
  if (room === undefined) {
    throw new Error(`asset room ${name} missing`);
  }
  return room;
}

function findAssetRoomById(tree: TreeResponse["tree"], id: string): AssetRoomView {
  const room = tree.assetRooms.find((candidate) => candidate.id === id);
  if (room === undefined) {
    throw new Error(`asset room ${id} missing`);
  }
  return room;
}

/**
 * Mirrors the future UI aggregation: an Asset.barcode is visible for a physical
 * room only through an asset-room whose explicit linkedRoomId points at it.
 */
function barcodesForPhysicalRoom(tree: TreeResponse["tree"], physicalRoomId: string): string[] {
  const mappedAssetRoomIds = new Set(
    tree.assetRooms
      .filter((room) => room.linkedRoomId === physicalRoomId)
      .map((room) => room.id),
  );
  return tree.assets
    .filter((asset) => typeof asset.roomId === "string" && mappedAssetRoomIds.has(asset.roomId))
    .map((asset) => asset.barcode)
    .filter((barcode): barcode is string => typeof barcode === "string" && barcode !== "")
    .sort();
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "bioscom-asset-room-links-test-"));
  dbPath = join(tempDir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });

  const db = getDatabase(dbPath);
  const insertUser = db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  );
  insertUser.run("uid-link-owner", "owner@links.test", await argonHash("owner-password"), "Link Owner", "admin", "group-a");
  insertUser.run("uid-link-reader", "reader@links.test", await argonHash("reader-password"), "Link Reader", "reader", "group-a");
  insertUser.run("uid-link-outsider", "outsider@links.test", await argonHash("outsider-password"), "Link Outsider", "admin", "group-b");

  const insertGroup = db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)");
  insertGroup.run("group-a", "Link Lab A", "BIOS-LINK-A", Date.now());
  insertGroup.run("group-b", "Link Lab B", "BIOS-LINK-B", Date.now());

  const emptyTree = JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] });
  const insertDoc = db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)");
  insertDoc.run("group-a", emptyTree);
  insertDoc.run("group-b", emptyTree);

  ownerCookie = await login("owner@links.test", "owner-password");
  readerCookie = await login("reader@links.test", "reader-password");
  outsiderCookie = await login("outsider@links.test", "outsider-password");

  // Identically named physical rooms in two separate lab documents.
  const roomA = await api("POST", "/api/groups/group-a/inventory/rooms", ownerCookie, { name: "Shared Alpha Room" });
  expect(roomA.status).toBe(201);
  roomAId = findRoom(roomA.body.tree, "Shared Alpha Room").id;

  const roomB = await api("POST", "/api/groups/group-b/inventory/rooms", outsiderCookie, { name: "Shared Alpha Room" });
  expect(roomB.status).toBe(201);
  roomBId = findRoom(roomB.body.tree, "Shared Alpha Room").id;

  const freezer = await api("POST", "/api/groups/group-a/inventory/deepfreezers", ownerCookie, { name: "Root Freezer" });
  expect(freezer.status).toBe(201);
  const createdFreezer = freezer.body.tree.deepFreezers?.find((candidate) => candidate.name === "Root Freezer");
  if (createdFreezer === undefined) {
    throw new Error("freezer missing");
  }
  freezerId = createdFreezer.id;
});

afterAll(async () => {
  await app.close();
  closeDatabase();
  if (tempDir !== "") {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("asset room -> chemical room links", () => {
  it("creates a linked asset room and keeps the mapping through a name-only edit and legacy asset relation", async () => {
    const before = await getTree(ownerCookie, "group-a");
    const create = await api("POST", "/api/groups/group-a/inventory/asset-rooms", ownerCookie, {
      name: "Linked Assets",
      linkedRoomId: roomAId,
    });
    expect(create.status).toBe(201);
    expect(create.body.version).toBe(before.version + 1);
    const assetRoom = findAssetRoom(create.body.tree, "Linked Assets");
    expect(assetRoom.linkedRoomId).toBe(roomAId);

    const asset = await api("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Linked microscope",
      barcode: "LINKED-BARCODE",
      roomId: assetRoom.id,
    });
    expect(asset.status).toBe(201);
    expect(asset.body.tree.assets.find((candidate) => candidate.barcode === "LINKED-BARCODE")?.roomId).toBe(
      assetRoom.id,
    );

    const rename = await api("PUT", `/api/groups/group-a/inventory/asset-rooms/${assetRoom.id}`, ownerCookie, {
      name: "Renamed Linked Assets",
    });
    expect(rename.status).toBe(200);
    expect(rename.body.version).toBe(asset.body.version + 1);
    const renamed = findAssetRoom(rename.body.tree, "Renamed Linked Assets");
    expect(renamed.id).toBe(assetRoom.id);
    expect(renamed.linkedRoomId).toBe(roomAId);
    expect(rename.body.tree.assets.find((candidate) => candidate.barcode === "LINKED-BARCODE")?.roomId).toBe(
      assetRoom.id,
    );
  });

  it("sets a mapping on an existing name-only asset room and clears it with null without touching names, rooms or assets", async () => {
    const created = await api("POST", "/api/groups/group-a/inventory/asset-rooms", ownerCookie, {
      name: "Name Only Assets",
    });
    expect(created.status).toBe(201);
    const assetRoom = findAssetRoom(created.body.tree, "Name Only Assets");
    expect(assetRoom.linkedRoomId).toBeUndefined();

    const asset = await api("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Legacy room reference",
      barcode: "LEGACY-ROOM-REF",
      roomId: assetRoom.id,
    });
    expect(asset.status).toBe(201);

    const setLink = await api("PUT", `/api/groups/group-a/inventory/asset-rooms/${assetRoom.id}`, ownerCookie, {
      linkedRoomId: roomAId,
    });
    expect(setLink.status).toBe(200);
    expect(setLink.body.version).toBe(asset.body.version + 1);
    const linked = findAssetRoomById(setLink.body.tree, assetRoom.id);
    expect(linked.name).toBe("Name Only Assets");
    expect(linked.linkedRoomId).toBe(roomAId);
    expect(setLink.body.tree.rooms.some((candidate) => candidate.id === roomAId)).toBe(true);
    expect(
      setLink.body.tree.assets.find((candidate) => candidate.barcode === "LEGACY-ROOM-REF")?.roomId,
    ).toBe(assetRoom.id);

    const clear = await api("PUT", `/api/groups/group-a/inventory/asset-rooms/${assetRoom.id}`, ownerCookie, {
      linkedRoomId: null,
    });
    expect(clear.status).toBe(200);
    expect(clear.body.version).toBe(setLink.body.version + 1);
    const cleared = findAssetRoomById(clear.body.tree, assetRoom.id);
    expect(cleared.name).toBe("Name Only Assets");
    expect(cleared.linkedRoomId ?? null).toBeNull();
    expect(clear.body.tree.rooms.some((candidate) => candidate.id === roomAId)).toBe(true);
    expect(
      clear.body.tree.assets.find((candidate) => candidate.barcode === "LEGACY-ROOM-REF")?.roomId,
    ).toBe(assetRoom.id);
  });

  it("rejects unknown ids, legacy asset-room ids and freezer ids without mutating the document", async () => {
    const target = await api("POST", "/api/groups/group-a/inventory/asset-rooms", ownerCookie, {
      name: "Reject Target Assets",
    });
    expect(target.status).toBe(201);
    const targetId = findAssetRoom(target.body.tree, "Reject Target Assets").id;
    const before = await getTree(ownerCookie, "group-a");

    for (const linkedRoomId of ["no-such-chemical-room", targetId, freezerId]) {
      const create = await api("POST", "/api/groups/group-a/inventory/asset-rooms", ownerCookie, {
        name: `Rejected ${linkedRoomId}`,
        linkedRoomId,
      });
      expect(create.status).toBe(404);
      expect(create.body).toMatchObject({ error: "Chemical room not found" });
    }

    for (const linkedRoomId of ["no-such-chemical-room", targetId, freezerId]) {
      const edit = await api(
        "PUT",
        `/api/groups/group-a/inventory/asset-rooms/${targetId}`,
        ownerCookie,
        { linkedRoomId },
      );
      expect(edit.status).toBe(404);
      expect(edit.body).toMatchObject({ error: "Chemical room not found" });
    }

    const after = await getTree(ownerCookie, "group-a");
    expect(after.version).toBe(before.version);
    expect(after.tree.assetRooms).toHaveLength(before.tree.assetRooms.length);
    const unchanged = findAssetRoomById(after.tree, targetId);
    expect(unchanged.name).toBe("Reject Target Assets");
    expect(unchanged.linkedRoomId ?? null).toBeNull();
    expect(after.tree.rooms.some((candidate) => candidate.id === freezerId)).toBe(false);
    expect(after.tree.assetRooms.some((candidate) => candidate.id === targetId)).toBe(true);
  });

  it("keeps group membership and reader restrictions for map/edit and the room-delete guard", async () => {
    const beforeA = await getTree(ownerCookie, "group-a");
    const existing = findAssetRoom(beforeA.tree, "Reject Target Assets");

    const outsiderCreate = await api("POST", "/api/groups/group-a/inventory/asset-rooms", outsiderCookie, {
      name: "Outsider Assets",
      linkedRoomId: roomAId,
    });
    expect(outsiderCreate.status).toBe(403);

    const outsiderEdit = await api(
      "PUT",
      `/api/groups/group-a/inventory/asset-rooms/${existing.id}`,
      outsiderCookie,
      { linkedRoomId: roomAId },
    );
    expect(outsiderEdit.status).toBe(403);

    const readerCreate = await api("POST", "/api/groups/group-a/inventory/asset-rooms", readerCookie, {
      name: "Reader Assets",
      linkedRoomId: roomAId,
    });
    expect(readerCreate.status).toBe(403);
    expect(readerCreate.body).toMatchObject({ error: "Readers cannot make changes" });

    const readerEdit = await api(
      "PUT",
      `/api/groups/group-a/inventory/asset-rooms/${existing.id}`,
      readerCookie,
      { linkedRoomId: roomAId },
    );
    expect(readerEdit.status).toBe(403);

    const readerDeleteRoom = await api(
      "DELETE",
      `/api/groups/group-a/inventory/rooms/${roomAId}`,
      readerCookie,
    );
    expect(readerDeleteRoom.status).toBe(403);
    expect(readerDeleteRoom.body).toMatchObject({ error: "Readers cannot make changes" });

    const outsiderDeleteRoom = await api(
      "DELETE",
      `/api/groups/group-a/inventory/rooms/${roomAId}`,
      outsiderCookie,
    );
    expect(outsiderDeleteRoom.status).toBe(403);

    const afterA = await getTree(ownerCookie, "group-a");
    expect(afterA.version).toBe(beforeA.version);
    expect(afterA.tree.assetRooms.some((candidate) => candidate.name === "Outsider Assets")).toBe(false);
    expect(afterA.tree.assetRooms.some((candidate) => candidate.name === "Reader Assets")).toBe(false);
    expect(findAssetRoomById(afterA.tree, existing.id).linkedRoomId ?? null).toBeNull();
    expect(afterA.tree.rooms.some((candidate) => candidate.id === roomAId)).toBe(true);
  });
});

describe("chemical room deletion guard", () => {
  it("blocks deletion while an asset-room or instrument links the room and succeeds after both links clear", async () => {
    const createdRoom = await api("POST", "/api/groups/group-a/inventory/rooms", ownerCookie, {
      name: "Guarded Physical Room",
    });
    expect(createdRoom.status).toBe(201);
    const guardedRoomId = findRoom(createdRoom.body.tree, "Guarded Physical Room").id;

    const createdAssetRoom = await api("POST", "/api/groups/group-a/inventory/asset-rooms", ownerCookie, {
      name: "Guarded Assets",
      linkedRoomId: guardedRoomId,
    });
    expect(createdAssetRoom.status).toBe(201);
    const guardedAssetRoom = findAssetRoom(createdAssetRoom.body.tree, "Guarded Assets");

    // No barcode on this asset: the guard must not depend on barcode contents.
    const createdAsset = await api("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Barcode-less asset",
      roomId: guardedAssetRoom.id,
    });
    expect(createdAsset.status).toBe(201);
    const guardedAsset = createdAsset.body.tree.assets.find((candidate) => candidate.name === "Barcode-less asset");
    expect(guardedAsset?.barcode ?? null).toBeNull();

    const db = getDatabase(dbPath);
    db.prepare(
      "INSERT INTO instruments (id, source, group_id, name, room_group_id, room_id) VALUES (?, 'shared', NULL, ?, ?, ?)",
    ).run("inst-guarded-room", "Guarded instrument", "group-a", guardedRoomId);

    const beforeBlock = await getTree(ownerCookie, "group-a");
    const blocked = await api("DELETE", `/api/groups/group-a/inventory/rooms/${guardedRoomId}`, ownerCookie);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({
      error: "Unlink assigned instruments and asset rooms before deleting this room",
    });

    const afterBlock = await getTree(ownerCookie, "group-a");
    expect(afterBlock.version).toBe(beforeBlock.version);
    expect(afterBlock.tree.rooms.some((candidate) => candidate.id === guardedRoomId)).toBe(true);
    expect(findAssetRoomById(afterBlock.tree, guardedAssetRoom.id).linkedRoomId).toBe(guardedRoomId);
    expect(
      afterBlock.tree.assets.find((candidate) => candidate.name === "Barcode-less asset")?.roomId,
    ).toBe(guardedAssetRoom.id);
    expect(
      db
        .prepare("SELECT room_group_id AS roomGroupId, room_id AS roomId FROM instruments WHERE id = ?")
        .get("inst-guarded-room"),
    ).toEqual({ roomGroupId: "group-a", roomId: guardedRoomId });
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = 'group-a' AND action = ?")
        .get(`Deleted room "Guarded Physical Room"`),
    ).toEqual({ n: 0 });

    // Clearing only the asset-room link still leaves the instrument link behind.
    const clearAssetLink = await api(
      "PUT",
      `/api/groups/group-a/inventory/asset-rooms/${guardedAssetRoom.id}`,
      ownerCookie,
      { linkedRoomId: null },
    );
    expect(clearAssetLink.status).toBe(200);
    const blockedByInstrument = await api(
      "DELETE",
      `/api/groups/group-a/inventory/rooms/${guardedRoomId}`,
      ownerCookie,
    );
    expect(blockedByInstrument.status).toBe(409);
    expect((await getTree(ownerCookie, "group-a")).version).toBe(clearAssetLink.body.version);

    // Unlink the SQL instrument, then the physical room may be deleted.
    db.prepare("UPDATE instruments SET room_group_id = NULL, room_id = NULL WHERE id = ?").run(
      "inst-guarded-room",
    );
    const deleted = await api("DELETE", `/api/groups/group-a/inventory/rooms/${guardedRoomId}`, ownerCookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body.version).toBe(clearAssetLink.body.version + 1);
    expect(deleted.body.tree.rooms.some((candidate) => candidate.id === guardedRoomId)).toBe(false);
    expect(findAssetRoomById(deleted.body.tree, guardedAssetRoom.id).linkedRoomId ?? null).toBeNull();
    expect(
      deleted.body.tree.assets.find((candidate) => candidate.name === "Barcode-less asset")?.roomId,
    ).toBe(guardedAssetRoom.id);
  });

  it("keeps plain room deletion and freezer pseudo-room behavior intact", async () => {
    const created = await api("POST", "/api/groups/group-a/inventory/rooms", ownerCookie, {
      name: "Unlinked Plain Room",
    });
    expect(created.status).toBe(201);
    const plainRoomId = findRoom(created.body.tree, "Unlinked Plain Room").id;

    const removed = await api("DELETE", `/api/groups/group-a/inventory/rooms/${plainRoomId}`, ownerCookie);
    expect(removed.status).toBe(200);
    expect(removed.body.version).toBe(created.body.version + 1);
    expect(removed.body.tree.rooms.some((candidate) => candidate.id === plainRoomId)).toBe(false);

    const beforeFreezerDelete = await getTree(ownerCookie, "group-a");
    const freezerDelete = await api(
      "DELETE",
      `/api/groups/group-a/inventory/rooms/${freezerId}`,
      ownerCookie,
    );
    expect(freezerDelete.status).toBe(404);
    const afterFreezerDelete = await getTree(ownerCookie, "group-a");
    expect(afterFreezerDelete.version).toBe(beforeFreezerDelete.version);
    expect(afterFreezerDelete.tree.deepFreezers?.some((candidate) => candidate.id === freezerId)).toBe(true);
  });
});

describe("asset room deletion and aggregation", () => {
  it("removes only the standard asset references and never deletes the chemical room or asset", async () => {
    const createdRoom = await api("POST", "/api/groups/group-a/inventory/rooms", ownerCookie, {
      name: "Keep Chemical Room",
    });
    expect(createdRoom.status).toBe(201);
    const chemicalRoomId = findRoom(createdRoom.body.tree, "Keep Chemical Room").id;

    const createdAssetRoom = await api("POST", "/api/groups/group-a/inventory/asset-rooms", ownerCookie, {
      name: "Disposable Assets",
      linkedRoomId: chemicalRoomId,
    });
    expect(createdAssetRoom.status).toBe(201);
    const assetRoom = findAssetRoom(createdAssetRoom.body.tree, "Disposable Assets");

    const createdAsset = await api("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Surviving asset",
      barcode: "SURVIVES-ASSET-ROOM-DELETE",
      roomId: assetRoom.id,
    });
    expect(createdAsset.status).toBe(201);

    const deleted = await api(
      "DELETE",
      `/api/groups/group-a/inventory/asset-rooms/${assetRoom.id}`,
      ownerCookie,
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.version).toBe(createdAsset.body.version + 1);
    expect(deleted.body.tree.assetRooms.some((candidate) => candidate.id === assetRoom.id)).toBe(false);
    expect(deleted.body.tree.rooms.some((candidate) => candidate.id === chemicalRoomId)).toBe(true);
    const survivingAsset = deleted.body.tree.assets.find(
      (candidate) => candidate.barcode === "SURVIVES-ASSET-ROOM-DELETE",
    );
    expect(survivingAsset?.roomId).toBe("");
    expect(survivingAsset?.name).toBe("Surviving asset");
    expect(barcodesForPhysicalRoom(deleted.body.tree, chemicalRoomId)).toEqual([]);
  });

  it("does not match names across groups or infer Asset.roomId only; barcode follows explicit linkedRoomId", async () => {
    // Group B has an identically named physical room and its own asset data.
    const createdBRoom = await api("POST", "/api/groups/group-b/inventory/asset-rooms", outsiderCookie, {
      name: "Shared Alpha Asset Room",
      linkedRoomId: roomBId,
    });
    expect(createdBRoom.status).toBe(201);
    const bAssetRoom = findAssetRoom(createdBRoom.body.tree, "Shared Alpha Asset Room");
    const bAsset = await api("POST", "/api/groups/group-b/inventory/assets", outsiderCookie, {
      name: "Group B asset",
      barcode: "B-ONLY-BARCODE",
      roomId: bAssetRoom.id,
    });
    expect(bAsset.status).toBe(201);

    // An asset room in group A cannot target group B's room id, even though the
    // room name is identical.
    const crossGroupBefore = await getTree(ownerCookie, "group-a");
    const crossGroup = await api("POST", "/api/groups/group-a/inventory/asset-rooms", ownerCookie, {
      name: "Cross Group Attempt",
      linkedRoomId: roomBId,
    });
    expect(crossGroup.status).toBe(404);
    expect(crossGroup.body).toMatchObject({ error: "Chemical room not found" });
    const crossGroupAfter = await getTree(ownerCookie, "group-a");
    expect(crossGroupAfter.version).toBe(crossGroupBefore.version);

    // Name-only asset room with the same name as the physical room.
    const nameOnly = await api("POST", "/api/groups/group-a/inventory/asset-rooms", ownerCookie, {
      name: "Shared Alpha Room",
    });
    expect(nameOnly.status).toBe(201);
    const nameOnlyRoom = findAssetRoom(nameOnly.body.tree, "Shared Alpha Room");
    const nameOnlyAsset = await api("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Name only asset",
      barcode: "A-NAME-ONLY-BARCODE",
      roomId: nameOnlyRoom.id,
    });
    expect(nameOnlyAsset.status).toBe(201);

    // Asset.roomId pointing directly at a physical room is not an asset-room link.
    const directRoomAsset = await api("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Direct room id asset",
      barcode: "A-DIRECT-ROOM-ID",
      roomId: roomAId,
    });
    expect(directRoomAsset.status).toBe(201);

    // Only an explicitly linked asset-room contributes a barcode.
    const linked = await api("POST", "/api/groups/group-a/inventory/asset-rooms", ownerCookie, {
      name: "Explicitly Linked Assets",
      linkedRoomId: roomAId,
    });
    expect(linked.status).toBe(201);
    const linkedRoom = findAssetRoom(linked.body.tree, "Explicitly Linked Assets");
    const linkedAsset = await api("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Visible asset",
      barcode: "A-LINKED-BARCODE",
      roomId: linkedRoom.id,
    });
    expect(linkedAsset.status).toBe(201);

    const treeA = (await getTree(ownerCookie, "group-a")).tree;
    expect(barcodesForPhysicalRoom(treeA, roomAId)).toEqual([
      "A-LINKED-BARCODE",
      "LINKED-BARCODE",
    ]);
    expect(treeA.assets.some((candidate) => candidate.barcode === "B-ONLY-BARCODE")).toBe(false);

    const treeB = (await getTree(outsiderCookie, "group-b")).tree;
    expect(barcodesForPhysicalRoom(treeB, roomBId)).toEqual(["B-ONLY-BARCODE"]);
  });
});
