import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import {
  InventoryTreeSchema,
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
  type Room,
  type Shelf,
} from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import type { SessionUserRow } from "../auth/sessions.js";
import { getOrCreatePosition } from "./positions.js";
import type { InventoryHub } from "./ws.js";

export class OpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadDoc(db: Database.Database, groupId: string): { tree: InventoryTree; version: number } {
  const row = db
    .prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = ?")
    .get(groupId) as { tree: string; version: number } | undefined;
  if (row === undefined) {
    throw new OpError(404, "Inventory not found");
  }
  const parsed = InventoryTreeSchema.safeParse(JSON.parse(row.tree));
  if (!parsed.success) {
    throw new OpError(500, "Inventory document is corrupt");
  }
  return { tree: parsed.data, version: row.version };
}

function findRoomOrThrow(tree: InventoryTree, roomId: string): Room {
  const room = tree.rooms.find((candidate) => candidate.id === roomId);
  if (room === undefined) {
    throw new OpError(404, "Room not found");
  }
  return room;
}

function findContainerOrThrow(tree: InventoryTree, roomId: string, containerId: string): Container {
  const room = findRoomOrThrow(tree, roomId);
  const container = room.containers.find((candidate) => candidate.id === containerId);
  if (container === undefined) {
    throw new OpError(404, "Container not found");
  }
  return container;
}

function findShelfOrThrow(tree: InventoryTree, roomId: string, containerId: string, shelfId: string): Shelf {
  const container = findContainerOrThrow(tree, roomId, containerId);
  const shelf = container.shelves.find((candidate) => candidate.id === shelfId);
  if (shelf === undefined) {
    throw new OpError(404, "Shelf not found");
  }
  return shelf;
}

function findChemicalOrThrow(
  tree: InventoryTree,
  roomId: string,
  containerId: string,
  shelfId: string,
  chemicalId: string,
): { shelf: Shelf; chemical: Chemical } {
  const shelf = findShelfOrThrow(tree, roomId, containerId, shelfId);
  const chemical = shelf.chemicals.find((candidate) => candidate.id === chemicalId);
  if (chemical === undefined) {
    throw new OpError(404, "Chemical not found");
  }
  return { shelf, chemical };
}

export function registerInventoryRoutes(app: FastifyInstance, config: ServerConfig, hub: InventoryHub): void {
  const db = (): Database.Database => getDatabase(config.dbPath);

  const guard = (user: SessionUserRow, groupId: string): void => {
    if (user.role !== "superadmin" && user.group_id !== groupId) {
      throw new OpError(403, "Not a member of this lab");
    }
  };

  const mutate = (
    groupId: string,
    user: SessionUserRow,
    apply: (tree: InventoryTree) => string,
  ): { version: number; tree: InventoryTree } => {
    const transactional = db().transaction((): { version: number; tree: InventoryTree } => {
      const { tree, version } = loadDoc(db(), groupId);
      const action = apply(tree);
      const check = InventoryTreeSchema.safeParse(tree);
      if (!check.success) {
        throw new OpError(500, "Mutation produced an invalid tree");
      }
      const nextVersion = version + 1;
      db()
        .prepare("UPDATE group_inventory_docs SET tree = ?, version = ? WHERE group_id = ?")
        .run(JSON.stringify(tree), nextVersion, groupId);
      db()
        .prepare("INSERT INTO history (group_id, timestamp, user_name, action) VALUES (?, ?, ?, ?)")
        .run(groupId, Date.now(), user.name ?? user.uid, action);
      return { version: nextVersion, tree };
    });
    return transactional();
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

  app.get("/api/groups/:id/inventory", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      const { tree, version } = loadDoc(db(), groupId);
      return { version, tree };
    });
  });

  app.post("/api/groups/:id/inventory/rooms", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      const body = AddRoomBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        tree.rooms.push({ id: genId(), name: body.data.name, description: body.data.description, containers: [] });
        return `Added room "${body.data.name}"`;
      });
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
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
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
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
      const result = mutate(groupId, user, (tree) => {
        const room = findRoomOrThrow(tree, roomId);
        tree.rooms = tree.rooms.filter((candidate) => candidate.id !== roomId);
        return `Deleted room "${room.name}"`;
      });
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/containers", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
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
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
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
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
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
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/shelves", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      const body = AddShelfBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const container = findContainerOrThrow(tree, body.data.roomId, body.data.containerId);
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
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
      return reply.status(201).send(result);
    });
  });

  app.delete("/api/groups/:id/inventory/shelves/:shelfId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const shelfId = (request.params as { shelfId: string }).shelfId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      const body = DeleteShelfBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const container = findContainerOrThrow(tree, body.data.roomId, body.data.containerId);
        const shelf = findShelfOrThrow(tree, body.data.roomId, body.data.containerId, shelfId);
        container.shelves = container.shelves.filter((candidate) => candidate.id !== shelfId);
        return `Deleted shelf/place "${shelf.name}" from container "${container.name}"`;
      });
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/chemicals", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      const body = AddChemicalBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const container = findContainerOrThrow(tree, body.data.roomId, body.data.containerId);
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
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
      return reply.status(201).send(result);
    });
  });

  app.put("/api/groups/:id/inventory/chemicals/:chemicalId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const chemicalId = (request.params as { chemicalId: string }).chemicalId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      const body = EditChemicalBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
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
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
      return result;
    });
  });

  app.delete("/api/groups/:id/inventory/chemicals/:chemicalId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const chemicalId = (request.params as { chemicalId: string }).chemicalId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      const body = DeleteChemicalBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const container = findContainerOrThrow(tree, body.data.roomId, body.data.containerId);
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
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/chemicals/:chemicalId/adjust-qty", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const chemicalId = (request.params as { chemicalId: string }).chemicalId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      const body = AdjustQtyBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
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
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/chemicals/:chemicalId/move", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const chemicalId = (request.params as { chemicalId: string }).chemicalId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      const body = MoveChemicalBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const { shelf: fromShelf, chemical } = findChemicalOrThrow(
          tree,
          body.data.fromRoomId,
          body.data.fromContainerId,
          body.data.fromShelfId,
          chemicalId,
        );
        const toContainer = findContainerOrThrow(tree, body.data.toRoomId, body.data.toContainerId);
        const toShelf = findShelfOrThrow(tree, body.data.toRoomId, body.data.toContainerId, body.data.toShelfId);
        if (body.data.position !== undefined) {
          chemical.position = body.data.position;
        }
        fromShelf.chemicals = fromShelf.chemicals.filter((candidate) => candidate.id !== chemicalId);
        toShelf.chemicals.push(chemical);
        return `Moved chemical "${chemical.name}" to "${toContainer.name}"`;
      });
      hub.broadcast(groupId, { groupId, version: result.version, tree: result.tree });
      return result;
    });
  });
}
