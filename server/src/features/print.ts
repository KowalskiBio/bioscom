import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  CreateCatalogItemBodySchema,
  CreatePrintRequestBodySchema,
  PrintStatusBodySchema,
  UpdateCatalogItemBodySchema,
} from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser, requireSuperadmin } from "../auth/guards.js";
import type { InventoryHub } from "../inventory/ws.js";

interface CatalogRow {
  id: string;
  group_id: string | null;
  name: string;
  description: string | null;
  category: string | null;
  material: string | null;
  estimated_time: string | null;
  image: string | null;
}

interface PrintRequestRow {
  id: string;
  source: string;
  group_id: string | null;
  catalog_item_id: string | null;
  catalog_item_name: string | null;
  custom_design: number | null;
  note: string | null;
  quantity: number | null;
  request_date: string | null;
  requested_by: string | null;
  requested_by_uid: string | null;
  requested_by_lab_name: string | null;
  status: string | null;
}

export function registerPrintRoutes(app: FastifyInstance, config: ServerConfig, hub: InventoryHub): void {
  const db = (): Database.Database => getDatabase(config.dbPath);

  const serializeRequest = (row: PrintRequestRow): unknown => ({
    id: row.id,
    catalogItemId: row.catalog_item_id,
    catalogItemName: row.catalog_item_name,
    customDesign: row.custom_design === 1,
    note: row.note,
    quantity: row.quantity,
    requestDate: row.request_date,
    requestedBy: row.requested_by,
    requestedByUid: row.requested_by_uid,
    requestedByLabName: row.requested_by_lab_name,
    status: row.status,
  });

  app.get("/api/print/catalog", async (request, reply) => {
    if (requireUser(db(), request, reply) === null) return;
    const rows = db().prepare("SELECT * FROM print_catalog ORDER BY name").all() as CatalogRow[];
    return {
      catalog: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        material: row.material,
        estimatedTime: row.estimated_time,
        image: row.image,
      })),
    };
  });

  app.post("/api/print/catalog", async (request, reply) => {
    if (requireSuperadmin(db(), request, reply) === null) return;
    const body = CreateCatalogItemBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const id = `pc_${randomBytes(9).toString("hex")}`;
    db()
      .prepare(
        "INSERT INTO print_catalog (id, group_id, name, description, category, material, estimated_time, image) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, body.data.name, body.data.description ?? null, body.data.category ?? null, body.data.material ?? null, body.data.estimatedTime ?? null, body.data.image ?? null);
    hub.broadcastAll({ type: "reload", resource: "print" });
    return reply.status(201).send({ id });
  });

  app.put("/api/print/catalog/:id", async (request, reply) => {
    if (requireSuperadmin(db(), request, reply) === null) return;
    const id = (request.params as { id: string }).id;
    const item = db().prepare("SELECT * FROM print_catalog WHERE id = ?").get(id) as CatalogRow | undefined;
    if (item === undefined) {
      return reply.status(404).send({ error: "Catalog item not found" });
    }
    const body = UpdateCatalogItemBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    db()
      .prepare("UPDATE print_catalog SET name = ?, description = ?, category = ?, material = ?, estimated_time = ?, image = ? WHERE id = ?")
      .run(
        body.data.name ?? item.name,
        body.data.description ?? item.description,
        body.data.category ?? item.category,
        body.data.material ?? item.material,
        body.data.estimatedTime ?? item.estimated_time,
        body.data.image ?? item.image,
        id,
      );
    hub.broadcastAll({ type: "reload", resource: "print" });
    return { ok: true };
  });

  app.delete("/api/print/catalog/:id", async (request, reply) => {
    if (requireSuperadmin(db(), request, reply) === null) return;
    const id = (request.params as { id: string }).id;
    const result = db().prepare("DELETE FROM print_catalog WHERE id = ?").run(id);
    if (result.changes === 0) {
      return reply.status(404).send({ error: "Catalog item not found" });
    }
    hub.broadcastAll({ type: "reload", resource: "print" });
    return { ok: true };
  });

  app.get("/api/print/requests", async (request, reply) => {
    if (requireUser(db(), request, reply) === null) return;
    const rows = db().prepare("SELECT * FROM print_requests ORDER BY request_date DESC, id").all() as PrintRequestRow[];
    return { requests: rows.map(serializeRequest) };
  });

  app.post("/api/print/requests", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const body = CreatePrintRequestBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    if (body.data.catalogItemId === undefined && body.data.customDesign !== true) {
      return reply.status(400).send({ error: "Either a catalog item or a custom design is required" });
    }
    const id = `pr_${randomBytes(9).toString("hex")}`;
    const group = user.group_id === null
      ? undefined
      : (db().prepare("SELECT name FROM groups WHERE id = ?").get(user.group_id) as { name: string } | undefined);
    let catalogName = body.data.catalogItemName ?? null;
    if (body.data.catalogItemId !== undefined && catalogName === null) {
      const item = db().prepare("SELECT name FROM print_catalog WHERE id = ?").get(body.data.catalogItemId) as { name: string } | undefined;
      catalogName = item?.name ?? null;
    }
    db()
      .prepare(
        "INSERT INTO print_requests (id, source, group_id, catalog_item_id, catalog_item_name, custom_design, note, quantity, request_date, requested_by, requested_by_uid, requested_by_lab_name, status) VALUES (?, 'shared', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
      )
      .run(id, body.data.catalogItemId ?? null, catalogName, body.data.customDesign === true ? 1 : 0, body.data.note ?? null, body.data.quantity ?? 1, new Date().toISOString().slice(0, 10), user.name ?? user.uid, user.uid, group?.name ?? null);
    hub.broadcastAll({ type: "reload", resource: "print" });
    return reply.status(201).send({ id });
  });

  app.post("/api/print/requests/:id/status", async (request, reply) => {
    if (requireSuperadmin(db(), request, reply) === null) return;
    const id = (request.params as { id: string }).id;
    const body = PrintStatusBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const result = db().prepare("UPDATE print_requests SET status = ? WHERE id = ?").run(body.data.status, id);
    if (result.changes === 0) {
      return reply.status(404).send({ error: "Print request not found" });
    }
    hub.broadcastAll({ type: "reload", resource: "print" });
    return { ok: true };
  });
}
