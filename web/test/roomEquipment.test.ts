import http from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page, type Request, type Route } from "playwright";
import { defaultCatalogColumnSelections } from "@bioscom/shared";

let vite: ViteDevServer | null = null;
let server: http.Server | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let fixtureUrl = "";
let instrumentsMode = "success";
let inventoryFails = false;
let instrumentCalls = 0;
let lateCalls = 0;
let firstLateResponseSent = false;
let inventoryDelayMs = 0;
let inventorySnapshotStarted = false;

const pageErrors: string[] = [];
const writes: Array<{ method: string; path: string; body: unknown; requestedWith: string }> = [];

function normalInstruments(): unknown[] {
  return [
    {
      id: "inst-main",
      name: "Matched centrifuge",
      description: "Current room assignment",
      location: "Legacy bench / keep me",
      roomGroupId: "group-a",
      roomId: "room-main",
      ownerLabId: "group-a",
      ownerLabName: "Synthetic Lab A",
      bookings: [],
    },
    {
      id: "inst-name-only",
      name: "Legacy name-only instrument",
      location: "Main Test Room",
      roomGroupId: null,
      roomId: null,
      ownerLabId: "group-a",
      ownerLabName: "Synthetic Lab A",
      bookings: [],
    },
    {
      id: "inst-other-lab",
      name: "Other lab instrument",
      location: "Foreign instrument",
      roomGroupId: "group-b",
      roomId: "room-main",
      ownerLabId: "group-b",
      ownerLabName: "Synthetic Lab B",
      bookings: [],
    },
  ];
}

function bodyOf(request: Request): unknown {
  try {
    return request.postDataJSON();
  } catch {
    return request.postData() ?? null;
  }
}

function record(request: Request): void {
  writes.push({
    method: request.method(),
    path: new URL(request.url()).pathname,
    body: bodyOf(request),
    requestedWith: request.headers()["x-requested-with"] ?? "",
  });
}

function json(route: Route, payload: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
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
    if (request.url?.split("?")[0] === "/room-equipment") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Room equipment fixture</title></head>
        <body><div id="app"></div><div id="modal-app"></div><div id="toast-app"></div><script type="module" src="/test/fixtures/roomEquipment.ts"></script></body></html>`);
      return;
    }
    next();
  });
  server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/room-equipment`;

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
    if (route.request().method() !== "GET") record(route.request());
    return json(route, { error: "Unexpected API request" }, 500);
  });

  await page.route("**/api/users/me/catalog-columns", (route) =>
    json(route, { columnsByType: defaultCatalogColumnSelections(), updatedAt: 0 }),
  );
  await page.route("**/api/users/me/dashboard-dismissals", (route) =>
    json(route, { dismissals: [], updatedAt: 0 }),
  );
  await page.route("**/api/notices", (route) => json(route, { notices: [] }));
  await page.route("**/api/groups", (route) =>
    json(route, { groups: [{ id: "group-a", name: "Synthetic Lab A" }] }),
  );
  await page.route("**/api/groups/group-a/stocks*", (route) => {
    const stock = {
      id: "catalog-stock-1",
      name: "Synthetic catalog stock",
      type: "chemical",
      quantity: 10,
      unit: "mL",
      status: "available",
      position: "A-1",
      location: {
        path: "Main Test Room · Cabinet",
        roomId: "room-main",
        roomName: "Main Test Room",
        containerId: "cont-main",
        containerName: "Main Cabinet",
        rackName: null,
        boxName: null,
      },
      batch: {
        id: "catalog-batch-1",
        productId: null,
        lotCode: "LOT-CATALOG-1",
        originType: "purchased",
        receivedAt: null,
        preparedAt: null,
        preparedBy: null,
        expiresAt: null,
      },
      product: null,
      materialId: "m-catalog-stock-1",
      attributes: {},
    };
    return json(route, { stocks: [stock], total: 1, page: 1, limit: 25 });
  });
  await page.route("**/api/me", (route) => json(route, {
    user: {
      uid: "synthetic-room-equipment-user",
      name: "Synthetic Room Equipment User",
      role: "member",
      groupId: "group-a",
      email: null,
    },
  }));
  await page.route("**/api/groups/group-a/backups", (route) => json(route, { backups: [] }));
  await page.route("**/api/groups/group-a/history", (route) => json(route, { history: [] }));

  await page.route("**/api/groups/group-a/inventory", async (route) => {
    if (inventoryFails) return json(route, { error: "Synthetic inventory failure" }, 500);
    const tree = await page!.evaluate(() =>
      (window as unknown as { __roomEquipmentTree?: () => unknown }).__roomEquipmentTree?.(),
    );
    const docVersion = await page!.evaluate(() =>
      (window as unknown as { __roomEquipmentInventoryVersion(): number }).__roomEquipmentInventoryVersion(),
    );
    inventorySnapshotStarted = true;
    if (inventoryDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, inventoryDelayMs));
    }
    return json(route, { version: docVersion, tree });
  });

  await page.route(/\/api\/groups\/group-a\/inventory\/asset-rooms\/[^/]+$/, (route) => {
    const request = route.request();
    record(request);
    return json(route, { ok: true });
  });

  await page.route("**/api/instruments", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path !== "/api/instruments" || request.method() !== "GET") {
      if (request.method() !== "GET") record(request);
      if (request.method() === "POST" && path === "/api/instruments") {
        return json(route, { id: "synthetic-new-instrument" }, 201);
      }
      return json(route, { ok: true });
    }

    instrumentCalls += 1;
    if (instrumentsMode === "empty-view") return json(route, { instruments: [] });
    if (instrumentsMode === "error") return json(route, { error: "Synthetic instruments failure" }, 500);
    if (instrumentsMode === "ordering") {
      lateCalls += 1;
      if (lateCalls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        firstLateResponseSent = true;
        return json(route, { instruments: [normalInstruments()[1]] });
      }
      return json(route, { instruments: normalInstruments() });
    }
    return json(route, { instruments: normalInstruments() });
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
  instrumentsMode = "success";
  inventoryFails = false;
  instrumentCalls = 0;
  lateCalls = 0;
  firstLateResponseSent = false;
  inventoryDelayMs = 0;
  inventorySnapshotStarted = false;
  writes.length = 0;
  pageErrors.length = 0;
});

async function gotoRoom(query = ""): Promise<void> {
  await page!.setViewportSize({ width: 1100, height: 900 });
  await page!.goto(`${fixtureUrl}${query === "" ? "" : `?${query}`}`, { waitUntil: "networkidle" });
  await page!.waitForSelector("#room-instruments-section");
}

async function expandBarcodes(): Promise<void> {
  await page!.focus("#room-barcodes-toggle");
  await page!.keyboard.press("Enter");
  await page!.waitForFunction(() =>
    document.querySelector("#room-barcodes-toggle")?.getAttribute("aria-expanded") === "true",
  );
}

async function settleModalAnimation(): Promise<void> {
  await page!.evaluate(async () => {
    const modalElement = document.querySelector("#modal");
    if (modalElement === null) return;
    await Promise.all(
      modalElement.getAnimations({ subtree: true }).map((animation) =>
        animation.finished.catch(() => undefined),
      ),
    );
  });
}

async function legacyAssetRoomId(): Promise<string | null> {
  return page!.evaluate(() =>
    (window as unknown as { __roomEquipmentLegacyAssetRoomId(id: string): string | null })
      .__roomEquipmentLegacyAssetRoomId("asset-newly-linked"),
  );
}

for (const design of ["original", "bauhaus"] as const) {
  it(`shows exact-room instruments and only mapped asset barcodes in ${design} at 390px`, async () => {
    await gotoRoom(`design=${design}`);
    await page!.setViewportSize({ width: 390, height: 844 });
    await page!.waitForSelector('[data-instrument-id="inst-main"]');

    expect(await page!.locator('[data-instrument-id="inst-main"]').count()).toBe(1);
    expect(await page!.locator('[data-instrument-id="inst-name-only"]').count()).toBe(0);
    expect(await page!.locator('[data-instrument-id="inst-other-lab"]').count()).toBe(0);
    expect(await page!.locator("#room-view-reservations").getAttribute("href")).toBe("#instruments");
    expect(await page!.textContent("#room-direct-chemicals-table")).toContain("Room primer stock");
    expect(await page!.locator('#room-direct-chemicals-table [data-column="type"] .status-badge').count()).toBeGreaterThan(0);

    await expandBarcodes();
    expect(await page!.locator("#room-barcodes-toggle").getAttribute("aria-expanded")).toBe("true");
    const values = await page!.$$eval("#room-barcodes-panel .room-barcode-value", (nodes) =>
      nodes.map((node) => node.textContent?.trim()),
    );
    expect(values).toEqual(["ASSET-001", "DUP-001", "DUP-001"]);
    expect(await page!.locator('[data-room-barcode-asset="asset-other-room"]').count()).toBe(0);
    expect(await page!.locator('[data-room-barcode-asset="asset-orphan"]').count()).toBe(0);
    expect(await page!.locator('[data-room-barcode-asset="asset-blank"]').count()).toBe(0);
    expect(await page!.locator('[data-room-barcode-asset="asset-newly-linked"]').count()).toBe(0);
    expect(await page!.textContent("#room-barcodes-panel")).not.toContain("CHEMICAL-ONLY-999");
    await page!.waitForFunction(() =>
      Array.from(document.querySelectorAll("#room-barcode-grid svg"))
        .every((svg) => svg.childNodes.length > 0),
    );
    expect(await page!.$$eval("#room-barcode-grid svg", (svgs) =>
      svgs.map((svg) => {
        const box = svg.getBBox();
        return box.width > 0 && box.height > 0;
      }),
    )).toEqual([true, true, true]);
    expect(await page!.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(pageErrors).toEqual([]);
  }, 40_000);
}

it("sends correct instrument assignment payloads without changing legacy location", async () => {
  await gotoRoom();
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentOpenNewInstrument(): void }).__roomEquipmentOpenNewInstrument();
  });
  await page!.waitForSelector("#i-room");
  await settleModalAnimation();
  await page!.fill("#i-name", "New centrifuge");
  await page!.selectOption("#i-room", "room-main");
  expect(await page!.locator('#i-room option[value="freezer-root"]').count()).toBe(0);
  await page!.click("#modal-confirm");
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    method: "POST",
    path: "/api/instruments",
    requestedWith: "XMLHttpRequest",
    body: {
      name: "New centrifuge",
      location: "Main Test Room",
      roomGroupId: "group-a",
      roomId: "room-main",
    },
  });

  // Keep each editor scenario isolated from the previous modal's closing transition.
  await page!.reload({ waitUntil: "networkidle" });
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentOpenAssignedInstrument(): void }).__roomEquipmentOpenAssignedInstrument();
  });
  await page!.waitForSelector("#i-name");
  await settleModalAnimation();
  await page!.fill("#i-name", "Renamed centrifuge");
  await page!.click("#modal-confirm");
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]?.path).toBe("/api/instruments/inst-main");
  expect(writes[1]?.body).not.toHaveProperty("roomGroupId");
  expect(writes[1]?.body).not.toHaveProperty("roomId");
  expect(writes[1]?.body).toMatchObject({ location: "Legacy bench / keep me" });

  await page!.reload({ waitUntil: "networkidle" });
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentOpenAssignedInstrument(): void }).__roomEquipmentOpenAssignedInstrument();
  });
  await page!.waitForSelector("#i-room");
  await settleModalAnimation();
  await page!.selectOption("#i-room", "");
  await page!.click("#modal-confirm");
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2]?.body).toMatchObject({ roomGroupId: null, roomId: null, location: "Legacy bench / keep me" });
  expect(writes[2]?.requestedWith).toBe("XMLHttpRequest");
  expect(pageErrors).toEqual([]);
}, 40_000);

it("applies asset-room link and clear only after confirmed inventory updates", async () => {
  await gotoRoom();
  await expandBarcodes();
  expect(await page!.locator('[data-room-barcode-asset="asset-newly-linked"]').count()).toBe(0);
  await page!.click("#room-map-asset-room-unmapped");
  expect(await page!.inputValue("#ar-linked-room")).toBe("room-main");
  await page!.click("#modal-confirm");
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    method: "PUT",
    path: "/api/groups/group-a/inventory/asset-rooms/asset-room-unmapped",
    requestedWith: "XMLHttpRequest",
    body: { name: "Main Test Room", linkedRoomId: "room-main" },
  });
  await page!.waitForSelector("#ar-linked-room", { state: "detached" });
  expect(await page!.locator('[data-room-barcode-asset="asset-newly-linked"]').count()).toBe(0);

  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentConfirmAssetRoomMapping(id: string, room: string | null): void })
      .__roomEquipmentConfirmAssetRoomMapping("asset-room-unmapped", "room-main");
  });
  await page!.waitForSelector('[data-room-barcode-asset="asset-newly-linked"]');
  expect(await legacyAssetRoomId()).toBe("asset-room-unmapped");

  await page!.click("#room-map-asset-room-unmapped");
  await page!.selectOption("#ar-linked-room", "");
  await page!.click("#modal-confirm");
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]?.body).toMatchObject({ name: "Main Test Room", linkedRoomId: null });
  await page!.waitForSelector('[data-room-barcode-asset="asset-newly-linked"]');
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentConfirmAssetRoomMapping(id: string, room: string | null): void })
      .__roomEquipmentConfirmAssetRoomMapping("asset-room-unmapped", null);
  });
  await page!.waitForSelector('[data-room-barcode-asset="asset-newly-linked"]', { state: "detached" });
  expect(await legacyAssetRoomId()).toBe("asset-room-unmapped");
  expect(pageErrors).toEqual([]);
}, 40_000);

it("honors load failures, explicit retry and late instrument responses", async () => {
  instrumentsMode = "error";
  await gotoRoom("instruments=error");
  await page!.waitForSelector("#room-instruments-retry");
  expect(await page!.locator("#room-instruments-empty").count()).toBe(0);
  await page!.waitForTimeout(400);
  expect(instrumentCalls).toBe(1);
  instrumentsMode = "success";
  await page!.click("#room-instruments-retry");
  await page!.waitForSelector('[data-instrument-id="inst-main"]');
  expect(instrumentCalls).toBe(2);
  expect(await page!.locator("#room-instruments-retry").count()).toBe(0);

  instrumentsMode = "ordering";
  await gotoRoom("instruments=manual");
  await page!.evaluate(() => {
    const fixture = window as unknown as { __roomEquipmentFetchInstruments(): void };
    fixture.__roomEquipmentFetchInstruments();
    fixture.__roomEquipmentFetchInstruments();
  });
  await page!.waitForSelector('[data-instrument-id="inst-main"]');
  await expect.poll(() => firstLateResponseSent).toBe(true);
  expect(await page!.locator('[data-instrument-id="inst-name-only"]').count()).toBe(0);

  inventoryFails = true;
  await expandBarcodes();
  await page!.evaluate(async () => {
    await (window as unknown as { __roomEquipmentFetchInventory(): Promise<void> })
      .__roomEquipmentFetchInventory()
      .catch(() => undefined);
  });
  await page!.waitForSelector("#room-barcodes-retry");
  await page!.click("#room-barcodes-retry");
  await page!.waitForSelector("#room-barcodes-panel .warning");
  expect(await page!.textContent("#room-barcodes-panel .warning")).toContain("last confirmed assignments");
  expect(await page!.textContent("#room-barcodes-panel")).toContain("ASSET-001");
  expect(pageErrors).toEqual([]);
}, 40_000);

it("keeps reader controls non-mutating and hidden content inaccessible when collapsed", async () => {
  await gotoRoom("role=reader&design=original");
  expect(await page!.locator("#room-open-inventory").count()).toBe(0);
  await expandBarcodes();
  expect(await page!.locator("#room-mapping").count()).toBe(0);
  expect(await page!.locator("#room-view-reservations").getAttribute("href")).toBe("#instruments");
  await page!.setViewportSize({ width: 390, height: 844 });
  expect(await page!.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await page!.textContent("#room-barcodes-panel")).toContain("ASSET-001");

  await page!.focus("#room-barcodes-toggle");
  await page!.keyboard.press("Enter");
  expect(await page!.$eval("#room-barcodes-panel", (element) => element.hidden)).toBe(true);
  expect(await page!.evaluate(() => document.activeElement?.closest("#room-barcodes-panel") === null)).toBe(true);
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
}, 40_000);

it("puts Catalog before Rooms & equipment and preserves navigation preferences", async () => {
  await page!.goto(`${fixtureUrl}?shell=1&design=bauhaus`, { waitUntil: "networkidle" });
  await page!.waitForSelector("#tab-catalog");
  await page!.waitForSelector("#tab-inventory");
  expect(await page!.textContent("#tab-catalog")).toContain("Catalog");
  expect(await page!.textContent("#tab-inventory")).toContain("Rooms & equipment");
  expect(await page!.$eval("#tab-catalog", (element) => element.compareDocumentPosition(
    document.querySelector("#tab-inventory")!,
  ) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();

  await page!.focus("#tab-catalog");
  await page!.keyboard.press("Enter");
  await page!.waitForFunction(() => window.location.hash === "#catalog");
  await page!.waitForSelector("#stocks-table");
  expect(await page!.locator("#stocks-table").count()).toBe(1);

  const visibleAfterChoice = await page!.evaluate(() => {
    const fixture = window as unknown as {
      __roomEquipmentSetCatalogVisible(visible: boolean): void;
      __roomEquipmentCatalogVisible(): boolean;
    };
    fixture.__roomEquipmentSetCatalogVisible(false);
    return fixture.__roomEquipmentCatalogVisible();
  });
  expect(visibleAfterChoice).toBe(false);
  await page!.reload({ waitUntil: "networkidle" });
  const preserved = await page!.evaluate(() => {
    const fixture = window as unknown as {
      __roomEquipmentSetCatalogVisible(visible: boolean): void;
      __roomEquipmentCatalogVisible(): boolean;
    };
    const value = fixture.__roomEquipmentCatalogVisible();
    fixture.__roomEquipmentSetCatalogVisible(true);
    return value;
  });
  expect(preserved).toBe(false);
  await page!.click("#tab-inventory");
  expect(await page!.evaluate(() => window.location.hash)).toBe("#rooms");
  expect(pageErrors).toEqual([]);
}, 40_000);

async function currentRoomName(): Promise<string | null> {
  return page!.evaluate(() =>
    (window as unknown as { __roomEquipmentCurrentRoomName(): string | null }).__roomEquipmentCurrentRoomName(),
  );
}

async function inventoryVersion(): Promise<number> {
  return page!.evaluate(() =>
    (window as unknown as { __roomEquipmentInventoryVersion(): number }).__roomEquipmentInventoryVersion(),
  );
}

it("does not let a late inventory fetch replace a newer mapping broadcast", async () => {
  inventoryDelayMs = 220;
  await gotoRoom();
  const olderResponse = page!.evaluate(() =>
    (window as unknown as { __roomEquipmentFetchInventory(): Promise<void> }).__roomEquipmentFetchInventory(),
  );
  await expect.poll(() => inventorySnapshotStarted).toBe(true);
  await expandBarcodes();
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentConfirmAssetRoomMapping(id: string, room: string | null): void })
      .__roomEquipmentConfirmAssetRoomMapping("asset-room-unmapped", "room-main");
  });
  await page!.waitForSelector('[data-room-barcode-asset="asset-newly-linked"]');
  await olderResponse;
  expect(await inventoryVersion()).toBe(2);
  expect(await page!.locator('[data-room-barcode-asset="asset-newly-linked"]').count()).toBe(1);
  expect(pageErrors).toEqual([]);
}, 40_000);

it("keeps a switched lab unconfirmed until its own tree arrives despite a late response", async () => {
  inventoryDelayMs = 220;
  await gotoRoom();
  const olderResponse = page!.evaluate(() =>
    (window as unknown as { __roomEquipmentFetchInventory(): Promise<void> }).__roomEquipmentFetchInventory(),
  );
  await expect.poll(() => inventorySnapshotStarted).toBe(true);
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentSelectGroup(groupId: string): void }).__roomEquipmentSelectGroup("group-b");
  });
  await expect.poll(() => page!.locator("#room-instruments-section").count()).toBe(0);
  expect(await currentRoomName()).toBeNull();
  expect(await page!.locator("#room-direct-chemicals-table").count()).toBe(0);
  expect(await page!.locator("#room-barcodes-section").count()).toBe(0);

  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentDeliverGroup(groupId: string): void }).__roomEquipmentDeliverGroup("group-b");
  });
  await page!.waitForSelector("#room-instruments-section");
  await olderResponse;
  expect(await currentRoomName()).toBe("Lab B physical room");
  expect(await inventoryVersion()).toBe(2);
  await expect.poll(() => page!.locator("#room-instruments-section").count()).toBe(1);
  expect(await page!.locator("#room-direct-chemicals-table").count()).toBe(0);
  expect(pageErrors).toEqual([]);
}, 40_000);

it("hides the empty Add Instrument action from readers and opens it for writers", async () => {
  instrumentsMode = "empty-view";
  await page!.goto(`${fixtureUrl}?instruments=empty-view&role=reader`, { waitUntil: "networkidle" });
  await page!.waitForSelector("#instruments-empty");
  expect(await page!.locator("#btn-add-instrument-empty").isVisible()).toBe(false);
  expect(writes).toEqual([]);

  await page!.goto(`${fixtureUrl}?instruments=empty-view`, { waitUntil: "networkidle" });
  await page!.waitForSelector("#instruments-empty");
  expect(await page!.locator("#btn-add-instrument-empty").isVisible()).toBe(true);
  await page!.click("#btn-add-instrument-empty");
  await page!.waitForSelector("#i-name");
  expect(await page!.textContent("#modal-title")).toBe("Add Instrument");
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
}, 40_000);
