import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { createRealtimeClient } from "../src/lib/realtime";
import { inventory, clearInventory } from "../src/lib/stores/inventory.svelte";
import { setCurrentGroup } from "../src/lib/stores/currentGroup.svelte";
import { connection, resetConnection } from "../src/lib/stores/connection.svelte";
import { clearSession, session, setUser, type SessionUser } from "../src/lib/stores/session.svelte";

const user: SessionUser = { uid: "u1", name: "Tester", role: "member", groupId: "g1", email: "t@example.com" };

let server: WebSocketServer | null = null;
let httpServer: http.Server | null = null;

function startWsServer(onSubscribe: (ws: WebSocket, message: string) => void, port = 0): Promise<number> {
  return new Promise((resolve) => {
    server = new WebSocketServer({ port });
    server.on("connection", (ws) => {
      ws.on("message", (data) => {
        onSubscribe(ws, String(data));
      });
    });
    server.on("listening", () => {
      resolve((server!.address() as AddressInfo).port);
    });
  });
}

function stopWsServer(): Promise<void> {
  const target = server;
  server = null;
  if (target === null) {
    return Promise.resolve();
  }
  for (const client of target.clients) {
    client.terminate();
  }
  return new Promise((resolve) => {
    target.close(() => resolve());
  });
}

afterAll(async () => {
  await stopWsServer();
  if (httpServer !== null) {
    httpServer.close();
    httpServer = null;
  }
});

beforeEach(() => {
  clearInventory();
  clearSession();
  resetConnection();
  setCurrentGroup("g1", "Lab One");
});

describe("realtime client", () => {
  it("broadcast updates the inventory store version and tree", async () => {
    let receivedSubscribe = "";
    const port = await startWsServer((ws, message) => {
      receivedSubscribe = message;
      ws.send(JSON.stringify({ groupId: "g1", version: 7, tree: { rooms: [] } }));
    });
    const client = createRealtimeClient({
      url: `ws://127.0.0.1:${port}`,
      minDelayMs: 2000,
      maxDelayMs: 2000,
      probeSession: async () => true,
    });
    client.connect();
    client.subscribe("g1");
    await vi.waitFor(() => {
      expect(inventory.version).toBe(7);
      expect(receivedSubscribe).toBe(JSON.stringify({ subscribe: "g1" }));
      expect(inventory.tree).toEqual({ rooms: [] });
      expect(connection.connected).toBe(true);
    });
    expect(connection.offline).toBe(false);
    client.stop();
  });

  it("server kill sets offline, restart reconnects, resubscribes and refetches", async () => {
    let connections = 0;
    let resubscribed = false;
    const port = await startWsServer((ws, message) => {
      const parsed = JSON.parse(message) as { subscribe?: string };
      if (parsed.subscribe === "g1") {
        resubscribed = true;
        ws.send(JSON.stringify({ groupId: "g1", version: 3, tree: { rooms: [] } }));
      }
    });
    server!.on("connection", () => {
      connections += 1;
    });

    const refetch = vi.fn();
    const client = createRealtimeClient({
      url: `ws://127.0.0.1:${port}`,
      minDelayMs: 100,
      maxDelayMs: 500,
      probeSession: async () => true,
      onRefetch: refetch,
    });
    client.connect();
    client.subscribe("g1");

    await vi.waitFor(() => {
      expect(connections).toBe(1);
      expect(connection.connected).toBe(true);
    });
    await vi.waitFor(() => {
      expect(inventory.version).toBe(3);
    });

    await stopWsServer();
    await vi.waitFor(() => {
      expect(connection.offline).toBe(true);
      expect(connection.connected).toBe(false);
    });

    await startWsServer(
      (ws, message) => {
        const parsed = JSON.parse(message) as { subscribe?: string };
        if (parsed.subscribe === "g1") {
          resubscribed = true;
          ws.send(JSON.stringify({ groupId: "g1", version: 4, tree: { rooms: [] } }));
        }
      },
      port,
    );

    await vi.waitFor(() => {
      expect(connection.connected).toBe(true);
      expect(resubscribed).toBe(true);
      expect(refetch).toHaveBeenCalled();
      expect(connection.offline).toBe(false);
    });
    await vi.waitFor(() => {
      expect(inventory.version).toBe(4);
    });
    client.stop();
    await stopWsServer();
  });

  it("reload broadcasts refresh feature stores", async () => {
    const fetchCalls: string[] = [];
    const port = await startWsServer((ws) => {
      ws.send(JSON.stringify({ type: "reload", resource: "notices" }));
    });
    const client = createRealtimeClient({
      url: `ws://127.0.0.1:${port}`,
      minDelayMs: 2000,
      probeSession: async () => true,
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return new Response(JSON.stringify({ notices: [] }), { status: 200 });
    }) as typeof fetch;
    try {
      client.connect();
      client.subscribe("g1");
      await vi.waitFor(() => {
        expect(fetchCalls.some((c) => c.includes("/api/notices"))).toBe(true);
      });
    } finally {
      globalThis.fetch = original;
      client.stop();
    }
  });

  it("handshake rejection with dead session shows login instead of crashing or retrying", async () => {
    httpServer = http.createServer((req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
    });
    const port = await new Promise<number>((resolve) => {
      httpServer!.listen(0, "127.0.0.1", () => {
        resolve((httpServer!.address() as AddressInfo).port);
      });
    });

    setUser(user);
    expect(session.user).not.toBeNull();

    let probeCalls = 0;
    const client = createRealtimeClient({
      url: `ws://127.0.0.1:${port}`,
      minDelayMs: 100,
      maxDelayMs: 200,
      probeSession: async () => {
        probeCalls += 1;
        return false;
      },
      onUnauthenticated: clearSession,
    });
    client.connect();

    await vi.waitFor(() => {
      expect(connection.unauthenticated).toBe(true);
      expect(session.user).toBeNull();
    });
    expect(client.currentState).toBe("unauthenticated");

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(probeCalls).toBe(1);
    expect(connection.connected).toBe(false);
    httpServer!.close();
    httpServer = null;
    client.stop();
  });
});
