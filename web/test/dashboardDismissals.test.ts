import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDashboardDismissals,
  dashboardDismissals,
  dismissDashboardAlert,
  loadDashboardDismissals,
} from "../src/lib/stores/dashboardDismissals.svelte";
import { resetConnection } from "../src/lib/stores/connection.svelte";

const USER_A = "synthetic-dashboard-a";
const USER_B = "synthetic-dashboard-b";
const KEY_A = "notice:notice-a";
const KEY_B = "stock-low:chemical-b";

type MockResponse = {
  status?: number;
  body?: unknown;
  promise?: Promise<Response>;
};

let responses: MockResponse[] = [];
let fetchCalls: Array<{ url: string; init: RequestInit }> = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function response(dismissals: string[] = [], updatedAt = 0): { dismissals: string[]; updatedAt: number } {
  return { dismissals, updatedAt };
}

beforeEach(() => {
  clearDashboardDismissals();
  resetConnection();
  responses = [];
  fetchCalls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (next === undefined) throw new Error("Unexpected fetch");
    return next.promise ?? jsonResponse(next.body ?? {}, next.status);
  });
});

afterEach(() => {
  clearDashboardDismissals();
  resetConnection();
  vi.unstubAllGlobals();
});

describe("dashboard dismissal account state", () => {
  it("marks defaults confirmed only after a valid response", async () => {
    responses.push({ body: response() });
    const loading = loadDashboardDismissals(USER_A);
    expect(dashboardDismissals.confirmed).toBe(false);
    expect(dashboardDismissals.canDismiss).toBe(false);
    await expect(loading).resolves.toBe(true);
    expect(dashboardDismissals.confirmed).toBe(true);
    expect(dashboardDismissals.updatedAt).toBe(0);
    expect(dashboardDismissals.canDismiss).toBe(true);
  });

  it.each([
    null,
    {},
    { updatedAt: 0 },
    { dismissals: "notice:a", updatedAt: 0 },
    { dismissals: ["invalid"], updatedAt: 0 },
    { dismissals: [KEY_A, KEY_A], updatedAt: 0 },
    { dismissals: [], updatedAt: "0" },
    { dismissals: [], updatedAt: -1 },
    { dismissals: [], updatedAt: 1.5 },
  ])("fails closed for malformed response %#", async (body) => {
    responses.push({ body });
    await expect(loadDashboardDismissals(USER_A)).resolves.toBe(false);
    expect(dashboardDismissals.confirmed).toBe(false);
    expect(dashboardDismissals.status).toBe("error");
    expect(dashboardDismissals.dismissalsFor(USER_A)).toEqual([]);
  });

  it("sends only the exact full key and waits for confirmation before exposing it", async () => {
    responses.push({ body: response([], 10) });
    await loadDashboardDismissals(USER_A);
    let resolveSave!: (value: Response) => void;
    const deferred = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });
    responses.push({ promise: deferred });

    const saving = dismissDashboardAlert(USER_A, KEY_A);
    expect(dashboardDismissals.pendingFor(USER_A, KEY_A)).toBe(true);
    expect(dashboardDismissals.dismissalsFor(USER_A)).toEqual([]);
    // Mutations run through the serialized queue, so the request starts on a microtask.
    await vi.waitFor(() => expect(fetchCalls).toHaveLength(2));
    expect(JSON.parse(String(fetchCalls[1]?.init.body))).toEqual({ key: KEY_A, dismissed: true });

    resolveSave(jsonResponse(response([KEY_A], 11)));
    await expect(saving).resolves.toBe(true);
    expect(dashboardDismissals.pendingFor(USER_A, KEY_A)).toBe(false);
    expect(dashboardDismissals.dismissalsFor(USER_A)).toEqual([KEY_A]);
    expect(dashboardDismissals.updatedAt).toBe(11);
  });

  it("keeps an item active after request failure or a response missing its key", async () => {
    responses.push(
      { body: response([], 20) },
      { status: 500, body: { error: "Synthetic failure" } },
      { body: response([KEY_B], 21) },
    );
    await loadDashboardDismissals(USER_A);

    await expect(dismissDashboardAlert(USER_A, KEY_A)).resolves.toBe(false);
    expect(dashboardDismissals.dismissalsFor(USER_A)).toEqual([]);
    expect(dashboardDismissals.errorFor(USER_A, KEY_A)).toMatch(/still visible/i);

    await expect(dismissDashboardAlert(USER_A, KEY_A)).resolves.toBe(false);
    expect(dashboardDismissals.dismissalsFor(USER_A)).toEqual([]);
    expect(dashboardDismissals.updatedAt).toBe(20);
    expect(dashboardDismissals.errorFor(USER_A, KEY_A)).toMatch(/still visible/i);
  });

  it("serializes full-list responses while retaining per-row pending state", async () => {
    responses.push({ body: response([], 30) });
    await loadDashboardDismissals(USER_A);
    let resolveFirst!: (value: Response) => void;
    responses.push({
      promise: new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      }),
    });
    responses.push({ body: response([KEY_A, KEY_B], 32) });

    const first = dismissDashboardAlert(USER_A, KEY_A);
    const second = dismissDashboardAlert(USER_A, KEY_B);
    expect(dashboardDismissals.pendingFor(USER_A, KEY_A)).toBe(true);
    expect(dashboardDismissals.pendingFor(USER_A, KEY_B)).toBe(true);
    await vi.waitFor(() => expect(fetchCalls).toHaveLength(2));

    resolveFirst(jsonResponse(response([KEY_A], 31)));
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(dashboardDismissals.dismissalsFor(USER_A)).toEqual([KEY_A, KEY_B]);
    expect(dashboardDismissals.pendingFor(USER_A, KEY_A)).toBe(false);
    expect(dashboardDismissals.pendingFor(USER_A, KEY_B)).toBe(false);
  });

  it("never exposes one account's dismissals to another and ignores stale responses", async () => {
    let resolveFirst!: (value: Response) => void;
    responses.push({
      promise: new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      }),
    });
    const firstLoad = loadDashboardDismissals(USER_A);
    responses.push({ body: response([], 41) });
    await expect(loadDashboardDismissals(USER_B)).resolves.toBe(true);
    resolveFirst(jsonResponse(response([KEY_A], 40)));
    await expect(firstLoad).resolves.toBe(false);

    expect(dashboardDismissals.accountId).toBe(USER_B);
    expect(dashboardDismissals.dismissalsFor(USER_A)).toEqual([]);
    expect(dashboardDismissals.dismissalsFor(USER_B)).toEqual([]);
    expect(dashboardDismissals.updatedAt).toBe(41);
  });

  it("clears pending and confirmed state on logout", async () => {
    responses.push({ body: response([KEY_A], 50) });
    await loadDashboardDismissals(USER_A);
    expect(dashboardDismissals.dismissalsFor(USER_A)).toEqual([KEY_A]);
    clearDashboardDismissals();
    expect(dashboardDismissals.accountId).toBeNull();
    expect(dashboardDismissals.confirmed).toBe(false);
    expect(dashboardDismissals.dismissalsFor(USER_A)).toEqual([]);
    expect(dashboardDismissals.pendingFor(USER_A, KEY_A)).toBe(false);
  });
});
