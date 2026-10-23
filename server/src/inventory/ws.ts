import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { InventoryTreeSchema } from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { getSessionUser, SESSION_COOKIE_NAME } from "../auth/sessions.js";

export class InventoryHub {
  private readonly channels = new Map<string, Set<WebSocket>>();

  subscribe(groupId: string, socket: WebSocket): void {
    let channel = this.channels.get(groupId);
    if (channel === undefined) {
      channel = new Set();
      this.channels.set(groupId, channel);
    }
    channel.add(socket);
  }

  unsubscribeAll(socket: WebSocket): void {
    for (const channel of this.channels.values()) {
      channel.delete(socket);
    }
  }

  broadcast(groupId: string, payload: unknown): void {
    const channel = this.channels.get(groupId);
    if (channel === undefined) {
      return;
    }
    this.sendTo(channel, payload);
  }

  broadcastAll(payload: unknown): void {
    for (const channel of this.channels.values()) {
      this.sendTo(channel, payload);
    }
  }

  private sendTo(channel: Set<WebSocket>, payload: unknown): void {
    const message = JSON.stringify(payload);
    for (const socket of channel) {
      if (socket.readyState === socket.OPEN) {
        socket.send(message);
      }
    }
  }
}

export function registerInventoryWs(app: FastifyInstance, config: ServerConfig, hub: InventoryHub): void {
  const db = () => getDatabase(config.dbPath);

  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const user = getSessionUser(db(), request.cookies[SESSION_COOKIE_NAME]);
        if (user === null) {
          return reply.status(401).send({ error: "Not authenticated" });
        }
      },
    },
    (socket: WebSocket, request) => {
      const user = getSessionUser(db(), request.cookies[SESSION_COOKIE_NAME]);
      if (user === null) {
        socket.close(4001, "unauthenticated");
        return;
      }
      const heartbeat = setInterval(() => {
        socket.ping();
      }, 30_000);
      socket.on("message", (data: unknown) => {
        let parsed: { subscribe?: unknown };
        try {
          parsed = JSON.parse(String(data)) as { subscribe?: unknown };
        } catch {
          socket.send(JSON.stringify({ error: "invalid message" }));
          return;
        }
        const groupId = parsed.subscribe;
        if (typeof groupId !== "string" || groupId === "") {
          return;
        }
        if (user.role !== "superadmin" && user.group_id !== groupId) {
          socket.send(JSON.stringify({ error: "not a member of this group" }));
          return;
        }
        hub.subscribe(groupId, socket);
        const row = db()
          .prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = ?")
          .get(groupId) as { tree: string; version: number } | undefined;
        if (row === undefined) {
          socket.send(JSON.stringify({ error: "inventory not found" }));
          return;
        }
        const tree = InventoryTreeSchema.parse(JSON.parse(row.tree));
        socket.send(JSON.stringify({ groupId, version: row.version, tree }));
      });
      socket.on("close", () => {
        clearInterval(heartbeat);
        hub.unsubscribeAll(socket);
      });
    },
  );
}
