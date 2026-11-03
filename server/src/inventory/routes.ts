import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import {
  AddRoomBodySchema,
  EditRoomBodySchema,
  AddContainerBodySchema,
  EditContainerBodySchema,
  AddShelfBodySchema,
  EditShelfBodySchema,
  AddChemicalBodySchema,
  EditChemicalBodySchema,
  DeleteContainerBodySchema,
  DeleteShelfBodySchema,
  DeleteChemicalBodySchema,
  AdjustQtyBodySchema,
  MoveChemicalBodySchema,
  AddProtocolBodySchema,
  EditProtocolBodySchema,
  AddAssetRoomBodySchema,
  EditAssetRoomBodySchema,
  AddAssetBodySchema,
  EditAssetBodySchema,
  validateAttributes as validateMaterialAttributes,
  type Chemical,
  type Container,
  type InventoryTree,
} from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import type { SessionUserRow } from "../auth/sessions.js";
import { getOrCreatePosition } from "./positions.js";
import { ensureParityChecked } from "./assemble.js";
import type { InventoryHub } from "./ws.js";
import {
  OpError,
  checkSharedContainerAccess,
  createMutator,
  findChemicalOrThrow,
  findContainerOrThrow,
  findRoomOrThrow,
  findShelfOrThrow,
  findChemicalAnywhere,
  genId,
  isMemberOrSuperadmin,
  locationChemicals,
  resolveStockTarget,
  type MutationResult,
} from "./doc.js";

export function registerInventoryRoutes(app: FastifyInstance, config: ServerConfig, hub: InventoryHub): void {
  const db = (): Database.Database => getDatabase(config.dbPath);
  const mutate = createMutator(db);

  const guard = (user: SessionUserRow, groupId: string): void => {
    if (!isMemberOrSuperadmin(user, groupId)) {
      throw new OpError(403, "Not a member of this lab");
    }
  };

  const requireWriter = (user: SessionUserRow, reply: FastifyReply): boolean => {
    if (user.role === "reader") {
      void reply.status(403).send({ error: "Readers cannot make changes" });
      return false;
    }
    return true;
  };

  const wrap = async (request: FastifyRequest, reply: FastifyReply, fn: () => unknown): Promise<unknown> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof OpError) {
        return reply.status(error.status).send({ error: error.message });
      }
      request.log.error(error, "inventory operation failed");
      return reply.status(500).send({ error: "Internal error" });
    }
  };

  function findBarcodeOwner(tree: InventoryTree, barcode: string, excludeChemicalId: string | null): string | undefined {
    for (const room of tree.rooms) {
      for (const container of room.containers) {
        for (const shelf of container.shelves ?? []) {
          for (const ch of shelf.chemicals ?? []) {
            if (ch.id !== excludeChemicalId && typeof ch.barcode === "string" && ch.barcode.trim() === barcode) {
              return ch.name ?? "another item";
            }
          }
        }
      }
    }
    return undefined;
  }

  const broadcastResult = (groupId: string, result: MutationResult): void => {
    hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
    if (result.mirrorGroupId !== null) {
      hub.broadcast(result.mirrorGroupId, { groupId, version: result.version, tree: result.tree });
    }
  };

  app.get("/api/groups/:id/inventory", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      const row = db()
        .prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = ?")
        .get(groupId) as { tree: string; version: number } | undefined;
      if (row === undefined) {
        throw new OpError(404, "Inventory not found");
      }
      return { version: row.version, tree: JSON.parse(row.tree) };
    });
  });

  app.get("/api/groups/:id/inventory/parity", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      const issues = ensureParityChecked(db(), [groupId]);
      return { ok: issues.length === 0, issues };
    });
  });

  app.post("/api/groups/:id/inventory/rooms", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = AddRoomBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        tree.rooms.push({ id: genId(), name: body.data.name, description: body.data.description, containers: [] });
        return `Added room "${body.data.name}"`;
      });
      broadcastResult(groupId, result);
      return reply.status(201).send(result);
    });
  });

  app.put("/api/groups/:id/inventory/rooms/:roomId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const roomId = (request.params as { roomId: string }).roomId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = EditRoomBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const room = findRoomOrThrow(tree, roomId);
        const oldName = room.name;
        if (body.data.name !== undefined) {
          room.name = body.data.name;
        }
        if (body.data.description !== undefined) {
          room.description = body.data.description;
        }
        return `Edited room "${oldName}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.delete("/api/groups/:id/inventory/rooms/:roomId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const roomId = (request.params as { roomId: string }).roomId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const result = mutate(groupId, user, (tree) => {
        const room = findRoomOrThrow(tree, roomId);
        tree.rooms = tree.rooms.filter((candidate) => candidate.id !== roomId);
        return `Deleted room "${room.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/containers", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = AddContainerBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const room = findRoomOrThrow(tree, body.data.roomId);
        const container: Container = {
          id: genId(),
          name: body.data.name,
          description: body.data.description,
          emoji: body.data.emoji,
          type: body.data.type,
          cabinetMethod: body.data.cabinetMethod,
          customRangeType: body.data.customRangeType,
          sharedWithGroupIds: [],
          shelves: (body.data.shelves ?? []).map((shelf) => {
            if (typeof shelf === "string") {
              return { id: genId(), name: shelf, chemicals: [] };
            }
            return {
              id: genId(),
              name: shelf.name,
              chemicals: [],
              isRangeShelf: shelf.isRangeShelf,
              rangeStart: shelf.rangeStart,
              rangeEnd: shelf.rangeEnd,
            };
          }),
        };
        room.containers.push(container);
        return `Added container "${body.data.name}"`;
      });
      broadcastResult(groupId, result);
      return reply.status(201).send(result);
    });
  });

  app.put("/api/groups/:id/inventory/containers/:containerId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const containerId = (request.params as { containerId: string }).containerId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = EditContainerBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const container = findContainerOrThrow(tree, body.data.roomId, containerId);
        if (body.data.name !== undefined) {
          container.name = body.data.name;
        }
        if (body.data.description !== undefined) {
          container.description = body.data.description;
        }
        if (body.data.emoji !== undefined) {
          container.emoji = body.data.emoji;
        }
        return `Edited container "${body.data.name ?? container.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.delete("/api/groups/:id/inventory/containers/:containerId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const containerId = (request.params as { containerId: string }).containerId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = DeleteContainerBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const room = findRoomOrThrow(tree, body.data.roomId);
        const container = findContainerOrThrow(tree, body.data.roomId, containerId);
        room.containers = room.containers.filter((candidate) => candidate.id !== containerId);
        return `Deleted container "${container.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/shelves", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      if (!requireWriter(user, reply)) return;
      const body = AddShelfBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);
      const result = mutate(groupId, user, (tree, context) => {
        const container = findContainerOrThrow(tree, body.data.roomId, body.data.containerId);
        checkSharedContainerAccess(user, groupId, container, context, isMember);
        container.shelves.push({
          id: genId(),
          name: body.data.name,
          type: body.data.type,
          parentShelfId: body.data.parentShelfId,
          rackName: body.data.rackName,
          boxName: body.data.boxName,
          isRangeShelf: body.data.isRangeShelf,
          rangeStart: body.data.rangeStart,
          rangeEnd: body.data.rangeEnd,
          chemicals: [],
        });
        return `Added shelf/place "${body.data.name}" to container "${container.name}"`;
      });
      broadcastResult(groupId, result);
      return reply.status(201).send(result);
    });
  });

  app.put("/api/groups/:id/inventory/shelves/:shelfId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const shelfId = (request.params as { shelfId: string }).shelfId;
    return wrap(request, reply, () => {
      if (!requireWriter(user, reply)) return;
      const body = EditShelfBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);
      const result = mutate(groupId, user, (tree, context) => {
        const container = findContainerOrThrow(tree, body.data.roomId, body.data.containerId);
        checkSharedContainerAccess(user, groupId, container, context, isMember);
        const shelf = container.shelves.find((candidate) => candidate.id === shelfId);
        if (shelf === undefined) {
          throw new OpError(404, "Shelf not found");
        }
        if (body.data.name !== undefined) {
          shelf.name = body.data.name;
        }
        if (body.data.color !== undefined) {
          shelf.color = body.data.color;
        }
        return `Edited shelf/place "${shelf.name}" in container "${container.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.delete("/api/groups/:id/inventory/shelves/:shelfId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const shelfId = (request.params as { shelfId: string }).shelfId;
    return wrap(request, reply, () => {
      if (!requireWriter(user, reply)) return;
      const body = DeleteShelfBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);
      const result = mutate(groupId, user, (tree, context) => {
        const container = findContainerOrThrow(tree, body.data.roomId, body.data.containerId);
        checkSharedContainerAccess(user, groupId, container, context, isMember);
        const shelf = findShelfOrThrow(tree, body.data.roomId, body.data.containerId, shelfId);
        container.shelves = container.shelves.filter((candidate) => candidate.id !== shelfId);
        return `Deleted shelf/place "${shelf.name}" from container "${container.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/chemicals", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      if (!requireWriter(user, reply)) return;
      const body = AddChemicalBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);
      const result = mutate(groupId, user, (tree, context) => {
        const container = body.data.containerId !== undefined
          ? findContainerOrThrow(tree, body.data.roomId, body.data.containerId)
          : null;
        if (container !== null) {
          checkSharedContainerAccess(user, groupId, container, context, isMember);
        } else if (!isMember) {
          throw new OpError(404, "Room not found");
        }
        const target = resolveStockTarget(tree, body.data.roomId, body.data.containerId, body.data.shelfId, body.data.boxId);
        const typeKey = body.data.type ?? "chemical";
        if (body.data.type !== undefined || body.data.attributes !== undefined) {
          const validation = validateMaterialAttributes(typeKey, body.data.attributes ?? {});
          if (!validation.ok) {
            throw new OpError(400, `Invalid attributes for type "${typeKey}": ${validation.errors.join("; ")}`);
          }
        }
        const position =
          body.data.position ??
          body.data.customPosition ??
          (target.shelf !== null && target.container !== null
            ? getOrCreatePosition(target.container, target.shelf, body.data.name)
            : undefined);
        if (body.data.barcode !== undefined && body.data.barcode.trim() !== "") {
          const owner = findBarcodeOwner(tree, body.data.barcode.trim(), null);
          if (owner !== undefined) {
            throw new OpError(400, `Barcode "${body.data.barcode}" is already used by "${owner}"`);
          }
        }
        const chemical: Chemical = {
          id: genId(),
          name: body.data.name,
          cas: body.data.cas,
          formula: body.data.formula,
          quantity: body.data.quantity,
          unit: body.data.unit,
          concentration: body.data.concentration,
          concUnit: body.data.concUnit,
          position,
          customPosition: body.data.customPosition,
          note: body.data.note,
          barcode: body.data.barcode !== undefined && body.data.barcode.trim() !== "" ? body.data.barcode.trim() : undefined,
          type: body.data.type,
          attributes: body.data.attributes,
          product: body.data.product,
          batchInfo: body.data.batchInfo,
        };
        locationChemicals(target).push(chemical);
        const where = target.box?.name ?? target.shelf?.name ?? target.container?.name ?? target.room.name ?? "inventory";
        return `Added ${typeKey === "chemical" ? "chemical" : typeKey} "${body.data.name}" to "${where}"`;
      });
      broadcastResult(groupId, result);
      return reply.status(201).send(result);
    });
  });

  app.put("/api/groups/:id/inventory/chemicals/:chemicalId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const chemicalId = (request.params as { chemicalId: string }).chemicalId;
    return wrap(request, reply, () => {
      if (!requireWriter(user, reply)) return;
      const body = EditChemicalBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);
      const result = mutate(groupId, user, (tree, context) => {
        const found = findChemicalAnywhere(tree, body.data.roomId, chemicalId);
        if (found.container !== null) {
          checkSharedContainerAccess(user, groupId, found.container, context, isMember);
        } else if (!isMember) {
          throw new OpError(404, "Chemical not found");
        }
        const chemical = found.chemical;
        const typeKey = body.data.type ?? chemical.type ?? "chemical";
        if (body.data.attributes !== undefined || body.data.type !== undefined) {
          const merged = { ...(chemical.attributes ?? {}), ...(body.data.attributes ?? {}) };
          const validation = validateMaterialAttributes(typeKey, merged);
          if (!validation.ok) {
            throw new OpError(400, `Invalid attributes for type "${typeKey}": ${validation.errors.join("; ")}`);
          }
        }
        if (body.data.barcode !== undefined) {
          if (body.data.barcode.trim() !== "") {
            const owner = findBarcodeOwner(tree, body.data.barcode.trim(), chemicalId);
            if (owner !== undefined) {
              throw new OpError(400, `Barcode "${body.data.barcode}" is already used by "${owner}"`);
            }
            chemical.barcode = body.data.barcode.trim();
          } else {
            chemical.barcode = undefined;
          }
        }
        if (body.data.name !== undefined) {
          chemical.name = body.data.name;
        }
        if (body.data.cas !== undefined) {
          chemical.cas = body.data.cas;
        }
        if (body.data.formula !== undefined) {
          chemical.formula = body.data.formula;
        }
        if (body.data.quantity !== undefined) {
          chemical.quantity = body.data.quantity;
        }
        if (body.data.unit !== undefined) {
          chemical.unit = body.data.unit;
        }
        if (body.data.concentration !== undefined) {
          chemical.concentration = body.data.concentration;
        }
        if (body.data.concUnit !== undefined) {
          chemical.concUnit = body.data.concUnit;
        }
        if (body.data.position !== undefined) {
          chemical.position = body.data.position;
        }
        if (body.data.customPosition !== undefined) {
          chemical.customPosition = body.data.customPosition;
        }
        if (body.data.note !== undefined) {
          chemical.note = body.data.note;
        }
        if (body.data.type !== undefined) {
          chemical.type = body.data.type;
        }
        if (body.data.attributes !== undefined) {
          chemical.attributes = body.data.attributes;
        }
        if (body.data.product !== undefined) {
          if (body.data.product === null) {
            chemical.product = undefined;
          } else {
            const merged: Record<string, unknown> = { ...(chemical.product ?? {}) };
            const src = body.data.product as unknown as Record<string, unknown>;
            for (const key of ["manufacturer", "supplier", "catalogNumber", "productName", "variant"]) {
              const value = src[key];
              if (value === undefined) continue;
              if (typeof value === "string" && value.trim() === "") {
                delete merged[key];
              } else {
                merged[key] = value;
              }
            }
            chemical.product = merged as Chemical["product"];
          }
        }
        if (body.data.batchInfo !== undefined) {
          chemical.batchInfo = body.data.batchInfo;
        }
        return `Edited chemical "${chemical.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.delete("/api/groups/:id/inventory/chemicals/:chemicalId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const chemicalId = (request.params as { chemicalId: string }).chemicalId;
    return wrap(request, reply, () => {
      if (!requireWriter(user, reply)) return;
      const body = DeleteChemicalBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);
      const result = mutate(groupId, user, (tree, context) => {
        const found = findChemicalAnywhere(tree, body.data.roomId, chemicalId);
        if (found.container !== null) {
          checkSharedContainerAccess(user, groupId, found.container, context, isMember);
        } else if (!isMember) {
          throw new OpError(404, "Chemical not found");
        }
        found.list.splice(found.index, 1);
        const where = found.shelf?.name ?? found.container?.name ?? found.room.name ?? "inventory";
        return `Deleted chemical "${found.chemical.name}" from "${where}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/chemicals/:chemicalId/adjust-qty", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const chemicalId = (request.params as { chemicalId: string }).chemicalId;
    return wrap(request, reply, () => {
      const body = AdjustQtyBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);
      const result = mutate(groupId, user, (tree, context) => {
        const found = findChemicalAnywhere(tree, body.data.roomId, chemicalId);
        if (found.container !== null) {
          checkSharedContainerAccess(user, groupId, found.container, context, isMember);
        } else if (!isMember) {
          throw new OpError(404, "Chemical not found");
        }
        if (user.role === "reader" && context.mirrorGroupId === null) {
          throw new OpError(403, "Readers cannot make changes");
        }
        const chemical = found.chemical;
        let newQty = (chemical.quantity ?? 0) + body.data.delta;
        if (newQty < 0) {
          newQty = 0;
        }
        chemical.quantity = parseFloat(newQty.toFixed(3));
        return `Updated quantity of chemical "${chemical.name}" to ${chemical.quantity} ${chemical.unit ?? ""}`.trim();
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/chemicals/:chemicalId/move", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const chemicalId = (request.params as { chemicalId: string }).chemicalId;
    return wrap(request, reply, () => {
      if (!requireWriter(user, reply)) return;
      const body = MoveChemicalBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);
      const result = mutate(groupId, user, (tree, context) => {
        const found = findChemicalAnywhere(tree, body.data.fromRoomId, chemicalId);
        if (found.container !== null) {
          checkSharedContainerAccess(user, groupId, found.container, context, isMember);
        } else if (!isMember) {
          throw new OpError(404, "Chemical not found");
        }
        const target = resolveStockTarget(tree, body.data.toRoomId, body.data.toContainerId, body.data.toShelfId, body.data.toBoxId);
        if (target.container !== null && found.container !== null && target.container.id !== found.container.id) {
          if (!isMember) {
            throw new OpError(403, "Chemicals can only be moved within a shared container");
          }
        }
        if (body.data.position !== undefined) {
          found.chemical.position = body.data.position;
        }
        found.list.splice(found.index, 1);
        locationChemicals(target).push(found.chemical);
        const where = target.box?.name ?? target.shelf?.name ?? target.container?.name ?? target.room.name ?? "inventory";
        return `Moved chemical "${found.chemical.name}" to "${where}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/protocols", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = AddProtocolBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        tree.protocols.push({ id: genId(), title: body.data.title, content: body.data.content ?? "" });
        return `Added protocol "${body.data.title}"`;
      });
      broadcastResult(groupId, result);
      return reply.status(201).send(result);
    });
  });

  app.put("/api/groups/:id/inventory/protocols/:protocolId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const protocolId = (request.params as { protocolId: string }).protocolId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = EditProtocolBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const protocol = tree.protocols.find((candidate) => candidate.id === protocolId);
        if (protocol === undefined) {
          throw new OpError(404, "Protocol not found");
        }
        if (body.data.title !== undefined) {
          protocol.title = body.data.title;
        }
        if (body.data.content !== undefined) {
          protocol.content = body.data.content;
        }
        return `Edited protocol "${protocol.title}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.delete("/api/groups/:id/inventory/protocols/:protocolId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const protocolId = (request.params as { protocolId: string }).protocolId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const result = mutate(groupId, user, (tree) => {
        const protocol = tree.protocols.find((candidate) => candidate.id === protocolId);
        if (protocol === undefined) {
          throw new OpError(404, "Protocol not found");
        }
        tree.protocols = tree.protocols.filter((candidate) => candidate.id !== protocolId);
        return `Deleted protocol "${protocol.title}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/asset-rooms", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = AddAssetRoomBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        tree.assetRooms.push({ id: genId(), name: body.data.name });
        return `Added asset room "${body.data.name}"`;
      });
      broadcastResult(groupId, result);
      return reply.status(201).send(result);
    });
  });

  app.put("/api/groups/:id/inventory/asset-rooms/:roomId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const roomId = (request.params as { roomId: string }).roomId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = EditAssetRoomBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const room = tree.assetRooms.find((candidate) => candidate.id === roomId);
        if (room === undefined) {
          throw new OpError(404, "Asset room not found");
        }
        if (body.data.name !== undefined) {
          room.name = body.data.name;
        }
        return `Edited asset room "${room.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.delete("/api/groups/:id/inventory/asset-rooms/:roomId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const roomId = (request.params as { roomId: string }).roomId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const result = mutate(groupId, user, (tree) => {
        const room = tree.assetRooms.find((candidate) => candidate.id === roomId);
        if (room === undefined) {
          throw new OpError(404, "Asset room not found");
        }
        tree.assetRooms = tree.assetRooms.filter((candidate) => candidate.id !== roomId);
        for (const asset of tree.assets) {
          if (asset.roomId === roomId) {
            asset.roomId = "";
          }
        }
        return `Deleted asset room "${room.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/assets", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = AddAssetBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        tree.assets.push({
          id: genId(),
          name: body.data.name,
          model: body.data.model,
          barcode: body.data.barcode,
          description: body.data.description,
          roomId: body.data.roomId ?? "",
        });
        return `Added asset "${body.data.name}"`;
      });
      broadcastResult(groupId, result);
      return reply.status(201).send(result);
    });
  });

  app.put("/api/groups/:id/inventory/assets/:assetId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const assetId = (request.params as { assetId: string }).assetId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = EditAssetBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const asset = tree.assets.find((candidate) => candidate.id === assetId);
        if (asset === undefined) {
          throw new OpError(404, "Asset not found");
        }
        if (body.data.name !== undefined) {
          asset.name = body.data.name;
        }
        if (body.data.model !== undefined) {
          asset.model = body.data.model;
        }
        if (body.data.barcode !== undefined) {
          asset.barcode = body.data.barcode;
        }
        if (body.data.description !== undefined) {
          asset.description = body.data.description;
        }
        if (body.data.roomId !== undefined) {
          asset.roomId = body.data.roomId;
        }
        return `Edited asset "${asset.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.delete("/api/groups/:id/inventory/assets/:assetId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const assetId = (request.params as { assetId: string }).assetId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const result = mutate(groupId, user, (tree) => {
        const asset = tree.assets.find((candidate) => candidate.id === assetId);
        if (asset === undefined) {
          throw new OpError(404, "Asset not found");
        }
        tree.assets = tree.assets.filter((candidate) => candidate.id !== assetId);
        return `Deleted asset "${asset.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });
}
