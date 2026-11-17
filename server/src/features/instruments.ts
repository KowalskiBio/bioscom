import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { BookingBodySchema, CreateInstrumentBodySchema, UpdateInstrumentBodySchema } from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import type { SessionUserRow } from "../auth/sessions.js";
import { isMemberOrSuperadmin, loadDoc, OpError } from "../inventory/doc.js";
import type { InventoryHub } from "../inventory/ws.js";

interface InstrumentRow {
  id: string;
  source: string;
  group_id: string | null;
  name: string;
  description: string | null;
  location: string | null;
  contact_person: string | null;
  contact_email: string | null;
  owner_lab_id: string | null;
  owner_lab_name: string | null;
  room_group_id: string | null;
  room_id: string | null;
}

type ResolvedRoomLink =
  | { ok: true; roomGroupId: string; roomId: string; roomName: string }
  | { ok: false; status: number; error: string };

/**
 * Validate a concrete instrument -> canonical room assignment. Only an actual
 * entry in the target group document's `tree.rooms` qualifies: root/deep
 * freezers, legacy asset-room ids and unknown ids are rejected. Group
 * ownership and membership are checked before the target document is loaded so
 * a foreign group cannot leak whether a room id exists.
 */
function validateInstrumentRoomTarget(
  db: Database.Database,
  user: SessionUserRow,
  ownerLabId: string | null,
  roomGroupId: string,
  roomId: string,
): ResolvedRoomLink {
  const isSuperadmin = user.role === "superadmin";
  if (!isSuperadmin && ownerLabId === null) {
    return { ok: false, status: 403, error: "Only a superadmin can assign a room to an unowned instrument" };
  }
  if (!isSuperadmin && ownerLabId !== roomGroupId) {
    return { ok: false, status: 403, error: "The room group must match the instrument's owning lab" };
  }
  if (!isMemberOrSuperadmin(user, roomGroupId)) {
    return { ok: false, status: 403, error: "You do not have access to that room group" };
  }

  let tree: ReturnType<typeof loadDoc>["tree"];
  try {
    ({ tree } = loadDoc(db, roomGroupId));
  } catch (error) {
    if (error instanceof OpError && error.status === 404) {
      return { ok: false, status: 404, error: "Room not found" };
    }
    throw error;
  }

  const room = tree.rooms.find((candidate) => candidate.id === roomId);
  if (room === undefined) {
    return { ok: false, status: 404, error: "Room not found" };
  }
  return { ok: true, roomGroupId, roomId, roomName: room.name };
}

/**
 * Resolve an update. Omitted fields preserve a currently valid assignment;
 * explicit nulls cannot clear the mandatory room; any new assignment must be a
 * valid canonical room pair. A legacy/unassigned/stale record may still be read
 * but must finish an edit with a valid pair.
 */
function resolveInstrumentRoomUpdate(
  db: Database.Database,
  user: SessionUserRow,
  instrument: InstrumentRow,
  body: { roomGroupId?: string | null; roomId?: string | null },
): ResolvedRoomLink {
  const hasGroupId = body.roomGroupId !== undefined;
  const hasRoomId = body.roomId !== undefined;

  if (!hasGroupId && !hasRoomId) {
    if (instrument.room_group_id === null || instrument.room_id === null) {
      return { ok: false, status: 409, error: "Assign a physical room to this instrument before editing it" };
    }
    const current = validateInstrumentRoomTarget(
      db,
      user,
      instrument.owner_lab_id,
      instrument.room_group_id,
      instrument.room_id,
    );
    if (!current.ok && current.status === 404) {
      return {
        ok: false,
        status: 409,
        error: "This instrument's room assignment is no longer valid; assign a valid room before editing it",
      };
    }
    return current;
  }

  if (body.roomGroupId === null && body.roomId === null) {
    return {
      ok: false,
      status: 400,
      error: "A physical room is required; clearing the room assignment is not allowed",
    };
  }

  // The shared schema rejects half-pairs, but keep this helper fail-closed so
  // it can never write an inconsistent assignment on its own.
  if (
    body.roomGroupId === undefined ||
    body.roomGroupId === null ||
    body.roomId === undefined ||
    body.roomId === null
  ) {
    return { ok: false, status: 400, error: "Invalid request" };
  }

  return validateInstrumentRoomTarget(db, user, instrument.owner_lab_id, body.roomGroupId, body.roomId);
}

/**
 * A booking requires a complete room pair that still resolves to a real room in
 * the document where the room is stored. Legacy/unassigned/stale records are
 * readable and cancellable but cannot accept new bookings.
 */
function hasValidBookingRoom(db: Database.Database, instrument: InstrumentRow): boolean {
  if (instrument.room_group_id === null || instrument.room_id === null) {
    return false;
  }
  try {
    const { tree } = loadDoc(db, instrument.room_group_id);
    return tree.rooms.some((candidate) => candidate.id === instrument.room_id);
  } catch (error) {
    if (error instanceof OpError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

interface BookingRow {
  id: string;
  instrument_id: string;
  date: string;
  start_time: string;
  end_time: string;
  user_id: string;
  user_name: string;
  lab_name: string;
  note: string;
}

export function registerInstrumentRoutes(app: FastifyInstance, config: ServerConfig, hub: InventoryHub): void {
  const db = (): Database.Database => getDatabase(config.dbPath);

function logHistory(db: Database.Database, groupId: string | null, userName: string, action: string): void {
  if (groupId === null) {
    return;
  }
  db.prepare("INSERT INTO history (group_id, timestamp, user_name, action) VALUES (?, ?, ?, ?)").run(
    groupId,
    Date.now(),
    userName,
    action,
  );
}


  const canManageInstrument = (user: SessionUserRow, instrument: InstrumentRow): boolean =>
    user.role === "superadmin" || instrument.owner_lab_id === user.group_id;

  // Readers may book instruments (and keep the existing booking-cancel rules),
  // but they must not edit or delete the instrument record itself.
  const canEditInstrument = (user: SessionUserRow, instrument: InstrumentRow): boolean =>
    user.role !== "reader" && canManageInstrument(user, instrument);

  const withBookings = (instrument: InstrumentRow): unknown => {
    // Never emit a half-pair: legacy rows with only one column set are shown as
    // unassigned, matching their inability to be booked.
    const hasRoomPair =
      typeof instrument.room_group_id === "string" &&
      instrument.room_group_id !== "" &&
      typeof instrument.room_id === "string" &&
      instrument.room_id !== "";
    return {
      id: instrument.id,
      name: instrument.name,
      description: instrument.description,
      location: instrument.location,
      contactPerson: instrument.contact_person,
      contactEmail: instrument.contact_email,
      ownerLabId: instrument.owner_lab_id,
      ownerLabName: instrument.owner_lab_name,
      roomGroupId: hasRoomPair ? instrument.room_group_id : null,
      roomId: hasRoomPair ? instrument.room_id : null,
      bookings: db()
        .prepare(
          "SELECT id, instrument_id, date, start_time AS startTime, end_time AS endTime, user_id AS userId, user_name AS userName, lab_name AS labName, note FROM instrument_bookings WHERE instrument_id = ? ORDER BY date, start_time",
        )
        .all(instrument.id),
    };
  };

  app.get("/api/instruments", async (request, reply) => {
    if (requireUser(db(), request, reply) === null) return;
    const rows = db().prepare("SELECT * FROM instruments ORDER BY name").all() as InstrumentRow[];
    return { instruments: rows.map(withBookings) };
  });

  app.post("/api/instruments", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    if (user.role === "reader") {
      return reply.status(403).send({ error: "Readers cannot make changes" });
    }
    const body = CreateInstrumentBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    // New instruments require a canonical room pair. Validate the group and
    // ownership before loading any document, then fall back a missing/blank
    // placement note to the resolved room name.
    const link = validateInstrumentRoomTarget(
      db(),
      user,
      user.group_id,
      body.data.roomGroupId,
      body.data.roomId,
    );
    if (!link.ok) {
      return reply.status(link.status).send({ error: link.error });
    }
    const location = body.data.location !== undefined && body.data.location !== "" ? body.data.location : link.roomName;
    const id = `i_${randomBytes(9).toString("hex")}`;
    const group = user.group_id === null
      ? undefined
      : (db().prepare("SELECT name FROM groups WHERE id = ?").get(user.group_id) as { name: string } | undefined);
    db()
      .prepare(
        "INSERT INTO instruments (id, source, group_id, name, description, location, contact_person, contact_email, owner_lab_id, owner_lab_name, room_group_id, room_id) VALUES (?, 'shared', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, body.data.name, body.data.description ?? null, location, body.data.contactPerson ?? null, body.data.contactEmail ?? null, user.group_id, group?.name ?? null, link.roomGroupId, link.roomId);
    hub.broadcastAll({ type: "reload", resource: "instruments" });
    logHistory(db(), user.group_id, user.name ?? user.uid, `Added instrument "${body.data.name}"`);
    return reply.status(201).send({ id });
  });

  app.put("/api/instruments/:id", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const id = (request.params as { id: string }).id;
    const instrument = db().prepare("SELECT * FROM instruments WHERE id = ?").get(id) as InstrumentRow | undefined;
    if (instrument === undefined) {
      return reply.status(404).send({ error: "Instrument not found" });
    }
    if (!canEditInstrument(user, instrument)) {
      return reply.status(403).send({ error: "Only the owning lab or a superadmin can edit this instrument" });
    }
    const body = UpdateInstrumentBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const link = resolveInstrumentRoomUpdate(db(), user, instrument, body.data);
    if (!link.ok) {
      return reply.status(link.status).send({ error: link.error });
    }
    db()
      .prepare(
        "UPDATE instruments SET name = ?, description = ?, location = ?, contact_person = ?, contact_email = ?, room_group_id = ?, room_id = ? WHERE id = ?",
      )
      .run(
        body.data.name ?? instrument.name,
        body.data.description ?? instrument.description,
        // Omitted location preserves the legacy placement note; an explicit
        // empty string clears it while the room assignment stays mandatory.
        body.data.location ?? instrument.location,
        body.data.contactPerson ?? instrument.contact_person,
        body.data.contactEmail ?? instrument.contact_email,
        link.roomGroupId,
        link.roomId,
        id,
      );
    hub.broadcastAll({ type: "reload", resource: "instruments" });
    return { ok: true };
  });

  app.delete("/api/instruments/:id", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const id = (request.params as { id: string }).id;
    const instrument = db().prepare("SELECT * FROM instruments WHERE id = ?").get(id) as InstrumentRow | undefined;
    if (instrument === undefined) {
      return reply.status(404).send({ error: "Instrument not found" });
    }
    if (!canEditInstrument(user, instrument)) {
      return reply.status(403).send({ error: "Only the owning lab or a superadmin can delete this instrument" });
    }
    const remove = db().transaction((): void => {
      db().prepare("DELETE FROM instruments WHERE id = ?").run(id);
      db().prepare("DELETE FROM instrument_bookings WHERE instrument_id = ?").run(id);
    });
    remove();
    hub.broadcastAll({ type: "reload", resource: "instruments" });
    return { ok: true };
  });

  app.post("/api/instruments/:id/bookings", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const id = (request.params as { id: string }).id;
    const instrument = db().prepare("SELECT * FROM instruments WHERE id = ?").get(id) as InstrumentRow | undefined;
    if (instrument === undefined) {
      return reply.status(404).send({ error: "Instrument not found" });
    }
    const body = BookingBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    if (body.data.endTime <= body.data.startTime) {
      return reply.status(400).send({ error: "End time must be after start time" });
    }
    // Bookings require an already-valid canonical room association. Room
    // details in the booking body are ignored (and stripped by the schema);
    // this check never creates or overrides an assignment.
    if (!hasValidBookingRoom(db(), instrument)) {
      return reply
        .status(409)
        .send({ error: "Assign a physical room to this instrument before booking" });
    }
    const conflict = db()
      .prepare(
        "SELECT id FROM instrument_bookings WHERE instrument_id = ? AND date = ? AND NOT (end_time <= ? OR start_time >= ?)",
      )
      .get(id, body.data.date, body.data.startTime, body.data.endTime) as { id: string } | undefined;
    if (conflict !== undefined) {
      return reply.status(409).send({ error: "This time slot is already booked" });
    }
    const bookingId = `b_${randomBytes(9).toString("hex")}`;
    const group = user.group_id === null
      ? undefined
      : (db().prepare("SELECT name FROM groups WHERE id = ?").get(user.group_id) as { name: string } | undefined);
    db()
      .prepare(
        "INSERT INTO instrument_bookings (id, instrument_id, date, start_time, end_time, user_id, user_name, lab_name, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(bookingId, id, body.data.date, body.data.startTime, body.data.endTime, user.uid, user.name ?? user.uid, group?.name ?? "", body.data.note ?? "");
    hub.broadcastAll({ type: "reload", resource: "instruments" });
    return reply.status(201).send({ id: bookingId });
  });

  app.delete("/api/instruments/:id/bookings/:bookingId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const params = request.params as { id: string; bookingId: string };
    const booking = db()
      .prepare("SELECT * FROM instrument_bookings WHERE id = ? AND instrument_id = ?")
      .get(params.bookingId, params.id) as BookingRow | undefined;
    if (booking === undefined) {
      return reply.status(404).send({ error: "Booking not found" });
    }
    const instrument = db().prepare("SELECT * FROM instruments WHERE id = ?").get(params.id) as InstrumentRow | undefined;
    const ownsInstrument = instrument !== undefined && canManageInstrument(user, instrument);
    if (booking.user_id !== user.uid && !ownsInstrument) {
      return reply.status(403).send({ error: "Only your own bookings can be cancelled" });
    }
    db().prepare("DELETE FROM instrument_bookings WHERE id = ?").run(params.bookingId);
    hub.broadcastAll({ type: "reload", resource: "instruments" });
    return { ok: true };
  });
}
