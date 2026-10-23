import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { InventoryTreeSchema, ShareContainerBodySchema, UnshareContainerBodySchema, type Container } from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import {
  OpError,
  createMutator,
  findContainerOrThrow,
  isMemberOrSuperadmin,
  type MutationResult,
} from "./doc.js";
import type { InventoryHub } from "./ws.js";

export interface SharedContainerView {
  roomId: string;
  roomName: string;
  ownerGroupId: string;
  ownerGroupName: string;
  container: Container;
}

export function registerSharedContainerRoutes(app: FastifyInstance, config: ServerConfig, hub: InventoryHub): void {
  const db = (): Database.Database => getDatabase(config.dbPath);
  const mutate = createMutator(db);

  const guard = (user: { role: string; group_id: string | null }, groupId: string): void => {
    if (user.role !== "superadmin" && user.group_id !== groupId) {
      throw new OpError(403, "Not a member of this lab");
    }
  };

  app.get("/api/groups/:id/shared-containers", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    try {
      guard(user, groupId);
      const shared: SharedContainerView[] = [];
      const rows = db()
        .prepare("SELECT group_id, tree FROM group_inventory_docs WHERE group_id != ?")
        .all(groupId) as Array<{ group_id: string; tree: string }>;
      for (const row of rows) {
        const parsed = InventoryTreeSchema.safeParse(JSON.parse(row.tree));
        if (!parsed.success) {
          continue;
        }
        for (const room of parsed.data.rooms) {
          for (const container of room.containers) {
            if (
              container.ownerGroupId !== undefined &&
              container.ownerGroupId !== groupId &&
              container.sharedWithGroupIds.includes(groupId)
            ) {
              const ownerGroup = db()
                .prepare("SELECT name FROM groups WHERE id = ?")
                .get(container.ownerGroupId) as { name: string } | undefined;
              shared.push({
                roomId: room.id,
                roomName: room.name,
                ownerGroupId: container.ownerGroupId ?? row.group_id,
                ownerGroupName: ownerGroup?.name ?? container.ownerGroupName ?? "Unknown lab",
                container,
              });
            }
          }
        }
      }
      return { sharedContainers: shared };
    } catch (error) {
      if (error instanceof OpError) {
        return reply.status(error.status).send({ error: error.message });
      }
      request.log.error(error, "shared container listing failed");
      return reply.status(500).send({ error: "Internal error" });
    }
  });

  app.post("/api/groups/:id/inventory/containers/:containerId/share", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const containerId = (request.params as { containerId: string }).containerId;
    try {
      guard(user, groupId);
      if (user.role === "reader") {
        return reply.status(403).send({ error: "Readers cannot make changes" });
      }
      const body = ShareContainerBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: "Invalid request" });
      }
      const target = db().prepare("SELECT id, name FROM groups WHERE id = ?").get(body.data.sharedWithGroupId) as
        | { id: string; name: string }
        | undefined;
      if (target === undefined) {
        return reply.status(404).send({ error: "No such lab" });
      }
      const result = mutate(groupId, user, (tree) => {
        const container = findContainerOrThrow(tree, body.data.roomId, containerId);
        const ownGroup = db().prepare("SELECT name FROM groups WHERE id = ?").get(groupId) as { name: string } | undefined;
        container.ownerGroupId = groupId;
        container.ownerGroupName = ownGroup?.name ?? "";
        if (!container.sharedWithGroupIds.includes(target.id)) {
          container.sharedWithGroupIds.push(target.id);
        }
        return `Shared container "${container.name}" with lab "${target.name}"`;
      });
      const payload = { groupId, version: result.version, tree: result.tree };
      hub.broadcast(groupId, payload);
      hub.broadcast(body.data.sharedWithGroupId, payload);
      return result;
    } catch (error) {
      if (error instanceof OpError) {
        return reply.status(error.status).send({ error: error.message });
      }
      request.log.error(error, "share container failed");
      return reply.status(500).send({ error: "Internal error" });
    }
  });

  app.post("/api/groups/:id/inventory/containers/:containerId/unshare", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const groupId = (request.params as { id: string }).id;
    const containerId = (request.params as { containerId: string }).containerId;
    try {
      guard(user, groupId);
      if (user.role === "reader") {
        return reply.status(403).send({ error: "Readers cannot make changes" });
      }
      const body = UnshareContainerBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: "Invalid request" });
      }
      const result: MutationResult = mutate(groupId, user, (tree) => {
        const container = findContainerOrThrow(tree, body.data.roomId, containerId);
        container.sharedWithGroupIds = container.sharedWithGroupIds.filter(
          (candidate) => candidate !== body.data.sharedWithGroupId,
        );
        return `Unshared container "${container.name}"`;
      });
      const payload = { groupId, version: result.version, tree: result.tree };
      hub.broadcast(groupId, payload);
      hub.broadcast(body.data.sharedWithGroupId, payload);
      return result;
    } catch (error) {
      if (error instanceof OpError) {
        return reply.status(error.status).send({ error: error.message });
      }
      request.log.error(error, "unshare container failed");
      return reply.status(500).send({ error: "Internal error" });
    }
  });
}
