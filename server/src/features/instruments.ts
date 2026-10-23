import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { BookingBodySchema, CreateInstrumentBodySchema, UpdateInstrumentBodySchema } from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import type { SessionUserRow } from "../auth/sessions.js";
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

  const withBookings = (instrument: InstrumentRow): unknown => ({
    id: instrument.id,
    name: instrument.name,
    description: instrument.description,
    location: instrument.location,
    contactPerson: instrument.contact_person,
    contactEmail: instrument.contact_email,
    ownerLabId: instrument.owner_lab_id,
    ownerLabName: instrument.owner_lab_name,
    bookings: db()
      .prepare(
        "SELECT id, instrument_id, date, start_time AS startTime, end_time AS endTime, user_id AS userId, user_name AS userName, lab_name AS labName, note FROM instrument_bookings WHERE instrument_id = ? ORDER BY date, start_time",
      )
      .all(instrument.id),
  });

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
    const id = `i_${randomBytes(9).toString("hex")}`;
    const group = user.group_id === null
      ? undefined
      : (db().prepare("SELECT name FROM groups WHERE id = ?").get(user.group_id) as { name: string } | undefined);
    db()
      .prepare(
        "INSERT INTO instruments (id, source, group_id, name, description, location, contact_person, contact_email, owner_lab_id, owner_lab_name) VALUES (?, 'shared', NULL, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, body.data.name, body.data.description ?? null, body.data.location, body.data.contactPerson ?? null, body.data.contactEmail ?? null, user.group_id, group?.name ?? null);
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
    if (!canManageInstrument(user, instrument)) {
      return reply.status(403).send({ error: "Only the owning lab or a superadmin can edit this instrument" });
    }
    const body = UpdateInstrumentBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    db()
      .prepare("UPDATE instruments SET name = ?, description = ?, location = ?, contact_person = ?, contact_email = ? WHERE id = ?")
      .run(
        body.data.name ?? instrument.name,
        body.data.description ?? instrument.description,
        body.data.location ?? instrument.location,
        body.data.contactPerson ?? instrument.contact_person,
        body.data.contactEmail ?? instrument.contact_email,
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
    if (!canManageInstrument(user, instrument)) {
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
