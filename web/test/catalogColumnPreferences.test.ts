import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultCatalogColumnsForScope,
  defaultCatalogColumnSelections,
} from "@bioscom/shared";
import type { CatalogColumnsResponse } from "../src/lib/catalogColumns";
import {
  catalogColumnPreferences,
  clearCatalogColumnPreferences,
  loadCatalogColumnPreferences,
  saveCatalogColumnPreferences,
} from "../src/lib/stores/catalogColumnPreferences.svelte";
import { resetConnection } from "../src/lib/stores/connection.svelte";

const USER = "synthetic-user-a";

type MockResponse = {
  status?: number;
  body?: unknown;
  promise?: Promise<Response>;
};

let responses: MockResponse[] = [];
let fetchCalls: Array<{ url: string; init: RequestInit }> = [];

function preferenceResponse(columnsByType = defaultCatalogColumnSelections(), updatedAt = 0): CatalogColumnsResponse {
  return { columnsByType, updatedAt };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  clearCatalogColumnPreferences();
  resetConnection();
  responses = [];
  fetchCalls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (next === undefined) {
      throw new Error("Unexpected fetch");
    }
    if (next.promise !== undefined) {
      return next.promise;
    }
    return jsonResponse(next.body ?? {}, next.status);
  });
});

afterEach(() => {
  clearCatalogColumnPreferences();
  vi.unstubAllGlobals();
  resetConnection();
});

describe("catalog column preference account state", () => {
  it("marks returned defaults as confirmed only after loading succeeds", async () => {
    responses.push({ body: preferenceResponse() });
    const loading = loadCatalogColumnPreferences(USER);
    expect(catalogColumnPreferences.confirmed).toBe(false);
    expect(catalogColumnPreferences.canSave).toBe(false);

    await expect(loading).resolves.toBe(true);
    expect(catalogColumnPreferences.loaded).toBe(true);
    expect(catalogColumnPreferences.confirmed).toBe(true);
    expect(catalogColumnPreferences.updatedAt).toBe(0);
    expect(catalogColumnPreferences.canSave).toBe(true);
    expect(catalogColumnPreferences.columnsForUser(USER, "all")).toEqual(
      defaultCatalogColumnsForScope("all"),
    );
  });

  it("keeps a failed initial load unconfirmed and prevents saving", async () => {
    responses.push({ status: 503, body: { error: "Temporarily unavailable" } });
    await expect(loadCatalogColumnPreferences(USER)).resolves.toBe(false);

    expect(catalogColumnPreferences.status).toBe("error");
    expect(catalogColumnPreferences.confirmed).toBe(false);
    expect(catalogColumnPreferences.canSave).toBe(false);
    expect(catalogColumnPreferences.loadError).toMatch(/couldn’t load/i);
    expect(catalogColumnPreferences.columnsForUser(USER, "chemical")).toEqual(
      defaultCatalogColumnsForScope("chemical"),
    );

    await expect(
      saveCatalogColumnPreferences(USER, "chemical", ["name", "cas_number", "actions"]),
    ).resolves.toBe(false);
    expect(fetchCalls).toHaveLength(1);
  });

  it("retries an initial failure without silently accepting defaults", async () => {
    responses.push(
      { status: 500, body: { error: "Unavailable" } },
      { body: preferenceResponse(defaultCatalogColumnSelections(), 12) },
    );
    await expect(loadCatalogColumnPreferences(USER)).resolves.toBe(false);
    await expect(loadCatalogColumnPreferences(USER)).resolves.toBe(false);
    expect(fetchCalls).toHaveLength(1);

    await expect(loadCatalogColumnPreferences(USER, true)).resolves.toBe(true);
    expect(fetchCalls).toHaveLength(2);
    expect(catalogColumnPreferences.loadError).toBe("");
    expect(catalogColumnPreferences.updatedAt).toBe(12);
  });

  it("retains confirmed selections when a refresh fails", async () => {
    const initial = defaultCatalogColumnSelections();
    initial.solution = ["name", "composition", "ph", "actions"];
    responses.push(
      { body: preferenceResponse(initial, 15) },
      { status: 503, body: { error: "Unavailable" } },
    );
    await loadCatalogColumnPreferences(USER);
    await expect(loadCatalogColumnPreferences(USER, true)).resolves.toBe(false);

    expect(catalogColumnPreferences.confirmed).toBe(true);
    expect(catalogColumnPreferences.canSave).toBe(false);
    expect(catalogColumnPreferences.columnsForUser(USER, "solution")).toEqual(initial.solution);
    expect(catalogColumnPreferences.updatedAt).toBe(15);
  });

  it("retains confirmed values and other scopes after a save failure", async () => {
    const initial = defaultCatalogColumnSelections();
    initial.antibody = ["name", "type", "target", "host_species", "actions"];
    responses.push(
      { body: preferenceResponse(initial, 20) },
      { status: 500, body: { error: "Save failed" } },
    );
    await loadCatalogColumnPreferences(USER);

    await expect(
      saveCatalogColumnPreferences(USER, "chemical", ["name", "cas_number", "actions"]),
    ).resolves.toBe(false);

    expect(catalogColumnPreferences.saveError).toMatch(/previous saved settings/i);
    expect(catalogColumnPreferences.columnsForUser(USER, "chemical")).toEqual(initial.chemical);
    expect(catalogColumnPreferences.columnsForUser(USER, "antibody")).toEqual(initial.antibody);
    expect(catalogColumnPreferences.updatedAt).toBe(20);
    expect(JSON.parse(String(fetchCalls[1]?.init.body))).toEqual({
      scope: "chemical",
      columns: ["name", "actions", "cas_number"],
    });
  });

  it("stays pending before applying a successful one-scope response", async () => {
    const initial = defaultCatalogColumnSelections();
    initial.primer = ["name", "sequence", "sequence_length", "actions"];
    const returned = defaultCatalogColumnSelections();
    returned.chemical = ["name", "quantity", "molecular_weight", "safety_notes", "actions"];
    returned.primer = initial.primer;

    responses.push({ body: preferenceResponse(initial, 30) });
    await loadCatalogColumnPreferences(USER);

    let resolveSave!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });
    responses.push({ promise: pendingResponse });

    const saving = saveCatalogColumnPreferences(USER, "chemical", [
      "name",
      "quantity",
      "molecular_weight",
      "safety_notes",
      "actions",
    ]);
    expect(catalogColumnPreferences.saving).toBe(true);
    expect(catalogColumnPreferences.canSave).toBe(false);
    expect(catalogColumnPreferences.columnsForUser(USER, "chemical")).toEqual(initial.chemical);
    const loadingDuringSave = loadCatalogColumnPreferences(USER);

    resolveSave(jsonResponse(preferenceResponse(returned, 31)));
    await expect(saving).resolves.toBe(true);
    await expect(loadingDuringSave).resolves.toBe(true);
    expect(fetchCalls).toHaveLength(2);
    expect(catalogColumnPreferences.saving).toBe(false);
    expect(catalogColumnPreferences.columnsForUser(USER, "chemical")).toEqual(returned.chemical);
    expect(catalogColumnPreferences.columnsForUser(USER, "primer")).toEqual(initial.primer);
    expect(catalogColumnPreferences.updatedAt).toBe(31);
  });

  it("does not expose one account's selections to another account", async () => {
    const first = defaultCatalogColumnSelections();
    first.antibody = ["name", "target", "actions"];
    responses.push(
      { body: preferenceResponse(first, 40) },
      { body: preferenceResponse(defaultCatalogColumnSelections(), 41) },
    );
    await loadCatalogColumnPreferences(USER);
    expect(catalogColumnPreferences.columnsForUser("synthetic-user-b", "antibody")).toEqual(
      defaultCatalogColumnsForScope("antibody"),
    );

    await loadCatalogColumnPreferences("synthetic-user-b");
    expect(catalogColumnPreferences.columnsForUser(USER, "antibody")).toEqual(
      defaultCatalogColumnsForScope("antibody"),
    );
    expect(catalogColumnPreferences.updatedAt).toBe(41);
  });
});
