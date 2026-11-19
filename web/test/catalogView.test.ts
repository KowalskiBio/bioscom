import http from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { defaultCatalogColumnSelections, MATERIAL_TYPES } from "@bioscom/shared";

let vite: ViteDevServer | null = null;
let server: http.Server | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let fixtureUrl = "";
let allPreferenceColumns = ["name", "target_species", "manufacturer", "catalog_number", "note", "actions"];
const pageErrors: string[] = [];

const STOCKS = [
  {
    id: "st-alpha",
    name: "Alpha product",
    type: "chemical",
    quantity: 1,
    unit: "g",
    concentration: 0,
    concentrationUnit: "mM",
    note: "Synthetic stock note alpha",
    status: "available",
    position: "A1",
    customPosition: null,
    location: {
      id: "loc-a",
      name: "Shelf A",
      rackName: null,
      boxName: null,
      containerId: "cont-a",
      containerName: "Cabinet",
      roomId: "room-a",
      roomName: "Room One",
      path: "Room One / Cabinet / Shelf A",
    },
    batch: {
      id: "batch-a",
      lotCode: "LOT-A",
      originType: "purchased",
      expiresAt: null,
      receivedAt: null,
      preparedAt: null,
    },
    product: {
      id: "product-a",
      manufacturer: "Sigma-Aldrich",
      catalogNumber: "A1234",
      productName: "Alpha product",
    },
    materialId: "m-alpha",
    attributes: { cas_number: "77-86-1" },
  },
  {
    id: "st-beta",
    name: "Beta no product",
    type: "chemical",
    quantity: 2,
    unit: "g",
    concentration: 2.5,
    concentrationUnit: "µM",
    note: null,
    status: "available",
    position: "A2",
    customPosition: null,
    location: {
      id: "loc-a",
      name: "Shelf A",
      rackName: null,
      boxName: null,
      containerId: "cont-a",
      containerName: "Cabinet",
      roomId: "room-a",
      roomName: "Room One",
      path: "Room One / Cabinet / Shelf A",
    },
    batch: {
      id: "batch-b",
      lotCode: null,
      originType: "unknown",
      expiresAt: null,
      receivedAt: null,
      preparedAt: null,
    },
    product: null,
    materialId: "m-beta",
    // A chemical descriptor must never be used as that row's stock Note.
    attributes: { custom_notes: "Chemical descriptor must not leak" },
  },
  {
    id: "st-primer",
    name: "Gamma primer",
    type: "primer",
    quantity: 10,
    unit: "nmol",
    concentration: null,
    concentrationUnit: null,
    note: "   ",
    status: "available",
    position: "A3",
    customPosition: null,
    location: {
      id: "loc-a",
      name: "Shelf A",
      rackName: null,
      boxName: null,
      containerId: "cont-a",
      containerName: "Cabinet",
      roomId: "room-a",
      roomName: "Room One",
      path: "Room One / Cabinet / Shelf A",
    },
    batch: {
      id: "batch-p",
      lotCode: null,
      originType: "unknown",
      expiresAt: null,
      receivedAt: null,
      preparedAt: null,
    },
    product: null,
    materialId: "m-primer",
    attributes: { sequence: "ACGT", target_species: "tobacco" },
  },
  {
    id: "st-other",
    name: "Delta other package",
    type: "other",
    quantity: 1,
    unit: "pcs",
    concentration: null,
    concentrationUnit: null,
    note: null,
    status: "available",
    position: "A4",
    customPosition: null,
    location: {
      id: "loc-a",
      name: "Shelf A",
      rackName: null,
      boxName: null,
      containerId: "cont-a",
      containerName: "Cabinet",
      roomId: "room-a",
      roomName: "Room One",
      path: "Room One / Cabinet / Shelf A",
    },
    batch: {
      id: "batch-o",
      lotCode: null,
      originType: "unknown",
      expiresAt: null,
      receivedAt: null,
      preparedAt: null,
    },
    product: null,
    materialId: "m-other",
    attributes: { custom_notes: "Synthetic Other descriptor" },
  },
  {
    id: "st-other-noted",
    name: "Other noted package",
    type: "other",
    quantity: 2,
    unit: "pcs",
    concentration: null,
    concentrationUnit: null,
    note: "Synthetic Other stock note",
    status: "available",
    position: "A5",
    customPosition: null,
    location: {
      id: "loc-a",
      name: "Shelf A",
      rackName: null,
      boxName: null,
      containerId: "cont-a",
      containerName: "Cabinet",
      roomId: "room-a",
      roomName: "Room One",
      path: "Room One / Cabinet / Shelf A",
    },
    batch: {
      id: "batch-on",
      lotCode: null,
      originType: "unknown",
      expiresAt: null,
      receivedAt: null,
      preparedAt: null,
    },
    product: null,
    materialId: "m-other-noted",
    attributes: { custom_notes: "Synthetic Other secondary descriptor" },
  },
];

const AVAILABILITY_STOCKS = [
  {
    ...STOCKS[0]!,
    id: "st-out-of-stock",
    name: "Empty catalog stock",
    quantity: 0,
    status: "out_of_stock",
    materialId: "m-out-of-stock",
  },
  {
    ...STOCKS[0]!,
    id: "st-low",
    name: "Low catalog stock",
    quantity: 4,
    status: "low",
    materialId: "m-low",
  },
  {
    ...STOCKS[0]!,
    id: "st-available",
    name: "Available catalog stock",
    quantity: 4,
    status: "available",
    materialId: "m-available",
  },
];

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
    if (request.url?.split("?")[0] === "/catalog-view") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Catalog view fixture</title></head>
        <body><div id="app"></div><script type="module" src="/test/fixtures/catalogView.ts"></script></body></html>`);
      return;
    }
    next();
  });
  server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/catalog-view`;

  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = existsSync(chromium.executablePath())
      ? await chromium.launch({ headless: true, channel: "chromium" })
      : await chromium.launch({ headless: true, channel: "msedge" });
  }
  page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{\"error\":\"Unexpected API request\"}" }),
  );
  await page.route("**/api/users/me/catalog-columns", (route) => {
    const columnsByType = defaultCatalogColumnSelections();
    columnsByType.all = [...allPreferenceColumns];
    columnsByType.chemical = ["name", "manufacturer", "catalog_number", "note", "actions"];
    columnsByType.primer = ["name", "target_species", "manufacturer", "catalog_number", "note", "actions"];
    columnsByType.other = ["name", "note", "custom_notes", "actions"];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ columnsByType, updatedAt: 0 }),
    });
  });
  await page.route("**/api/groups/group-a/stocks*", (route) => {
    const stocks = [...STOCKS, ...AVAILABILITY_STOCKS];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stocks, total: stocks.length, page: 1, limit: 25 }),
    });
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

async function headerTexts(): Promise<string[]> {
  return page!.$$eval("#stocks-table thead th", (headers) =>
    headers.map((header) => header.textContent?.trim() ?? ""),
  );
}

async function rowTexts(stockId: string): Promise<string[]> {
  return page!.$eval(`#stocks-table tbody tr[data-stock-id="${stockId}"]`, (row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim() ?? ""),
  );
}

async function resolvedThemeColor(token: string): Promise<string> {
  return page!.evaluate((property) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${property})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

describe("catalog view product, descriptor and stock note columns", () => {
  it("renders the stock Note next to Actions and keeps other descriptors intact in All", async () => {
    await page!.goto(fixtureUrl, { waitUntil: "networkidle" });
    await page!.waitForSelector('#stocks-table tbody tr[data-stock-id="st-alpha"]');

    expect(await headerTexts()).toEqual([
      "Name",
      "Target species",
      "Manufacturer",
      "Catalog number",
      "Note",
      "Actions",
    ]);
    expect(await rowTexts("st-alpha")).toEqual([
      "Alpha product",
      "—",
      "Sigma-Aldrich",
      "A1234",
      "Synthetic stock note alpha",
      "",
    ]);
    // Missing note and whitespace-only note both fall back to an em dash; a
    // chemical's custom_notes descriptor must not leak into the Note column.
    expect(await rowTexts("st-beta")).toEqual(["Beta no product", "—", "—", "—", "—", ""]);
    expect(await rowTexts("st-primer")).toEqual(["Gamma primer", "tobacco", "—", "—", "—", ""]);
    // All Note prefers the stock note, then falls back to Other's descriptor only.
    expect(await rowTexts("st-other")).toEqual([
      "Delta other package",
      "—",
      "—",
      "—",
      "Synthetic Other descriptor",
      "",
    ]);
    expect(await rowTexts("st-other-noted")).toEqual([
      "Other noted package",
      "—",
      "—",
      "—",
      "Synthetic Other stock note",
      "",
    ]);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("updates descriptor, stock Note and product columns for the selected material type", async () => {
    await page!.click("#catalog-type-chemical");
    await page!.waitForFunction(
      () => ![...document.querySelectorAll("#stocks-table thead th")].some((th) => th.textContent === "Target species"),
    );
    expect(await headerTexts()).toEqual(["Name", "Manufacturer", "Catalog number", "Note", "Actions"]);
    expect(await rowTexts("st-alpha")).toEqual(["Alpha product", "Sigma-Aldrich", "A1234", "Synthetic stock note alpha", ""]);
    expect(await rowTexts("st-beta")).toEqual(["Beta no product", "—", "—", "—", ""]);

    await page!.click("#catalog-type-primer");
    await page!.waitForFunction(() =>
      [...document.querySelectorAll("#stocks-table thead th")].some((th) => th.textContent === "Target species"),
    );
    expect(await headerTexts()).toEqual([
      "Name",
      "Target species",
      "Manufacturer",
      "Catalog number",
      "Note",
      "Actions",
    ]);
    expect(await rowTexts("st-primer")).toEqual(["Gamma primer", "tobacco", "—", "—", "—", ""]);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("keeps Other's material custom_notes separate from its stock Note", async () => {
    await page!.click("#catalog-type-other");
    await page!.waitForFunction(() =>
      [...document.querySelectorAll("#stocks-table thead th")].some((th) => th.textContent === "Notes"),
    );
    // The Other descriptor renders as its own Notes column; the canonical Note
    // stays penultimate, immediately before Actions.
    expect(await headerTexts()).toEqual(["Name", "Notes", "Note", "Actions"]);
    expect(await rowTexts("st-other")).toEqual(["Delta other package", "Synthetic Other descriptor", "—", ""]);
    expect(await rowTexts("st-other-noted")).toEqual([
      "Other noted package",
      "Synthetic Other secondary descriptor",
      "Synthetic Other stock note",
      "",
    ]);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("renders optional stock concentration and unit, preserving zero, before the penultimate Note", async () => {
    allPreferenceColumns = ["name", "concentration", "note", "actions"];
    await page!.goto(`${fixtureUrl}?concentration=1`, { waitUntil: "networkidle" });
    await page!.waitForSelector('#stocks-table tbody tr[data-stock-id="st-alpha"]');

    expect(await headerTexts()).toEqual(["Name", "Concentration", "Note", "Actions"]);
    expect(await rowTexts("st-alpha")).toEqual(["Alpha product", "0 mM", "Synthetic stock note alpha", ""]);
    expect(await rowTexts("st-beta")).toEqual(["Beta no product", "2.5 µM", "—", ""]);
    expect(await rowTexts("st-primer")).toEqual(["Gamma primer", "—", "—", ""]);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("uses short labels in stock Type cells and full labels in the top filter pills", async () => {
    const previousColumns = [...allPreferenceColumns];
    allPreferenceColumns = ["name", "type", "note", "actions"];
    try {
      await page!.goto(`${fixtureUrl}?short-types=1`, { waitUntil: "networkidle" });
      await page!.waitForSelector('#stocks-table tbody tr[data-stock-id="st-primer"]');

      expect(await headerTexts()).toEqual(["Name", "Type", "Note", "Actions"]);
      expect(await rowTexts("st-alpha")).toEqual(["Alpha product", "Chemical", "Synthetic stock note alpha", ""]);
      expect(await rowTexts("st-primer")).toEqual(["Gamma primer", "Primer", "—", ""]);
      expect(await rowTexts("st-other")).toEqual(["Delta other package", "Other", "Synthetic Other descriptor", ""]);
      const primerType = page!.locator('#stocks-table tr[data-stock-id="st-primer"] .chem-pos');
      expect(await primerType.getAttribute("title")).toBe("Primer / oligonucleotide");

      for (const type of MATERIAL_TYPES) {
        expect(await page!.locator(`#catalog-type-${type.key}`).textContent()).toBe(type.label);
      }
      expect(pageErrors).toEqual([]);
    } finally {
      allPreferenceColumns = previousColumns;
    }
  }, 40_000);

  it("labels and colors derived stock status and quantity consistently", async () => {
    const previousColumns = [...allPreferenceColumns];
    allPreferenceColumns = ["name", "quantity", "status", "note", "actions"];
    try {
      await page!.goto(`${fixtureUrl}?availability=1`, { waitUntil: "networkidle" });
      await page!.waitForSelector('#stocks-table tbody tr[data-stock-id="st-out-of-stock"]');

      const cases = [
        { id: "st-out-of-stock", quantity: "0", label: "Out of stock", statusClass: "rejected", quantityClass: "low", color: "--accent-red" },
        { id: "st-low", quantity: "4", label: "Low", statusClass: "pending", quantityClass: "medium", color: "--accent-amber" },
        { id: "st-available", quantity: "4", label: "Available", statusClass: "done", quantityClass: "ok", color: "--accent-green" },
      ];
      for (const item of cases) {
        const row = page!.locator(`#stocks-table tbody tr[data-stock-id="${item.id}"]`);
        const status = row.locator(".status-badge");
        const quantity = row.locator(".chem-quantity");
        expect((await status.textContent())?.trim()).toBe(item.label);
        expect(await status.getAttribute("class")).toContain(item.statusClass);
        expect((await quantity.textContent())?.trim()).toBe(item.quantity);
        expect(await quantity.getAttribute("class")).toContain(item.quantityClass);
        const expectedColor = await resolvedThemeColor(item.color);
        expect(await status.evaluate((element) => getComputedStyle(element).color)).toBe(expectedColor);
        expect(await quantity.evaluate((element) => getComputedStyle(element).color)).toBe(expectedColor);
      }
      expect(pageErrors).toEqual([]);
    } finally {
      allPreferenceColumns = previousColumns;
    }
  }, 40_000);
});
