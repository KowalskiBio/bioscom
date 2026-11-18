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

interface AssetView {
  id: string;
  name: string;
  roomId?: string;
}

interface TreeResponse {
  version: number;
  tree: {
    rooms: Array<{ id: string; name: string }>;
    deepFreezers?: Array<{ id: string; name: string }>;
    assetRooms: Array<{ id: string; name: string; linkedRoomId?: string | null }>;
    assets: AssetView[];
  };
}

let app: FastifyInstance;
let db: ReturnType<typeof getDatabase>;
let tempDir = "";
let ownerCookie = "";

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: XRW,
    payload: { email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login failed: ${response.statusCode}`);
  }
  const raw = response.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return (first ?? "").split(";")[0] ?? "";
}

async function call(
  method: Method,
  url: string,
  payload?: unknown,
): Promise<{ status: number; body: TreeResponse & { error?: string } }> {
  const response = await app.inject({
    method,
    url,
    headers: { ...XRW, cookie: ownerCookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  const body =
    response.body === ""
      ? ({ version: -1, tree: { rooms: [], assetRooms: [], assets: [] } } as TreeResponse)
      : (JSON.parse(response.body) as TreeResponse & { error?: string });
  return { status: response.statusCode, body };
}

async function tree(): Promise<TreeResponse> {
  const response = await call("GET", "/api/groups/group-a/inventory");
  return response.body;
}

function assetByName(view: TreeResponse, name: string): AssetView {
  const asset = view.tree.assets.find((candidate) => candidate.name === name);
  if (asset === undefined) throw new Error(`asset ${name} missing`);
  return asset;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "bioscom-canonical-asset-guard-"));
  const dbPath = join(tempDir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  db = getDatabase(dbPath);

  db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, 'admin', ?)",
  ).run("uid-guard-owner", "guard@asset.test", await argonHash("guard-password"), "Guard Owner", "group-a");
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)").run(
    "group-a",
    "Guard Lab",
    "GUARD-A",
    Date.now(),
  );

  const seeded = {
    rooms: [
      { id: "room-one", name: "Room One", containers: [] },
      { id: "room-two", name: "Room Two", containers: [] },
    ],
    deepFreezers: [{ id: "df-root", name: "Root Freezer", type: "deepfreezer", shelves: [] }],
    assetRooms: [],
    assets: [],
    protocols: [],
  };
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-a', ?, 0)").run(
    JSON.stringify(seeded),
  );

  ownerCookie = await login("guard@asset.test", "guard-password");
});

afterAll(async () => {
  await app.close();
  closeDatabase();
  if (tempDir !== "") {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("canonical asset room-delete guard", () => {
  it("blocks deleting a room referenced by an asset.roomId until the asset is reassigned", async () => {
    const created = await call("POST", "/api/groups/group-a/inventory/assets", {
      name: "Canonical microscope",
      barcode: "GUARD-CANONICAL",
      roomId: "room-one",
    });
    expect(created.status).toBe(201);
    expect(assetByName(created.body, "Canonical microscope").roomId).toBe("room-one");

    const beforeBlocked = await tree();
    const blocked = await call("DELETE", "/api/groups/group-a/inventory/rooms/room-one");
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("Unlink assigned instruments and asset rooms before deleting this room");

    const afterBlocked = await tree();
    expect(afterBlocked.version).toBe(beforeBlocked.version);
    expect(afterBlocked.tree.rooms.some((room) => room.id === "room-one")).toBe(true);
    expect(assetByName(afterBlocked, "Canonical microscope").roomId).toBe("room-one");

    const reassigned = await call(
      "PUT",
      `/api/groups/group-a/inventory/assets/${assetByName(afterBlocked, "Canonical microscope").id}`,
      { roomId: "room-two" },
    );
    expect(reassigned.status).toBe(200);
    expect(assetByName(reassigned.body, "Canonical microscope").roomId).toBe("room-two");

    const deleted = await call("DELETE", "/api/groups/group-a/inventory/rooms/room-one");
    expect(deleted.status).toBe(200);
    expect(deleted.body.tree.rooms.some((room) => room.id === "room-one")).toBe(false);
    expect(assetByName(deleted.body, "Canonical microscope").roomId).toBe("room-two");
  });

  it("keeps root deep-freezer pseudo-room deletion behavior unchanged", async () => {
    // Legacy data can still point an asset at a freezer id directly; the guard
    // must not reinterpret the freezer as a deletable canonical room.
    const docRow = db.prepare("SELECT tree FROM group_inventory_docs WHERE group_id = 'group-a'").get() as {
      tree: string;
    };
    const doc = JSON.parse(docRow.tree) as TreeResponse["tree"];
    doc.assets.push({ id: "legacy-freezer-asset", name: "Legacy freezer asset", roomId: "df-root" });
    db.prepare("UPDATE group_inventory_docs SET tree = ? WHERE group_id = 'group-a'").run(JSON.stringify(doc));

    const before = await tree();
    const removed = await call("DELETE", "/api/groups/group-a/inventory/rooms/df-root");
    expect(removed.status).toBe(404);
    expect(removed.body.error).toBe("Room not found");

    const after = await tree();
    expect(after.version).toBe(before.version);
    expect(after.tree.deepFreezers?.some((freezer) => freezer.id === "df-root")).toBe(true);
    expect(assetByName(after, "Legacy freezer asset").roomId).toBe("df-root");
  });
});
