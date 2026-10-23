import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import {
  AddRoomBodySchema,
  EditRoomBodySchema,
  AddContainerBodySchema,
  EditContainerBodySchema,
  AddShelfBodySchema,
  AddChemicalBodySchema,
  EditChemicalBodySchema,
  DeleteContainerBodySchema,
  DeleteShelfBodySchema,
  DeleteChemicalBodySchema,
  AdjustQtyBodySchema,
  MoveChemicalBodySchema,
  type Chemical,
  type Container,
  type InventoryTree,
} from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import type { SessionUserRow } from "../auth/sessions.js";
import { getOrCreatePosition } from "./positions.js";
import type { InventoryHub } from "./ws.js";
import {
  OpError,
  checkSharedContainerAccess,
  createMutator,
  findChemicalOrThrow,
  findContainerOrThrow,
  findRoomOrThrow,
  findShelfOrThrow,
  genId,
  isMemberOrSuperadmin,
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
          shelves: (body.data.shelves ?? []).map((shelfName) => ({
            id: genId(),
            name: shelfName,
            chemicals: [],
          })),
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
        const container = findContainerOrThrow(tree, body.data.roomId, body.data.containerId);
        checkSharedContainerAccess(user, groupId, container, context, isMember);
        const shelf = findShelfOrThrow(tree, body.data.roomId, body.data.containerId, body.data.shelfId);
        const position =
          body.data.position ??
          body.data.customPosition ??
          getOrCreatePosition(container, shelf, body.data.name);
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
        };
        shelf.chemicals.push(chemical);
        return `Added chemical "${body.data.name}" to container "${container.name}"`;
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
        const container = findContainerOrThrow(tree, body.data.roomId, body.data.containerId);
        checkSharedContainerAccess(user, groupId, container, context, isMember);
        const { chemical } = findChemicalOrThrow(
          tree,
          body.data.roomId,
          body.data.containerId,
          body.data.shelfId,
          chemicalId,
        );
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
        const container = findContainerOrThrow(tree, body.data.roomId, body.data.containerId);
        checkSharedContainerAccess(user, groupId, container, context, isMember);
        const { shelf, chemical } = findChemicalOrThrow(
          tree,
          body.data.roomId,
          body.data.containerId,
          body.data.shelfId,
          chemicalId,
        );
        shelf.chemicals = shelf.chemicals.filter((candidate) => candidate.id !== chemicalId);
        return `Deleted chemical "${chemical.name}" from container "${container.name}"`;
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
        const container = findContainerOrThrow(tree, body.data.roomId, body.data.containerId);
        checkSharedContainerAccess(user, groupId, container, context, isMember);
        if (user.role === "reader" && context.mirrorGroupId === null) {
          throw new OpError(403, "Readers cannot make changes");
        }
        const { chemical } = findChemicalOrThrow(
          tree,
          body.data.roomId,
          body.data.containerId,
          body.data.shelfId,
          chemicalId,
        );
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
        const fromContainer = findContainerOrThrow(tree, body.data.fromRoomId, body.data.fromContainerId);
        checkSharedContainerAccess(user, groupId, fromContainer, context, isMember);
        const toContainer = findContainerOrThrow(tree, body.data.toRoomId, body.data.toContainerId);
        if (toContainer.id !== fromContainer.id) {
          if (!isMember) {
            throw new OpError(403, "Chemicals can only be moved within a shared container");
          }
        }
        const { shelf: fromShelf, chemical } = findChemicalOrThrow(
          tree,
          body.data.fromRoomId,
          body.data.fromContainerId,
          body.data.fromShelfId,
          chemicalId,
        );
        const toShelf = findShelfOrThrow(tree, body.data.toRoomId, body.data.toContainerId, body.data.toShelfId);
        if (body.data.position !== undefined) {
          chemical.position = body.data.position;
        }
        fromShelf.chemicals = fromShelf.chemicals.filter((candidate) => candidate.id !== chemicalId);
        toShelf.chemicals.push(chemical);
        return `Moved chemical "${chemical.name}" to "${toContainer.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });
}
