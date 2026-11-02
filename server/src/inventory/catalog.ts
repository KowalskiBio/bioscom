import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import { isMemberOrSuperadmin } from "./doc.js";

interface StockRow {
  id: string;
  group_id: string;
  batch_id: string;
  location_id: string;
  position: string | null;
  custom_position: string | null;
  shelf_override: string | null;
  current_quantity: number | null;
  quantity_unit: string | null;
  concentration: number | null;
  concentration_unit: string | null;
  note: string | null;
  barcode: string | null;
  status: string;
  container_type: string | null;
  material_id: string;
  material_name: string;
  type_key: string;
  material_attributes: string;
  lot_code: string | null;
  origin_type: string;
  expires_at: number | null;
  received_at: number | null;
  prepared_at: number | null;
  manufacturer_name: string | null;
  catalog_number: string | null;
  product_name: string | null;
  product_id: string | null;
  location_name: string;
  rack_name: string | null;
  box_name: string | null;
  location_parent_id: string | null;
  container_name: string | null;
  room_id: string | null;
  room_name: string | null;
}

interface MaterialRow {
  id: string;
  group_id: string;
  type_key: string;
  name: string;
  description: string | null;
  attributes: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

const STOCK_SELECT = `
  SELECT s.id, s.group_id, s.batch_id, s.location_id, s.position, s.custom_position, s.shelf_override,
         s.current_quantity, s.quantity_unit, s.concentration, s.concentration_unit, s.note, s.barcode, s.status,
         s.container_type,
         m.id AS material_id, m.name AS material_name, m.type_key AS type_key, m.attributes AS material_attributes,
         b.lot_code, b.origin_type, b.expires_at, b.received_at, b.prepared_at,
         p.id AS product_id, p.manufacturer_name, p.catalog_number, p.product_name,
         l.name AS location_name, l.rack_name, l.box_name, l.parent_id AS location_parent_id,
         c.name AS container_name, r.id AS room_id, r.name AS room_name
  FROM stocks s
  JOIN batches b ON b.id = s.batch_id
  JOIN materials m ON m.id = b.material_id
  LEFT JOIN products p ON p.id = b.product_id
  JOIN locations l ON l.id = s.location_id
  LEFT JOIN locations c ON c.id = l.parent_id
  LEFT JOIN locations r ON r.id = c.parent_id`;

function stockToJson(row: StockRow) {
  const path = [row.room_name, row.container_name, row.location_name]
    .filter((part) => part !== null && part !== "")
    .join(" / ");
  return {
    id: row.id,
    name: row.material_name,
    type: row.type_key,
    quantity: row.current_quantity,
    unit: row.quantity_unit,
    concentration: row.concentration,
    concentrationUnit: row.concentration_unit,
    note: row.note,
    barcode: row.barcode,
    status: row.status,
    position: row.position,
    customPosition: row.custom_position,
    location: {
      id: row.location_id,
      name: row.location_name,
      rackName: row.rack_name,
      boxName: row.box_name,
      containerId: row.location_parent_id,
      containerName: row.container_name,
      roomId: row.room_id,
      roomName: row.room_name,
      path,
    },
    batch: {
      id: row.batch_id,
      lotCode: row.lot_code,
      originType: row.origin_type,
      expiresAt: row.expires_at,
      receivedAt: row.received_at,
      preparedAt: row.prepared_at,
    },
    product:
      row.product_id === null
        ? null
        : {
            id: row.product_id,
            manufacturer: row.manufacturer_name,
            catalogNumber: row.catalog_number,
            productName: row.product_name,
          },
    materialId: row.material_id,
    attributes: JSON.parse(row.material_attributes) as unknown,
  };
}

function materialToJson(row: MaterialRow, counts: { products: number; batches: number; stocks: number; locations: number }) {
  return {
    id: row.id,
    groupId: row.group_id,
    type: row.type_key,
    name: row.name,
    description: row.description,
    attributes: JSON.parse(row.attributes) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    counts,
  };
}

export function registerCatalogRoutes(app: FastifyInstance, config: ServerConfig): void {
  const db = (): Database.Database => getDatabase(config.dbPath);

  app.get("/api/groups/:id/material-types", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    if (!isMemberOrSuperadmin(user, groupId)) {
      return reply.status(403).send({ error: "Not a member of this lab" });
    }
    const types = db().prepare("SELECT key, label, schema_version, fields FROM material_types ORDER BY key").all();
    return {
      types: (types as Array<{ key: string; label: string; schema_version: number; fields: string }>).map((row) => ({
        key: row.key,
        label: row.label,
        schemaVersion: row.schema_version,
        fields: JSON.parse(row.fields) as unknown,
      })),
    };
  });

  app.get("/api/groups/:id/materials", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    if (!isMemberOrSuperadmin(user, groupId)) {
      return reply.status(403).send({ error: "Not a member of this lab" });
    }
    const query = request.query as { type?: string; q?: string; limit?: string; page?: string; archived?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 200) || 200, 1), 500);
    const page = Math.max(Number(query.page ?? 1) || 1, 1);

    const where: string[] = ["m.group_id = ?"];
    const params: unknown[] = [groupId];
    if (query.archived !== "true") {
      where.push("m.archived_at IS NULL");
    }
    if (typeof query.type === "string" && query.type !== "") {
      where.push("m.type_key = ?");
      params.push(query.type);
    }
    if (typeof query.q === "string" && query.q.trim() !== "") {
      where.push("m.name LIKE ? COLLATE NOCASE");
      params.push(`%${query.q.trim()}%`);
    }
    const whereSql = where.join(" AND ");

    const total = (db().prepare(`SELECT COUNT(*) AS n FROM materials m WHERE ${whereSql}`).get(...params) as { n: number }).n;
    const rows = db()
      .prepare(
        `SELECT m.*,
           (SELECT COUNT(*) FROM products p WHERE p.material_id = m.id) AS products,
           (SELECT COUNT(*) FROM batches b WHERE b.material_id = m.id) AS batches,
           (SELECT COUNT(*) FROM stocks s JOIN batches b2 ON b2.id = s.batch_id WHERE b2.material_id = m.id) AS stocks,
           (SELECT COUNT(DISTINCT s.location_id) FROM stocks s JOIN batches b3 ON b3.id = s.batch_id WHERE b3.material_id = m.id) AS locations
         FROM materials m WHERE ${whereSql}
         ORDER BY m.name COLLATE NOCASE, m.id LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, (page - 1) * limit) as Array<MaterialRow & { products: number; batches: number; stocks: number; locations: number }>;

    return {
      materials: rows.map((row) =>
        materialToJson(row, { products: row.products, batches: row.batches, stocks: row.stocks, locations: row.locations }),
      ),
      total,
      page,
      limit,
    };
  });

  app.get("/api/groups/:id/materials/:materialId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const materialId = (request.params as { materialId: string }).materialId;
    if (!isMemberOrSuperadmin(user, groupId)) {
      return reply.status(403).send({ error: "Not a member of this lab" });
    }
    const material = db().prepare("SELECT * FROM materials WHERE id = ? AND group_id = ?").get(materialId, groupId) as
      | MaterialRow
      | undefined;
    if (material === undefined) {
      return reply.status(404).send({ error: "Material not found" });
    }
    const products = db()
      .prepare("SELECT * FROM products WHERE material_id = ? ORDER BY created_at, id")
      .all(materialId) as Array<Record<string, unknown>>;
    const batches = db()
      .prepare(
        `SELECT b.*, p.manufacturer_name, p.catalog_number, p.product_name
         FROM batches b LEFT JOIN products p ON p.id = b.product_id
         WHERE b.material_id = ? ORDER BY b.created_at, b.id`,
      )
      .all(materialId) as Array<Record<string, unknown> & { manufacturer_name: string | null; catalog_number: string | null; product_name: string | null }>;
    const stocks = db()
      .prepare(`${STOCK_SELECT} WHERE s.group_id = ? AND b.material_id = ? ORDER BY r.name, c.name, l.name`)
      .all(groupId, materialId) as StockRow[];

    return {
      material: materialToJson(material, {
        products: products.length,
        batches: batches.length,
        stocks: stocks.length,
        locations: new Set(stocks.map((s) => s.location_id)).size,
      }),
      products: products.map((p) => ({
        id: p.id,
        manufacturer: p.manufacturer_name ?? null,
        supplier: p.supplier_name ?? null,
        catalogNumber: p.catalog_number ?? null,
        productName: p.product_name ?? null,
        variant: p.variant ?? null,
        attributes: typeof p.attributes === "string" ? (JSON.parse(p.attributes as string) as unknown) : {},
      })),
      batches: batches.map((b) => ({
        id: b.id,
        productId: b.product_id ?? null,
        lotCode: b.lot_code ?? null,
        originType: b.origin_type,
        receivedAt: b.received_at ?? null,
        preparedAt: b.prepared_at ?? null,
        preparedBy: b.prepared_by ?? null,
        expiresAt: b.expires_at ?? null,
        product:
          b.product_id === null
            ? null
            : { manufacturer: b.manufacturer_name, catalogNumber: b.catalog_number, productName: b.product_name },
      })),
      stocks: stocks.map(stockToJson),
    };
  });

  app.get("/api/groups/:id/stocks", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    if (!isMemberOrSuperadmin(user, groupId)) {
      return reply.status(403).send({ error: "Not a member of this lab" });
    }
    const query = request.query as {
      locationId?: string;
      type?: string;
      status?: string;
      expiresBefore?: string;
      q?: string;
      limit?: string;
      page?: string;
    };
    const limit = Math.min(Math.max(Number(query.limit ?? 200) || 200, 1), 500);
    const page = Math.max(Number(query.page ?? 1) || 1, 1);

    let recursiveCte = "";
    const cteParams: unknown[] = [];
    const where: string[] = [];
    const whereParams: unknown[] = [];

    if (typeof query.locationId === "string" && query.locationId !== "") {
      const location = db()
        .prepare("SELECT id, kind FROM locations WHERE id = ? AND group_id = ?")
        .get(query.locationId, groupId) as { id: string; kind: string } | undefined;
      if (location === undefined) {
        return reply.status(404).send({ error: "Location not found" });
      }
      recursiveCte = "WITH RECURSIVE sub(id) AS (SELECT id FROM locations WHERE id = ? UNION ALL SELECT l2.id FROM locations l2 JOIN sub ON l2.parent_id = sub.id)";
      cteParams.push(query.locationId);
      where.push("s.location_id IN (SELECT id FROM sub)");
    }

    where.push("s.group_id = ?");
    whereParams.push(groupId);
    if (typeof query.type === "string" && query.type !== "") {
      where.push("m.type_key = ?");
      whereParams.push(query.type);
    }
    if (typeof query.status === "string" && query.status !== "") {
      where.push("s.status = ?");
      whereParams.push(query.status);
    }
    if (query.expiresBefore !== undefined && query.expiresBefore !== "") {
      const cutoff = Number(query.expiresBefore);
      if (!Number.isFinite(cutoff)) {
        return reply.status(400).send({ error: "expiresBefore must be an epoch ms number" });
      }
      where.push("b.expires_at IS NOT NULL AND b.expires_at <= ?");
      whereParams.push(cutoff);
    }
    if (typeof query.q === "string" && query.q.trim() !== "") {
      const like = `%${query.q.trim()}%`;
      where.push(
        "(m.name LIKE ? COLLATE NOCASE OR json_extract(m.attributes, '$.cas_number') LIKE ? OR json_extract(m.attributes, '$.target') LIKE ? OR json_extract(m.attributes, '$.sequence') LIKE ? OR p.catalog_number LIKE ? OR b.lot_code LIKE ? OR s.position LIKE ? OR s.custom_position LIKE ? OR s.barcode LIKE ?)",
      );
      whereParams.push(like, like, like, like, like, like, like, like, like);
    }

    const whereSql = where.join(" AND ");
    const prefix = recursiveCte === "" ? "" : `${recursiveCte} `;
    const params = [...cteParams, ...whereParams];
    const total = (
      db()
        .prepare(
          `${prefix}SELECT COUNT(*) AS n FROM stocks s JOIN batches b ON b.id = s.batch_id JOIN materials m ON m.id = b.material_id LEFT JOIN products p ON p.id = b.product_id WHERE ${whereSql}`,
        )
        .get(...params) as { n: number }
    ).n;
    const rows = db()
      .prepare(`${prefix}${STOCK_SELECT} WHERE ${whereSql} ORDER BY m.name COLLATE NOCASE, s.position, s.id LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit) as StockRow[];

    return { stocks: rows.map(stockToJson), total, page, limit };
  });
}
