import http from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defaultCatalogColumnSelections } from "@bioscom/shared";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";

let vite: ViteDevServer | null = null;
let server: http.Server | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let fixtureUrl = "";
const pageErrors: string[] = [];

interface MaterialDto {
  id: string;
  groupId: string;
  type: string;
  name: string;
  description: string | null;
  attributes: Record<string, string | number | boolean | null>;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  counts: { products: number; batches: number; stocks: number; locations: number };
}

interface StockDto {
  id: string;
  name: string;
  type: string;
  quantity: number | null;
  unit: string | null;
  concentration: number | null;
  concentrationUnit: string | null;
  note: string | null;
  barcode: string | null;
  status: string;
  position: string | null;
  customPosition: string | null;
  location: {
    id: string;
    name: string;
    rackName: string | null;
    boxName: string | null;
    containerId: string | null;
    containerName: string | null;
    roomId: string | null;
    roomName: string | null;
    path: string;
  };
  batch: {
    id: string;
    lotCode: string | null;
    originType: string;
    expiresAt: number | null;
    receivedAt: number | null;
    preparedAt: number | null;
  };
  product: { id: string; manufacturer: string | null; catalogNumber: string | null; productName: string | null } | null;
  materialId: string;
  attributes: Record<string, string | number | boolean | null>;
}

interface DetailDto {
  material: MaterialDto;
  products: Array<{
    id: string;
    manufacturer: string | null;
    supplier: string | null;
    catalogNumber: string | null;
    productName: string | null;
    variant: string | null;
    attributes: Record<string, string | number | boolean | null>;
  }>;
  batches: Array<{
    id: string;
    productId: string | null;
    lotCode: string | null;
    originType: string;
    receivedAt: number | null;
    preparedAt: number | null;
    preparedBy: string | null;
    expiresAt: number | null;
    product: { manufacturer: string | null; catalogNumber: string | null; productName: string | null } | null;
  }>;
  stocks: StockDto[];
}

interface RecordedWrite {
  method: string;
  path: string;
  body: unknown;
  requestedWith: string;
}

const MATERIAL_ID = "m-stock-primary";
const DETAIL_PATH = `/api/groups/group-a/materials/${MATERIAL_ID}`;
const PUT_PATH = "/api/groups/group-a/inventory/chemicals/stock-primary";
const CLEAR_MATERIAL_ID = "m-no-stock";
const CLEAR_DETAIL_PATH = `/api/groups/group-a/materials/${CLEAR_MATERIAL_ID}`;
const LONG_BARCODE = "TRIS-BARCODE-123456789012345678901234567890";
const LONG_PRODUCT_ATTRIBUTE = "PRODUCT-ATTRIBUTE-WITH-AN-UNBROKEN-IDENTIFIER-0123456789";
const LONG_LOCATION_PATH = "C05/112-LAB-FRIDGE-WITH-AN-UNBROKEN-LOCATION-IDENTIFIER-0123456789-MIDDLE-SHELF";
const FALLBACK_LOCATION = "C05/112 / Lab fridge +4 / Middle shelf / Rack A";
const REPEATED_LOCATION_ROWS = ["Location path", "Room", "Container", "Shelf / location", "Rack", "Box"];

let detailCalls = 0;
let detailPhase: "initial" | "updated" = "initial";
let fixtureVariant = "default";
let fixtureLocation = "room";
let quantityDeltas: Record<string, number> = {};
let availabilityOverrides: Record<string, "available" | "low"> = {};
let mergeCandidateCalls = 0;
let events: string[] = [];
let writes: RecordedWrite[] = [];

function material(overrides: Partial<MaterialDto> = {}): MaterialDto {
  return {
    id: MATERIAL_ID,
    groupId: "group-a",
    type: "chemical",
    name: "Tris base",
    description: "Primary Tris buffer material used for synthetic material detail tests.",
    attributes: {
      cas_number: "77-86-1",
      molecular_formula: "C4H11NO3",
      molecular_weight: 121.14,
      safety_notes: "corrosive",
    },
    createdAt: Date.UTC(2026, 0, 1),
    updatedAt: Date.UTC(2026, 0, 1),
    archivedAt: null,
    counts: { products: 2, batches: 2, stocks: 2, locations: 1 },
    ...overrides,
  };
}

function catalogLocation(): StockDto["location"] {
  if (fixtureLocation === "fallback") {
    return {
      id: "fallback-shelf",
      name: "Middle shelf / Rack A",
      rackName: "Rack A",
      boxName: null,
      containerId: "fallback-fridge",
      containerName: "Lab fridge +4",
      roomId: "fallback-room",
      roomName: "C05/112",
      path: "",
    };
  }
  if (fixtureLocation === "long-path") {
    return {
      id: "long-path-shelf",
      name: "Middle shelf",
      rackName: null,
      boxName: null,
      containerId: "long-path-fridge",
      containerName: "Lab fridge +4",
      roomId: "long-path-room",
      roomName: "C05/112",
      path: LONG_LOCATION_PATH,
    };
  }
  if (fixtureLocation === "freezer") {
    return {
      id: "freezer-box",
      name: "Rack A / Box 1",
      rackName: "Rack A",
      boxName: "Box 1",
      containerId: "freezer-main",
      containerName: "Material Detail Freezer",
      roomId: "freezer-main",
      roomName: "Material Detail Freezer",
      path: "Material Detail Freezer / Rack A / Box 1",
    };
  }
  if (fixtureLocation === "container") {
    return {
      id: "container-main",
      name: "Cold storage",
      rackName: null,
      boxName: null,
      containerId: "container-main",
      containerName: "Cold storage",
      roomId: "room-main",
      roomName: "Material Detail Room",
      path: "Material Detail Room / Cold storage",
    };
  }
  if (fixtureLocation === "cabinet" || fixtureLocation === "nested") {
    const nested = fixtureLocation === "nested";
    return {
      id: nested ? "box-main" : "shelf-main",
      name: nested ? "Shelf A / Box A" : "Shelf A",
      rackName: null,
      boxName: nested ? "Box A" : null,
      containerId: "container-main",
      containerName: "Chemical cabinet",
      roomId: "room-main",
      roomName: "Material Detail Room",
      path: `Material Detail Room / Chemical cabinet / Shelf A${nested ? " / Box A" : ""}`,
    };
  }
  return {
    id: "loc-room-main",
    name: "Material Detail Room",
    rackName: null,
    boxName: null,
    containerId: null,
    containerName: null,
    roomId: "room-main",
    roomName: "Material Detail Room",
    path: "Material Detail Room",
  };
}

function secondaryStock(): StockDto {
  return {
    id: "stock-secondary",
    name: "Tris base",
    type: "chemical",
    quantity: 25,
    unit: "g",
    concentration: 0.5,
    concentrationUnit: "mol/L",
    note: "Secondary stock note",
    barcode: null,
    status: "available",
    position: "C-9",
    customPosition: "C-9",
    location: catalogLocation(),
    batch: {
      id: "batch-secondary",
      lotCode: "LOT-SECONDARY",
      originType: "purchased",
      expiresAt: Date.UTC(2029, 1, 2),
      receivedAt: Date.UTC(2026, 1, 2),
      preparedAt: null,
    },
    product: {
      id: "product-secondary",
      manufacturer: "Secondary manufacturer",
      catalogNumber: "TRIS-SECONDARY",
      productName: "Tris secondary product",
    },
    materialId: MATERIAL_ID,
    attributes: {
      cas_number: "77-86-1",
      molecular_formula: "C4H11NO3",
      molecular_weight: 121.14,
    },
  };
}

function primaryStock(): StockDto {
  return {
    id: "stock-primary",
    name: "Tris base",
    type: "chemical",
    quantity: fixtureVariant === "out-of-stock" ? 0 : 250,
    unit: "g",
    concentration: 1.5,
    concentrationUnit: "mol/L",
    note: "Original stock note",
    barcode: fixtureVariant === "rich-preview" ? LONG_BARCODE : null,
    status: fixtureVariant === "out-of-stock" ? "out_of_stock" : "available",
    position: fixtureVariant === "no-position" ? null : fixtureVariant === "legacy-position" ? "AH1" : "A-17",
    customPosition: fixtureVariant === "no-position" ? null : fixtureVariant === "legacy-position" ? "" : "A-17",
    location: catalogLocation(),
    batch: {
      id: "batch-primary",
      lotCode: "LOT-ORIGINAL",
      originType: "purchased",
      expiresAt: Date.UTC(2028, 0, 4),
      receivedAt: Date.UTC(2026, 0, 2),
      preparedAt: Date.UTC(2026, 0, 3),
    },
    product: {
      id: "product-primary",
      manufacturer: "Original manufacturer",
      catalogNumber: "TRIS-100",
      productName: "Tris laboratory product",
    },
    materialId: MATERIAL_ID,
    attributes: {
      cas_number: "77-86-1",
      molecular_formula: "C4H11NO3",
      molecular_weight: 121.14,
      safety_notes: "corrosive",
    },
  };
}

function foreignStock(): StockDto {
  return {
    ...primaryStock(),
    id: "stock-other-material",
    name: "Other material stock",
    materialId: "m-other-material",
    note: "Foreign material note",
  };
}

function applyQuickState(stock: StockDto): StockDto {
  const delta = quantityDeltas[stock.id];
  const quantity = delta === undefined ? stock.quantity : Math.max(0, (stock.quantity ?? 0) + delta);
  const status = quantity !== null && quantity <= 0
    ? "out_of_stock"
    : availabilityOverrides[stock.id] ?? (stock.status === "out_of_stock" ? "available" : stock.status);
  return { ...stock, quantity, status };
}

function initialDetail(): DetailDto {
  return {
    material: material(),
    products: [
      {
        id: "product-primary",
        manufacturer: "Original manufacturer",
        supplier: "Synthetic supplier",
        catalogNumber: "TRIS-100",
        productName: "Tris laboratory product",
        variant: "Ultra pure",
        attributes: {
          grade: "molecular biology",
          ...(fixtureVariant === "rich-preview" ? { handling_reference: LONG_PRODUCT_ATTRIBUTE } : {}),
        },
      },
      {
        id: "product-secondary",
        manufacturer: "Secondary manufacturer",
        supplier: null,
        catalogNumber: "TRIS-SECONDARY",
        productName: "Tris secondary product",
        variant: null,
        attributes: {},
      },
    ],
    batches: [
      {
        id: "batch-primary",
        productId: "product-primary",
        lotCode: "LOT-ORIGINAL",
        originType: "purchased",
        receivedAt: Date.UTC(2026, 0, 2),
        preparedAt: Date.UTC(2026, 0, 3),
        preparedBy: "Original preparer",
        expiresAt: Date.UTC(2028, 0, 4),
        product: {
          manufacturer: "Original manufacturer",
          catalogNumber: "TRIS-100",
          productName: "Tris laboratory product",
        },
      },
      {
        id: "batch-secondary",
        productId: "product-secondary",
        lotCode: "LOT-SECONDARY",
        originType: "purchased",
        receivedAt: Date.UTC(2026, 1, 2),
        preparedAt: null,
        preparedBy: null,
        expiresAt: Date.UTC(2029, 1, 2),
        product: {
          manufacturer: "Secondary manufacturer",
          catalogNumber: "TRIS-SECONDARY",
          productName: "Tris secondary product",
        },
      },
    ],
    // The server may order stocks however its location query returns them.
    // A foreign material first, then secondary, proves the modal filters by
    // materialId and never uses response order to choose an edit target.
    stocks: [foreignStock(), secondaryStock(), primaryStock()].map(applyQuickState),
  };
}

function updatedDetail(): DetailDto {
  const detail = initialDetail();
  detail.material = material({
    name: "Tris base edited",
    description: "Edited Tris material description.",
    attributes: {
      cas_number: "77-86-1",
      molecular_formula: "C4H11NO3-HCl",
      molecular_weight: 125.5,
      safety_notes: "corrosive irritant",
    },
    updatedAt: Date.UTC(2026, 0, 10),
  });
  const primary = detail.stocks.find((stock) => stock.id === "stock-primary");
  if (primary !== undefined) {
    primary.name = "Tris base edited";
    primary.note = "Edited stock note";
    primary.concentration = 2.25;
    primary.customPosition = "A-18";
    primary.attributes = {
      cas_number: "77-86-1",
      molecular_formula: "C4H11NO3-HCl",
      molecular_weight: 125.5,
      safety_notes: "corrosive irritant",
    };
    primary.batch.lotCode = "LOT-EDITED";
    primary.batch.originType = "prepared";
    primary.batch.expiresAt = Date.UTC(2028, 5, 15);
    primary.batch.preparedBy = "Edited preparer";
    primary.product = {
      id: "product-primary",
      manufacturer: "Edited manufacturer",
      catalogNumber: "TRIS-EDITED",
      productName: "Tris laboratory product",
    };
  }
  return detail;
}

function clearDetail(): DetailDto {
  return {
    material: material({
      id: CLEAR_MATERIAL_ID,
      name: "No stock material",
      description: "Synthetic material with no stock records.",
      attributes: { cas_number: "50-00-0", safety_notes: "flammable" },
      counts: { products: 0, batches: 0, stocks: 0, locations: 0 },
    }),
    products: [],
    batches: [],
    stocks: [],
  };
}

function mergeCandidate(): MaterialDto {
  return material({
    id: "m-merge-target",
    name: "Merge target material",
    description: null,
    attributes: { cas_number: "77-86-1" },
    counts: { products: 0, batches: 1, stocks: 1, locations: 1 },
  });
}

function readRequestBody(request: import("playwright").Request): unknown {
  try {
    return request.postDataJSON();
  } catch {
    return request.postData() ?? null;
  }
}

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
    if (request.url?.split("?")[0] === "/material-detail-modal") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Material detail modal fixture</title></head>
        <body><div id="catalog-app"></div><div id="modal-app"></div><div id="toast-app"></div><script type="module" src="/test/fixtures/materialDetailModal.ts"></script></body></html>`);
      return;
    }
    next();
  });
  server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/material-detail-modal`;

  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = existsSync(chromium.executablePath())
      ? await chromium.launch({ headless: true, channel: "chromium" })
      : await chromium.launch({ headless: true, channel: "msedge" });
  }
  page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/api/**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      writes.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
        body: readRequestBody(request),
        requestedWith: request.headers()["x-requested-with"] ?? "",
      });
    }
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: "{\"error\":\"Unexpected API request\"}",
    });
  });

  await page.route(/\/api\/groups\/group-a\/materials\/[^/?]+$/, (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      return route.fulfill({ status: 405, contentType: "application/json", body: "{\"error\":\"Method not allowed\"}" });
    }
    const path = new URL(request.url()).pathname;
    detailCalls += 1;
    events.push(`GET ${path}`);
    const id = path.slice(path.lastIndexOf("/") + 1);
    if (id === MATERIAL_ID) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(detailPhase === "updated" ? updatedDetail() : initialDetail()),
      });
    }
    if (id === CLEAR_MATERIAL_ID) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(clearDetail()),
      });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{\"error\":\"Material not found\"}" });
  });

  await page.route(/\/api\/groups\/group-a\/materials\?/, (route) => {
    mergeCandidateCalls += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ materials: [mergeCandidate()], total: 1, page: 1, limit: 25 }),
    });
  });

  await page.route(/\/api\/groups\/group-a\/inventory\/chemicals\/(stock-primary|stock-secondary)$/, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const stockId = path.slice(path.lastIndexOf("/") + 1);
    writes.push({
      method: request.method(),
      path,
      body: readRequestBody(request),
      requestedWith: request.headers()["x-requested-with"] ?? "",
    });
    events.push(`${request.method()} ${path}`);
    if (request.method() !== "PUT") {
      return route.fulfill({ status: 405, contentType: "application/json", body: "{\"error\":\"Method not allowed\"}" });
    }
    if (stockId === "stock-primary") {
      detailPhase = "updated";
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: stockId, updated: true }),
    });
  });

  await page.route(/\/api\/groups\/group-a\/inventory\/chemicals\/[^/]+\/(adjust-qty|availability)$/, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = readRequestBody(request) as { delta?: number; availability?: "available" | "low" };
    const chemicalId = path.split("/").at(-2) ?? "";
    writes.push({
      method: request.method(),
      path,
      body: readRequestBody(request),
      requestedWith: request.headers()["x-requested-with"] ?? "",
    });
    events.push(`${request.method()} ${path}`);
    if (path.endsWith("/adjust-qty")) {
      if (request.method() !== "POST" || typeof body.delta !== "number" || !Number.isFinite(body.delta)) {
        return route.fulfill({ status: 400, contentType: "application/json", body: "{\"error\":\"Invalid quantity adjustment\"}" });
      }
      quantityDeltas[chemicalId] = (quantityDeltas[chemicalId] ?? 0) + body.delta;
    } else {
      if (request.method() !== "PUT" || (body.availability !== "available" && body.availability !== "low")) {
        return route.fulfill({ status: 400, contentType: "application/json", body: "{\"error\":\"Invalid availability\"}" });
      }
      availabilityOverrides[chemicalId] = body.availability;
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: chemicalId, updated: true }),
    });
  });

  await page.route("**/api/users/me/catalog-columns", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ columnsByType: defaultCatalogColumnSelections(), updatedAt: 0 }),
  }));

  await page.route("**/api/groups/group-a/stocks*", (route) => {
    const stocks = initialDetail().stocks.filter((stock) => stock.materialId === MATERIAL_ID);
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

beforeEach(() => {
  detailCalls = 0;
  detailPhase = "initial";
  fixtureVariant = "default";
  fixtureLocation = "room";
  quantityDeltas = {};
  availabilityOverrides = {};
  mergeCandidateCalls = 0;
  events = [];
  writes = [];
  pageErrors.length = 0;
});

function url(query = ""): string {
  return query === "" ? fixtureUrl : `${fixtureUrl}?${query}`;
}

async function gotoDetail(query = ""): Promise<void> {
  const params = new URLSearchParams(query);
  fixtureVariant = params.get("variant") ?? "default";
  fixtureLocation = params.get("location") ?? "room";
  await page!.setViewportSize({ width: 1100, height: 900 });
  await page!.goto(url(query), { waitUntil: "networkidle" });
  await page!.waitForSelector("#material-detail");
}

async function gotoCatalog(query: string): Promise<void> {
  const params = new URLSearchParams(query);
  fixtureVariant = params.get("variant") ?? "default";
  fixtureLocation = params.get("location") ?? "room";
  await page!.setViewportSize({ width: 1100, height: 900 });
  await page!.goto(url(query), { waitUntil: "networkidle" });
  await page!.waitForSelector('#stocks-table tbody tr[data-stock-id="stock-primary"]');
}

async function openEditor(stockId = "stock-primary"): Promise<void> {
  await page!.click(`#stock-edit-${stockId}`);
  await page!.waitForSelector("#f-cn2");
}

async function inputValue(id: string): Promise<string> {
  return page!.inputValue(`#${id}`);
}

interface ActionRect {
  id: string;
  left: number;
  right: number;
  width: number;
  scrollWidth: number;
  clientWidth: number;
  visible: boolean;
}

async function actionRects(): Promise<ActionRect[]> {
  return page!.$$eval("#material-detail .material-stock-edit", (buttons) =>
    buttons.map((button) => {
      const element = button as HTMLElement;
      const rect = element.getBoundingClientRect();
      return {
        id: element.id,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        visible: element.getClientRects().length > 0,
      };
    }),
  );
}

async function descriptorRows(): Promise<Record<string, string>> {
  const rows = await page!.$$eval("#modal-body .detail-def-key", (keys) =>
    keys.map((key) => [
      key.textContent?.trim() ?? "",
      key.nextElementSibling?.textContent?.trim() ?? "",
    ]),
  );
  return Object.fromEntries(rows);
}

async function stockRows(stockId: string): Promise<Record<string, string>> {
  const rows = await page!.$$eval(`#stock-card-${stockId} .material-stock-fact dt`, (keys) =>
    keys.map((key) => [
      key.textContent?.trim() ?? "",
      key.nextElementSibling?.textContent?.trim() ?? "",
    ]),
  );
  return Object.fromEntries(rows);
}

async function stockLocationPath(stockId: string): Promise<string> {
  return page!.$eval(`#stock-card-${stockId} .material-stock-location-path`, (element) =>
    element.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );
}

async function stockFactLabels(stockId: string): Promise<string[]> {
  return page!.$$eval(`#stock-card-${stockId} > .material-stock-facts > .material-stock-fact > dt`, (keys) =>
    keys.map((key) => key.textContent?.trim() ?? ""),
  );
}

async function waitForQuantity(stockId: string, quantity: number): Promise<void> {
  await page!.waitForFunction(
    ({ id, expected }) => document.querySelector(`#quantity-${id}`)?.textContent?.trim() === String(expected),
    { id: stockId, expected: quantity },
  );
}

async function expectLocationLayoutsContainedAt390(): Promise<void> {
  const layouts = await page!.$$eval(".material-stock-location-content", (contents) =>
    contents.map((content) => {
      const path = content.querySelector(".material-stock-location-path");
      const position = content.querySelector(".material-stock-position");
      if (path === null) {
        throw new Error("Missing location path");
      }
      const contentRect = content.getBoundingClientRect();
      const pathRect = path.getBoundingClientRect();
      const positionRect = position?.getBoundingClientRect();
      return {
        left: contentRect.left,
        right: contentRect.right,
        scrollWidth: content.scrollWidth,
        clientWidth: content.clientWidth,
        pathLeft: pathRect.left,
        pathRight: pathRect.right,
        pathBottom: pathRect.bottom,
        pathScrollWidth: path.scrollWidth,
        pathClientWidth: path.clientWidth,
        position: position === null || positionRect === undefined ? null : {
          left: positionRect.left,
          right: positionRect.right,
          top: positionRect.top,
          scrollWidth: position.scrollWidth,
          clientWidth: position.clientWidth,
        },
      };
    }),
  );

  expect(layouts).toHaveLength(2);
  for (const layout of layouts) {
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(390.5);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.pathLeft).toBeGreaterThanOrEqual(layout.left - 0.5);
    expect(layout.pathRight).toBeLessThanOrEqual(layout.right + 0.5);
    expect(layout.pathScrollWidth).toBeLessThanOrEqual(layout.pathClientWidth + 1);
    if (layout.position === null) {
      continue;
    }
    expect(layout.position.left).toBeGreaterThanOrEqual(layout.pathLeft - 0.5);
    expect(layout.position.right).toBeLessThanOrEqual(layout.right + 0.5);
    expect(layout.position.scrollWidth).toBeLessThanOrEqual(layout.position.clientWidth + 1);
    expect(
      layout.position.left >= layout.pathRight - 0.5 || layout.position.top >= layout.pathBottom - 0.5,
    ).toBe(true);
  }
}

describe("mounted MaterialDetailModal", () => {
  it("edits the selected stock card through the existing chemical editor and refreshes the detail", async () => {
    await gotoDetail(`material=${MATERIAL_ID}`);
    expect(detailCalls).toBe(1);
    await openEditor();

    expect(await page!.textContent("#modal-title")).toBe("Edit Chemical");
    // The editor must be populated from the real stock-primary inventory record,
    // not from stock-secondary even though both catalog stocks share a name.
    expect(await inputValue("f-cn2")).toBe("Tris base original");
    expect(await inputValue("f-cf")).toBe("C4H11NO3");
    expect(await inputValue("f-cc")).toBe("77-86-1");
    expect(await inputValue("f-cconc")).toBe("1.5");
    expect(await inputValue("f-cno")).toBe("Original stock note");
    expect(await inputValue("f-cpos")).toBe("A-17");
    expect(await inputValue("f-cq")).toBe("250");
    expect(await inputValue("f-cu")).toBe("g");
    expect(await inputValue("f-ccu")).toBe("mol/L");
    expect(await inputValue("f-attr-molecular_weight")).toBe("121.14");
    expect(await page!.textContent("#modal-body")).toContain("corrosive");
    expect(await inputValue("f-p-manufacturer")).toBe("Original manufacturer");
    expect(await inputValue("f-p-catalog")).toBe("TRIS-100");
    expect(await inputValue("f-b-lot")).toBe("LOT-ORIGINAL");
    expect(await inputValue("f-b-origin")).toBe("purchased");
    expect(await inputValue("f-b-expiry")).toBe("2028-01-04");
    expect(await inputValue("f-b-received")).toBe("2026-01-02");
    expect(await inputValue("f-b-preparedby")).toBe("Original preparer");

    await page!.fill("#f-cn2", "Tris base edited");
    await page!.fill("#f-cf", "C4H11NO3-HCl");
    await page!.fill("#f-cconc", "2.25");
    await page!.fill("#f-cno", "Edited stock note");
    await page!.fill("#f-attr-molecular_weight", "125.5");
    await page!.fill("#f-attr-safety_notes", "irritant");
    await page!.press("#f-attr-safety_notes", "Enter");
    await page!.fill("#f-p-manufacturer", "Edited manufacturer");
    await page!.fill("#f-p-catalog", "TRIS-EDITED");
    await page!.fill("#f-b-lot", "LOT-EDITED");
    await page!.selectOption("#f-b-origin", "prepared");
    await page!.fill("#f-b-expiry", "2028-06-15");
    await page!.fill("#f-b-preparedby", "Edited preparer");

    await page!.click("#modal-confirm");
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => detailCalls, { timeout: 10_000 }).toBe(2);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "PUT",
      path: PUT_PATH,
      requestedWith: "XMLHttpRequest",
    });
    expect(writes[0]?.body).toEqual({
      roomId: "room-main",
      name: "Tris base edited",
      cas: "77-86-1",
      formula: "C4H11NO3-HCl",
      quantity: 250,
      availability: "available",
      unit: "g",
      concentration: 2.25,
      concUnit: "mol/L",
      customPosition: "A-17",
      note: "Edited stock note",
      type: "chemical",
      attributes: {
        molecular_weight: 125.5,
        safety_notes: "corrosive irritant",
      },
      batchInfo: {
        lotCode: "LOT-EDITED",
        originType: "prepared",
        expiresAt: Date.UTC(2028, 5, 15),
        receivedAt: Date.UTC(2026, 0, 2),
        preparedAt: Date.UTC(2026, 0, 3),
        preparedBy: "Edited preparer",
      },
      product: {
        manufacturer: "Edited manufacturer",
        catalogNumber: "TRIS-EDITED",
      },
    });
    expect(events).toEqual([`GET ${DETAIL_PATH}`, `PUT ${PUT_PATH}`, `GET ${DETAIL_PATH}`]);

    // Only stock-primary may be written: no merge, delete or secondary package write.
    expect(writes.some((write) => write.method === "DELETE")).toBe(false);
    expect(writes.some((write) => write.path.includes("stock-secondary"))).toBe(false);
    expect(writes.some((write) => write.path.endsWith("/materials/merge"))).toBe(false);

    // The fixture can apply the realistic next inventory tree broadcast while
    // preserving the untouched secondary package.
    const nextTree = await page!.evaluate(() => {
      const fixture = window as unknown as {
        materialDetailFixtureTree(): {
          rooms: Array<{ chemicals?: Array<Record<string, unknown>> }>;
        };
      };
      const tree = fixture.materialDetailFixtureTree();
      const primary = tree.rooms[0]?.chemicals?.find((chemical) => chemical.id === "stock-primary");
      if (primary !== undefined) {
        primary.name = "Tris base edited";
        primary.note = "Edited stock note";
      }
      return tree;
    });
    await page!.evaluate((tree) => {
      const fixture = window as unknown as {
        materialDetailFixtureInstallTree(next: unknown): void;
      };
      fixture.materialDetailFixtureInstallTree(tree);
    }, nextTree);

    const installed = await page!.evaluate(() => {
      const fixture = window as unknown as {
        materialDetailFixtureTree(): {
          rooms: Array<{ chemicals?: Array<{ id: string; name: string; note?: string }> }>;
        };
      };
      return fixture.materialDetailFixtureTree();
    });
    const chemicals = installed.rooms.flatMap((room) => room.chemicals ?? []);
    expect(chemicals.map((chemical) => chemical.id)).toEqual(["stock-secondary", "stock-primary"]);
    expect(chemicals.find((chemical) => chemical.id === "stock-secondary")).toMatchObject({
      name: "Secondary package",
      note: "Secondary stock note",
    });
    expect(chemicals.find((chemical) => chemical.id === "stock-primary")).toMatchObject({
      name: "Tris base edited",
      note: "Edited stock note",
    });

    // Reopening consumes the refreshed catalog.detail DTO returned after save.
    await page!.evaluate(() => {
      const fixture = window as unknown as {
        openMaterialDetailFixture(id: string): void;
      };
      fixture.openMaterialDetailFixture("m-stock-primary");
    });
    await expect.poll(() => detailCalls, { timeout: 10_000 }).toBe(3);
    await page!.waitForFunction(
      () => document.querySelector(".material-detail-heading")?.textContent === "Tris base edited",
    );
    expect(await descriptorRows()).toMatchObject({
      "Molecular weight": "125.5",
      "Safety notes": "corrosive irritant",
    });
    expect(await page!.locator("#material-detail .material-stock-edit").count()).toBe(2);
    expect(await page!.locator("#material-merge-open, #material-edit-open").count()).toBe(0);
    expect(pageErrors).toEqual([]);
  }, 40_000);
});

describe("mounted MaterialDetailModal per-package editing", () => {
  it.each([
    {
      stockId: "stock-secondary",
      name: "Secondary package",
      lotCode: "LOT-SECONDARY",
      note: "Secondary stock note",
    },
    {
      stockId: "stock-primary",
      name: "Tris base original",
      lotCode: "LOT-ORIGINAL",
      note: "Original stock note",
    },
  ])("keeps same-name stock $stockId individually editable and saves its own id", async ({ stockId, name, lotCode, note }) => {
    await gotoDetail(`material=${MATERIAL_ID}`);

    expect(await page!.locator(".material-stock-card").count()).toBe(2);
    expect(await page!.locator(".material-stock-edit").count()).toBe(2);
    expect(await page!.locator("#material-edit-open, #material-merge-open").count()).toBe(0);
    const edit = page!.locator(`#stock-edit-${stockId}`);
    await expect(edit.textContent()).resolves.toBe("Edit package");
    await expect(edit.getAttribute("aria-label")).resolves.toContain(`lot ${lotCode}`);

    await openEditor(stockId);
    expect(await page!.textContent("#modal-title")).toBe("Edit Chemical");
    expect(await inputValue("f-cn2")).toBe(name);
    expect(await inputValue("f-b-lot")).toBe(lotCode);
    expect(await inputValue("f-cno")).toBe(note);

    await page!.click("#modal-confirm");
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => detailCalls, { timeout: 10_000 }).toBe(2);
    expect(writes[0]).toMatchObject({
      method: "PUT",
      path: `/api/groups/group-a/inventory/chemicals/${stockId}`,
      requestedWith: "XMLHttpRequest",
    });
    expect(writes[0]?.body).toMatchObject({
      name,
      note,
      batchInfo: { lotCode },
    });
    expect(events).toEqual([
      `GET ${DETAIL_PATH}`,
      `PUT /api/groups/group-a/inventory/chemicals/${stockId}`,
      `GET ${DETAIL_PATH}`,
    ]);
    expect(writes.some((write) => write.path.includes(stockId === "stock-primary" ? "stock-secondary" : "stock-primary"))).toBe(false);
    expect(pageErrors).toEqual([]);
  }, 40_000);
});

describe("mounted MaterialDetailModal generated-position editing", () => {
  it.each([
    { behavior: "retains an unchanged generated position", expected: "AH1" },
    { behavior: "retains the generated position on a name-only edit", name: "Tris base renamed", expected: "AH1" },
    { behavior: "saves a meaningful manual override", position: "Z9", expected: "Z9" },
    { behavior: "sends an explicit blank clear", position: "   ", expected: "" },
  ])("$behavior", async ({ name, position, expected }) => {
    await gotoDetail(`material=${MATERIAL_ID}&variant=legacy-position`);
    await openEditor();

    expect(await inputValue("f-cpos")).toBe("AH1");
    if (name !== undefined) {
      await page!.fill("#f-cn2", name);
    }
    if (position !== undefined) {
      await page!.fill("#f-cpos", position);
    }
    await page!.click("#modal-confirm");
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => detailCalls, { timeout: 10_000 }).toBe(2);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "PUT",
      path: PUT_PATH,
      requestedWith: "XMLHttpRequest",
    });
    expect(writes[0]?.body).toMatchObject({
      ...(name === undefined ? {} : { name }),
      customPosition: expected,
    });
    expect(writes[0]?.body).not.toHaveProperty("position");
    expect(pageErrors).toEqual([]);
  }, 40_000);
});

describe("mounted MaterialDetailModal quick stock actions", () => {
  it("adjusts quantity in both directions and refreshes the detail after each write", async () => {
    await gotoDetail(`material=${MATERIAL_ID}`);
    const adjustPath = "/api/groups/group-a/inventory/chemicals/stock-primary/adjust-qty";

    await page!.click("#qty-decrease-stock-primary");
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => detailCalls, { timeout: 10_000 }).toBe(2);
    await waitForQuantity("stock-primary", 249);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: adjustPath,
      requestedWith: "XMLHttpRequest",
    });
    expect(writes[0]?.body).toEqual({ roomId: "room-main", delta: -1 });

    await page!.click("#qty-increase-stock-primary");
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(2);
    await expect.poll(() => detailCalls, { timeout: 10_000 }).toBe(3);
    await waitForQuantity("stock-primary", 250);
    expect(writes[1]).toMatchObject({
      method: "POST",
      path: adjustPath,
      requestedWith: "XMLHttpRequest",
    });
    expect(writes[1]?.body).toEqual({ roomId: "room-main", delta: 1 });
    expect(events).toEqual([
      `GET ${DETAIL_PATH}`,
      `POST ${adjustPath}`,
      `GET ${DETAIL_PATH}`,
      `POST ${adjustPath}`,
      `GET ${DETAIL_PATH}`,
    ]);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("marks an available stock low and then available, refreshing after each write", async () => {
    await gotoDetail(`material=${MATERIAL_ID}`);
    const availabilityPath = "/api/groups/group-a/inventory/chemicals/stock-primary/availability";
    const action = page!.locator("#availability-stock-primary");
    await expect(action.textContent()).resolves.toBe("Mark low");

    await action.press("Enter");
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => detailCalls, { timeout: 10_000 }).toBe(2);
    await page!.waitForFunction(
      () => document.querySelector("#availability-stock-primary")?.textContent?.trim() === "Mark available",
    );
    expect(writes[0]).toMatchObject({
      method: "PUT",
      path: availabilityPath,
      requestedWith: "XMLHttpRequest",
    });
    expect(writes[0]?.body).toEqual({ roomId: "room-main", availability: "low" });

    await page!.click("#availability-stock-primary");
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(2);
    await expect.poll(() => detailCalls, { timeout: 10_000 }).toBe(3);
    await page!.waitForFunction(
      () => document.querySelector("#availability-stock-primary")?.textContent?.trim() === "Mark low",
    );
    expect(writes[1]).toMatchObject({
      method: "PUT",
      path: availabilityPath,
      requestedWith: "XMLHttpRequest",
    });
    expect(writes[1]?.body).toEqual({ roomId: "room-main", availability: "available" });
    expect(events).toEqual([
      `GET ${DETAIL_PATH}`,
      `PUT ${availabilityPath}`,
      `GET ${DETAIL_PATH}`,
      `PUT ${availabilityPath}`,
      `GET ${DETAIL_PATH}`,
    ]);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("disables low-stock marking for out-of-stock stock and never writes", async () => {
    await gotoDetail(`material=${MATERIAL_ID}&variant=out-of-stock`);
    const action = page!.locator("#availability-stock-primary");

    await expect(action.textContent()).resolves.toBe("Mark low");
    await expect(action.isDisabled()).resolves.toBe(true);
    await expect(action.getAttribute("title")).resolves.toBe("Out-of-stock packages cannot be marked low.");
    await expect(action.getAttribute("aria-pressed")).resolves.toBe("false");
    await page!.evaluate(() => {
      (document.getElementById("availability-stock-primary") as HTMLButtonElement | null)?.click();
    });
    await page!.waitForTimeout(250);
    expect(writes).toEqual([]);
    expect(detailCalls).toBe(1);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it.each([
    {
      placement: "container-direct",
      location: "container",
      body: { roomId: "room-main", containerId: "container-main", delta: 1 },
    },
    {
      placement: "cabinet shelf",
      location: "cabinet",
      body: { roomId: "room-main", containerId: "container-main", shelfId: "shelf-main", delta: 1 },
    },
    {
      placement: "nested shelf box",
      location: "nested",
      body: { roomId: "room-main", containerId: "container-main", shelfId: "shelf-main", boxId: "box-main", delta: 1 },
    },
    {
      placement: "deep-freezer box",
      location: "freezer",
      body: { roomId: "freezer-main", containerId: "freezer-main", shelfId: "freezer-box", delta: 1 },
    },
  ])("resolves the $placement target for quick quantity changes", async ({ location, body }) => {
    await gotoDetail(`material=${MATERIAL_ID}&location=${location}`);
    await page!.click("#qty-increase-stock-primary");
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => detailCalls, { timeout: 10_000 }).toBe(2);
    await waitForQuantity("stock-primary", 251);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: "/api/groups/group-a/inventory/chemicals/stock-primary/adjust-qty",
      requestedWith: "XMLHttpRequest",
    });
    expect(writes[0]?.body).toEqual(body);
    expect(pageErrors).toEqual([]);
  }, 40_000);
});

describe("mounted MaterialDetailModal stock focus", () => {
  it("opens a clicked catalog row and name link focused on the clicked stock id", async () => {
    await gotoCatalog(`material=${MATERIAL_ID}&view=catalog`);

    await page!.locator('#stocks-table tbody tr[data-stock-id="stock-secondary"] td:nth-child(2)').click();
    await page!.waitForSelector("#material-detail");
    await page!.waitForFunction(() => document.activeElement?.id === "stock-card-stock-secondary");
    expect(detailCalls).toBe(1);
    expect(await page!.locator(".material-stock-card.is-focused").count()).toBe(1);
    expect(await page!.locator("#stock-card-stock-secondary").getAttribute("class")).toContain("is-focused");
    expect(await page!.locator("#stock-card-stock-primary").getAttribute("class")).not.toContain("is-focused");

    await page!.click("#modal-close");
    await page!.locator('#stocks-table tbody tr[data-stock-id="stock-primary"] td:first-child button').click();
    await page!.waitForFunction(() => document.activeElement?.id === "stock-card-stock-primary");
    await expect.poll(() => detailCalls, { timeout: 10_000 }).toBe(2);
    expect(await page!.locator(".material-stock-card.is-focused").count()).toBe(1);
    expect(await page!.locator("#stock-card-stock-primary").getAttribute("class")).toContain("is-focused");
    expect(await page!.locator("#stock-card-stock-secondary").getAttribute("class")).not.toContain("is-focused");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("reports a stale focused package without focusing or substituting another stock", async () => {
    await gotoDetail(`material=${MATERIAL_ID}&stock=stock-retired`);

    await expect(page!.locator("#material-stock-focus-missing").textContent()).resolves.toBe(
      "The selected package is no longer available. Refresh Packages and try again.",
    );
    expect(await page!.locator(".material-stock-card").count()).toBe(2);
    expect(await page!.locator(".material-stock-card.is-focused").count()).toBe(0);
    expect(await page!.locator("#stock-card-stock-primary").count()).toBe(1);
    expect(await page!.locator("#stock-card-stock-secondary").count()).toBe(1);
    expect(await page!.evaluate(() => document.activeElement?.id ?? "")).not.toMatch(/^stock-card-/);
    expect(pageErrors).toEqual([]);
  }, 40_000);
});

describe("mounted MaterialDetailModal presentation", () => {
  it("shows joined stock details in compact headers and one facts grid per stock", async () => {
    await gotoDetail(`material=${MATERIAL_ID}&variant=rich-preview&location=nested`);

    await expect(page!.locator('[data-stock-id="stock-primary"]').count()).resolves.toBe(1);
    await expect(page!.locator('[data-stock-id="stock-secondary"]').count()).resolves.toBe(1);
    await expect(page!.locator('[data-stock-id="stock-other-material"]').count()).resolves.toBe(0);
    await expect(page!.locator(".material-stock-count").textContent()).resolves.toBe("2");
    await expect(page!.locator("#modal-body").textContent()).resolves.toContain("Created 2026-01-01");
    await expect(page!.locator("#modal-body").textContent()).resolves.toContain("Updated 2026-01-01");
    await expect(page!.locator("#quantity-stock-primary").textContent()).resolves.toBe("250");
    await expect(page!.locator("#quantity-stock-secondary").textContent()).resolves.toBe("25");

    const header = page!.locator("#stock-card-stock-primary > .material-stock-header");
    await expect(header.locator(":scope > .material-stock-heading-group > h5").textContent()).resolves.toBe("Stock 2");
    await expect(header.locator(":scope > .material-stock-heading-group > .status-badge").textContent()).resolves.toBe("Available");
    const headerActions = header.locator(":scope > .material-stock-header-actions");
    await expect(headerActions.locator(":scope > .material-stock-quantity #quantity-stock-primary").textContent()).resolves.toBe("250");
    await expect(headerActions.getByRole("group", { name: "Quantity controls for stock 2" }).count()).resolves.toBe(1);
    await expect(headerActions.locator(":scope > #availability-stock-primary").textContent()).resolves.toBe("Mark low");
    await expect(headerActions.locator(":scope > #stock-edit-stock-primary").textContent()).resolves.toBe("Edit package");
    await expect(page!.locator(".material-stock-quick-row").count()).resolves.toBe(0);
    await expect(page!.locator(".material-stock-subsection").count()).resolves.toBe(0);
    await expect(page!.getByRole("heading", { name: "Product", exact: true }).count()).resolves.toBe(0);
    await expect(page!.getByRole("heading", { name: "Batch", exact: true }).count()).resolves.toBe(0);

    const primaryFacts = page!.locator("#stock-card-stock-primary > .material-stock-facts");
    await expect(primaryFacts.count()).resolves.toBe(1);
    expect(await primaryFacts.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);

    const primary = await stockRows("stock-primary");
    expect(primary).toMatchObject({
      Concentration: "1.5 mol/L",
      Barcode: LONG_BARCODE,
      Note: "Original stock note",
      "Product name": "Tris laboratory product",
      Manufacturer: "Original manufacturer",
      Supplier: "Synthetic supplier",
      "Catalog number": "TRIS-100",
      Variant: "Ultra pure",
      Grade: "molecular biology",
      "Handling reference": LONG_PRODUCT_ATTRIBUTE,
      "Lot code": "LOT-ORIGINAL",
      "Origin type": "Purchased",
      "Received date": "2026-01-02",
      "Prepared date": "2026-01-03",
      "Prepared by": "Original preparer",
      "Expiry date": "2028-01-04",
    });
    expect(Object.values(primary)).not.toContain("—");
    expect(primary).not.toHaveProperty("Position");
    expect(await stockFactLabels("stock-primary")).not.toContain("Position");

    const location = primaryFacts.locator(":scope > .material-stock-location");
    await expect(location.count()).resolves.toBe(1);
    await expect(location.locator(":scope > dt").textContent()).resolves.toBe("Location");
    await expect(location.locator(".material-stock-position").count()).resolves.toBe(1);
    await expect(location.locator(".material-stock-position-value").textContent()).resolves.toBe("A-17");
    await expect(location.locator(".material-stock-position").getAttribute("title")).resolves.toBe("Custom position");
    await expect(location.locator(".material-stock-sr-only").textContent()).resolves.toBe("Custom position: ");
    await expect(page!.locator("#stock-card-stock-primary .material-stock-position").count()).resolves.toBe(1);
    expect(await stockLocationPath("stock-primary")).toBe(
      "Material Detail Room / Chemical cabinet / Shelf A / Box A",
    );

    const factTextStyles = await page!.$eval("#stock-card-stock-primary", (card) => {
      const locationValue = card.querySelector(".material-stock-location-content");
      const productLabel = Array.from(card.querySelectorAll(".material-stock-fact dt"))
        .find((label) => label.textContent?.trim() === "Product name");
      const productValue = productLabel?.nextElementSibling;
      if (locationValue === null || productValue === null || productValue === undefined) {
        throw new Error("Missing location or product fact");
      }
      const locationStyle = getComputedStyle(locationValue);
      const productStyle = getComputedStyle(productValue);
      return {
        location: {
          color: locationStyle.color,
          fontFamily: locationStyle.fontFamily,
          fontSize: locationStyle.fontSize,
          lineHeight: locationStyle.lineHeight,
        },
        product: {
          color: productStyle.color,
          fontFamily: productStyle.fontFamily,
          fontSize: productStyle.fontSize,
          lineHeight: productStyle.lineHeight,
        },
      };
    });
    expect(factTextStyles.location).toEqual(factTextStyles.product);
    for (const label of REPEATED_LOCATION_ROWS) {
      expect(primary).not.toHaveProperty(label);
    }

    const secondary = await stockRows("stock-secondary");
    expect(secondary).toMatchObject({
      Concentration: "0.5 mol/L",
      Note: "Secondary stock note",
      "Product name": "Tris secondary product",
      Manufacturer: "Secondary manufacturer",
      "Catalog number": "TRIS-SECONDARY",
      "Lot code": "LOT-SECONDARY",
      "Expiry date": "2029-02-02",
    });
    expect(secondary).not.toHaveProperty("Supplier");
    expect(secondary).not.toHaveProperty("Variant");
    expect(secondary).not.toHaveProperty("Prepared by");
    expect(await page!.locator("#modal-body").textContent()).not.toContain("Foreign material note");
    expect(await descriptorRows()).toMatchObject({
      "CAS number": "77-86-1",
      "Molecular formula": "C4H11NO3",
      "Molecular weight": "121.14",
      "Safety notes": "corrosive",
    });
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("builds one compact de-duplicated location when the path is missing", async () => {
    await gotoDetail(`material=${MATERIAL_ID}&location=fallback`);

    expect(await page!.locator("#stock-card-stock-primary .material-stock-location").count()).toBe(1);
    expect(await stockLocationPath("stock-primary")).toBe(FALLBACK_LOCATION);
    const primary = await stockRows("stock-primary");
    for (const label of REPEATED_LOCATION_ROWS) {
      expect(primary).not.toHaveProperty(label);
    }
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("keeps the generated-position distinction in the compact Location fact", async () => {
    await gotoDetail(`material=${MATERIAL_ID}&variant=legacy-position`);

    const location = page!.locator("#stock-card-stock-primary > .material-stock-facts > .material-stock-location");
    const position = location.locator(".material-stock-position");
    await expect(position.count()).resolves.toBe(1);
    await expect(position.locator(".material-stock-position-value").textContent()).resolves.toBe("AH1");
    await expect(position.getAttribute("title")).resolves.toBe("Generated position");
    await expect(position.locator(".material-stock-sr-only").textContent()).resolves.toBe("Generated position: ");
    expect(await stockFactLabels("stock-primary")).not.toContain("Position");
    expect(await page!.locator("#stock-card-stock-primary .material-stock-position").count()).toBe(1);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("omits a missing position without disturbing the compact Location fact", async () => {
    await gotoDetail(`material=${MATERIAL_ID}&variant=no-position`);

    const location = page!.locator("#stock-card-stock-primary > .material-stock-facts > .material-stock-location");
    await expect(location.count()).resolves.toBe(1);
    await expect(location.locator(":scope > dt").textContent()).resolves.toBe("Location");
    await expect(location.locator(".material-stock-position").count()).resolves.toBe(0);
    await expect(location.locator(".material-stock-sr-only").count()).resolves.toBe(0);
    expect(await stockLocationPath("stock-primary")).toBe("Material Detail Room");
    expect(await stockFactLabels("stock-primary")).not.toContain("Position");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("hides material-level Edit and Merge while keeping per-package actions and long locations contained at 390px", async () => {
    await gotoDetail(`material=${MATERIAL_ID}&variant=rich-preview&location=long-path`);

    expect(await page!.textContent(".material-detail-heading")).toBe("Tris base");
    const bodyText = await page!.$eval(
      "#modal-body",
      (element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "",
    );
    expect(bodyText).toContain("Primary Tris buffer material used for synthetic material detail tests.");
    expect(bodyText).toContain("Stock records");
    expect(bodyText).toContain("Original stock note");
    expect(bodyText).toContain("Secondary stock note");
    expect(bodyText).not.toContain("Foreign material note");
    expect(await page!.getByRole("heading", { name: "Stock records" }).count()).toBe(1);
    expect(await page!.locator(".material-stock-card").count()).toBe(2);
    expect(await descriptorRows()).toMatchObject({
      "CAS number": "77-86-1",
      "Molecular formula": "C4H11NO3",
      "Molecular weight": "121.14",
      "Safety notes": "corrosive",
    });

    expect(await page!.locator("#material-edit-open, #material-merge-open").count()).toBe(0);
    expect(await page!.locator("#material-stock-edit-hint").count()).toBe(0);
    expect(mergeCandidateCalls).toBe(0);
    const desktop = await actionRects();
    expect(desktop.map((rect) => rect.id)).toEqual(["stock-edit-stock-secondary", "stock-edit-stock-primary"]);
    expect(desktop.every((rect) => rect.visible)).toBe(true);
    for (const rect of desktop) {
      expect(rect.width).toBeGreaterThan(0);
    }

    await page!.setViewportSize({ width: 390, height: 844 });
    await page!.waitForFunction(() => window.innerWidth === 390);
    expect(await stockLocationPath("stock-primary")).toBe(LONG_LOCATION_PATH);
    const mobileColumnCounts = await page!.$$eval(".material-stock-card > .material-stock-facts", (grids) =>
      grids.map((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length),
    );
    expect(mobileColumnCounts).toEqual([1, 1]);
    const mobile = await actionRects();
    expect(mobile.map((rect) => rect.id)).toEqual(["stock-edit-stock-secondary", "stock-edit-stock-primary"]);
    for (const rect of mobile) {
      expect(rect.visible).toBe(true);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(390.5);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.scrollWidth).toBeLessThanOrEqual(rect.clientWidth + 1);
    }
    const container = await page!.$eval("#material-detail", (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(container.left).toBeGreaterThanOrEqual(0);
    expect(container.right).toBeLessThanOrEqual(390.5);
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth + 1);
    const modalBody = await page!.$eval("#modal-body", (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(modalBody.left).toBeGreaterThanOrEqual(0);
    expect(modalBody.right).toBeLessThanOrEqual(390.5);
    expect(modalBody.scrollWidth).toBeLessThanOrEqual(modalBody.clientWidth + 1);
    const stockCards = await page!.$$eval(".material-stock-card", (cards) =>
      cards.map((card) => {
        const rect = card.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          scrollWidth: card.scrollWidth,
          clientWidth: card.clientWidth,
        };
      }),
    );
    expect(stockCards).toHaveLength(2);
    for (const card of stockCards) {
      expect(card.left).toBeGreaterThanOrEqual(0);
      expect(card.right).toBeLessThanOrEqual(390.5);
      expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
    }
    const longValues = await page!.$$eval(".material-stock-fact dd, .material-stock-location", (values) =>
      values.map((value) => ({ scrollWidth: value.scrollWidth, clientWidth: value.clientWidth })),
    );
    for (const value of longValues) {
      expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
    }
    await expectLocationLayoutsContainedAt390();
    expect(await page!.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    expect(mergeCandidateCalls).toBe(0);
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("keeps the rich Bauhaus stock preview and long location contained at 390px", async () => {
    await gotoDetail(`material=${MATERIAL_ID}&variant=rich-preview&location=long-path&design=bauhaus`);
    await page!.setViewportSize({ width: 390, height: 844 });
    await page!.waitForFunction(() => window.innerWidth === 390);

    expect(await page!.getAttribute("body", "data-design")).toBe("bauhaus");
    expect(await stockLocationPath("stock-primary")).toBe(LONG_LOCATION_PATH);
    expect(await page!.locator(".material-stock-subsection").count()).toBe(0);
    expect(await page!.locator(".material-stock-card > .material-stock-facts").count()).toBe(2);
    const cardStyle = await page!.$eval(".material-stock-card", (card) => {
      const style = getComputedStyle(card);
      return { background: style.backgroundColor, radius: style.borderRadius };
    });
    expect(cardStyle).toEqual({ background: "rgb(255, 255, 255)", radius: "0px" });
    const regions = await page!.$$eval("#modal-body, .material-stock-card, .material-stock-location", (elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      }),
    );
    expect(regions).toHaveLength(5);
    for (const region of regions) {
      expect(region.left).toBeGreaterThanOrEqual(0);
      expect(region.right).toBeLessThanOrEqual(390.5);
      expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1);
    }
    await expectLocationLayoutsContainedAt390();
    expect(await page!.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("gives readers no merge/edit control and cannot trigger a write", async () => {
    await gotoDetail(`material=${MATERIAL_ID}&role=reader`);

    expect(await page!.textContent(".material-detail-heading")).toBe("Tris base");
    expect(await page!.locator("#material-merge-open").count()).toBe(0);
    expect(await page!.locator("#material-edit-open").count()).toBe(0);
    expect(await page!.locator('#material-detail [role="group"][aria-label="Material actions"]').count()).toBe(0);
    expect(await page!.locator(".material-stock-card").count()).toBe(2);
    expect(await page!.locator(".qty-adjuster").count()).toBe(0);
    expect(await page!.locator(".btn-qty").count()).toBe(0);
    expect(await page!.locator(".material-stock-availability").count()).toBe(0);
    expect(await page!.locator(".material-stock-edit").count()).toBe(0);
    expect(await page!.locator("#material-stock-edit-hint").count()).toBe(0);
    expect(await page!.locator("#quantity-stock-primary").textContent()).toBe("250");
    expect(await descriptorRows()).toMatchObject({
      "CAS number": "77-86-1",
      "Molecular formula": "C4H11NO3",
      "Molecular weight": "121.14",
      "Safety notes": "corrosive",
    });
    await page!.waitForTimeout(300);
    expect(writes).toEqual([]);
    expect(detailCalls).toBe(1);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("shows an empty stock state without material-level or package edit actions", async () => {
    await gotoDetail(`material=${CLEAR_MATERIAL_ID}&variant=no-stock`);

    expect(await page!.textContent(".material-detail-heading")).toBe("No stock material");
    expect(await page!.locator(".material-stock-empty").textContent()).toBe("No stock records.");
    expect(await page!.locator(".material-stock-card").count()).toBe(0);
    expect(await page!.locator(".qty-adjuster").count()).toBe(0);
    expect(await page!.locator(".material-stock-availability").count()).toBe(0);
    expect(await page!.locator(".material-stock-edit").count()).toBe(0);
    expect(await page!.locator("#material-edit-open, #material-merge-open").count()).toBe(0);
    expect(await page!.locator("#f-cn2").count()).toBe(0);
    expect(writes).toEqual([]);
    expect(detailCalls).toBe(1);
    expect(mergeCandidateCalls).toBe(0);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("resolves the selected stock through tree.deepFreezers", async () => {
    await gotoDetail(`material=${MATERIAL_ID}&location=freezer`);
    await openEditor();

    expect(await page!.textContent("#modal-title")).toBe("Edit Chemical");
    expect(await inputValue("f-cn2")).toBe("Tris base original");
    expect(await inputValue("f-shelf")).toBe("freezer-box");
    expect(await page!.locator("#f-room").count()).toBe(0);

    await page!.click("#modal-cancel");
    await page!.waitForSelector("#f-cn2", { state: "detached" });
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  }, 40_000);
});