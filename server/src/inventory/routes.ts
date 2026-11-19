import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import {
  AddRoomBodySchema,
  AddDeepFreezerBodySchema,
  AddDeepFreezerRackBodySchema,
  AddDeepFreezerBoxBodySchema,
  MoveDeepFreezerRackBodySchema,
  MoveDeepFreezerBoxBodySchema,
  ResizeDeepFreezerBodySchema,
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
  EditAssetRoomBodySchema,
  AddAssetBodySchema,
  EditAssetBodySchema,
  ContainerGridMoveBodySchema,
  GridSettingsSchema,
  RoomGridMoveBodySchema,
  MAX_GRID_ROWS,
  autoAssignGridPositions,
  fillFreeGridSlots,
  gridCapacity,
  gridPositionsFitProblem,
  moveGridItem,
  nextFreeGridSlot,
  removeGridItem,
  sortByGridSlot,
  validateAttributes as validateMaterialAttributes,
  nextFreeRackSlot,
  nextFreeRackShelf,
  rackCapacity,
  rackPositionsFitProblem,
  rackShelfFitProblem,
  relocateDeepFreezers,
  resolveRackShelfIndex,
  resolveRackShelves,
  type Chemical,
  type Container,
  type InventoryTree,
  type Room,
} from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import type { SessionUserRow } from "../auth/sessions.js";
import { assignCreatePosition, normalizePositionCode } from "./positions.js";
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
  findBarcodeOwner as findBarcodeOwnerHelper,
  findChemicalAnywhere,
  genId,
  isMemberOrSuperadmin,
  isPseudoRoom,
  loadDoc,
  locationChemicals,
  resolveStockTarget,
  type MutationContext,
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

  // An asset room may only link to a real chemical room in tree.rooms. Deep
  // freezers (including the pseudo room shape returned by findRoomOrThrow),
  // legacy asset-room ids and unknown ids are never valid targets.
  const resolveAssetRoomLink = (
    tree: InventoryTree,
    linkedRoomId: string | null | undefined,
  ): string | undefined => {
    if (linkedRoomId === undefined || linkedRoomId === null) {
      return undefined;
    }
    const room = tree.rooms.find((candidate) => candidate.id === linkedRoomId);
    if (room === undefined) {
      throw new OpError(404, "Chemical room not found");
    }
    return room.id;
  };

  // An asset may only reference a canonical physical room from tree.rooms.
  // Omitted/blank room ids preserve the legacy no-room state; root/deep
  // freezers, legacy asset-room ids and unknown ids are rejected.
  const resolveCanonicalAssetRoomId = (tree: InventoryTree, roomId: string | undefined): string => {
    if (roomId === undefined || roomId.trim() === "") {
      return "";
    }
    const room = tree.rooms.find((candidate) => candidate.id === roomId);
    if (room === undefined) {
      throw new OpError(404, "Room not found");
    }
    return room.id;
  };

  // Container layout grids belong to a real canonical room only. Deep-freezer
  // pseudo rooms (their ids resolve through findRoomOrThrow) and the virtual
  // `shared-assets` view are never valid grid owners.
  const resolveGridRoom = (tree: InventoryTree, roomId: string): Room => {
    if (roomId === "shared-assets") {
      throw new OpError(404, "Room not found");
    }
    const room = findRoomOrThrow(tree, roomId);
    if (isPseudoRoom(room)) {
      throw new OpError(404, "Room not found");
    }
    return room;
  };

  // Auto-place a freshly created item and grow the grid by one row while the
  // maximum is not reached. A full 20-row grid leaves the item unpositioned;
  // creation itself must still succeed.
  const autoAssignNewGridItem = (
    grid: { rows: number; columns: number; positions: Record<string, number> },
    itemId: string,
  ): void => {
    let slot = nextFreeGridSlot(grid.positions, gridCapacity(grid.rows, grid.columns));
    if (slot === null && grid.rows < MAX_GRID_ROWS) {
      grid.rows += 1;
      slot = nextFreeGridSlot(grid.positions, gridCapacity(grid.rows, grid.columns));
    }
    if (slot !== null) {
      grid.positions[itemId] = slot;
    }
  };

  app.post("/api/groups/:id/inventory/deepfreezers/:deepfreezerId/racks", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const deepfreezerId = (request.params as { deepfreezerId: string }).deepfreezerId;
    return wrap(request, reply, () => {
      if (!requireWriter(user, reply)) return;
      const body = AddDeepFreezerRackBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);
      const result = mutate(groupId, user, (tree, context) => {
        const freezer = tree.deepFreezers?.find((c) => c.id === deepfreezerId);
        if (freezer === undefined) {
          throw new OpError(404, "Deep freezer not found");
        }
        checkSharedContainerAccess(user, groupId, freezer, context, isMember);
        const name = body.data.name.trim();
        const positions: Record<string, number> = { ...(freezer.rackPositions ?? {}) };
        if (Object.prototype.hasOwnProperty.call(positions, name)) {
          throw new OpError(400, `Rack "${name}" already exists`);
        }
        const capacity = rackCapacity(freezer);
        let slot: number | null;
        if (body.data.slot !== undefined) {
          if (body.data.slot < 0 || body.data.slot >= capacity) {
            throw new OpError(409, `Slot ${body.data.slot} is outside this deep freezer's capacity (${capacity} slots)`);
          }
          const occupant = Object.entries(positions).find(([, assigned]) => assigned === body.data.slot);
          if (occupant !== undefined) {
            throw new OpError(409, `Slot ${body.data.slot} is already occupied by rack "${occupant[0]}"`);
          }
          slot = body.data.slot;
        } else {
          slot = nextFreeRackSlot(positions, capacity);
        }
        if (slot === null) {
          throw new OpError(409, "Deep freezer is full (no free rack slots)");
        }
        freezer.rackPositions = { ...positions, [name]: slot };
        return `Added rack "${name}" to deep freezer "${freezer.name}"`;
      });
      broadcastResult(groupId, result);
      return reply.status(201).send(result);
    });
  });

  app.post("/api/groups/:id/inventory/deepfreezers/:deepfreezerId/racks/:rackName/move", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const deepfreezerId = (request.params as { deepfreezerId: string }).deepfreezerId;
    const rackName = (request.params as { rackName: string }).rackName;
    return wrap(request, reply, () => {
      if (!requireWriter(user, reply)) return;
      const body = MoveDeepFreezerRackBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);

      // A move onto the rack's current slot is a harmless no-op and must not
      // bump the document or append history, so resolve it before mutating.
      const { tree: currentTree, version: currentVersion } = loadDoc(db(), groupId);
      relocateDeepFreezers(currentTree);
      const currentFreezer = currentTree.deepFreezers?.find((c) => c.id === deepfreezerId);
      if (currentFreezer === undefined) {
        throw new OpError(404, "Deep freezer not found");
      }
      const preflightContext: MutationContext = { mirrorGroupId: null };
      checkSharedContainerAccess(user, groupId, currentFreezer, preflightContext, isMember);
      const currentPositions: Record<string, number> = { ...(currentFreezer.rackPositions ?? {}) };
      if (!Object.prototype.hasOwnProperty.call(currentPositions, rackName)) {
        throw new OpError(404, `Rack "${rackName}" not found`);
      }
      const capacity = rackCapacity(currentFreezer);
      if (body.data.slot >= capacity) {
        throw new OpError(409, `Slot ${body.data.slot} is outside this deep freezer's capacity (${capacity} slots)`);
      }
      const occupant = Object.entries(currentPositions).find(([, assigned]) => assigned === body.data.slot);
      if (occupant !== undefined && occupant[0] !== rackName) {
        throw new OpError(409, `Slot ${body.data.slot} is already occupied by rack "${occupant[0]}"`);
      }
      if (currentPositions[rackName] === body.data.slot) {
        return { version: currentVersion, tree: currentTree, mirrorGroupId: preflightContext.mirrorGroupId };
      }

      const result = mutate(groupId, user, (tree, context) => {
        const freezer = tree.deepFreezers?.find((c) => c.id === deepfreezerId);
        if (freezer === undefined) {
          throw new OpError(404, "Deep freezer not found");
        }
        checkSharedContainerAccess(user, groupId, freezer, context, isMember);
        const positions: Record<string, number> = { ...(freezer.rackPositions ?? {}) };
        if (!Object.prototype.hasOwnProperty.call(positions, rackName)) {
          throw new OpError(404, `Rack "${rackName}" not found`);
        }
        const liveCapacity = rackCapacity(freezer);
        if (body.data.slot >= liveCapacity) {
          throw new OpError(409, `Slot ${body.data.slot} is outside this deep freezer's capacity (${liveCapacity} slots)`);
        }
        const liveOccupant = Object.entries(positions).find(([, assigned]) => assigned === body.data.slot);
        if (liveOccupant !== undefined && liveOccupant[0] !== rackName) {
          throw new OpError(409, `Slot ${body.data.slot} is already occupied by rack "${liveOccupant[0]}"`);
        }
        positions[rackName] = body.data.slot;
        freezer.rackPositions = positions;
        return `Moved rack "${rackName}" to slot ${body.data.slot} in deep freezer "${freezer.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.put("/api/groups/:id/inventory/deepfreezers/:deepfreezerId", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const deepfreezerId = (request.params as { deepfreezerId: string }).deepfreezerId;
    return wrap(request, reply, () => {
      if (!requireWriter(user, reply)) return;
      const body = ResizeDeepFreezerBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);
      const result = mutate(groupId, user, (tree, context) => {
        const freezer = tree.deepFreezers?.find((c) => c.id === deepfreezerId);
        if (freezer === undefined) {
          throw new OpError(404, "Deep freezer not found");
        }
        checkSharedContainerAccess(user, groupId, freezer, context, isMember);
        const capacity = body.data.rackRows * body.data.rackColumns;
        const fitProblem = rackPositionsFitProblem(freezer.rackPositions ?? {}, capacity);
        if (fitProblem !== null) {
          throw new OpError(409, `Cannot resize deep freezer to ${body.data.rackRows}x${body.data.rackColumns}: ${fitProblem}`);
        }
        if (body.data.rackShelves !== undefined) {
          const shelfFitProblem = rackShelfFitProblem(freezer.shelves ?? [], body.data.rackShelves);
          if (shelfFitProblem !== null) {
            throw new OpError(
              409,
              `Cannot resize deep freezer to ${body.data.rackShelves} shelves per rack: ${shelfFitProblem}`,
            );
          }
        }
        freezer.rackRows = body.data.rackRows;
        freezer.rackColumns = body.data.rackColumns;
        if (body.data.rackShelves !== undefined) {
          freezer.rackShelves = body.data.rackShelves;
        }
        return `Resized deep freezer "${freezer.name}" to ${body.data.rackRows}x${body.data.rackColumns}`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/deepfreezers/:deepfreezerId/boxes", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const deepfreezerId = (request.params as { deepfreezerId: string }).deepfreezerId;
    return wrap(request, reply, () => {
      if (!requireWriter(user, reply)) return;
      const body = AddDeepFreezerBoxBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);
      const result = mutate(groupId, user, (tree, context) => {
        const freezer = tree.deepFreezers?.find((c) => c.id === deepfreezerId);
        if (freezer === undefined) {
          throw new OpError(404, "Deep freezer not found");
        }
        checkSharedContainerAccess(user, groupId, freezer, context, isMember);
        const rackName = body.data.rackName.trim();
        const rackLocations = freezer.rackPositions ?? {};
        if (!Object.prototype.hasOwnProperty.call(rackLocations, rackName)) {
          throw new OpError(404, `Rack "${rackName}" not found`);
        }
        const rackChildren = (freezer.shelves ?? []).filter(
          (sh) => (sh.rackName ?? "") === rackName,
        );
        const used = new Set(rackChildren.map((sh) => sh.boxName ?? "").filter((b) => b !== ""));
        let nextBox = 1;
        while (used.has(String(nextBox))) nextBox += 1;
        const shelfCapacity = resolveRackShelves(freezer);
        if (rackChildren.length >= shelfCapacity) {
          throw new OpError(409, `Rack "${rackName}" holds ${rackChildren.length} boxes; no free shelf position (capacity ${shelfCapacity})`);
        }
        const nextShelf = nextFreeRackShelf(rackChildren, rackName, shelfCapacity);
        if (nextShelf === null) {
          throw new OpError(409, `Rack "${rackName}" has no free shelf position (capacity ${shelfCapacity})`);
        }
        (freezer.shelves ??= []).push({
          id: genId(),
          name: `Rack ${rackName} / Box ${nextBox}`,
          rackName,
          boxName: String(nextBox),
          rackShelf: nextShelf,
          color: body.data.color,
          chemicals: [],
        });
        return `Added box "${nextBox}" to rack "${rackName}" in deep freezer "${freezer.name}"`;
      });
      broadcastResult(groupId, result);
      return reply.status(201).send(result);
    });
  });

  app.post("/api/groups/:id/inventory/deepfreezers/:deepfreezerId/boxes/:boxId/move", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const deepfreezerId = (request.params as { deepfreezerId: string }).deepfreezerId;
    const boxId = (request.params as { boxId: string }).boxId;
    return wrap(request, reply, () => {
      if (!requireWriter(user, reply)) return;
      const body = MoveDeepFreezerBoxBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const isMember = isMemberOrSuperadmin(user, groupId);

      // A move onto the box's current shelf is a harmless no-op and must not
      // bump the document or append history, so resolve it before mutating.
      const { tree: currentTree, version: currentVersion } = loadDoc(db(), groupId);
      relocateDeepFreezers(currentTree);
      const currentFreezer = currentTree.deepFreezers?.find((c) => c.id === deepfreezerId);
      if (currentFreezer === undefined) {
        throw new OpError(404, "Deep freezer not found");
      }
      const preflightContext: MutationContext = { mirrorGroupId: null };
      checkSharedContainerAccess(user, groupId, currentFreezer, preflightContext, isMember);
      const currentBox = (currentFreezer.shelves ?? []).find((shelf) => shelf.id === boxId);
      if (currentBox === undefined) {
        throw new OpError(404, "Box not found");
      }
      const currentRackName = currentBox.rackName ?? "";
      if (currentRackName === "") {
        throw new OpError(409, "Box is not assigned to a rack");
      }
      const capacity = resolveRackShelves(currentFreezer);
      if (body.data.shelf > capacity) {
        throw new OpError(409, `Shelf ${body.data.shelf} is outside this rack's capacity (1..${capacity})`);
      }
      const currentOccupant = (currentFreezer.shelves ?? []).find(
        (shelf) =>
          shelf.id !== boxId &&
          (shelf.rackName ?? "") === currentRackName &&
          resolveRackShelfIndex(shelf) === body.data.shelf,
      );
      if (currentOccupant !== undefined) {
        throw new OpError(
          409,
          `Shelf ${body.data.shelf} is already occupied by box "${currentOccupant.boxName ?? currentOccupant.id}" in rack "${currentRackName}"`,
        );
      }
      if (resolveRackShelfIndex(currentBox) === body.data.shelf) {
        return { version: currentVersion, tree: currentTree, mirrorGroupId: preflightContext.mirrorGroupId };
      }

      const result = mutate(groupId, user, (tree, context) => {
        const freezer = tree.deepFreezers?.find((c) => c.id === deepfreezerId);
        if (freezer === undefined) {
          throw new OpError(404, "Deep freezer not found");
        }
        checkSharedContainerAccess(user, groupId, freezer, context, isMember);
        const box = (freezer.shelves ?? []).find((shelf) => shelf.id === boxId);
        if (box === undefined) {
          throw new OpError(404, "Box not found");
        }
        const rackName = box.rackName ?? "";
        if (rackName === "") {
          throw new OpError(409, "Box is not assigned to a rack");
        }
        const liveCapacity = resolveRackShelves(freezer);
        if (body.data.shelf > liveCapacity) {
          throw new OpError(409, `Shelf ${body.data.shelf} is outside this rack's capacity (1..${liveCapacity})`);
        }
        const occupant = (freezer.shelves ?? []).find(
          (shelf) =>
            shelf.id !== boxId &&
            (shelf.rackName ?? "") === rackName &&
            resolveRackShelfIndex(shelf) === body.data.shelf,
        );
        if (occupant !== undefined) {
          throw new OpError(
            409,
            `Shelf ${body.data.shelf} is already occupied by box "${occupant.boxName ?? occupant.id}" in rack "${rackName}"`,
          );
        }
        box.rackShelf = body.data.shelf;
        return `Moved box "${box.boxName ?? box.name}" to shelf ${body.data.shelf} in rack "${rackName}" of deep freezer "${freezer.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/deepfreezers", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = AddDeepFreezerBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        (tree.deepFreezers ??= []).push({
          id: genId(),
          name: body.data.name,
          description: body.data.description,
          emoji: body.data.emoji,
          type: "deepfreezer",
          sharedWithGroupIds: [],
          rackRows: body.data.rackRows,
          rackColumns: body.data.rackColumns,
          rackShelves: body.data.rackShelves,
          shelves: [],
        });
        return `Added deep freezer "${body.data.name}"`;
      });
      broadcastResult(groupId, result);
      return reply.status(201).send(result);
    });
  });

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
        const room: Room = { id: genId(), name: body.data.name, description: body.data.description, containers: [] };
        tree.rooms.push(room);
        if (tree.roomGrid !== undefined) {
          autoAssignNewGridItem(tree.roomGrid, room.id);
          tree.rooms = sortByGridSlot(tree.rooms, tree.roomGrid.positions);
        }
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
        if (isPseudoRoom(room)) {
          throw new OpError(404, "Room not found");
        }
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
        if (isPseudoRoom(room)) {
          throw new OpError(404, "Room not found");
        }
        const linkedInstrument = db()
          .prepare("SELECT 1 AS linked FROM instruments WHERE room_group_id = ? AND room_id = ? LIMIT 1")
          .get(groupId, roomId) as { linked: number } | undefined;
        const linkedAssetRoom = tree.assetRooms.some((candidate) => candidate.linkedRoomId === roomId);
        // Assets may point directly at a canonical tree.rooms id; those
        // references must block deletion just like legacy asset-room links.
        const linkedAsset = tree.assets.some((candidate) => candidate.roomId === roomId);
        if (linkedInstrument !== undefined || linkedAssetRoom || linkedAsset) {
          throw new OpError(
            409,
            "Unlink assigned instruments and asset rooms before deleting this room",
          );
        }
        tree.rooms = tree.rooms.filter((candidate) => candidate.id !== roomId);
        if (tree.roomGrid !== undefined) {
          tree.roomGrid.positions = removeGridItem(tree.roomGrid.positions, roomId);
        }
        return `Deleted room "${room.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.put("/api/groups/:id/inventory/room-grid", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = GridSettingsSchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const { rows, columns, hideEmptySlots } = body.data;
        if (tree.roomGrid === undefined) {
          tree.roomGrid = {
            rows,
            columns,
            positions: autoAssignGridPositions(
              tree.rooms.map((room) => room.id),
              gridCapacity(rows, columns),
            ),
            hideEmptySlots: hideEmptySlots ?? false,
          };
          tree.rooms = sortByGridSlot(tree.rooms, tree.roomGrid.positions);
          return `Created room grid (${rows}x${columns})`;
        }
        // Shrinks must never silently renumber or drop occupied slots.
        const grid = tree.roomGrid;
        const previousCapacity = gridCapacity(grid.rows, grid.columns);
        const fitProblem = gridPositionsFitProblem(grid.positions, rows, columns);
        if (fitProblem !== null) {
          throw new OpError(409, `Cannot resize room grid to ${rows}x${columns}: ${fitProblem}`);
        }
        grid.rows = rows;
        grid.columns = columns;
        // View-only preference: never touches positions or document order.
        if (hideEmptySlots !== undefined) {
          grid.hideEmptySlots = hideEmptySlots;
        }
        const capacity = gridCapacity(rows, columns);
        if (capacity > previousCapacity) {
          // Growth fills previously unpositioned rooms into the first free
          // slots without renumbering anything that is already placed.
          const positions = fillFreeGridSlots(tree.rooms.map((room) => room.id), grid.positions, capacity);
          if (Object.keys(positions).length > Object.keys(grid.positions).length) {
            grid.positions = positions;
            tree.rooms = sortByGridSlot(tree.rooms, grid.positions);
          }
        }
        return `Resized room grid to ${rows}x${columns}`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.delete("/api/groups/:id/inventory/room-grid", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const { tree: currentTree, version: currentVersion } = loadDoc(db(), groupId);
      if (currentTree.roomGrid === undefined) {
        return { version: currentVersion, tree: currentTree, mirrorGroupId: null };
      }
      const result = mutate(groupId, user, (tree) => {
        tree.roomGrid = undefined;
        return "Removed room grid";
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/room-grid/move", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = RoomGridMoveBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }

      // Resolve same-slot no-ops before mutating so they do not bump the
      // document or append history.
      const { tree: currentTree, version: currentVersion } = loadDoc(db(), groupId);
      const currentGrid = currentTree.roomGrid;
      if (currentGrid === undefined) {
        throw new OpError(404, "Room grid not configured");
      }
      const currentRoom = currentTree.rooms.find((candidate) => candidate.id === body.data.roomId);
      if (currentRoom === undefined) {
        throw new OpError(404, "Room not found");
      }
      const currentCapacity = gridCapacity(currentGrid.rows, currentGrid.columns);
      if (body.data.slot >= currentCapacity) {
        throw new OpError(
          409,
          `Slot ${body.data.slot} is outside the room grid capacity (${currentGrid.rows}x${currentGrid.columns} = ${currentCapacity} slots)`,
        );
      }
      if (currentGrid.positions[body.data.roomId] === body.data.slot) {
        return { version: currentVersion, tree: currentTree, mirrorGroupId: null };
      }

      const result = mutate(groupId, user, (tree) => {
        const grid = tree.roomGrid;
        if (grid === undefined) {
          throw new OpError(404, "Room grid not configured");
        }
        const room = tree.rooms.find((candidate) => candidate.id === body.data.roomId);
        if (room === undefined) {
          throw new OpError(404, "Room not found");
        }
        const capacity = gridCapacity(grid.rows, grid.columns);
        if (body.data.slot >= capacity) {
          throw new OpError(
            409,
            `Slot ${body.data.slot} is outside the room grid capacity (${grid.rows}x${grid.columns} = ${capacity} slots)`,
          );
        }
        grid.positions = moveGridItem(grid.positions, body.data.roomId, body.data.slot);
        tree.rooms = sortByGridSlot(tree.rooms, grid.positions);
        return `Moved room "${room.name}" to grid slot ${body.data.slot}`;
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
        if (isPseudoRoom(room)) {
          throw new OpError(404, "Room not found");
        }
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
        // Deep freezers are relocated to the root rail on the next document
        // load; never give them a slot in this room's container grid.
        if (room.containerGrid !== undefined && container.type !== "deepfreezer") {
          autoAssignNewGridItem(room.containerGrid, container.id);
          room.containers = sortByGridSlot(room.containers, room.containerGrid.positions);
        }
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
        if (room.containerGrid !== undefined) {
          room.containerGrid.positions = removeGridItem(room.containerGrid.positions, containerId);
        }
        return `Deleted container "${container.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.put("/api/groups/:id/inventory/rooms/:roomId/container-grid", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const roomId = (request.params as { roomId: string }).roomId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = GridSettingsSchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const room = resolveGridRoom(tree, roomId);
        const { rows, columns, hideEmptySlots } = body.data;
        if (room.containerGrid === undefined) {
          room.containerGrid = {
            rows,
            columns,
            positions: autoAssignGridPositions(
              room.containers.map((container) => container.id),
              gridCapacity(rows, columns),
            ),
            hideEmptySlots: hideEmptySlots ?? false,
          };
          room.containers = sortByGridSlot(room.containers, room.containerGrid.positions);
          return `Created container grid for room "${room.name}" (${rows}x${columns})`;
        }
        // Owner-lab authority only; shared-container access never grants
        // permission to rearrange another lab's layout.
        const grid = room.containerGrid;
        const previousCapacity = gridCapacity(grid.rows, grid.columns);
        const fitProblem = gridPositionsFitProblem(grid.positions, rows, columns);
        if (fitProblem !== null) {
          throw new OpError(
            409,
            `Cannot resize container grid for room "${room.name}" to ${rows}x${columns}: ${fitProblem}`,
          );
        }
        grid.rows = rows;
        grid.columns = columns;
        // View-only preference: never touches positions or document order.
        if (hideEmptySlots !== undefined) {
          grid.hideEmptySlots = hideEmptySlots;
        }
        const capacity = gridCapacity(rows, columns);
        if (capacity > previousCapacity) {
          // Growth fills previously unpositioned containers into the first
          // free slots without renumbering anything that is already placed.
          const positions = fillFreeGridSlots(
            room.containers.map((container) => container.id),
            grid.positions,
            capacity,
          );
          if (Object.keys(positions).length > Object.keys(grid.positions).length) {
            grid.positions = positions;
            room.containers = sortByGridSlot(room.containers, grid.positions);
          }
        }
        return `Resized container grid for room "${room.name}" to ${rows}x${columns}`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.delete("/api/groups/:id/inventory/rooms/:roomId/container-grid", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const roomId = (request.params as { roomId: string }).roomId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const { tree: currentTree, version: currentVersion } = loadDoc(db(), groupId);
      const currentRoom = resolveGridRoom(currentTree, roomId);
      if (currentRoom.containerGrid === undefined) {
        return { version: currentVersion, tree: currentTree, mirrorGroupId: null };
      }
      const result = mutate(groupId, user, (tree) => {
        const room = resolveGridRoom(tree, roomId);
        room.containerGrid = undefined;
        return `Removed container grid for room "${room.name}"`;
      });
      broadcastResult(groupId, result);
      return result;
    });
  });

  app.post("/api/groups/:id/inventory/rooms/:roomId/container-grid/move", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const roomId = (request.params as { roomId: string }).roomId;
    return wrap(request, reply, () => {
      guard(user, groupId);
      if (!requireWriter(user, reply)) return;
      const body = ContainerGridMoveBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }

      // Resolve same-slot no-ops before mutating so they neither bump the
      // document nor append history.
      const { tree: currentTree, version: currentVersion } = loadDoc(db(), groupId);
      const currentRoom = resolveGridRoom(currentTree, roomId);
      const currentGrid = currentRoom.containerGrid;
      if (currentGrid === undefined) {
        throw new OpError(404, "Container grid not configured");
      }
      const currentContainer = currentRoom.containers.find(
        (candidate) => candidate.id === body.data.containerId,
      );
      if (currentContainer === undefined) {
        throw new OpError(404, "Container not found");
      }
      const currentCapacity = gridCapacity(currentGrid.rows, currentGrid.columns);
      if (body.data.slot >= currentCapacity) {
        throw new OpError(
          409,
          `Slot ${body.data.slot} is outside the container grid capacity (${currentGrid.rows}x${currentGrid.columns} = ${currentCapacity} slots)`,
        );
      }
      if (currentGrid.positions[body.data.containerId] === body.data.slot) {
        return { version: currentVersion, tree: currentTree, mirrorGroupId: null };
      }

      const result = mutate(groupId, user, (tree) => {
        const room = resolveGridRoom(tree, roomId);
        const grid = room.containerGrid;
        if (grid === undefined) {
          throw new OpError(404, "Container grid not configured");
        }
        const container = room.containers.find((candidate) => candidate.id === body.data.containerId);
        if (container === undefined) {
          throw new OpError(404, "Container not found");
        }
        const capacity = gridCapacity(grid.rows, grid.columns);
        if (body.data.slot >= capacity) {
          throw new OpError(
            409,
            `Slot ${body.data.slot} is outside the container grid capacity (${grid.rows}x${grid.columns} = ${capacity} slots)`,
          );
        }
        grid.positions = moveGridItem(grid.positions, body.data.containerId, body.data.slot);
        room.containers = sortByGridSlot(room.containers, grid.positions);
        return `Moved container "${container.name}" to grid slot ${body.data.slot}`;
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
        const assignment = assignCreatePosition({
          position: body.data.position,
          customPosition: body.data.customPosition,
          container: target.container,
          shelf: target.shelf,
          name: body.data.name,
        });
        if (body.data.barcode !== undefined && body.data.barcode.trim() !== "") {
          const owner = findBarcodeOwnerHelper(tree, body.data.barcode.trim(), null);
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
          position: assignment.position,
          customPosition: assignment.customPosition,
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
            const owner = findBarcodeOwnerHelper(tree, body.data.barcode.trim(), chemicalId);
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
          chemical.customPosition = normalizePositionCode(body.data.customPosition);
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
      // Compatibility creator: new physical rooms use the canonical tree.rooms
      // namespace. `linkedRoomId` from legacy callers is accepted and ignored;
      // this route no longer creates a second asset-room namespace.
      const body = AddRoomBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new OpError(400, "Invalid request");
      }
      const result = mutate(groupId, user, (tree) => {
        const room: Room = { id: genId(), name: body.data.name, description: body.data.description, containers: [] };
        tree.rooms.push(room);
        if (tree.roomGrid !== undefined) {
          autoAssignNewGridItem(tree.roomGrid, room.id);
          tree.rooms = sortByGridSlot(tree.rooms, tree.roomGrid.positions);
        }
        return `Added room "${body.data.name}"`;
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
        if (body.data.linkedRoomId !== undefined) {
          // Omitted link leaves the existing mapping alone; explicit null clears it.
          room.linkedRoomId = resolveAssetRoomLink(tree, body.data.linkedRoomId);
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
        const roomId = resolveCanonicalAssetRoomId(tree, body.data.roomId);
        tree.assets.push({
          id: genId(),
          name: body.data.name,
          model: body.data.model,
          barcode: body.data.barcode,
          description: body.data.description,
          roomId,
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
          // Validate before mutating so an invalid legacy/freezer/unknown id
          // leaves the document and version untouched. Omitted ids preserve
          // the existing room; an explicit empty string clears it.
          asset.roomId = resolveCanonicalAssetRoomId(tree, body.data.roomId);
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
