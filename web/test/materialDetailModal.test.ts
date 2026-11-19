import http from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
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

let detailCalls = 0;
let detailPhase: "initial" | "updated" = "initial";
let fixtureVariant = "default";
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
    status: "available",
    position: "C-9",
    customPosition: "C-9",
    location: {
      id: "loc-room-main",
      name: "Material Detail Room",
      rackName: null,
      boxName: null,
      containerId: null,
      containerName: null,
      roomId: "room-main",
      roomName: "Material Detail Room",
      path: "Material Detail Room",
    },
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
    quantity: 250,
    unit: "g",
    concentration: 1.5,
    concentrationUnit: "mol/L",
    note: "Original stock note",
    status: "available",
    position: fixtureVariant === "legacy-position" ? "AH1" : "A-17",
    customPosition: fixtureVariant === "legacy-position" ? "" : "A-17",
    location: {
      id: "loc-room-main",
      name: "Material Detail Room",
      rackName: null,
      boxName: null,
      containerId: null,
      containerName: null,
      roomId: "room-main",
      roomName: "Material Detail Room",
      path: "Material Detail Room",
    },
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
        attributes: { grade: "molecular biology" },
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
    // materialId and resolves the canonical m-stock-primary package instead of
    // taking stocks[0].
    stocks: [foreignStock(), secondaryStock(), primaryStock()],
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
        <body><div id="modal-app"></div><div id="toast-app"></div><script type="module" src="/test/fixtures/materialDetailModal.ts"></script></body></html>`);
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

  await page.route("**/api/groups/group-a/inventory/chemicals/stock-primary", (route) => {
    const request = route.request();
    writes.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: readRequestBody(request),
      requestedWith: request.headers()["x-requested-with"] ?? "",
    });
    events.push(`${request.method()} ${new URL(request.url()).pathname}`);
    if (request.method() !== "PUT") {
      return route.fulfill({ status: 405, contentType: "application/json", body: "{\"error\":\"Method not allowed\"}" });
    }
    detailPhase = "updated";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "stock-primary", updated: true }),
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
  mergeCandidateCalls = 0;
  events = [];
  writes = [];
  pageErrors.length = 0;
});

function url(query = ""): string {
  return query === "" ? fixtureUrl : `${fixtureUrl}?${query}`;
}

async function gotoDetail(query = ""): Promise<void> {
  fixtureVariant = new URLSearchParams(query).get("variant") ?? "default";
  await page!.setViewportSize({ width: 1100, height: 900 });
  await page!.goto(url(query), { waitUntil: "networkidle" });
  await page!.waitForSelector("#material-detail");
}

async function openEditor(): Promise<void> {
  await page!.click("#material-edit-open");
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
  return page!.$$eval("#material-detail .material-detail-action", (buttons) =>
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

describe("mounted MaterialDetailModal", () => {
  it("edits the canonical stock through the existing chemical editor and refreshes the detail", async () => {
    await gotoDetail(`material=${MATERIAL_ID}`);
    expect(detailCalls).toBe(1);
    await openEditor();

    expect(await page!.textContent("#modal-title")).toBe("Edit Chemical");
    // The editor must be populated from the real stock-primary inventory record,
    // not from stock-secondary or the material id itself.
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
    expect(await page!.locator("#material-detail .material-detail-action").count()).toBe(2);
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

describe("mounted MaterialDetailModal presentation", () => {
  it("keeps identity and descriptors only, orders Merge before Edit and fits a 390px viewport", async () => {
    await gotoDetail(`material=${MATERIAL_ID}`);

    expect(await page!.textContent(".material-detail-heading")).toBe("Tris base");
    const bodyText = await page!.$eval(
      "#modal-body",
      (element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "",
    );
    expect(bodyText).toContain("Primary Tris buffer material used for synthetic material detail tests.");
    expect(bodyText).not.toMatch(/Packages/);
    expect(bodyText).not.toMatch(/Locations/);
    expect(await page!.getByRole("heading", { name: /Packages|Locations/ }).count()).toBe(0);
    expect(await descriptorRows()).toMatchObject({
      "CAS number": "77-86-1",
      "Molecular formula": "C4H11NO3",
      "Molecular weight": "121.14",
      "Safety notes": "corrosive",
    });

    const desktop = await actionRects();
    expect(desktop.map((rect) => rect.id)).toEqual(["material-merge-open", "material-edit-open"]);
    expect(desktop.every((rect) => rect.visible)).toBe(true);
    expect(desktop[0]!.left).toBeLessThan(desktop[1]!.left);
    expect(desktop[0]!.width).toBeGreaterThan(0);
    expect(desktop[1]!.width).toBeGreaterThan(0);

    await page!.setViewportSize({ width: 390, height: 844 });
    await page!.waitForFunction(() => window.innerWidth === 390);
    const mobile = await actionRects();
    expect(mobile.map((rect) => rect.id)).toEqual(["material-merge-open", "material-edit-open"]);
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

    await page!.setViewportSize({ width: 1100, height: 900 });
    await page!.click("#material-merge-open");
    await page!.waitForSelector("#merge-target-search");
    await page!.waitForSelector('[data-material-id="m-merge-target"]');
    expect(mergeCandidateCalls).toBe(1);
    expect(await page!.$eval("#merge-confirm", (element) => (element as HTMLButtonElement).disabled)).toBe(true);
    await page!.click('[data-material-id="m-merge-target"]');
    expect(await page!.$eval("#merge-confirm", (element) => (element as HTMLButtonElement).disabled)).toBe(false);
    // Opening the merge dialog must not execute the merge/write.
    await page!.click("#merge-cancel");
    await page!.waitForSelector("#merge-target-search", { state: "detached" });
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("gives readers no merge/edit control and cannot trigger a write", async () => {
    await gotoDetail(`material=${MATERIAL_ID}&role=reader`);

    expect(await page!.textContent(".material-detail-heading")).toBe("Tris base");
    expect(await page!.locator("#material-merge-open").count()).toBe(0);
    expect(await page!.locator("#material-edit-open").count()).toBe(0);
    expect(await page!.locator('#material-detail [role="group"][aria-label="Material actions"]').count()).toBe(0);
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

  it("disables Edit with an explanatory title when the material has no stock", async () => {
    await gotoDetail(`material=${CLEAR_MATERIAL_ID}&variant=no-stock`);

    expect(await page!.textContent(".material-detail-heading")).toBe("No stock material");
    const edit = page!.locator("#material-edit-open");
    expect(await edit.isVisible()).toBe(true);
    expect(await edit.isDisabled()).toBe(true);
    expect(await edit.getAttribute("title")).toBe("Edit unavailable: this material has no stock records.");
    expect(await page!.locator("#material-merge-open").count()).toBe(1);

    await page!.evaluate(() => {
      (document.getElementById("material-edit-open") as HTMLButtonElement | null)?.click();
    });
    await page!.waitForTimeout(250);
    expect(await page!.textContent("#modal-title")).toBe("Chemical");
    expect(await page!.locator("#f-cn2").count()).toBe(0);
    expect(writes).toEqual([]);
    expect(detailCalls).toBe(1);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("resolves the same canonical stock through tree.deepFreezers", async () => {
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