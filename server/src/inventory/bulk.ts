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
  genId,
  isMemberOrSuperadmin,
  locationChemicals,
  resolveStockTarget,
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
      const payloadBarcodes = new Set<string>();
      const payloadOwners = new Map<string, number>();
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
        if (!itemValidationErrors.some((entry) => entry.index === index) && typeof item.barcode === "string") {
          const code = item.barcode.trim();
          if (code !== "") {
            if (payloadOwners.has(code)) {
              itemValidationErrors.push({ index, name: item.name, error: `duplicate barcode "${code}" in payload` });
            } else {
              payloadOwners.set(code, index);
              payloadBarcodes.add(code);
            }
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

      let createdCount = 0;
      const result = mutate(groupId, user, (tree, context) => {
        const target = resolveStockTarget(tree, body.data.roomId, body.data.containerId, body.data.shelfId, body.data.boxId);
        if (target.container !== null) {
          checkSharedContainerAccess(user, groupId, target.container, context, isMember);
        } else if (!isMember) {
          throw new OpError(404, "Room not found");
        }
        const list = locationChemicals(target);
        const ownerLabel = target.box?.name ?? target.shelf?.name ?? target.container?.name ?? target.room.name ?? "inventory";
        const treeBarcodeOwners = new Map<string, string>();
        for (const room of tree.rooms) {
          for (const cont of room.containers) {
            for (const sh of cont.shelves ?? []) {
              for (const ch of sh.chemicals ?? []) {
                if (typeof ch.barcode === "string" && payloadBarcodes.has(ch.barcode.trim())) {
                  treeBarcodeOwners.set(ch.barcode.trim(), ch.name ?? "existing item");
                }
              }
            }
          }
        }
        let created = 0;
        for (const index of mutableIndexes) {
          const item = body.data.items[index]!;
          const code = typeof item.barcode === "string" && item.barcode.trim() !== "" ? item.barcode.trim() : null;
          if (code !== null && treeBarcodeOwners.has(code)) {
            itemValidationErrors.push({ index, name: item.name, error: `barcode "${code}" already used by "${treeBarcodeOwners.get(code)}"` });
            continue;
          }
          const chemical: Chemical = {
            id: genId(),
            name: item.name,
            cas: item.cas,
            formula: item.formula,
            quantity: item.quantity,
            unit: item.unit,
            concentration: item.concentration,
            concUnit: item.concUnit,
            position: item.position ?? item.customPosition ?? (target.shelf !== null && target.container !== null ? getOrCreatePosition(target.container, target.shelf, item.name) : undefined),
            customPosition: item.customPosition,
            note: item.note,
            barcode: code ?? undefined,
            type: item.type,
            attributes: item.attributes,
            product: item.product,
            batchInfo: item.batchInfo,
          };
          list.push(chemical);
          created += 1;
          createdCount += 1;
        }
        return `Imported ${created} items into "${ownerLabel}"`;
      });
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
      if (result.mirrorGroupId !== null) {
        hub.broadcast(result.mirrorGroupId, { groupId, version: result.version, tree: result.tree });
      }
      return {
        created: createdCount,
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
