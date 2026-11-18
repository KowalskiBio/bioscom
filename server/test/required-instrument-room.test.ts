import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hash as argonHash } from "@node-rs/argon2";
import { buildApp } from "../src/app.js";
import { closeDatabase, getDatabase } from "../src/db.js";

const XRW = { "X-Requested-With": "XMLHttpRequest" };

interface InstrumentView {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  contactPerson: string | null;
  contactEmail: string | null;
  ownerLabId: string | null;
  ownerLabName: string | null;
  roomGroupId: string | null;
  roomId: string | null;
  bookings: Array<{ id: string; userId: string; date: string; startTime: string; endTime: string }>;
}

let app: FastifyInstance;
let db: ReturnType<typeof getDatabase>;
let tempDir: string;
let adminCookie: string;
let readerCookie: string;
let outsiderCookie: string;
let superCookie: string;
let noGroupCookie: string;
let emptyGroupCookie: string;

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

async function listInstruments(cookie = readerCookie): Promise<InstrumentView[]> {
  const response = await app.inject({ method: "GET", url: "/api/instruments", headers: { cookie } });
  expect(response.statusCode).toBe(200);
  return (response.json() as { instruments: InstrumentView[] }).instruments;
}

async function instrument(id: string): Promise<InstrumentView> {
  const found = (await listInstruments()).find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`instrument ${id} not listed`);
  }
  return found;
}

async function createInstrument(cookie: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/instruments", headers: headers(cookie), payload });
}

async function putInstrument(cookie: string, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PUT", url: `/api/instruments/${id}`, headers: headers(cookie), payload });
}

async function book(cookie: string, id: string, payload: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: `/api/instruments/${id}/bookings`,
    headers: headers(cookie),
    payload: { date: "2032-04-01", startTime: "09:00", endTime: "10:00", ...payload },
  });
}

async function createValid(cookie: string, name: string, roomId = "room-a"): Promise<string> {
  const response = await createInstrument(cookie, {
    name,
    location: `${name} bench`,
    roomGroupId: "group-a",
    roomId,
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

function inventoryVersion(groupId: string): number {
  const row = db
    .prepare("SELECT version FROM group_inventory_docs WHERE group_id = ?")
    .get(groupId) as { version: number } | undefined;
  if (row === undefined) {
    throw new Error(`missing inventory doc for ${groupId}`);
  }
  return row.version;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "bioscom-required-instrument-room-test-"));
  const dbPath = join(tempDir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  db = getDatabase(dbPath);

  const passwordHash = await argonHash("fixture-password");
  const insertUser = db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  );
  insertUser.run("uid-req-admin", "admin@req.test", passwordHash, "Req Admin", "admin", "group-a");
  insertUser.run("uid-req-reader", "reader@req.test", passwordHash, "Req Reader", "reader", "group-a");
  insertUser.run("uid-req-outsider", "outsider@req.test", passwordHash, "Req Outsider", "admin", "group-b");
  insertUser.run("uid-req-super", "super@req.test", passwordHash, "Req Super", "superadmin", null);
  insertUser.run("uid-req-nogroup", "nogroup@req.test", passwordHash, "Req No Group", "admin", null);
  insertUser.run("uid-req-empty", "empty@req.test", passwordHash, "Req Empty", "admin", "group-empty");

  const insertGroup = db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)");
  insertGroup.run("group-a", "Lab A", "REQ-A", Date.now());
  insertGroup.run("group-b", "Lab B", "REQ-B", Date.now());
  insertGroup.run("group-empty", "Lab Empty", "REQ-E", Date.now());

  const inventoryA = {
    rooms: [
      { id: "room-a", name: "Chem A", containers: [] },
      { id: "room-a-2", name: "Chem A Annex", containers: [] },
    ],
    deepFreezers: [
      { id: "df-root", name: "Root Freezer", type: "deepfreezer", shelves: [], sharedWithGroupIds: [] },
    ],
    assetRooms: [{ id: "asset-room-a", name: "Asset Room A" }],
    assets: [],
    protocols: [],
  };
  const inventoryB = {
    rooms: [{ id: "room-b", name: "Chem B", containers: [] }],
    deepFreezers: [],
    assetRooms: [],
    assets: [],
    protocols: [],
  };
  const inventoryEmpty = {
    rooms: [],
    deepFreezers: [],
    assetRooms: [],
    assets: [],
    protocols: [],
  };
  const insertDoc = db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)");
  insertDoc.run("group-a", JSON.stringify(inventoryA));
  insertDoc.run("group-b", JSON.stringify(inventoryB));
  insertDoc.run("group-empty", JSON.stringify(inventoryEmpty));

  adminCookie = await login("admin@req.test", "fixture-password");
  readerCookie = await login("reader@req.test", "fixture-password");
  outsiderCookie = await login("outsider@req.test", "fixture-password");
  superCookie = await login("super@req.test", "fixture-password");
  noGroupCookie = await login("nogroup@req.test", "fixture-password");
  emptyGroupCookie = await login("empty@req.test", "fixture-password");
});

afterAll(async () => {
  await app.close();
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("instrument create requires a canonical room pair", () => {
  it("rejects missing, half, null and empty pairs before writing", async () => {
    const countBefore = (await listInstruments()).length;
    const invalid = [
      { name: "No pair" },
      { name: "Location only", location: "Bench 1" },
      { name: "Group only", roomGroupId: "group-a" },
      { name: "Room only", roomId: "room-a" },
      { name: "Both null", roomGroupId: null, roomId: null },
      { name: "Null group", roomGroupId: null, roomId: "room-a" },
      { name: "Null room", roomGroupId: "group-a", roomId: null },
      { name: "Empty group", roomGroupId: "", roomId: "room-a" },
      { name: "Blank group", roomGroupId: "   ", roomId: "room-a" },
      { name: "Empty room", roomGroupId: "group-a", roomId: "" },
    ];
    for (const payload of invalid) {
      const response = await createInstrument(adminCookie, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await listInstruments()).length).toBe(countBefore);
  });

  it("creates a normal instrument with an actual room, fallback location and owner-lab authority", async () => {
    const versionBefore = inventoryVersion("group-a");
    const response = await createInstrument(adminCookie, {
      name: "Ordinary Scope",
      roomGroupId: "group-a",
      roomId: "room-a",
      // Unknown owner override keys are stripped by the create schema.
      ownerLabId: "group-b",
    });
    expect(response.statusCode).toBe(201);
    const created = await instrument((response.json() as { id: string }).id);
    expect(created.roomGroupId).toBe("group-a");
    expect(created.roomId).toBe("room-a");
    expect(created.location).toBe("Chem A");
    expect(created.ownerLabId).toBe("group-a");
    expect(created.ownerLabName).toBe("Lab A");
    expect(inventoryVersion("group-a")).toBe(versionBefore);
  });

  it("keeps an explicit placement note while the room stays authoritative", async () => {
    const response = await createInstrument(adminCookie, {
      name: "Placement Note Only",
      location: "Near the window",
      roomGroupId: "group-a",
      roomId: "room-a-2",
    });
    expect(response.statusCode).toBe(201);
    const created = await instrument((response.json() as { id: string }).id);
    expect(created.roomId).toBe("room-a-2");
    expect(created.location).toBe("Near the window");
  });

  it("rejects unknown, root/deep-freezer, legacy asset-room, foreign and no-room targets", async () => {
    const countBefore = (await listInstruments()).length;
    const versionBefore = inventoryVersion("group-a");

    for (const roomId of ["missing-room", "df-root", "asset-room-a"]) {
      const response = await createInstrument(adminCookie, {
        name: `Rejected ${roomId}`,
        roomGroupId: "group-a",
        roomId,
      });
      expect(response.statusCode).toBe(404);
      expect((response.json() as { error: string }).error).toBe("Room not found");
    }

    const foreignExisting = await createInstrument(adminCookie, {
      name: "Foreign Existing",
      roomGroupId: "group-b",
      roomId: "room-b",
    });
    expect(foreignExisting.statusCode).toBe(403);
    expect((foreignExisting.json() as { error: string }).error).not.toContain("room-b");

    const foreignGhost = await createInstrument(adminCookie, {
      name: "Foreign Ghost",
      roomGroupId: "group-b",
      roomId: "ghost-in-group-b",
    });
    expect(foreignGhost.statusCode).toBe(403);
    expect((foreignGhost.json() as { error: string }).error).not.toContain("ghost-in-group-b");

    // The target group exists but has no rooms at all.
    const noRooms = await createInstrument(emptyGroupCookie, {
      name: "No Rooms Here",
      roomGroupId: "group-empty",
      roomId: "anything",
    });
    expect(noRooms.statusCode).toBe(404);
    expect((noRooms.json() as { error: string }).error).toBe("Room not found");

    expect((await listInstruments()).length).toBe(countBefore);
    expect(inventoryVersion("group-a")).toBe(versionBefore);
  });

  it("keeps reader creation forbidden", async () => {
    const response = await createInstrument(readerCookie, {
      name: "Reader Instrument",
      roomGroupId: "group-a",
      roomId: "room-a",
    });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: string }).error).toBe("Readers cannot make changes");
  });
});

describe("instrument update keeps a valid assignment mandatory", () => {
  let id = "";

  beforeAll(async () => {
    id = await createValid(adminCookie, "Editable Instrument");
  });

  it("preserves the pair through name/contact/description/location-only edits", async () => {
    const update = await putInstrument(adminCookie, id, {
      name: "Renamed Instrument",
      description: "updated",
      contactPerson: "Dr B",
      contactEmail: "b@req.test",
    });
    expect(update.statusCode).toBe(200);

    const listed = await instrument(id);
    expect(listed.name).toBe("Renamed Instrument");
    expect(listed.description).toBe("updated");
    expect(listed.contactPerson).toBe("Dr B");
    expect(listed.contactEmail).toBe("b@req.test");
    expect(listed.location).toBe("Editable Instrument bench");
    expect(listed.roomGroupId).toBe("group-a");
    expect(listed.roomId).toBe("room-a");

    const locationOnly = await putInstrument(adminCookie, id, { location: "Moved to the annex" });
    expect(locationOnly.statusCode).toBe(200);
    const afterLocation = await instrument(id);
    expect(afterLocation.location).toBe("Moved to the annex");
    expect(afterLocation.roomId).toBe("room-a");
  });

  it("allows an empty placement note to clear the note while keeping the room", async () => {
    const update = await putInstrument(adminCookie, id, { location: "" });
    expect(update.statusCode).toBe(200);
    const listed = await instrument(id);
    expect(listed.location).toBe("");
    expect(listed.roomGroupId).toBe("group-a");
    expect(listed.roomId).toBe("room-a");
  });

  it("refuses to clear the pair and does not silently unassign", async () => {
    const before = await instrument(id);
    const clear = await putInstrument(adminCookie, id, { roomGroupId: null, roomId: null });
    expect(clear.statusCode).toBe(400);
    expect((clear.json() as { error: string }).error).toContain("clearing the room assignment is not allowed");
    expect(await instrument(id)).toEqual(before);
  });

  it("reassigns to another real room in the owning lab", async () => {
    const update = await putInstrument(adminCookie, id, { roomGroupId: "group-a", roomId: "room-a-2" });
    expect(update.statusCode).toBe(200);
    const listed = await instrument(id);
    expect(listed.roomGroupId).toBe("group-a");
    expect(listed.roomId).toBe("room-a-2");
    expect(listed.location).toBe("");
  });

  it("rejects invalid targets, foreign groups, half pairs and reader edits without writing", async () => {
    const before = await instrument(id);

    for (const roomId of ["missing-room", "df-root", "asset-room-a"]) {
      const response = await putInstrument(adminCookie, id, { roomGroupId: "group-a", roomId });
      expect(response.statusCode).toBe(404);
      expect((response.json() as { error: string }).error).toBe("Room not found");
    }

    const foreign = await putInstrument(adminCookie, id, { roomGroupId: "group-b", roomId: "room-b" });
    expect(foreign.statusCode).toBe(403);
    expect((foreign.json() as { error: string }).error).not.toContain("room-b");

    const half = await putInstrument(adminCookie, id, { roomGroupId: "group-a" });
    expect(half.statusCode).toBe(400);
    const halfRoom = await putInstrument(adminCookie, id, { roomId: "room-a" });
    expect(halfRoom.statusCode).toBe(400);

    const reader = await putInstrument(readerCookie, id, { name: "Reader Rename" });
    expect(reader.statusCode).toBe(403);

    expect(await instrument(id)).toEqual(before);
  });

  it("requires a valid pair once a legacy unassigned instrument is edited", async () => {
    const legacyId = "inst-req-legacy-unassigned";
    db.prepare(
      "INSERT INTO instruments (id, source, group_id, name, location) VALUES (?, 'shared', NULL, 'Legacy Unassigned', 'Old bench')",
    ).run(legacyId);

    // Read-only legacy records remain readable.
    const legacy = await instrument(legacyId);
    expect(legacy.roomGroupId).toBeNull();
    expect(legacy.roomId).toBeNull();

    const nameOnly = await putInstrument(superCookie, legacyId, { name: "Legacy Renamed" });
    expect(nameOnly.statusCode).toBe(409);
    expect((nameOnly.json() as { error: string }).error).toContain("Assign a physical room");
    expect((await instrument(legacyId)).name).toBe("Legacy Unassigned");

    const noGroupAssign = await putInstrument(noGroupCookie, legacyId, {
      roomGroupId: "group-a",
      roomId: "room-a",
    });
    expect(noGroupAssign.statusCode).toBe(403);

    const assigned = await putInstrument(superCookie, legacyId, {
      roomGroupId: "group-a",
      roomId: "room-a",
    });
    expect(assigned.statusCode).toBe(200);
    const linked = await instrument(legacyId);
    expect(linked.ownerLabId).toBeNull();
    expect(linked.roomGroupId).toBe("group-a");
    expect(linked.roomId).toBe("room-a");
    expect(linked.location).toBe("Old bench");

    // Superadmin keeps the exceptional cross-lab privilege.
    const crossLab = await putInstrument(superCookie, legacyId, {
      roomGroupId: "group-b",
      roomId: "room-b",
    });
    expect(crossLab.statusCode).toBe(200);
    expect((await instrument(legacyId)).roomId).toBe("room-b");
  });

  it("rejects an unchanged save when the stored room is stale and repairs only with a valid target", async () => {
    const staleId = "inst-req-stale";
    db.prepare(
      "INSERT INTO instruments (id, source, group_id, name, location, owner_lab_id, owner_lab_name, room_group_id, room_id) VALUES (?, 'shared', NULL, 'Stale Instrument', 'Bench', 'group-a', 'Lab A', 'group-a', 'deleted-room')",
    ).run(staleId);

    const stale = await instrument(staleId);
    expect(stale.roomGroupId).toBe("group-a");
    expect(stale.roomId).toBe("deleted-room");

    const unchanged = await putInstrument(adminCookie, staleId, { name: "Still Stale" });
    expect(unchanged.statusCode).toBe(409);
    expect((unchanged.json() as { error: string }).error).toContain("no longer valid");
    expect((await instrument(staleId)).name).toBe("Stale Instrument");

    const repaired = await putInstrument(adminCookie, staleId, { roomGroupId: "group-a", roomId: "room-a-2" });
    expect(repaired.statusCode).toBe(200);
    const after = await instrument(staleId);
    expect(after.roomId).toBe("room-a-2");
    expect(after.name).toBe("Stale Instrument");
  });

  it("never exposes a half-pair from a legacy database row", async () => {
    const halfId = "inst-req-half-pair";
    db.prepare(
      "INSERT INTO instruments (id, source, group_id, name, owner_lab_id, owner_lab_name, room_group_id, room_id) VALUES (?, 'shared', NULL, 'Half Pair', 'group-a', 'Lab A', 'group-a', NULL)",
    ).run(halfId);

    const listed = await instrument(halfId);
    expect(listed.roomGroupId).toBeNull();
    expect(listed.roomId).toBeNull();
  });
});

describe("bookings require a valid canonical room", () => {
  it("lets a reader book and conflict-check a properly assigned instrument", async () => {
    const id = await createValid(adminCookie, "Bookable Instrument");
    const first = await book(readerCookie, id);
    expect(first.statusCode).toBe(201);
    expect((await instrument(id)).bookings).toHaveLength(1);

    const conflict = await book(readerCookie, id, { startTime: "09:30", endTime: "10:30" });
    expect(conflict.statusCode).toBe(409);
    expect((conflict.json() as { error: string }).error).toBe("This time slot is already booked");
  });

  it("rejects bookings for unassigned and stale instruments even when the body carries room details", async () => {
    const unassignedId = "inst-req-booking-unassigned";
    db.prepare(
      "INSERT INTO instruments (id, source, group_id, name) VALUES (?, 'shared', NULL, 'Unassigned Booking')",
    ).run(unassignedId);

    const unassigned = await book(readerCookie, unassignedId, {
      roomGroupId: "group-a",
      roomId: "room-a",
    });
    expect(unassigned.statusCode).toBe(409);
    expect((unassigned.json() as { error: string }).error).toContain("Assign a physical room");
    expect((await instrument(unassignedId)).roomId).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM instrument_bookings WHERE instrument_id = ?").get(unassignedId)).toEqual({
      n: 0,
    });

    const staleId = "inst-req-booking-stale";
    db.prepare(
      "INSERT INTO instruments (id, source, group_id, name, owner_lab_id, owner_lab_name, room_group_id, room_id) VALUES (?, 'shared', NULL, 'Stale Booking', 'group-a', 'Lab A', 'group-a', 'deleted-room')",
    ).run(staleId);
    const stale = await book(readerCookie, staleId);
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as { error: string }).error).toContain("Assign a physical room");
    expect(db.prepare("SELECT COUNT(*) AS n FROM instrument_bookings WHERE instrument_id = ?").get(staleId)).toEqual({
      n: 0,
    });
  });

  it("still allows cancellation on legacy instruments without a room assignment", async () => {
    const legacyId = "inst-req-cancel-legacy";
    db.prepare(
      "INSERT INTO instruments (id, source, group_id, name) VALUES (?, 'shared', NULL, 'Cancel Legacy')",
    ).run(legacyId);
    db.prepare(
      "INSERT INTO instrument_bookings (id, instrument_id, date, start_time, end_time, user_id, user_name, lab_name, note) VALUES ('booking-legacy', ?, '2032-05-01', '09:00', '10:00', 'uid-req-reader', 'Req Reader', 'Lab A', '')",
    ).run(legacyId);

    const cancel = await app.inject({
      method: "DELETE",
      url: `/api/instruments/${legacyId}/bookings/booking-legacy`,
      headers: headers(readerCookie),
    });
    expect(cancel.statusCode).toBe(200);
    expect((await instrument(legacyId)).bookings).toHaveLength(0);

    // Cancellation does not assign a room as a side effect.
    expect((await instrument(legacyId)).roomId).toBeNull();
  });

  it("keeps reader edit/delete forbidden while booking remains allowed", async () => {
    const id = await createValid(adminCookie, "Reader Rules Instrument");

    const readerPut = await putInstrument(readerCookie, id, { name: "Reader Rename" });
    expect(readerPut.statusCode).toBe(403);

    const readerDelete = await app.inject({
      method: "DELETE",
      url: `/api/instruments/${id}`,
      headers: headers(readerCookie),
    });
    expect(readerDelete.statusCode).toBe(403);

    const readerBook = await book(readerCookie, id, { date: "2032-06-01" });
    expect(readerBook.statusCode).toBe(201);
    expect((await instrument(id)).roomId).toBe("room-a");
  });
});
