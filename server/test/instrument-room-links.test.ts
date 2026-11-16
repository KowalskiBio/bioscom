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

const ADMIN_BOOKING_DATE = "2031-03-01";

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

function inventoryVersion(groupId: string): number {
  const row = db
    .prepare("SELECT version FROM group_inventory_docs WHERE group_id = ?")
    .get(groupId) as { version: number } | undefined;
  if (row === undefined) {
    throw new Error(`missing inventory doc for ${groupId}`);
  }
  return row.version;
}

async function createInstrument(cookie: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/instruments",
    headers: headers(cookie),
    payload,
  });
}

async function putInstrument(cookie: string, id: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "PUT",
    url: `/api/instruments/${id}`,
    headers: headers(cookie),
    payload,
  });
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "bioscom-instrument-links-test-"));
  const dbPath = join(tempDir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  db = getDatabase(dbPath);

  const passwordHash = await argonHash("fixture-password");
  const insertUser = db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  );
  insertUser.run("uid-link-admin", "admin@links.test", passwordHash, "Link Admin", "admin", "group-a");
  insertUser.run("uid-link-reader", "reader@links.test", passwordHash, "Link Reader", "reader", "group-a");
  insertUser.run("uid-link-outsider", "outsider@links.test", passwordHash, "Link Outsider", "admin", "group-b");
  insertUser.run("uid-link-super", "super@links.test", passwordHash, "Link Super", "superadmin", null);
  insertUser.run("uid-link-nogroup", "nogroup@links.test", passwordHash, "Link No Group", "admin", null);

  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-a', 'Lab A', 'LINKS-A', ?)").run(Date.now());
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES ('group-b', 'Lab B', 'LINKS-B', ?)").run(Date.now());

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
    rooms: [{ id: "room-b", name: "Chem A", containers: [] }],
    deepFreezers: [],
    assetRooms: [],
    assets: [],
    protocols: [],
  };
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-a', ?, 0)").run(
    JSON.stringify(inventoryA),
  );
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES ('group-b', ?, 0)").run(
    JSON.stringify(inventoryB),
  );

  adminCookie = await login("admin@links.test", "fixture-password");
  readerCookie = await login("reader@links.test", "fixture-password");
  outsiderCookie = await login("outsider@links.test", "fixture-password");
  superCookie = await login("super@links.test", "fixture-password");
  noGroupCookie = await login("nogroup@links.test", "fixture-password");
});

afterAll(async () => {
  await app.close();
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("instrument room links", () => {
  let legacyId = "";
  let linkedId = "";

  it("creates and lists a legacy unlinked instrument with location and owner preserved", async () => {
    const versionBefore = inventoryVersion("group-a");
    const create = await createInstrument(adminCookie, { name: "Legacy Scope", location: "B302 bench" });
    expect(create.statusCode).toBe(201);
    legacyId = (create.json() as { id: string }).id;

    const listed = await instrument(legacyId);
    expect(listed.location).toBe("B302 bench");
    expect(listed.roomGroupId).toBeNull();
    expect(listed.roomId).toBeNull();
    expect(listed.ownerLabId).toBe("group-a");
    expect(listed.ownerLabName).toBe("Lab A");
    expect(listed.bookings).toEqual([]);
    expect(inventoryVersion("group-a")).toBe(versionBefore);
  });

  it("creates a linked instrument and exposes the link, owner and bookings globally", async () => {
    const versionBefore = inventoryVersion("group-a");
    const create = await createInstrument(adminCookie, {
      name: "Linked HPLC",
      description: "binary pump",
      location: "Chem A bench",
      contactPerson: "Dr A",
      contactEmail: "a@links.test",
      roomGroupId: "group-a",
      roomId: "room-a",
    });
    expect(create.statusCode).toBe(201);
    linkedId = (create.json() as { id: string }).id;

    const booking = await app.inject({
      method: "POST",
      url: `/api/instruments/${linkedId}/bookings`,
      headers: headers(readerCookie),
      payload: { date: "2031-02-01", startTime: "09:00", endTime: "10:00", note: "run" },
    });
    expect(booking.statusCode).toBe(201);

    const listed = await instrument(linkedId);
    expect(listed.roomGroupId).toBe("group-a");
    expect(listed.roomId).toBe("room-a");
    expect(listed.location).toBe("Chem A bench");
    expect(listed.ownerLabId).toBe("group-a");
    expect(listed.ownerLabName).toBe("Lab A");
    expect(listed.contactPerson).toBe("Dr A");
    expect(listed.contactEmail).toBe("a@links.test");
    expect(listed.bookings).toHaveLength(1);
    expect(listed.bookings[0]?.userId).toBe("uid-link-reader");
    expect(inventoryVersion("group-a")).toBe(versionBefore);

    // Global cross-lab listing remains available to an authenticated reader.
    const asOutsider = await listInstruments(outsiderCookie);
    expect(asOutsider.find((candidate) => candidate.id === linkedId)?.roomGroupId).toBe("group-a");
  });

  it("keeps the link on a name-only owner update", async () => {
    const update = await putInstrument(adminCookie, linkedId, { name: "Linked HPLC Renamed" });
    expect(update.statusCode).toBe(200);

    const listed = await instrument(linkedId);
    expect(listed.name).toBe("Linked HPLC Renamed");
    expect(listed.location).toBe("Chem A bench");
    expect(listed.roomGroupId).toBe("group-a");
    expect(listed.roomId).toBe("room-a");
    expect(listed.ownerLabId).toBe("group-a");
  });

  it("re-assigns to another real room in the owning lab", async () => {
    const update = await putInstrument(adminCookie, linkedId, { roomGroupId: "group-a", roomId: "room-a-2" });
    expect(update.statusCode).toBe(200);

    const listed = await instrument(linkedId);
    expect(listed.roomGroupId).toBe("group-a");
    expect(listed.roomId).toBe("room-a-2");
    expect(listed.location).toBe("Chem A bench");
  });

  it("clears both link columns explicitly without touching the literal location", async () => {
    const update = await putInstrument(adminCookie, linkedId, { roomGroupId: null, roomId: null });
    expect(update.statusCode).toBe(200);

    const listed = await instrument(linkedId);
    expect(listed.roomGroupId).toBeNull();
    expect(listed.roomId).toBeNull();
    expect(listed.location).toBe("Chem A bench");
    expect(listed.ownerLabId).toBe("group-a");
  });

  it("rejects invalid room targets without writing or leaking foreign room existence", async () => {
    const relink = await putInstrument(adminCookie, linkedId, { roomGroupId: "group-a", roomId: "room-a" });
    expect(relink.statusCode).toBe(200);
    const before = await instrument(linkedId);
    const countBefore = (await listInstruments()).length;

    const invalidTargets = [
      { roomGroupId: "group-a", roomId: "missing-room" },
      { roomGroupId: "group-a", roomId: "df-root" },
      { roomGroupId: "group-a", roomId: "asset-room-a" },
    ];
    for (const payload of invalidTargets) {
      const response = await putInstrument(adminCookie, linkedId, payload);
      expect(response.statusCode).toBe(404);
      expect((response.json() as { error: string }).error).toBe("Room not found");
    }

    // The foreign-group check happens before the target document is consulted:
    // a ghost room in group-b is still a 403, not a 404 or a name leak.
    const foreignExisting = await putInstrument(adminCookie, linkedId, {
      roomGroupId: "group-b",
      roomId: "room-b",
    });
    expect(foreignExisting.statusCode).toBe(403);
    expect((foreignExisting.json() as { error: string }).error).not.toContain("room-b");

    const foreignGhost = await putInstrument(adminCookie, linkedId, {
      roomGroupId: "group-b",
      roomId: "ghost-in-group-b",
    });
    expect(foreignGhost.statusCode).toBe(403);
    expect((foreignGhost.json() as { error: string }).error).not.toContain("ghost-in-group-b");

    const incompleteGroup = await putInstrument(adminCookie, linkedId, { roomGroupId: "group-a" });
    expect(incompleteGroup.statusCode).toBe(400);
    const incompleteRoom = await putInstrument(adminCookie, linkedId, { roomId: "room-a" });
    expect(incompleteRoom.statusCode).toBe(400);

    const rejectedCreate = await createInstrument(adminCookie, {
      name: "Never Created",
      location: "X",
      roomGroupId: "group-a",
      roomId: "df-root",
    });
    expect(rejectedCreate.statusCode).toBe(404);
    const foreignCreate = await createInstrument(adminCookie, {
      name: "Never Created Abroad",
      location: "X",
      roomGroupId: "group-b",
      roomId: "ghost-in-group-b",
    });
    expect(foreignCreate.statusCode).toBe(403);

    expect((await listInstruments()).length).toBe(countBefore);
    expect(await instrument(linkedId)).toEqual(before);
  });

  it("denies reader owner edits/deletes but keeps reader bookings and cancel behavior", async () => {
    const before = await instrument(linkedId);

    const readerPut = await putInstrument(readerCookie, linkedId, { name: "Reader Edit" });
    expect(readerPut.statusCode).toBe(403);
    const readerDelete = await app.inject({
      method: "DELETE",
      url: `/api/instruments/${linkedId}`,
      headers: headers(readerCookie),
    });
    expect(readerDelete.statusCode).toBe(403);
    expect(await instrument(linkedId)).toEqual(before);

    const readerBooking = await app.inject({
      method: "POST",
      url: `/api/instruments/${linkedId}/bookings`,
      headers: headers(readerCookie),
      payload: { date: ADMIN_BOOKING_DATE, startTime: "11:00", endTime: "12:00" },
    });
    expect(readerBooking.statusCode).toBe(201);
    const conflict = await app.inject({
      method: "POST",
      url: `/api/instruments/${linkedId}/bookings`,
      headers: headers(readerCookie),
      payload: { date: ADMIN_BOOKING_DATE, startTime: "11:30", endTime: "12:30" },
    });
    expect(conflict.statusCode).toBe(409);

    // Existing cancel behavior is intentionally kept: a reader in the owning
    // lab could already cancel bookings on that lab's instrument.
    const adminBooking = await app.inject({
      method: "POST",
      url: `/api/instruments/${linkedId}/bookings`,
      headers: headers(adminCookie),
      payload: { date: ADMIN_BOOKING_DATE, startTime: "13:00", endTime: "14:00" },
    });
    expect(adminBooking.statusCode).toBe(201);
    const cancelOther = await app.inject({
      method: "DELETE",
      url: `/api/instruments/${linkedId}/bookings/${(adminBooking.json() as { id: string }).id}`,
      headers: headers(readerCookie),
    });
    expect(cancelOther.statusCode).toBe(200);
  });

  it("does not let an outsider editor take ownership of the link", async () => {
    const before = await instrument(linkedId);
    const attempt = await putInstrument(outsiderCookie, linkedId, {
      roomGroupId: "group-b",
      roomId: "room-b",
    });
    expect(attempt.statusCode).toBe(403);
    expect(await instrument(linkedId)).toEqual(before);
  });

  it("allows only a superadmin to assign a room to a legacy owner-null record", async () => {
    const create = await createInstrument(superCookie, { name: "Legacy No Owner", location: "Unassigned" });
    expect(create.statusCode).toBe(201);
    const legacyIdWithoutOwner = (create.json() as { id: string }).id;
    const created = await instrument(legacyIdWithoutOwner);
    expect(created.ownerLabId).toBeNull();
    expect(created.roomGroupId).toBeNull();

    // A non-superadmin with no group can manage the null-owner row under the
    // legacy ownership rule, but must not be allowed to attach a room.
    const denied = await putInstrument(noGroupCookie, legacyIdWithoutOwner, {
      roomGroupId: "group-a",
      roomId: "room-a",
    });
    expect(denied.statusCode).toBe(403);
    expect((await instrument(legacyIdWithoutOwner)).roomId).toBeNull();

    const assigned = await putInstrument(superCookie, legacyIdWithoutOwner, {
      roomGroupId: "group-a",
      roomId: "room-a",
    });
    expect(assigned.statusCode).toBe(200);
    const linked = await instrument(legacyIdWithoutOwner);
    expect(linked.ownerLabId).toBeNull();
    expect(linked.roomGroupId).toBe("group-a");
    expect(linked.roomId).toBe("room-a");
    expect(linked.location).toBe("Unassigned");

    // Superadmin keeps the broad ability to point it at rooms in another lab.
    const reassigned = await putInstrument(superCookie, legacyIdWithoutOwner, {
      roomGroupId: "group-b",
      roomId: "room-b",
    });
    expect(reassigned.statusCode).toBe(200);
    expect((await instrument(legacyIdWithoutOwner)).roomId).toBe("room-b");
  });
});
