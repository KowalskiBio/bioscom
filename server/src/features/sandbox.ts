import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { InventoryTreeSchema, TreeReplaceBodySchema } from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireSuperadmin, requireUser } from "../auth/guards.js";
import type { InventoryHub } from "../inventory/ws.js";

const EMPTY_TREE = JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] });

function loadSandboxDoc(db: Database.Database, key: string): { tree: string; version: number } {
  db.prepare("INSERT OR IGNORE INTO sandbox_docs (key, tree, version) VALUES (?, ?, 0)").run(key, EMPTY_TREE);
  return db.prepare("SELECT tree, version FROM sandbox_docs WHERE key = ?").get(key) as {
    tree: string;
    version: number;
  };
}

export function registerSandboxRoutes(app: FastifyInstance, config: ServerConfig, hub: InventoryHub): void {
  const db = (): Database.Database => getDatabase(config.dbPath);

  app.get("/api/sandbox", async (request, reply) => {
    if (requireUser(db(), request, reply) === null) return;
    const doc = loadSandboxDoc(db(), "sandbox");
    return { version: doc.version, tree: JSON.parse(doc.tree) };
  });

  app.put("/api/sandbox", async (request, reply) => {
    if (requireSuperadmin(db(), request, reply) === null) return;
    const body = TreeReplaceBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const parsed = InventoryTreeSchema.safeParse(body.data.tree);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid tree" });
    }
    const doc = loadSandboxDoc(db(), "sandbox");
    db()
      .prepare("UPDATE sandbox_docs SET tree = ?, version = ? WHERE key = ?")
      .run(JSON.stringify(parsed.data), doc.version + 1, "sandbox");
    hub.broadcastAll({ type: "reload", resource: "sandbox" });
    return { ok: true };
  });

  app.get("/api/admin/inventory", async (request, reply) => {
    if (requireSuperadmin(db(), request, reply) === null) return;
    const doc = loadSandboxDoc(db(), "global");
    return { version: doc.version, tree: JSON.parse(doc.tree) };
  });

  app.put("/api/admin/inventory", async (request, reply) => {
    if (requireSuperadmin(db(), request, reply) === null) return;
    const body = TreeReplaceBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const parsed = InventoryTreeSchema.safeParse(body.data.tree);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid tree" });
    }
    const doc = loadSandboxDoc(db(), "global");
    db()
      .prepare("UPDATE sandbox_docs SET tree = ?, version = ? WHERE key = ?")
      .run(JSON.stringify(parsed.data), doc.version + 1, "global");
    hub.broadcastAll({ type: "reload", resource: "sandbox" });
    return { ok: true };
  });
}
