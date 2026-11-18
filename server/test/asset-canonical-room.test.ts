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
  barcode?: string | null;
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
let db: ReturnType<typeof getDatabase>;
let tempDir = "";
let dbPath = "";
let ownerCookie = "";
let readerCookie = "";
let outsiderCookie = "";

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

async function api(method: Method, url: string, cookie: string, payload?: unknown): Promise<TreeResponse & { error?: string }> {
  const response = await app.inject({
    method,
    url,
    headers: { ...XRW, cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  if (response.body === "") {
    return { version: -1, tree: { rooms: [], deepFreezers: [], assetRooms: [], assets: [] } };
  }
  return JSON.parse(response.body) as TreeResponse & { error?: string };
}

async function apiStatus(
  method: Method,
  url: string,
  cookie: string,
  payload?: unknown,
): Promise<{ status: number; body: TreeResponse & { error?: string } }> {
  const response = await app.inject({
    method,
    url,
    headers: { ...XRW, cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  const body =
    response.body === ""
      ? ({ version: -1, tree: { rooms: [], deepFreezers: [], assetRooms: [], assets: [] } } as TreeResponse)
      : (JSON.parse(response.body) as TreeResponse & { error?: string });
  return { status: response.statusCode, body };
}

async function getTree(): Promise<TreeResponse> {
  const body = await api("GET", "/api/groups/group-a/inventory", ownerCookie);
  return body;
}

function assetByName(tree: TreeResponse["tree"], name: string): AssetView {
  const asset = tree.assets.find((candidate) => candidate.name === name);
  if (asset === undefined) {
    throw new Error(`asset ${name} missing`);
  }
  return asset;
}

function roomByName(tree: TreeResponse["tree"], name: string): { id: string; name: string } {
  const room = tree.rooms.find((candidate) => candidate.name === name);
  if (room === undefined) {
    throw new Error(`room ${name} missing`);
  }
  return room;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "bioscom-asset-canonical-room-test-"));
  dbPath = join(tempDir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  db = getDatabase(dbPath);

  const passwordHash = await argonHash("fixture-password");
  const insertUser = db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  );
  insertUser.run("uid-asset-owner", "owner@asset.test", passwordHash, "Asset Owner", "admin", "group-a");
  insertUser.run("uid-asset-reader", "reader@asset.test", passwordHash, "Asset Reader", "reader", "group-a");
  insertUser.run("uid-asset-outsider", "outsider@asset.test", passwordHash, "Asset Outsider", "admin", "group-b");

  const insertGroup = db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)");
  insertGroup.run("group-a", "Asset Lab A", "ASSET-A", Date.now());
  insertGroup.run("group-b", "Asset Lab B", "ASSET-B", Date.now());

  const treeA = {
    rooms: [
      { id: "room-a", name: "Canonical Room A", containers: [] },
      { id: "room-a-2", name: "Canonical Room A2", containers: [] },
    ],
    deepFreezers: [
      { id: "df-root", name: "Root Freezer", type: "deepfreezer", shelves: [], sharedWithGroupIds: [] },
    ],
    assetRooms: [{ id: "legacy-asset-room", name: "Legacy Asset Room" }],
    assets: [],
    protocols: [],
  };
  const treeB = {
    rooms: [{ id: "room-b", name: "Canonical Room B", containers: [] }],
    deepFreezers: [],
    assetRooms: [],
    assets: [],
    protocols: [],
  };
  const insertDoc = db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)");
  insertDoc.run("group-a", JSON.stringify(treeA));
  insertDoc.run("group-b", JSON.stringify(treeB));

  ownerCookie = await login("owner@asset.test", "fixture-password");
  readerCookie = await login("reader@asset.test", "fixture-password");
  outsiderCookie = await login("outsider@asset.test", "fixture-password");
});

afterAll(async () => {
  await app.close();
  closeDatabase();
  if (tempDir !== "") {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("asset create accepts only canonical tree.rooms ids", () => {
  it("stores a real canonical room id and keeps blank/omitted room ids unassigned", async () => {
    const before = await getTree();

    const withRoom = await apiStatus("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Canonical microscope",
      barcode: "CANONICAL-1",
      roomId: "room-a",
    });
    expect(withRoom.status).toBe(201);
    expect(withRoom.body.version).toBe(before.version + 1);
    expect(assetByName(withRoom.body.tree, "Canonical microscope").roomId).toBe("room-a");

    const omitted = await apiStatus("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "No-room asset",
      barcode: "CANONICAL-NONE",
    });
    expect(omitted.status).toBe(201);
    expect(assetByName(omitted.body.tree, "No-room asset").roomId).toBe("");

    const blank = await apiStatus("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Blank-room asset",
      barcode: "CANONICAL-BLANK",
      roomId: "",
    });
    expect(blank.status).toBe(201);
    expect(assetByName(blank.body.tree, "Blank-room asset").roomId).toBe("");
  });

  it("rejects legacy asset-room, root/deep-freezer, unknown and cross-lab room ids without version change", async () => {
    const before = await getTree();
    const countBefore = before.tree.assets.length;

    for (const roomId of ["legacy-asset-room", "df-root", "missing-room", "room-b"]) {
      const created = await apiStatus("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
        name: `Rejected ${roomId}`,
        roomId,
      });
      expect(created.status, roomId).toBe(404);
      expect(created.body.error).toBe("Room not found");
    }

    const after = await getTree();
    expect(after.version).toBe(before.version);
    expect(after.tree.assets).toHaveLength(countBefore);
    expect(after.tree.assets.some((candidate) => candidate.name.startsWith("Rejected "))).toBe(false);
    expect(after.tree.rooms.some((candidate) => candidate.id === "legacy-asset-room")).toBe(false);
  });

  it("keeps reader and outsider asset creation forbidden", async () => {
    const before = await getTree();
    for (const cookie of [readerCookie, outsiderCookie]) {
      const created = await apiStatus("POST", "/api/groups/group-a/inventory/assets", cookie, {
        name: "Forbidden asset",
        roomId: "room-a",
      });
      expect(created.status).toBe(403);
    }
    const after = await getTree();
    expect(after.version).toBe(before.version);
    expect(after.tree.assets.some((candidate) => candidate.name === "Forbidden asset")).toBe(false);
  });
});

describe("asset edit validates canonical room ids", () => {
  it("sets, reassigns and clears the canonical room, and preserves it when roomId is omitted", async () => {
    const created = await apiStatus("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Editable asset",
      roomId: "room-a",
    });
    expect(created.status).toBe(201);
    const asset = assetByName(created.body.tree, "Editable asset");

    const reassigned = await apiStatus(
      "PUT",
      `/api/groups/group-a/inventory/assets/${asset.id}`,
      ownerCookie,
      { roomId: "room-a-2" },
    );
    expect(reassigned.status).toBe(200);
    expect(reassigned.body.version).toBe(created.body.version + 1);
    expect(assetByName(reassigned.body.tree, "Editable asset").roomId).toBe("room-a-2");

    const nameOnly = await apiStatus(
      "PUT",
      `/api/groups/group-a/inventory/assets/${asset.id}`,
      ownerCookie,
      { name: "Editable asset renamed" },
    );
    expect(nameOnly.status).toBe(200);
    const renamed = assetByName(nameOnly.body.tree, "Editable asset renamed");
    expect(renamed.id).toBe(asset.id);
    expect(renamed.roomId).toBe("room-a-2");

    const cleared = await apiStatus(
      "PUT",
      `/api/groups/group-a/inventory/assets/${asset.id}`,
      ownerCookie,
      { roomId: "" },
    );
    expect(cleared.status).toBe(200);
    expect(assetByName(cleared.body.tree, "Editable asset renamed").roomId).toBe("");
  });

  it("rejects legacy asset-room, freezer and unknown edits without mutating the document or version", async () => {
    const created = await apiStatus("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Reject edit target",
      barcode: "REJECT-EDIT",
      roomId: "room-a",
    });
    expect(created.status).toBe(201);
    const asset = assetByName(created.body.tree, "Reject edit target");
    const before = await getTree();

    for (const roomId of ["legacy-asset-room", "df-root", "missing-room"]) {
      const edited = await apiStatus(
        "PUT",
        `/api/groups/group-a/inventory/assets/${asset.id}`,
        ownerCookie,
        { roomId },
      );
      expect(edited.status, roomId).toBe(404);
      expect(edited.body.error).toBe("Room not found");
    }

    const after = await getTree();
    expect(after.version).toBe(before.version);
    const unchanged = assetByName(after.tree, "Reject edit target");
    expect(unchanged.id).toBe(asset.id);
    expect(unchanged.barcode).toBe("REJECT-EDIT");
    expect(unchanged.roomId).toBe("room-a");
  });

  it("allows a legacy asset with an old asset-room id to be edited when roomId is omitted", async () => {
    // Simulate an un-migrated legacy asset inserted outside the create route.
    const row = db
      .prepare("SELECT tree FROM group_inventory_docs WHERE group_id = 'group-a'")
      .get() as { tree: string };
    const doc = JSON.parse(row.tree) as TreeResponse["tree"];
    doc.assets.push({ id: "legacy-asset", name: "Legacy asset", roomId: "legacy-asset-room" });
    db.prepare("UPDATE group_inventory_docs SET tree = ? WHERE group_id = 'group-a'").run(JSON.stringify(doc));

    const edited = await apiStatus(
      "PUT",
      "/api/groups/group-a/inventory/assets/legacy-asset",
      ownerCookie,
      { name: "Legacy asset edited" },
    );
    expect(edited.status).toBe(200);
    const legacy = assetByName(edited.body.tree, "Legacy asset edited");
    expect(legacy.roomId).toBe("legacy-asset-room");

    // Supplying that same legacy id explicitly is still rejected.
    const retry = await apiStatus(
      "PUT",
      "/api/groups/group-a/inventory/assets/legacy-asset",
      ownerCookie,
      { roomId: "legacy-asset-room" },
    );
    expect(retry.status).toBe(404);
    expect(retry.body.error).toBe("Room not found");
  });

  it("keeps reader and outsider asset edits forbidden", async () => {
    const created = await apiStatus("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Permission asset",
      roomId: "room-a",
    });
    expect(created.status).toBe(201);
    const asset = assetByName(created.body.tree, "Permission asset");
    const before = await getTree();

    for (const cookie of [readerCookie, outsiderCookie]) {
      const edited = await apiStatus(
        "PUT",
        `/api/groups/group-a/inventory/assets/${asset.id}`,
        cookie,
        { name: "Forbidden rename" },
      );
      expect(edited.status).toBe(403);
    }

    const after = await getTree();
    expect(after.version).toBe(before.version);
    expect(assetByName(after.tree, "Permission asset").id).toBe(asset.id);
  });
});

describe("asset-room create compatibility route", () => {
  it("creates a canonical tree.rooms entry instead of a second asset-room namespace", async () => {
    const before = await getTree();
    const assetRoomCountBefore = before.tree.assetRooms.length;

    const created = await apiStatus("POST", "/api/groups/group-a/inventory/asset-rooms", ownerCookie, {
      name: "Compat Canonical Room",
      // Legacy callers may still send this; it is ignored, not a mapping.
      linkedRoomId: "legacy-asset-room",
    });
    expect(created.status).toBe(201);
    expect(created.body.version).toBe(before.version + 1);

    const room = roomByName(created.body.tree, "Compat Canonical Room");
    expect(room.id).not.toBe("legacy-asset-room");
    expect(created.body.tree.assetRooms).toHaveLength(assetRoomCountBefore);
    expect(created.body.tree.assetRooms.some((candidate) => candidate.name === "Compat Canonical Room")).toBe(false);

    // The new canonical room can be used directly by asset create.
    const asset = await apiStatus("POST", "/api/groups/group-a/inventory/assets", ownerCookie, {
      name: "Asset in compat room",
      roomId: room.id,
    });
    expect(asset.status).toBe(201);
    expect(assetByName(asset.body.tree, "Asset in compat room").roomId).toBe(room.id);
  });

  it("keeps group permissions and invalid-body handling", async () => {
    const before = await getTree();

    for (const cookie of [readerCookie, outsiderCookie]) {
      const created = await apiStatus("POST", "/api/groups/group-a/inventory/asset-rooms", cookie, {
        name: "Forbidden compat room",
      });
      expect(created.status).toBe(403);
    }

    const invalid = await apiStatus("POST", "/api/groups/group-a/inventory/asset-rooms", ownerCookie, {
      name: "",
    });
    expect(invalid.status).toBe(400);

    const after = await getTree();
    expect(after.version).toBe(before.version);
    expect(after.tree.rooms.some((candidate) => candidate.name === "Forbidden compat room")).toBe(false);
  });
});
