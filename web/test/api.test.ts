import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, onUnauthorized } from "../src/lib/api";
import { resetConnection, setConnected } from "../src/lib/stores/connection.svelte";

let fetchCalls: Array<{ url: string; init: RequestInit }> = [];
let status = 200;
let responseBody: unknown = {};

beforeEach(() => {
  fetchCalls = [];
  status = 200;
  responseBody = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetConnection();
});

describe("api client", () => {
  it("sends X-Requested-With on every request and JSON content-type with a body", async () => {
    responseBody = { ok: true };
    await api.post("/api/groups", { name: "Lab" });
    const call = fetchCalls[0]!;
    const headers = call.init.headers as Record<string, string>;
    expect(headers["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(call.init.credentials).toBe("same-origin");
    expect(call.init.body).toBe(JSON.stringify({ name: "Lab" }));
  });

  it("401 invokes the unauthorized handler and throws ApiError", async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    status = 401;
    responseBody = { error: "Not authenticated" };
    await expect(api.get("/api/me")).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
    try {
      await api.get("/api/me");
    } catch (error) {
      expect((error as ApiError).status).toBe(401);
      expect((error as ApiError).message).toBe("Not authenticated");
    }
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("401 on auth endpoints keeps the server message and does not clear the session", async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    status = 401;
    responseBody = { error: "Invalid email or password" };
    await expect(api.post("/api/login", { email: "x", password: "y" })).rejects.toThrow(
      "Invalid email or password",
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("surfaces the server error message", async () => {
    status = 409;
    responseBody = { error: "Already a member of this lab" };
    await expect(api.post("/api/groups/join", { code: "X" })).rejects.toThrow(
      "Already a member of this lab",
    );
  });

  it("rejects mutations while offline and allows them once reconnected", async () => {
    setConnected(true);
    setConnected(false);
    await expect(api.post("/api/groups/join", { code: "X" })).rejects.toThrow(/offline/i);
    expect(fetchCalls.length).toBe(0);
    setConnected(true);
    responseBody = { ok: true };
    await api.post("/api/groups/join", { code: "X" });
    expect(fetchCalls.length).toBe(1);
  });
});
