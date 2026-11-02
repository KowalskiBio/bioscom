import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { BulkImportBodySchema, validateAttributes as validateMaterialAttributes, type Chemical } from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import type { InventoryHub } from "./ws.js";
import {
  OpError,
  checkSharedContainerAccess,
  createMutator,
  findContainerOrThrow,
  findShelfOrThrow,
  genId,
  isMemberOrSuperadmin,
} from "./doc.js";
import { getOrCreatePosition } from "./positions.js";

export function registerBulkImportRoutes(app: FastifyInstance, config: ServerConfig, hub: InventoryHub): void {
  const db = (): Database.Database => getDatabase(config.dbPath);
  const mutate = createMutator(db);

  app.post("/api/groups/:id/inventory/bulk-import", async (request, reply) => {
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
      const body = BulkImportBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);
      const itemValidationErrors: Array<{ index: number; name: string; error: string }> = [];
      body.data.items.forEach((item, index) => {
        const typeKey = item.type ?? "chemical";
        if (item.type !== undefined) {
          const validation = validateMaterialAttributes(typeKey, item.attributes ?? {});
          if (!validation.ok) {
            itemValidationErrors.push({ index, name: item.name, error: validation.errors.join("; ") });
          }
        } else if (item.attributes !== undefined && item.type === undefined) {
          const validation = validateMaterialAttributes(typeKey, item.attributes);
          if (!validation.ok) {
            itemValidationErrors.push({ index, name: item.name, error: validation.errors.join("; ") });
          }
        }
      });
      const skipped = new Set(itemValidationErrors.map((entry) => entry.index));
      const mutableIndexes = body.data.items
        .map((_, index) => index)
        .filter((index) => !skipped.has(index));

      if (mutableIndexes.length === 0) {
        return {
          created: 0,
          skipped: itemValidationErrors,
          location: null,
        };
      }

      const result = mutate(groupId, user, (tree, context) => {
        const container = findContainerOrThrow(tree, body.data.roomId, body.data.containerId);
        checkSharedContainerAccess(user, groupId, container, context, isMember);
        const shelf = findShelfOrThrow(tree, body.data.roomId, body.data.containerId, body.data.shelfId);
        let created = 0;
        for (const index of mutableIndexes) {
          const item = body.data.items[index]!;
          const chemical: Chemical = {
            id: genId(),
            name: item.name,
            cas: item.cas,
            formula: item.formula,
            quantity: item.quantity,
            unit: item.unit,
            concentration: item.concentration,
            concUnit: item.concUnit,
            position: item.position ?? item.customPosition ?? getOrCreatePosition(container, shelf, item.name),
            customPosition: item.customPosition,
            note: item.note,
            type: item.type,
            attributes: item.attributes,
            product: item.product,
            batchInfo: item.batchInfo,
          };
          shelf.chemicals.push(chemical);
          created += 1;
        }
        return `Imported ${created} items into "${shelf.name}" of container "${container.name}"`;
      });
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
      if (result.mirrorGroupId !== null) {
        hub.broadcast(result.mirrorGroupId, { groupId, version: result.version, tree: result.tree });
      }
      return {
        created: mutableIndexes.length,
        skipped: itemValidationErrors,
        location: { roomId: body.data.roomId, containerId: body.data.containerId, shelfId: body.data.shelfId },
      };
    } catch (error) {
      if (error instanceof OpError) {
        return reply.status(error.status).send({ error: error.message });
      }
      request.log.error(error, "bulk import failed");
      return reply.status(500).send({ error: "Internal error" });
    }
  });
}
