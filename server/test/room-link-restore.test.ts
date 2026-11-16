import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hash as argonHash } from "@node-rs/argon2";
import { buildApp } from "../src/app.js";
import { closeDatabase, getDatabase } from "../src/db.js";

const XRW = { "X-Requested-With": "XMLHttpRequest" };

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface TreeRoom {
  id: string;
  name: string;
  containers?: unknown[];
}

interface AssetRoomView {
  id: string;
  name: string;
  linkedRoomId?: string | null;
}

interface InventoryBody {
  version: number;
  tree: {
    rooms: TreeRoom[];
    deepFreezers?: Array<{ id: string; name: string }>;
    assetRooms: AssetRoomView[];
    assets: unknown[];
  };
}

interface InstrumentView {
  id: string;
  name: string;
  location: string | null;
  ownerLabId: string | null;
  roomGroupId: string | null;
  roomId: string | null;
}

interface BackupTree {
  rooms: TreeRoom[];
  deepFreezers?: Array<{ id: string; name: string; type: string; shelves: unknown[] }>;
  assetRooms: AssetRoomView[];
  assets: unknown[];
  protocols: unknown[];
}

let app: FastifyInstance;
let db: ReturnType<typeof getDatabase>;
let tempDir = "";
let adminACookie = "";
let adminBCookie = "";

function headers(cookie?: string): Record<string, string> {
  return cookie === undefined ? { ...XRW } : { ...XRW, cookie };
}

function cookieFrom(responseHeaders: Record<string, string | string[] | number | undefined>): string {
  const setCookie = responseHeaders["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (typeof first === "string" ? first : "").split(";")[0] ?? "";
}

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { ...XRW },
    payload: { email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login failed for ${email}: ${response.statusCode} ${response.body}`);
  }
  return cookieFrom(response.headers);
}

async function call<T = unknown>(
  method: Method,
  url: string,
  cookie: string,
  payload?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await app.inject({
    method,
    url,
    headers: { ...XRW, cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  const body = response.body === "" ? (undefined as T) : (JSON.parse(response.body) as T);
  return { status: response.statusCode, body };
}

function readDoc(groupId: string): { tree: string; version: number } {
  const row = db
    .prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = ?")
    .get(groupId) as { tree: string; version: number } | undefined;
  if (row === undefined) {
    throw new Error(`missing inventory doc for ${groupId}`);
  }
  return row;
}

function backupRow(backupId: string, groupId: string): { data: string } | undefined {
  return db
    .prepare("SELECT data FROM group_backups WHERE id = ? AND group_id = ?")
    .get(backupId, groupId) as { data: string } | undefined;
}

function backupCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM group_backups").get() as { n: number }).n;
}

function restoreHistoryCountFor(groupId: string, backupId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = ? AND action = ?")
      .get(groupId, `Restored backup ${backupId}`) as { n: number }
  ).n;
}

function historyCount(groupId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM history WHERE group_id = ?").get(groupId) as { n: number }).n;
}

function instrumentRow(id: string): { roomGroupId: string | null; roomId: string | null; location: string | null } | undefined {
  return db
    .prepare("SELECT room_group_id AS roomGroupId, room_id AS roomId, location FROM instruments WHERE id = ?")
    .get(id) as { roomGroupId: string | null; roomId: string | null; location: string | null } | undefined;
}

async function createBackup(cookie: string, groupId: string): Promise<string> {
  const response = await call<{ id: string }>("POST", `/api/groups/${groupId}/backups`, cookie);
  expect(response.status).toBe(201);
  return response.body.id;
}

async function restoreBackup(
  cookie: string,
  groupId: string,
  backupId: string,
): Promise<{ status: number; body: InventoryBody & { error?: string } }> {
  return call<InventoryBody & { error?: string }>(
    "POST",
    `/api/groups/${groupId}/backups/${backupId}/restore`,
    cookie,
  );
}

function findRoomByName(tree: { rooms: TreeRoom[] }, name: string): TreeRoom {
  const room = tree.rooms.find((candidate) => candidate.name === name);
  if (room === undefined) {
    throw new Error(`room ${name} missing`);
  }
  return room;
}

function findAssetRoom(tree: { assetRooms: AssetRoomView[] }, id: string): AssetRoomView {
  const room = tree.assetRooms.find((candidate) => candidate.id === id);
  if (room === undefined) {
    throw new Error(`asset room ${id} missing`);
  }
  return room;
}

function findAssetRoomByName(tree: { assetRooms: AssetRoomView[] }, name: string): AssetRoomView {
  const room = tree.assetRooms.find((candidate) => candidate.name === name);
  if (room === undefined) {
    throw new Error(`asset room ${name} missing`);
  }
  return room;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "bioscom-room-link-restore-test-"));
  const dbPath = join(tempDir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  db = getDatabase(dbPath);

  const passwordHash = await argonHash("fixture-password");
  const insertUser = db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  );
  insertUser.run("uid-restore-admin-a", "admin@restore-a.test", passwordHash, "Restore Admin A", "admin", "group-a");
  insertUser.run("uid-restore-admin-b", "admin@restore-b.test", passwordHash, "Restore Admin B", "admin", "group-b");

  const insertGroup = db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)");
  insertGroup.run("group-a", "Restore Lab A", "RESTORE-A", Date.now());
  insertGroup.run("group-b", "Restore Lab B", "RESTORE-B", Date.now());

  const docA = {
    rooms: [
      { id: "room-alpha", name: "Alpha Room", containers: [] },
      { id: "room-beta", name: "Beta Room", containers: [] },
    ],
    deepFreezers: [],
    assetRooms: [],
    assets: [],
    protocols: [],
  };
  const docB = {
    rooms: [{ id: "room-b-1", name: "B Room One", containers: [] }],
    deepFreezers: [],
    assetRooms: [
      { id: "asset-room-b-linked", name: "B Linked Assets", linkedRoomId: "room-b-1" },
      { id: "asset-room-b-null", name: "B Null Assets" },
    ],
    assets: [],
    protocols: [],
  };
  const insertDoc = db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)");
  insertDoc.run("group-a", JSON.stringify(docA));
  insertDoc.run("group-b", JSON.stringify(docB));

  adminACookie = await login("admin@restore-a.test", "fixture-password");
  adminBCookie = await login("admin@restore-b.test", "fixture-password");
});

afterAll(async () => {
  await app.close();
  closeDatabase();
  if (tempDir !== "") {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("backup restore room-link integrity", () => {
  let backupBeforeRoom = "";
  let postBackupRoomId = "";
  let linkedInstrumentId = "";

  it("rejects a restore whose SQL instrument link targets a room missing from the backup", async () => {
    backupBeforeRoom = await createBackup(adminACookie, "group-a");

    const createdRoom = await call<InventoryBody>(
      "POST",
      "/api/groups/group-a/inventory/rooms",
      adminACookie,
      { name: "Post-backup Room" },
    );
    expect(createdRoom.status).toBe(201);
    postBackupRoomId = findRoomByName(createdRoom.body.tree, "Post-backup Room").id;

    const createdInstrument = await call<{ id: string }>("POST", "/api/instruments", adminACookie, {
      name: "Linked After Backup",
      location: "Post-backup bench",
      roomGroupId: "group-a",
      roomId: postBackupRoomId,
    });
    expect(createdInstrument.status).toBe(201);
    linkedInstrumentId = createdInstrument.body.id;
    expect(instrumentRow(linkedInstrumentId)).toEqual({
      roomGroupId: "group-a",
      roomId: postBackupRoomId,
      location: "Post-backup bench",
    });

    const before = readDoc("group-a");
    const historyBefore = historyCount("group-a");
    const backupsBefore = backupCount();
    const storedBackupBefore = backupRow(backupBeforeRoom, "group-a");
    expect(storedBackupBefore).toBeDefined();

    const response = await restoreBackup(adminACookie, "group-a", backupBeforeRoom);
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("room links pointing to missing rooms");
    expect(response.body.error).toMatch(/unlink|reassign/i);
    expect(response.body.error).toMatch(/compatible backup/i);

    const after = readDoc("group-a");
    expect(after.tree).toBe(before.tree);
    expect(after.version).toBe(before.version);
    expect(historyCount("group-a")).toBe(historyBefore);
    expect(restoreHistoryCountFor("group-a", backupBeforeRoom)).toBe(0);
    expect(backupCount()).toBe(backupsBefore);
    expect(backupRow(backupBeforeRoom, "group-a")?.data).toBe(storedBackupBefore?.data);
    expect(instrumentRow(linkedInstrumentId)).toEqual({
      roomGroupId: "group-a",
      roomId: postBackupRoomId,
      location: "Post-backup bench",
    });
    expect((JSON.parse(after.tree) as { rooms: TreeRoom[] }).rooms.some((room) => room.id === postBackupRoomId)).toBe(true);
  });

  it("restores after unlinking through the instrument API while preserving location and version/history semantics", async () => {
    const listedBefore = await call<{ instruments: InstrumentView[] }>("GET", "/api/instruments", adminACookie);
    expect(listedBefore.status).toBe(200);
    const linked = listedBefore.body.instruments.find((candidate) => candidate.id === linkedInstrumentId);
    expect(linked?.location).toBe("Post-backup bench");
    expect(linked?.roomGroupId).toBe("group-a");
    expect(linked?.roomId).toBe(postBackupRoomId);

    const unlink = await call<{ ok: boolean }>(
      "PUT",
      `/api/instruments/${linkedInstrumentId}`,
      adminACookie,
      { roomGroupId: null, roomId: null },
    );
    expect(unlink.status).toBe(200);

    const listedAfter = await call<{ instruments: InstrumentView[] }>("GET", "/api/instruments", adminACookie);
    const unlinked = listedAfter.body.instruments.find((candidate) => candidate.id === linkedInstrumentId);
    expect(unlinked?.roomGroupId).toBeNull();
    expect(unlinked?.roomId).toBeNull();
    expect(unlinked?.location).toBe("Post-backup bench");
    expect(unlinked?.ownerLabId).toBe("group-a");
    expect(instrumentRow(linkedInstrumentId)).toEqual({
      roomGroupId: null,
      roomId: null,
      location: "Post-backup bench",
    });

    const beforeRestore = readDoc("group-a");
    const historyBefore = historyCount("group-a");

    const response = await restoreBackup(adminACookie, "group-a", backupBeforeRoom);
    expect(response.status).toBe(200);
    expect(response.body.version).toBe(beforeRestore.version + 1);

    const active = readDoc("group-a");
    expect(active.version).toBe(response.body.version);
    expect(JSON.parse(active.tree)).toEqual(response.body.tree);
    expect((JSON.parse(active.tree) as { rooms: TreeRoom[] }).rooms.some((room) => room.id === postBackupRoomId)).toBe(false);
    expect(historyCount("group-a")).toBe(historyBefore + 1);
    expect(restoreHistoryCountFor("group-a", backupBeforeRoom)).toBe(1);

    const inventory = await call<InventoryBody>("GET", "/api/groups/group-a/inventory", adminACookie);
    expect(inventory.status).toBe(200);
    expect(inventory.body.version).toBe(response.body.version);
    expect(inventory.body.tree).toEqual(response.body.tree);
  });

  it("rejects a restored asset-room link to a missing physical room without name or freezer-id matching", async () => {
    const createdAssetRoom = await call<InventoryBody>(
      "POST",
      "/api/groups/group-a/inventory/asset-rooms",
      adminACookie,
      { name: "Mapped Asset Room", linkedRoomId: "room-alpha" },
    );
    expect(createdAssetRoom.status).toBe(201);
    const mappedAssetRoomId = findAssetRoomByName(createdAssetRoom.body.tree, "Mapped Asset Room").id;

    const backupId = await createBackup(adminACookie, "group-a");
    const seeded = backupRow(backupId, "group-a");
    expect(seeded).toBeDefined();
    const corrupt = JSON.parse(seeded?.data ?? "{}") as BackupTree;

    // Keep the asset-room link, but remove its target from the backup's real
    // rooms. Add both a same-named room and a freezer using the old id so a
    // name-based or pseudo-room-based guard would incorrectly accept this.
    corrupt.rooms = corrupt.rooms.filter((room) => room.id !== "room-alpha");
    corrupt.rooms.push({ id: "room-alpha-copy", name: "Alpha Room", containers: [] });
    corrupt.deepFreezers = [
      ...(corrupt.deepFreezers ?? []),
      { id: "room-alpha", name: "Decoy Freezer", type: "deepfreezer", shelves: [] },
    ];
    expect(findAssetRoom(corrupt, mappedAssetRoomId).linkedRoomId).toBe("room-alpha");

    db.prepare("UPDATE group_backups SET data = ? WHERE id = ? AND group_id = ?").run(
      JSON.stringify(corrupt),
      backupId,
      "group-a",
    );

    const before = readDoc("group-a");
    const historyBefore = historyCount("group-a");

    const rejected = await restoreBackup(adminACookie, "group-a", backupId);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error).toContain("room links pointing to missing rooms");
    expect(rejected.body.error).toMatch(/unlink|reassign/i);
    expect(rejected.body.error).toMatch(/compatible backup/i);

    const afterReject = readDoc("group-a");
    expect(afterReject.tree).toBe(before.tree);
    expect(afterReject.version).toBe(before.version);
    expect(historyCount("group-a")).toBe(historyBefore);
    expect(restoreHistoryCountFor("group-a", backupId)).toBe(0);

    const unchanged = JSON.parse(afterReject.tree) as {
      rooms: TreeRoom[];
      deepFreezers?: Array<{ id: string; name: string }>;
      assetRooms: AssetRoomView[];
    };
    expect(unchanged.rooms.some((room) => room.id === "room-alpha")).toBe(true);
    expect(unchanged.rooms.some((room) => room.id === "room-alpha-copy")).toBe(false);
    expect((unchanged.deepFreezers ?? []).some((freezer) => freezer.id === "room-alpha")).toBe(false);
    expect(findAssetRoom(unchanged, mappedAssetRoomId).linkedRoomId).toBe("room-alpha");

    // Empty and malformed assigned values are rejected rather than silently
    // cleared by the schema's optional-id coercion.
    for (const malformed of ["", 42] as unknown[]) {
      const mutated = JSON.parse((backupRow(backupId, "group-a") as { data: string }).data) as BackupTree;
      (findAssetRoom(mutated, mappedAssetRoomId) as { linkedRoomId?: unknown }).linkedRoomId = malformed;
      db.prepare("UPDATE group_backups SET data = ? WHERE id = ? AND group_id = ?").run(
        JSON.stringify(mutated),
        backupId,
        "group-a",
      );

      const malformedRejected = await restoreBackup(adminACookie, "group-a", backupId);
      expect(malformedRejected.status).toBe(409);
      expect(malformedRejected.body.error).toContain("room links pointing to missing rooms");
      const stillUnchanged = readDoc("group-a");
      expect(stillUnchanged.tree).toBe(before.tree);
      expect(stillUnchanged.version).toBe(before.version);
      expect(historyCount("group-a")).toBe(historyBefore);
      expect(restoreHistoryCountFor("group-a", backupId)).toBe(0);
    }

    // A null link is allowed: the same synthetic backup becomes restorable once
    // the dangling assignment itself is removed.
    const relaxed = JSON.parse((backupRow(backupId, "group-a") as { data: string }).data) as BackupTree;
    const relaxedAssetRoom = findAssetRoom(relaxed, mappedAssetRoomId);
    relaxedAssetRoom.linkedRoomId = null;
    db.prepare("UPDATE group_backups SET data = ? WHERE id = ? AND group_id = ?").run(
      JSON.stringify(relaxed),
      backupId,
      "group-a",
    );

    const beforeSuccess = readDoc("group-a");
    const historyBeforeSuccess = historyCount("group-a");
    const succeeded = await restoreBackup(adminACookie, "group-a", backupId);
    expect(succeeded.status).toBe(200);
    expect(succeeded.body.version).toBe(beforeSuccess.version + 1);

    const restored = readDoc("group-a");
    expect(restored.version).toBe(succeeded.body.version);
    const restoredTree = JSON.parse(restored.tree) as {
      rooms: TreeRoom[];
      deepFreezers?: Array<{ id: string; name: string }>;
      assetRooms: AssetRoomView[];
    };
    expect(restoredTree.rooms.some((room) => room.id === "room-alpha")).toBe(false);
    expect(restoredTree.rooms.some((room) => room.id === "room-alpha-copy" && room.name === "Alpha Room")).toBe(true);
    expect(
      restoredTree.deepFreezers?.some((freezer) => freezer.id === "room-alpha" && freezer.name === "Decoy Freezer"),
    ).toBe(true);
    expect(findAssetRoom(restoredTree, mappedAssetRoomId).linkedRoomId ?? null).toBeNull();
    expect(historyCount("group-a")).toBe(historyBeforeSuccess + 1);
    expect(restoreHistoryCountFor("group-a", backupId)).toBe(1);

    const inventory = await call<InventoryBody>("GET", "/api/groups/group-a/inventory", adminACookie);
    expect(inventory.status).toBe(200);
    expect(inventory.body.version).toBe(succeeded.body.version);
    expect(inventory.body.tree).toEqual(succeeded.body.tree);
  });

  it("allows a valid linked layout and null asset-room mapping while preserving existing SQL links", async () => {
    const createdInstrument = await call<{ id: string }>("POST", "/api/instruments", adminBCookie, {
      name: "Valid B Instrument",
      location: "B Bench",
      roomGroupId: "group-b",
      roomId: "room-b-1",
    });
    expect(createdInstrument.status).toBe(201);
    const validInstrumentId = createdInstrument.body.id;

    const backupId = await createBackup(adminBCookie, "group-b");
    const extraRoom = await call<InventoryBody>(
      "POST",
      "/api/groups/group-b/inventory/rooms",
      adminBCookie,
      { name: "B Extra" },
    );
    expect(extraRoom.status).toBe(201);
    const extraRoomId = findRoomByName(extraRoom.body.tree, "B Extra").id;

    const beforeRestore = readDoc("group-b");
    const historyBefore = historyCount("group-b");

    const response = await restoreBackup(adminBCookie, "group-b", backupId);
    expect(response.status).toBe(200);
    expect(response.body.version).toBe(beforeRestore.version + 1);

    const active = readDoc("group-b");
    expect(active.version).toBe(response.body.version);
    expect(JSON.parse(active.tree)).toEqual(response.body.tree);
    expect(response.body.tree.rooms.some((room) => room.id === "room-b-1")).toBe(true);
    expect(response.body.tree.rooms.some((room) => room.id === extraRoomId)).toBe(false);
    expect(findAssetRoom(response.body.tree, "asset-room-b-linked").linkedRoomId).toBe("room-b-1");
    expect(findAssetRoom(response.body.tree, "asset-room-b-null").linkedRoomId ?? null).toBeNull();
    expect(instrumentRow(validInstrumentId)).toEqual({
      roomGroupId: "group-b",
      roomId: "room-b-1",
      location: "B Bench",
    });
    expect(historyCount("group-b")).toBe(historyBefore + 1);
    expect(restoreHistoryCountFor("group-b", backupId)).toBe(1);

    const inventory = await call<InventoryBody>("GET", "/api/groups/group-b/inventory", adminBCookie);
    expect(inventory.status).toBe(200);
    expect(inventory.body.version).toBe(response.body.version);
    expect(inventory.body.tree).toEqual(response.body.tree);
  });
});
