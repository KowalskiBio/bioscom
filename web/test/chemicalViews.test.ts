import http from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { defaultCatalogColumnSelections } from "@bioscom/shared";

let vite: ViteDevServer | null = null;
let server: http.Server | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let fixtureUrl = "";
let navigation = 0;
let preferenceStatus = 200;
let roomPreferenceColumns = [
  "name",
  "type",
  "quantity",
  "location",
  "concentration",
  "cas_number",
  "molecular_formula",
  "target_species",
  "manufacturer",
  "catalog_number",
  "lot",
  "received",
  "expires",
  "status",
  "note",
  "actions",
];
const pageErrors: string[] = [];
const adjustCalls: Array<{ path: string; body: Record<string, unknown> }> = [];

beforeAll(async () => {
  const webRoot = fileURLToPath(new URL("../", import.meta.url));
  const sharedBrowser = fileURLToPath(new URL("../../shared/src/browser.ts", import.meta.url));
  vite = await createServer({
    configFile: false,
    root: webRoot,
    plugins: [svelte()],
    resolve: { alias: { "@bioscom/shared": sharedBrowser } },
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
  });
  vite.middlewares.use((request, response, next) => {
    if (request.url?.split("?")[0] === "/chemical-views") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Chemical column fixture</title></head>
        <body><div id="app"></div><script type="module" src="/test/fixtures/chemicalViews.ts"></script></body></html>`);
      return;
    }
    next();
  });
  server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/chemical-views`;

  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = existsSync(chromium.executablePath())
      ? await chromium.launch({ headless: true, channel: "chromium" })
      : await chromium.launch({ headless: true, channel: "msedge" });
  }
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{\"error\":\"Unexpected API request\"}" }),
  );
  await page.route("**/api/users/me/catalog-columns", (route) => {
    if (preferenceStatus !== 200) {
      return route.fulfill({
        status: preferenceStatus,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic preferences unavailable" }),
      });
    }
    const columnsByType = defaultCatalogColumnSelections();
    columnsByType.all = [...roomPreferenceColumns];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ columnsByType, updatedAt: navigation }),
    });
  });
  await page.route("**/api/groups/group-a/inventory/chemicals/*/adjust-qty", (route) => {
    adjustCalls.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}, 30_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  if (server !== null) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
  await vite?.close();
});

async function openView(hash: string, params = ""): Promise<void> {
  navigation += 1;
  const separator = params === "" ? "" : "&";
  await page!.goto(`${fixtureUrl}?case=${navigation}${separator}${params}#${hash}`, { waitUntil: "networkidle" });
}

async function columnIds(tableId: string): Promise<string[]> {
  return page!.$$eval(`#${tableId} thead th`, (headers) =>
    headers.map((header) => (header as HTMLElement).dataset.column ?? ""),
  );
}

async function cellText(tableId: string, chemicalId: string, columnId: string): Promise<string> {
  const cell = page!.locator(`#${tableId} tbody tr[data-chemid="${chemicalId}"] td[data-column="${columnId}"]`);
  return (await cell.textContent())?.trim() ?? "";
}

describe("mounted room All column preferences", () => {
  it("renders real direct-room values, descriptors, Note and status in semantic column order", async () => {
    await openView("containers/room-main", "case=values");
    await page!.waitForSelector('#room-direct-chemicals-table tbody tr[data-chemid="room-chem"]');

    const table = "room-direct-chemicals-table";
    expect(await columnIds(table)).toEqual([
      "name",
      "type",
      "quantity",
      "unit",
      "location",
      "concentration",
      "cas_number",
      "molecular_formula",
      "target_species",
      "manufacturer",
      "catalog_number",
      "lot",
      "received",
      "expires",
      "status",
      "note",
      "actions",
    ]);
    expect(await cellText(table, "room-chem", "type")).toBe("Primer / oligonucleotide");
    expect(await cellText(table, "room-chem", "location")).toBe("Main Test Room");
    expect(await cellText(table, "room-chem", "concentration")).toBe("0 mM");
    expect(await cellText(table, "room-chem", "cas_number")).toBe("77-86-1");
    expect(await cellText(table, "room-chem", "target_species")).toBe("tobacco");
    expect(await cellText(table, "room-chem", "manufacturer")).toBe("Room Products");
    expect(await cellText(table, "room-chem", "catalog_number")).toBe("ROOM-1");
    expect(await cellText(table, "room-chem", "lot")).toBe("ROOM-LOT");
    expect(await cellText(table, "room-chem", "received")).toBe("1970-01-01");
    expect(await cellText(table, "room-chem", "expires")).toBe("2027-01-02");
    expect(await cellText(table, "room-chem", "status")).toBe("on hold");
    expect(await cellText(table, "room-chem", "note")).toBe("Actual room stock note");
    expect(await cellText(table, "room-chem", "cas_number")).not.toBe("50-00-0");
    expect(await page!.locator(`#${table} tr[data-chemid="room-chem"] td[data-column="molecular_formula"] sub`).first().textContent()).toBe("6");
    expect(await cellText(table, "room-blank", "status")).toBe("—");
    expect(await cellText(table, "room-blank", "note")).toBe("—");
    expect(await cellText(table, "room-blank", "target_species")).toBe("—");
    expect(await cellText(table, "room-other", "note")).toBe("Other room descriptor fallback");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("normalizes legacy custom_notes to actual Note and applies type/quantity/location visibility to rooms and detail", async () => {
    roomPreferenceColumns = ["name", "custom_notes", "actions"];
    await openView("containers/room-main", "case=alias");
    await page!.waitForSelector("#room-direct-chemicals-table");
    expect(await columnIds("room-direct-chemicals-table")).toEqual(["name", "note", "actions"]);
    expect(await cellText("room-direct-chemicals-table", "room-chem", "note")).toBe("Actual room stock note");
    expect(await cellText("room-direct-chemicals-table", "room-blank", "note")).toBe("—");
    expect(await cellText("room-direct-chemicals-table", "room-other", "note")).toBe("Other room descriptor fallback");

    await openView("detail/room-main/cont-main", "case=detail-minimal");
    await page!.waitForSelector("#container-direct-chemicals-table");
    expect(await columnIds("container-direct-chemicals-table")).toEqual(["name", "note", "actions"]);
    expect(await cellText("container-direct-chemicals-table", "container-chem", "note")).toBe("Container direct note");

    // On detail rows the Type preference controls the legacy inline chip, not a fake Type filter.
    roomPreferenceColumns = ["name", "type", "quantity", "location", "note", "actions"];
    await openView("detail/room-main/cont-main", "case=detail-types&q=Nested");
    await page!.waitForSelector("#nested-box-chemicals-table-nested-box");
    expect(await columnIds("nested-box-chemicals-table-nested-box")).toEqual([
      "position",
      "name",
      "quantity",
      "unit",
      "note",
      "actions",
    ]);
    expect(await page!.locator('#nested-box-chemicals-table-nested-box tr[data-chemid="nested-chem"] .status-badge').textContent()).toBe(
      "Primer / oligonucleotide",
    );
    expect(await cellText("nested-box-chemicals-table-nested-box", "nested-chem", "note")).toBe("Nested box note");
  }, 40_000);

  it("shows legacy direct-room columns and an honest error while initial preferences are unconfirmed", async () => {
    preferenceStatus = 503;
    await openView("containers/room-main", "case=load-error&uid=synthetic-room-user-error");
    await page!.waitForSelector("#room-direct-chemicals-table");
    expect(await columnIds("room-direct-chemicals-table")).toEqual([
      "name",
      "type",
      "quantity",
      "unit",
      "location",
      "actions",
    ]);
    expect(await page!.locator('[role="alert"]').textContent()).toContain("not confirmed account settings");
    expect(await page!.locator('#room-direct-chemicals-table tr[data-chemid="room-chem"] .room-chemical-meta').textContent()).toBe("0 mM");
    preferenceStatus = 200;
  }, 40_000);

  it("keeps matched-box navigation through the chemical name when Location is hidden", async () => {
    roomPreferenceColumns = ["name", "actions"];
    await openView("detail/room-main/cont-freezer", "case=deep-navigation&q=Deep");
    await page!.waitForSelector('#deepfreezer-search-chemicals-table tr[data-chemid="deep-chem"]');
    expect(await columnIds("deepfreezer-search-chemicals-table")).toEqual(["name", "actions"]);
    const nameLink = page!.locator('#deepfreezer-search-chemicals-table tr[data-chemid="deep-chem"] .chemical-name-link');
    expect(await nameLink.getAttribute("title")).toBe("Open Rack 7 / Box B4");
    await nameLink.click();
    await page!.waitForFunction(() => window.location.hash === "#detail/room-main/cont-freezer/rack/7/box/B4");
  }, 40_000);

  it("renders selected deep-freezer boxes with the same actual values and penultimate Note", async () => {
    roomPreferenceColumns = [
      "name",
      "type",
      "quantity",
      "location",
      "concentration",
      "target_species",
      "manufacturer",
      "catalog_number",
      "lot",
      "received",
      "expires",
      "status",
      "note",
      "actions",
    ];
    await openView("detail/room-main/cont-freezer/rack/7/box/B4", "case=deep-values");
    await page!.waitForSelector('#deepfreezer-box-chemicals-table tr[data-chemid="deep-chem"]');
    const table = "deepfreezer-box-chemicals-table";
    const ids = await columnIds(table);
    expect(ids.at(-2)).toBe("note");
    expect(ids.at(-1)).toBe("actions");
    expect(ids).toContain("position");
    expect(await cellText(table, "deep-chem", "position")).toBe("D-1");
    expect(await cellText(table, "deep-chem", "concentration")).toBe("0 µM");
    expect(await cellText(table, "deep-chem", "target_species")).toBe("mouse");
    expect(await cellText(table, "deep-chem", "manufacturer")).toBe("Cold Products");
    expect(await cellText(table, "deep-chem", "lot")).toBe("DEEP-LOT");
    expect(await cellText(table, "deep-chem", "status")).toBe("—");
    expect(await cellText(table, "deep-chem", "note")).toBe("Deep freezer note");
  }, 40_000);

  it("keeps Directly-in-room printing for readers without exposing write controls", async () => {
    roomPreferenceColumns = ["name", "type", "quantity", "location", "note", "actions"];
    await openView("containers/room-main", "case=reader&role=reader&uid=synthetic-room-reader");
    await page!.waitForSelector('#room-direct-chemicals-table tr[data-chemid="room-chem"]');
    const row = page!.locator('#room-direct-chemicals-table tr[data-chemid="room-chem"]');
    expect(await row.getByRole("button", { name: "Print label for Room primer stock" }).isVisible()).toBe(true);
    expect(await row.locator(".btn-qty").count()).toBe(0);
    expect(await row.getByRole("button", { name: "Edit Room primer stock" }).count()).toBe(0);
    expect(await row.getByRole("button", { name: "Delete Room primer stock" }).count()).toBe(0);
    expect(adjustCalls).toHaveLength(0);
  }, 40_000);
});

describe("mounted chemical writer context", () => {
  it("uses the real room/container/shelf/box IDs for direct, nested and deep-freezer quantity writers", async () => {
    roomPreferenceColumns = ["name", "quantity", "note", "actions"];
    const cases = [
      {
        hash: "containers/room-main",
        params: "case=writer-room",
        table: "room-direct-chemicals-table",
        chemical: "room-chem",
        expected: { roomId: "room-main", delta: 1 },
      },
      {
        hash: "detail/room-main/cont-main",
        params: "case=writer-container",
        table: "container-direct-chemicals-table",
        chemical: "container-chem",
        expected: { roomId: "room-main", containerId: "cont-main", delta: 1 },
      },
      {
        hash: "detail/room-main/cont-main",
        params: "case=writer-shelf&q=Shelf",
        table: "shelf-chemicals-table-shelf-main",
        chemical: "shelf-chem",
        expected: { roomId: "room-main", containerId: "cont-main", shelfId: "shelf-main", delta: 1 },
      },
      {
        hash: "detail/room-main/cont-main",
        params: "case=writer-nested&q=Nested",
        table: "nested-box-chemicals-table-nested-box",
        chemical: "nested-chem",
        expected: { roomId: "room-main", containerId: "cont-main", shelfId: "nested-box", delta: 1 },
      },
      {
        hash: "detail/room-main/cont-freezer",
        params: "case=writer-search&q=Deep",
        table: "deepfreezer-search-chemicals-table",
        chemical: "deep-chem",
        expected: { roomId: "room-main", containerId: "cont-freezer", shelfId: "box-cryo", delta: 1 },
      },
      {
        hash: "detail/room-main/cont-freezer/rack/7/box/B4",
        params: "case=writer-deep-box",
        table: "deepfreezer-box-chemicals-table",
        chemical: "deep-chem",
        expected: { roomId: "room-main", containerId: "cont-freezer", shelfId: "box-cryo", delta: 1 },
      },
    ];

    for (const [index, entry] of cases.entries()) {
      await openView(entry.hash, entry.params);
      await page!.waitForSelector(`#${entry.table} tr[data-chemid="${entry.chemical}"]`);
      await page!.locator(`#${entry.table} tr[data-chemid="${entry.chemical}"] button[aria-label^="Increase quantity"]`).click();
      await expect.poll(() => adjustCalls.length, { timeout: 10_000 }).toBe(index + 1);
      expect(adjustCalls[index]).toEqual({
        path: `/api/groups/group-a/inventory/chemicals/${entry.chemical}/adjust-qty`,
        body: entry.expected,
      });
    }
    expect(pageErrors).toEqual([]);
  }, 90_000);
});
