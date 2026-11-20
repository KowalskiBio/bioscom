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
    {
      id: "inst-foreign-bookable",
      name: "Foreign validated instrument",
      location: "Foreign bench 4",
      roomGroupId: "group-b",
      roomId: "room-foreign-not-local",
      ownerLabId: "group-b",
      ownerLabName: "Synthetic Lab B",
      bookings: [],
    },
    {
      id: "inst-foreign-unassigned",
      name: "Foreign unassigned instrument",
      location: "Legacy foreign note",
      roomGroupId: null,
      roomId: null,
      ownerLabId: "group-b",
      ownerLabName: "Synthetic Lab B",
      bookings: [],
    },
    {
      id: "inst-stale-room",
      name: "Stale room instrument",
      roomGroupId: "group-a",
      roomId: "room-stale-not-local",
      ownerLabId: "group-a",
      ownerLabName: "Synthetic Lab A",
      bookings: [],
    },
    {
      id: "inst-freezer-room",
      name: "Freezer pointer instrument",
      roomGroupId: "group-a",
      roomId: "freezer-root",
      ownerLabId: "group-a",
      ownerLabName: "Synthetic Lab A",
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

  await page.route("**/api/groups/group-a/inventory/assets", (route) => {
    record(route.request());
    return json(route, { id: "synthetic-new-asset" }, 201);
  });
  await page.route(/\/api\/groups\/group-a\/inventory\/assets\/[^/]+$/, (route) => {
    record(route.request());
    return json(route, { ok: true });
  });
  await page.route("**/api/groups/group-a/inventory/asset-rooms", (route) => {
    record(route.request());
    return json(route, { id: "synthetic-canonical-room" }, 201);
  });
  await page.route(/\/api\/groups\/group-a\/inventory\/asset-rooms\/[^/]+$/, (route) => {
    const request = route.request();
    record(request);
    return json(route, { ok: true });
  });

  await page.route(/\/api\/instruments\/[^/]+\/bookings$/, (route) => {
    record(route.request());
    return json(route, { id: "synthetic-foreign-booking" }, 201);
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

async function confirmedAssetRoomId(): Promise<string | null> {
  return page!.evaluate(() =>
    (window as unknown as { __roomEquipmentConfirmedAssetRoomId(id: string): string | null })
      .__roomEquipmentConfirmedAssetRoomId("asset-newly-linked"),
  );
}

for (const design of ["original", "bauhaus"] as const) {
  it(`shows exact-room instruments and only directly assigned asset barcodes in ${design} at 390px`, async () => {
    await gotoRoom(`design=${design}`);
    await page!.setViewportSize({ width: 390, height: 844 });
    await page!.waitForSelector('[data-instrument-id="inst-main"]');

    expect(await page!.locator('[data-instrument-id="inst-main"]').count()).toBe(1);
    expect(await page!.locator('[data-instrument-id="inst-name-only"]').count()).toBe(0);
    expect(await page!.locator('[data-instrument-id="inst-other-lab"]').count()).toBe(0);
    expect(await page!.locator("#room-view-reservations").count()).toBe(0);
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
    expect(await page!.locator('[data-room-barcode-asset="asset-freezer"]').count()).toBe(0);
    expect(await page!.locator('[data-room-barcode-asset="asset-name-only"]').count()).toBe(0);
    expect(await page!.locator("#room-mapping").count()).toBe(0);
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

  it(`opens room instrument booking by mouse, Enter and Space in ${design}`, async () => {
    await page!.goto(`${fixtureUrl}?shell=1&design=${design}#containers/room-main`, { waitUntil: "networkidle" });
    const roomCard = page!.locator('#view-containers [data-instrument-id="inst-main"]');
    await roomCard.waitFor();
    expect(await page!.locator("#room-view-reservations").count()).toBe(0);
    expect(await roomCard.getAttribute("role")).toBe("button");
    expect(await roomCard.getAttribute("tabindex")).toBe("0");
    expect(await roomCard.getAttribute("aria-label")).toBe("Book Matched centrifuge");

    async function expectBookingView(): Promise<void> {
      await page!.waitForFunction(() => window.location.hash === "#instruments");
      await page!.waitForSelector("#view-instruments.active #instruments-grid");
      await page!.waitForSelector("#b-date");
      expect(await page!.textContent("#modal-title")).toBe("Book: Matched centrifuge");
      expect(await page!.textContent("#modal-confirm")).toBe("Book");
    }

    async function returnToRoom(): Promise<void> {
      await page!.click("#modal-cancel");
      await page!.goBack();
      await page!.waitForSelector("#view-containers.active #room-instrument-grid");
    }

    await roomCard.click();
    await expectBookingView();

    await returnToRoom();
    await roomCard.focus();
    await page!.keyboard.press("Enter");
    await expectBookingView();

    await returnToRoom();
    await roomCard.focus();
    await page!.keyboard.press("Space");
    await expectBookingView();

    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  }, 60_000);
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
      location: "",
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
  expect(writes[1]?.body).not.toHaveProperty("location");

  await page!.reload({ waitUntil: "networkidle" });
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentOpenAssignedInstrument(): void }).__roomEquipmentOpenAssignedInstrument();
  });
  await page!.waitForSelector("#i-room");
  await settleModalAnimation();
  expect(await page!.inputValue("#i-room")).toBe("room-main");
  expect(await page!.locator('#i-room option[value=""]').count()).toBe(0);
  expect(await page!.inputValue("#i-location")).toBe("Legacy bench / keep me");
  expect(writes).toHaveLength(2);
  expect(writes[1]?.body).not.toHaveProperty("roomGroupId");
  expect(writes[1]?.body).not.toHaveProperty("roomId");
  expect(pageErrors).toEqual([]);
}, 40_000);

it("requires a room for legacy instruments and offers an accessible create-room path", async () => {
  await gotoRoom();
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentOpenLegacyInstrument(): void }).__roomEquipmentOpenLegacyInstrument();
  });
  await page!.waitForSelector("#i-room");
  await settleModalAnimation();
  expect(await page!.inputValue("#i-location")).toBe("Main Test Room");
  expect(await page!.locator("#i-room").getAttribute("required")).not.toBeNull();
  expect(await page!.textContent("#i-room")).not.toContain("No physical room assigned");
  expect(await page!.locator('#i-room option[value="asset-room-main"]').count()).toBe(0);
  expect(await page!.locator('#i-room option[value="freezer-root"]').count()).toBe(0);
  await page!.click("#modal-confirm");
  await page!.waitForSelector("#i-room-error", { state: "visible" });
  expect(writes).toEqual([]);

  await page!.selectOption("#i-room", "room-other");
  await page!.fill("#i-location", "Bench 7, beside the Balanced Instruments With A Very Long Placement Note");
  await page!.setViewportSize({ width: 390, height: 844 });
  expect(await page!.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page!.click("#modal-confirm");
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    method: "PUT",
    path: "/api/instruments/inst-name-only",
    requestedWith: "XMLHttpRequest",
    body: {
      roomGroupId: "group-a",
      roomId: "room-other",
      location: "Bench 7, beside the Balanced Instruments With A Very Long Placement Note",
    },
  });

  await page!.goto(`${fixtureUrl}?inventory=no-rooms`, { waitUntil: "networkidle" });
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentOpenNewInstrument(): void }).__roomEquipmentOpenNewInstrument();
  });
  await page!.waitForSelector("#i-room-empty");
  expect(await page!.locator("#i-room").isDisabled()).toBe(true);
  expect(await page!.locator("#i-room").getAttribute("aria-describedby")).toContain("i-room-help");
  await page!.focus("#i-create-room");
  await page!.keyboard.press("Enter");
  await page!.waitForSelector("#f-rn");
  expect(await page!.textContent("#modal-title")).toBe("Add Room");
  expect(writes).toHaveLength(1);
  expect(pageErrors).toEqual([]);
}, 45_000);

it("uses canonical room IDs in asset forms without carrying legacy pointers on unrelated edits", async () => {
  await page!.goto(`${fixtureUrl}?view=assets`, { waitUntil: "networkidle" });
  await page!.waitForSelector("#assets-grid");
  const roomHeadings = await page!.$$eval("#assets-grid h3", (headings) => headings.map((heading) => (heading.textContent ?? "").replace("🚪", "").trim()));
  expect(roomHeadings).toContain("Main Test Room");
  expect(roomHeadings).toContain("Other Test Room");
  expect(roomHeadings).not.toContain("Main Inventory Room");
  expect(roomHeadings).not.toContain("Other Inventory Room");
  await page!.getByRole("button", { name: "Edit Room", exact: true }).first().click();
  await page!.waitForSelector("#f-rn");
  expect(await page!.inputValue("#f-rn")).toBe("Main Test Room");
  expect(await page!.locator("#ar-linked-room").count()).toBe(0);
  await page!.click("#modal-cancel");
  await page!.waitForSelector("#f-rn", { state: "detached" });
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentOpenNewAsset(): void }).__roomEquipmentOpenNewAsset();
  });
  await page!.waitForSelector("#a-room");
  await settleModalAnimation();
  expect(await page!.$$eval("#a-room option", (options) => options.map((option) => (option as HTMLOptionElement).value)))
    .toEqual(["", "room-main", "room-other"]);
  await page!.fill("#a-name", "New canonical reader");
  await page!.fill("#a-model", "Reader Model Z");
  await page!.fill("#a-barcode", "DUP-001");
  await page!.fill("#a-desc", "Descriptive product details stay intact");
  await page!.selectOption("#a-room", "room-main");
  await page!.click("#modal-confirm");
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    method: "POST",
    path: "/api/groups/group-a/inventory/assets",
    requestedWith: "XMLHttpRequest",
    body: {
      name: "New canonical reader",
      model: "Reader Model Z",
      barcode: "DUP-001",
      description: "Descriptive product details stay intact",
      roomId: "room-main",
    },
  });

  await page!.reload({ waitUntil: "networkidle" });
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentOpenLegacyAsset(): void }).__roomEquipmentOpenLegacyAsset();
  });
  await page!.waitForSelector("#a-room");
  expect(await page!.inputValue("#a-room")).toBe("");
  expect(await page!.locator('#a-room option[value="missing-asset-room"]').count()).toBe(0);
  await page!.fill("#a-name", "Renamed legacy orphan centrifuge");
  await page!.click("#modal-confirm");
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({
    method: "PUT",
    path: "/api/groups/group-a/inventory/assets/asset-orphan",
    requestedWith: "XMLHttpRequest",
    body: {
      name: "Renamed legacy orphan centrifuge",
      model: "Legacy Model L-1",
      barcode: "LEGACY-DUPLICATE-001",
      description: "Keep every descriptive field",
    },
  });
  expect(writes[1]?.body).not.toHaveProperty("roomId");

  await page!.reload({ waitUntil: "networkidle" });
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentOpenLegacyAsset(): void }).__roomEquipmentOpenLegacyAsset();
  });
  await page!.waitForSelector("#a-room");
  await page!.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>("#a-room")!;
    select.add(new Option("Injected invalid root freezer", "freezer-root"));
    select.value = "freezer-root";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page!.click("#modal-confirm");
  await page!.waitForFunction(() => document.body.textContent?.includes("Select a current physical room"));
  expect(writes).toHaveLength(2);

  await page!.reload({ waitUntil: "networkidle" });
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentOpenCanonicalAsset(): void }).__roomEquipmentOpenCanonicalAsset();
  });
  await page!.waitForSelector("#a-room");
  expect(await page!.inputValue("#a-room")).toBe("room-main");
  await page!.fill("#a-name", "Renamed canonical microscope");
  await page!.click("#modal-confirm");
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2]?.body).toMatchObject({
    name: "Renamed canonical microscope",
    model: "Model M-1",
    barcode: "DUP-001",
    description: "Canonical descriptive note",
  });
  expect(writes[2]?.body).not.toHaveProperty("roomId");

  await page!.reload({ waitUntil: "networkidle" });
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentOpenCanonicalAsset(): void }).__roomEquipmentOpenCanonicalAsset();
  });
  await page!.waitForSelector("#a-room");
  await page!.selectOption("#a-room", "room-other");
  await page!.click("#modal-confirm");
  await expect.poll(() => writes.length).toBe(4);
  expect(writes[3]?.body).toMatchObject({ roomId: "room-other", barcode: "DUP-001" });

  await page!.reload({ waitUntil: "networkidle" });
  await page!.evaluate(() => {
    (window as unknown as { __roomEquipmentOpenAddAssetRoom(): void }).__roomEquipmentOpenAddAssetRoom();
  });
  await page!.waitForSelector("#ar-name");
  expect(await page!.locator("#ar-linked-room").count()).toBe(0);
  await page!.fill("#ar-name", "New Physical Room");
  await page!.click("#modal-confirm");
  await expect.poll(() => writes.length).toBe(5);
  expect(writes[4]).toMatchObject({
    method: "POST",
    path: "/api/groups/group-a/inventory/asset-rooms",
    requestedWith: "XMLHttpRequest",
    body: { name: "New Physical Room" },
  });
  expect(writes[4]?.body).not.toHaveProperty("linkedRoomId");
  expect(pageErrors).toEqual([]);
}, 60_000);

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
  expect(await page!.locator("#room-view-reservations").count()).toBe(0);
  await page!.setViewportSize({ width: 390, height: 844 });
  expect(await page!.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await page!.textContent("#room-barcodes-panel")).toContain("ASSET-001");

  await page!.focus("#room-barcodes-toggle");
  await page!.keyboard.press("Enter");
  expect(await page!.$eval("#room-barcodes-panel", (element) => element.hidden)).toBe(true);
  expect(await page!.evaluate(() => document.activeElement?.closest("#room-barcodes-panel") === null)).toBe(true);
  expect(writes).toEqual([]);

  await page!.goto(`${fixtureUrl}?instruments=view&role=reader`, { waitUntil: "networkidle" });
  await page!.waitForSelector('[data-instrument-id="inst-main"]');
  expect(await page!.locator('[data-instrument-id="inst-main"] .asset-actions button').allTextContents()).not.toContain("Edit");
  expect(await page!.locator('[data-instrument-id="inst-main"] .asset-actions button').isEnabled()).toBe(true);
  expect(await page!.locator('[data-instrument-id="inst-name-only"] .asset-actions button').isDisabled()).toBe(true);
  await page!.locator('[data-instrument-id="inst-main"] .asset-actions button').click();
  await page!.waitForSelector("#b-date");
  expect(await page!.textContent("#modal-title")).toContain("Book");
  await page!.click("#modal-cancel");
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
}, 40_000);

it("lets a reader book a structured foreign-lab room without a local inventory document", async () => {
  await page!.goto(`${fixtureUrl}?instruments=view&role=reader`, { waitUntil: "networkidle" });
  await page!.waitForSelector('[data-instrument-id="inst-foreign-bookable"]');
  const foreignRoomIsLocal = await page!.evaluate(() => {
    const tree = (window as unknown as { __roomEquipmentTree(): { rooms: Array<{ id: string }> } }).__roomEquipmentTree();
    return tree.rooms.some((room) => room.id === "room-foreign-not-local");
  });
  expect(foreignRoomIsLocal).toBe(false);

  const foreignBookButton = page!.locator('[data-instrument-id="inst-foreign-bookable"] .asset-actions button');
  expect(await foreignBookButton.isEnabled()).toBe(true);
  expect(await page!.locator('[data-instrument-id="inst-foreign-unassigned"] .asset-actions button').isDisabled()).toBe(true);
  expect(await page!.locator('[data-instrument-id="inst-stale-room"] .asset-actions button').isDisabled()).toBe(true);
  expect(await page!.locator('[data-instrument-id="inst-freezer-room"] .asset-actions button').isDisabled()).toBe(true);
  await foreignBookButton.click();
  await page!.waitForSelector("#b-date");
  expect(await page!.textContent("#modal-title")).toContain("Book");
  await page!.fill("#b-date", "2099-03-02");
  await page!.fill("#b-start", "09:15");
  await page!.fill("#b-end", "10:45");
  await page!.fill("#b-note", "Foreign reader booking");
  await page!.click("#modal-confirm");
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    method: "POST",
    path: "/api/instruments/inst-foreign-bookable/bookings",
    requestedWith: "XMLHttpRequest",
    body: {
      date: "2099-03-02",
      startTime: "09:15",
      endTime: "10:45",
      note: "Foreign reader booking",
    },
  });
  await page!.waitForSelector("#b-date", { state: "detached" });
  expect(pageErrors).toEqual([]);
}, 40_000);

it("puts Rooms & equipment before Catalog and preserves navigation preferences", async () => {
  await page!.goto(`${fixtureUrl}?shell=1&design=bauhaus`, { waitUntil: "networkidle" });
  await page!.waitForSelector("#tab-catalog");
  await page!.waitForSelector("#tab-inventory");
  expect(await page!.textContent("#tab-catalog")).toContain("Catalog");
  expect(await page!.textContent("#tab-inventory")).toContain("Rooms & equipment");
  expect(await page!.$eval("#tab-inventory", (element) => element.compareDocumentPosition(
    document.querySelector("#tab-catalog")!,
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

it("does not let a late inventory fetch replace a newer canonical assignment broadcast", async () => {
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
  expect(await confirmedAssetRoomId()).toBe("room-main");
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
