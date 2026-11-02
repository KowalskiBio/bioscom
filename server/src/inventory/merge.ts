import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { MergeMaterialsBodySchema } from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import { OpError, isMemberOrSuperadmin } from "./doc.js";

export function registerMaterialMergeRoutes(app: FastifyInstance, config: ServerConfig): void {
  const db = (): Database.Database => getDatabase(config.dbPath);

  app.post("/api/groups/:id/materials/merge", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    try {
      if (!isMemberOrSuperadmin(user, groupId)) {
        throw new OpError(403, "Not a member of this lab");
      }
      if (user.role === "reader") {
        throw new OpError(403, "Readers cannot make changes");
      }
      const body = MergeMaterialsBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const { sourceMaterialId, targetMaterialId } = body.data;
      if (sourceMaterialId === targetMaterialId) {
        throw new OpError(400, "Source and target must be different materials");
      }
      const result = db().transaction(() => {
        const materialBy = db().prepare(
          "SELECT id, name, type_key, archived_at FROM materials WHERE id = ? AND group_id = ?",
        );
        const source = materialBy.get(sourceMaterialId, groupId) as
          | { id: string; name: string; type_key: string; archived_at: number | null }
          | undefined;
        const target = materialBy.get(targetMaterialId, groupId) as
          | { id: string; name: string; type_key: string; archived_at: number | null }
          | undefined;
        if (source === undefined) throw new OpError(404, "Source material not found");
        if (target === undefined) throw new OpError(404, "Target material not found");
        if (source.archived_at !== null) throw new OpError(400, "Source material is already archived");
        if (target.archived_at !== null) throw new OpError(400, "Target material is archived");
        if (source.type_key !== target.type_key) {
          throw new OpError(
            400,
            `Type mismatch: cannot merge "${source.type_key}" into "${target.type_key}"`,
          );
        }

        const products = db()
          .prepare("SELECT COUNT(*) AS n FROM products WHERE material_id = ?")
          .get(sourceMaterialId) as { n: number };
        const batches = db()
          .prepare("SELECT COUNT(*) AS n FROM batches WHERE material_id = ?")
          .get(sourceMaterialId) as { n: number };
        const stocks = db()
          .prepare(
            "SELECT COUNT(*) AS n FROM stocks s JOIN batches b ON b.id = s.batch_id WHERE b.material_id = ?",
          )
          .get(sourceMaterialId) as { n: number };

        const now = Date.now();
        db().prepare("UPDATE products SET material_id = ?, updated_at = ? WHERE material_id = ?").run(
          targetMaterialId,
          now,
          sourceMaterialId,
        );
        db().prepare("UPDATE batches SET material_id = ?, updated_at = ? WHERE material_id = ?").run(
          targetMaterialId,
          now,
          sourceMaterialId,
        );
        db().prepare("UPDATE legacy_chemical_map SET material_id = ? WHERE group_id = ? AND material_id = ?").run(
          targetMaterialId,
          groupId,
          sourceMaterialId,
        );
        db().prepare("UPDATE materials SET archived_at = ?, updated_at = ? WHERE id = ?").run(now, now, sourceMaterialId);
        db().prepare(
          "INSERT INTO history (group_id, timestamp, user_name, action) VALUES (?, ?, ?, ?)",
        ).run(groupId, now, user.name ?? user.uid, `Merged material "${source.name}" into "${target.name}"`);

        return {
          source: { id: sourceMaterialId, name: source.name, archived: true },
          target: { id: targetMaterialId, name: target.name },
          moved: { products: products.n, batches: batches.n, stocks: stocks.n },
        };
      })();
      return result;
    } catch (error) {
      if (error instanceof OpError) {
        return reply.status(error.status).send({ error: error.message });
      }
      request.log.error(error, "material merge failed");
      return reply.status(500).send({ error: "Internal error" });
    }
  });
}
