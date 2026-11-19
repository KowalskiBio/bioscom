import http from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page, type Request, type Route } from "playwright";
import { defaultCatalogColumnSelections, type InventoryTree, type Room } from "@bioscom/shared";
import {
  autoAssignGridPositions,
  fillFreeGridSlots,
  gridCapacity,
  gridPositionsFitProblem,
  moveGridItem,
  sortByGridSlot,
} from "../../shared/src/grid";

let vite: ViteDevServer | null = null;
let httpServer: http.Server | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let fixtureUrl = "";

const pageErrors: string[] = [];
const writes: Array<{ method: string; path: string; body: unknown; requestedWith: string }> = [];

interface GridDimensions {
  rows: number;
  columns: number;
  hideEmptySlots?: boolean;
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

async function treeState(): Promise<{ tree: InventoryTree; version: number }> {
  return page!.evaluate(() => {
    const fixture = window as unknown as {
      __roomGridTree(): InventoryTree;
      __roomGridVersion(): number;
    };
    return { tree: fixture.__roomGridTree(), version: fixture.__roomGridVersion() };
  });
}

async function commitTree(tree: InventoryTree): Promise<{ tree: InventoryTree; version: number }> {
  const { version } = await treeState();
  const nextVersion = version + 1;
  await page!.evaluate(
    (payload) => {
      const fixture = window as unknown as {
        __roomGridApply(tree: InventoryTree, version: number): void;
      };
      fixture.__roomGridApply(payload.tree, payload.version);
    },
    { tree, version: nextVersion },
  );
  return { tree, version: nextVersion };
}

function findRoom(tree: InventoryTree, roomId: string): Room | undefined {
  return tree.rooms.find((room) => room.id === roomId);
}

async function handleGridSettings(route: Route, containerRoomId?: string): Promise<void> {
  record(route.request());
  const { rows, columns, hideEmptySlots = false } = bodyOf(route.request()) as GridDimensions;
  const { tree } = await treeState();

  if (containerRoomId === undefined) {
    let grid = tree.roomGrid;
    if (grid === undefined) {
      grid = {
        rows,
        columns,
        positions: autoAssignGridPositions(tree.rooms.map((room) => room.id), gridCapacity(rows, columns)),
      };
      tree.roomGrid = grid;
    } else {
      const problem = gridPositionsFitProblem(grid.positions, rows, columns);
      if (problem !== null) {
        await json(route, { error: problem }, 409);
        return;
      }
      const previousCapacity = gridCapacity(grid.rows, grid.columns);
      grid.rows = rows;
      grid.columns = columns;
      if (gridCapacity(rows, columns) > previousCapacity) {
        const filled = fillFreeGridSlots(
          tree.rooms.map((room) => room.id),
          grid.positions,
          gridCapacity(rows, columns),
        );
        if (Object.keys(filled).length > Object.keys(grid.positions).length) {
          grid.positions = filled;
        }
      }
    }
    grid.hideEmptySlots = hideEmptySlots;
    tree.rooms = sortByGridSlot(tree.rooms, grid.positions);
  } else {
    const room = findRoom(tree, containerRoomId);
    if (room === undefined) {
      await json(route, { error: "Room not found" }, 404);
      return;
    }
    let grid = room.containerGrid;
    if (grid === undefined) {
      grid = {
        rows,
        columns,
        positions: autoAssignGridPositions(
          (room.containers ?? []).map((container) => container.id),
          gridCapacity(rows, columns),
        ),
      };
      room.containerGrid = grid;
    } else {
      const problem = gridPositionsFitProblem(grid.positions, rows, columns);
      if (problem !== null) {
        await json(route, { error: problem }, 409);
        return;
      }
      const previousCapacity = gridCapacity(grid.rows, grid.columns);
      grid.rows = rows;
      grid.columns = columns;
      if (gridCapacity(rows, columns) > previousCapacity) {
        const filled = fillFreeGridSlots(
          (room.containers ?? []).map((container) => container.id),
          grid.positions,
          gridCapacity(rows, columns),
        );
        if (Object.keys(filled).length > Object.keys(grid.positions).length) {
          grid.positions = filled;
        }
      }
    }
    grid.hideEmptySlots = hideEmptySlots;
    room.containers = sortByGridSlot(room.containers ?? [], grid.positions);
  }

  await json(route, await commitTree(tree));
}

async function handleGridMove(route: Route, containerRoomId?: string): Promise<void> {
  record(route.request());
  const body = bodyOf(route.request()) as {
    roomId?: string;
    containerId?: string;
    slot: number;
  };
  const { tree } = await treeState();

  if (containerRoomId === undefined) {
    const grid = tree.roomGrid;
    if (grid === undefined || body.roomId === undefined) {
      await json(route, { error: "Room grid not configured" }, 404);
      return;
    }
    if (body.slot >= gridCapacity(grid.rows, grid.columns)) {
      await json(route, { error: "Slot outside capacity" }, 409);
      return;
    }
    grid.positions = moveGridItem(grid.positions, body.roomId, body.slot);
    tree.rooms = sortByGridSlot(tree.rooms, grid.positions);
  } else {
    const room = findRoom(tree, containerRoomId);
    const grid = room?.containerGrid;
    if (room === undefined || grid === undefined || body.containerId === undefined) {
      await json(route, { error: "Container grid not configured" }, 404);
      return;
    }
    if (body.slot >= gridCapacity(grid.rows, grid.columns)) {
      await json(route, { error: "Slot outside capacity" }, 409);
      return;
    }
    grid.positions = moveGridItem(grid.positions, body.containerId, body.slot);
    room.containers = sortByGridSlot(room.containers ?? [], grid.positions);
  }

  await json(route, await commitTree(tree));
}

async function handleDeleteContainerGrid(route: Route, roomId: string): Promise<void> {
  record(route.request());
  const { tree } = await treeState();
  const room = findRoom(tree, roomId);
  if (room === undefined) {
    await json(route, { error: "Room not found" }, 404);
    return;
  }

  delete room.containerGrid;
  await json(route, await commitTree(tree));
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
    if (request.url?.split("?")[0] === "/room-grid") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Room grid fixture</title></head>
        <body><div id="app"></div><div id="modal-app"></div><div id="toast-app"></div><script type="module" src="/test/fixtures/roomGrid.ts"></script></body></html>`);
      return;
    }
    next();
  });
  httpServer = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/room-grid`;

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
  await page.route("**/api/me", (route) =>
    json(route, {
      user: {
        uid: "synthetic-room-grid-user",
        name: "Synthetic Room Grid User",
        role: "member",
        groupId: "group-a",
        email: null,
      },
    }),
  );
  await page.route("**/api/groups/group-a/backups", (route) => json(route, { backups: [] }));
  await page.route("**/api/groups/group-a/history", (route) => json(route, { history: [] }));
  await page.route("**/api/instruments", (route) => json(route, { instruments: [] }));
  await page.route("**/api/groups/group-a/inventory", async (route) => json(route, await treeState()));

  await page.route("**/api/groups/group-a/inventory/room-grid", (route) => {
    if (route.request().method() !== "PUT") return json(route, { ok: true });
    return handleGridSettings(route);
  });
  await page.route("**/api/groups/group-a/inventory/room-grid/move", (route) => {
    if (route.request().method() !== "POST") return json(route, { ok: true });
    return handleGridMove(route);
  });
  await page.route("**/api/groups/group-a/inventory/rooms/room-main/container-grid", (route) => {
    if (route.request().method() === "PUT") return handleGridSettings(route, "room-main");
    if (route.request().method() === "DELETE") return handleDeleteContainerGrid(route, "room-main");
    return json(route, { ok: true });
  });
  await page.route("**/api/groups/group-a/inventory/rooms/room-main/container-grid/move", (route) => {
    if (route.request().method() !== "POST") return json(route, { ok: true });
    return handleGridMove(route, "room-main");
  });
}, 30_000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  if (httpServer !== null) {
    await new Promise<void>((resolve, reject) => {
      httpServer!.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
  await vite?.close();
});

beforeEach(() => {
  writes.length = 0;
  pageErrors.length = 0;
});

async function gotoFixture(params: Record<string, string> = {}): Promise<void> {
  await page!.setViewportSize({ width: 1100, height: 900 });
  const query = new URLSearchParams(params).toString();
  await page!.goto(`${fixtureUrl}${query === "" ? "" : `?${query}`}`, { waitUntil: "networkidle" });
  await page!.waitForSelector("body[data-design]");
}

function slotItem(boardId: string, slot: number) {
  return page!.locator(`#${boardId} [data-slot-index="${slot}"] [data-grid-item-id]`);
}

async function slotItemId(boardId: string, slot: number): Promise<string | null> {
  return slotItem(boardId, slot).getAttribute("data-grid-item-id");
}

async function slotIndices(boardId: string): Promise<number[]> {
  return page!.$$eval(`#${boardId} [data-slot-index]`, (nodes) =>
    nodes.map((node) => Number(node.getAttribute("data-slot-index"))),
  );
}

interface SlotGeometry {
  slot: number;
  itemId: string | null;
  row: string;
  column: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function occupiedGeometry(boardId: string): Promise<SlotGeometry[]> {
  return page!.$$eval(`#${boardId} .grid-slot.occupied`, (nodes) =>
    nodes.map((node) => {
      const element = node as HTMLElement;
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        slot: Number(element.dataset.slotIndex),
        itemId: element.querySelector<HTMLElement>("[data-grid-item-id]")?.dataset.gridItemId ?? null,
        row: style.gridRowStart,
        column: style.gridColumnStart,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    }),
  );
}

async function slotBounds(boardId: string, slot: number) {
  const bounds = await page!.locator(`#${boardId} [data-slot-index="${slot}"]`).boundingBox();
  expect(bounds).not.toBeNull();
  return bounds!;
}

async function assertSameRowSlotSizes(boardId: string, occupied: number, empty: number): Promise<void> {
  const occupiedBounds = await slotBounds(boardId, occupied);
  const emptyBounds = await slotBounds(boardId, empty);
  expect(Math.abs(occupiedBounds.width - emptyBounds.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(occupiedBounds.height - emptyBounds.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(occupiedBounds.x - emptyBounds.x)).toBeGreaterThan(1);
  expect(Math.abs(occupiedBounds.y - emptyBounds.y)).toBeLessThanOrEqual(1);

  const occupiedContent = await page!.locator(`#${boardId} [data-slot-index="${occupied}"] .grid-item`).boundingBox();
  const emptyContent = await page!.locator(`#${boardId} [data-slot-index="${empty}"] .empty-slot`).boundingBox();
  expect(occupiedContent).not.toBeNull();
  expect(emptyContent).not.toBeNull();
  expect(Math.abs(occupiedContent!.width - emptyContent!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(occupiedContent!.height - emptyContent!.height)).toBeLessThanOrEqual(1);
}

async function assertRowsAlign(boardId: string, first: number, second: number): Promise<void> {
  const firstBounds = await slotBounds(boardId, first);
  const secondBounds = await slotBounds(boardId, second);
  expect(Math.abs(firstBounds.width - secondBounds.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(firstBounds.x - secondBounds.x)).toBeLessThanOrEqual(1);
}

async function dragItem(boardId: string, itemId: string, slot: number): Promise<void> {
  await page!.evaluate(
    ({ boardId: id, itemId: item, slot: targetSlot }) => {
      const root = document.getElementById(id);
      const source = root?.querySelector(`[data-grid-item-id="${item}"]`);
      const target = root?.querySelector(`[data-slot-index="${targetSlot}"]`);
      if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
        throw new Error(`Missing drag source ${item} or slot ${targetSlot}`);
      }
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
      source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));
    },
    { boardId, itemId, slot },
  );
}

async function focusedGridItem(): Promise<string | null> {
  return page!.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement ? (active.dataset.gridItemId ?? null) : null;
  });
}

async function assertStreamlinedBoard(boardId: string, title: string): Promise<void> {
  expect(await page!.getAttribute(`#${boardId}`, "aria-label")).toBe(title);
  expect(await page!.getAttribute(`#${boardId} .grid-board-grid`, "aria-label")).toBe(title);
  expect(await page!.locator(`#${boardId} .grid-board-header`).count()).toBe(0);
  expect(await page!.locator(`#${boardId} .grid-board-title`).count()).toBe(0);
  expect(await page!.locator(`#${boardId} .grid-board-size`).count()).toBe(0);
  expect(await page!.locator(`#${boardId} .grid-board-help`).count()).toBe(0);
  expect(await page!.locator(`#${boardId}-movement-help`).count()).toBe(0);
  expect(await page!.textContent(`#${boardId}`)).not.toContain("Drag items to a slot");

  const occupiedStyle = await page!.$eval(`#${boardId} .grid-slot.occupied`, (element) => {
    const style = getComputedStyle(element);
    return {
      borderColor: style.borderTopColor,
      background: style.backgroundColor,
      shadow: style.boxShadow,
    };
  });
  expect(occupiedStyle).toEqual({
    borderColor: "rgba(0, 0, 0, 0)",
    background: "rgba(0, 0, 0, 0)",
    shadow: "none",
  });
}

async function assertBoardAt390(boardId: string, design: "original" | "bauhaus", hideEmpty = false): Promise<void> {
  await page!.setViewportSize({ width: 390, height: 844 });
  await page!.waitForSelector(`#${boardId}`);
  expect(await page!.$eval("body", (body) => body.dataset.design)).toBe(design);
  expect(await page!.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await assertStreamlinedBoard(boardId, boardId === "room-grid-board" ? "Room grid" : "Container grid");
  expect(await slotIndices(boardId)).toEqual(hideEmpty ? [0, 1, 3] : [0, 1, 2, 3, 4, 5]);
  if (!hideEmpty) {
    await assertSameRowSlotSizes(boardId, 0, 2);
    await assertSameRowSlotSizes(boardId, 3, 4);
    await assertRowsAlign(boardId, 0, 3);
  }

  const scroll = await page!.$eval(`#${boardId} .grid-board-scroll`, (element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);

  const occupiedRadius = await page!.$eval(
    `#${boardId} .grid-slot.occupied`,
    (element) => getComputedStyle(element).borderRadius,
  );
  if (design === "bauhaus") {
    expect(occupiedRadius).toBe("0px");
  } else {
    expect(occupiedRadius).not.toBe("0px");
  }

  const itemSelector = `#${boardId} .grid-slot.occupied [data-grid-item-id]`;
  await page!.focus(itemSelector);
  await page!.keyboard.press("Shift");
  const focusStyle = await page!.$eval(itemSelector, (element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      shadow: style.boxShadow,
    };
  });
  expect(focusStyle).toEqual({
    outlineStyle: "solid",
    outlineWidth: design === "bauhaus" ? "2px" : "3px",
    outlineColor: design === "bauhaus" ? "rgb(29, 79, 162)" : "rgb(14, 165, 233)",
    outlineOffset: design === "bauhaus" ? "2px" : "3px",
    shadow: "none",
  });

  const box = await page!.locator(`#${boardId} [data-grid-item-id]`).first().boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThan(0);
}

describe("room grid", () => {
  it("creates and updates the room grid while enforcing the hard five-column cap", async () => {
    await gotoFixture({ view: "rooms", roomGrid: "off" });
    expect(await page!.locator("#view-rooms .view-header-actions #btn-room-grid").count()).toBe(1);
    expect(await page!.locator(".grid-view-actions").count()).toBe(0);
    await page!.click("#btn-room-grid");
    await page!.waitForSelector("#grid-rows");
    expect(await page!.getAttribute("#grid-columns", "max")).toBe("5");
    expect(await page!.textContent("#grid-movement-help")).toContain("Ctrl + an arrow key");
    expect(await page!.isChecked("#grid-hide-empty")).toBe(false);
    expect(await page!.textContent("#grid-hide-empty-help")).toContain("does not move or renumber placed items");
    expect(await page!.locator("#grid-settings-use-default").count()).toBe(0);

    await page!.fill("#grid-rows", "2");
    await page!.fill("#grid-columns", "6");
    expect(await page!.$eval("#grid-columns", (input) => (input as HTMLInputElement).checkValidity())).toBe(false);
    await page!.click("#grid-settings-save");
    await page!.waitForTimeout(100);
    expect(writes).toEqual([]);

    // Bypass the browser's native max constraint to prove the component guard
    // also rejects six columns without sending a request.
    await page!.$eval(".grid-settings", (form) =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await page!.waitForSelector("#grid-settings-error");
    expect(await page!.textContent("#grid-settings-error")).toContain("1 to 5");
    expect(writes).toEqual([]);

    await page!.fill("#grid-columns", "3");
    await page!.click("#grid-settings-save");
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      method: "PUT",
      path: "/api/groups/group-a/inventory/room-grid",
      requestedWith: "XMLHttpRequest",
      body: { rows: 2, columns: 3, hideEmptySlots: false },
    });
    await page!.waitForSelector("#grid-rows", { state: "detached" });
    await page!.waitForSelector("#room-grid-board");
    await assertStreamlinedBoard("room-grid-board", "Room grid");
    expect(await page!.getAttribute("#room-grid-board .grid-board-grid", "aria-rowcount")).toBe("2");
    expect(await page!.getAttribute("#room-grid-board .grid-board-grid", "aria-colcount")).toBe("3");

    await page!.click("#btn-room-grid");
    await page!.waitForSelector("#grid-rows");
    expect(await page!.inputValue("#grid-rows")).toBe("2");
    expect(await page!.inputValue("#grid-columns")).toBe("3");
    expect(await page!.isChecked("#grid-hide-empty")).toBe(false);
    expect(await page!.locator("#grid-settings-use-default").count()).toBe(0);
    await page!.fill("#grid-rows", "3");
    await page!.fill("#grid-columns", "5");
    await page!.click("#grid-settings-save");
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toEqual({
      method: "PUT",
      path: "/api/groups/group-a/inventory/room-grid",
      requestedWith: "XMLHttpRequest",
      body: { rows: 3, columns: 5, hideEmptySlots: false },
    });
    await page!.waitForSelector("#grid-rows", { state: "detached" });
    await expect.poll(() => page!.getAttribute("#room-grid-board .grid-board-grid", "aria-rowcount")).toBe("3");
    expect(await page!.getAttribute("#room-grid-board .grid-board-grid", "aria-colcount")).toBe("5");
    expect(await page!.locator("#room-grid-board [data-slot-index]").count()).toBe(15);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("renders row-major slots, empty slots, and keeps the deep-freezer rail separate", async () => {
    await gotoFixture({ view: "rooms" });
    await page!.waitForSelector("#room-grid-board");
    await assertStreamlinedBoard("room-grid-board", "Room grid");

    expect(await slotIndices("room-grid-board")).toEqual([0, 1, 2, 3, 4, 5]);
    expect(await slotItemId("room-grid-board", 0)).toBe("room-main");
    expect(await slotItemId("room-grid-board", 1)).toBe("room-b");
    expect(await slotItemId("room-grid-board", 3)).toBe("room-c");
    expect(await page!.locator('#room-grid-board [data-slot-index="2"] .empty-slot').count()).toBe(1);
    expect(await page!.locator('#room-grid-board [data-slot-index="4"] .empty-slot').count()).toBe(1);
    expect(await page!.locator('#room-grid-board [data-slot-index="5"] .empty-slot').count()).toBe(1);
    await assertSameRowSlotSizes("room-grid-board", 0, 2);
    await assertSameRowSlotSizes("room-grid-board", 3, 4);
    await assertRowsAlign("room-grid-board", 0, 3);

    expect(await page!.locator("#deepfreezers-rail #df-card-freezer-root").count()).toBe(1);
    expect(await page!.locator('#room-grid-board [data-grid-item-id="freezer-root"]').count()).toBe(0);
    expect(await page!.textContent("#room-grid-board")).not.toContain("Standalone Root Freezer");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("persists hide-empty without repacking rooms and restores all empty slots when toggled back", async () => {
    await gotoFixture({ view: "rooms" });
    await page!.waitForSelector("#room-grid-board");
    const originalGeometry = await occupiedGeometry("room-grid-board");
    const originalPositions = {
      "room-main": 0,
      "room-b": 1,
      "room-c": 3,
    };

    await page!.click("#btn-room-grid");
    await page!.waitForSelector("#grid-hide-empty");
    expect(await page!.isChecked("#grid-hide-empty")).toBe(false);
    expect(await page!.locator("#grid-settings-use-default").count()).toBe(0);
    await page!.check("#grid-hide-empty");
    await page!.click("#grid-settings-save");
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      method: "PUT",
      path: "/api/groups/group-a/inventory/room-grid",
      requestedWith: "XMLHttpRequest",
      body: { rows: 2, columns: 3, hideEmptySlots: true },
    });
    await page!.waitForSelector("#grid-rows", { state: "detached" });
    await expect.poll(() => slotIndices("room-grid-board")).toEqual([0, 1, 3]);
    expect(await occupiedGeometry("room-grid-board")).toEqual(originalGeometry);
    expect(await page!.locator("#room-grid-board .empty-slot").count()).toBe(0);
    expect(await slotItemId("room-grid-board", 0)).toBe("room-main");
    expect(await slotItemId("room-grid-board", 1)).toBe("room-b");
    expect(await slotItemId("room-grid-board", 3)).toBe("room-c");
    expect(await page!.getAttribute('#room-grid-board [data-slot-index="3"]', "aria-rowindex")).toBe("2");
    expect(await page!.getAttribute('#room-grid-board [data-slot-index="3"]', "aria-colindex")).toBe("1");
    expect(await page!.getAttribute('#room-grid-board [data-grid-item-id="room-c"]', "aria-label")).toBe("Open room Gamma Room");
    expect(await page!.getAttribute('#room-grid-board [data-grid-item-id="room-c"]', "aria-keyshortcuts")).toContain("Control+ArrowRight");
    expect(await page!.locator('#room-grid-board .grid-overflow [data-grid-item-id="room-d"]').count()).toBe(1);
    expect((await treeState()).tree.roomGrid?.positions).toEqual(originalPositions);
    expect((await treeState()).tree.roomGrid?.hideEmptySlots).toBe(true);

    // Slot 5 is hidden. Ctrl+ArrowRight must not move Gamma Room out of view.
    await page!.focus('#room-grid-board [data-grid-item-id="room-c"]');
    await page!.keyboard.press("Control+ArrowRight");
    await page!.waitForTimeout(100);
    expect(writes.length).toBe(1);
    expect(await slotItemId("room-grid-board", 3)).toBe("room-c");
    expect(await focusedGridItem()).toBe("room-c");

    await page!.click("#btn-room-grid");
    await page!.waitForSelector("#grid-hide-empty");
    expect(await page!.isChecked("#grid-hide-empty")).toBe(true);
    await page!.uncheck("#grid-hide-empty");
    await page!.click("#grid-settings-save");
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toEqual({
      method: "PUT",
      path: "/api/groups/group-a/inventory/room-grid",
      requestedWith: "XMLHttpRequest",
      body: { rows: 2, columns: 3, hideEmptySlots: false },
    });
    await page!.waitForSelector("#grid-rows", { state: "detached" });
    await expect.poll(() => slotIndices("room-grid-board")).toEqual([0, 1, 2, 3, 4, 5]);
    expect(await occupiedGeometry("room-grid-board")).toEqual(originalGeometry);
    expect(await page!.locator("#room-grid-board .empty-slot").count()).toBe(3);
    expect((await treeState()).tree.roomGrid?.positions).toEqual(originalPositions);
    expect((await treeState()).tree.roomGrid?.hideEmptySlots).toBe(false);

    await page!.click("#btn-room-grid");
    await page!.waitForSelector("#grid-hide-empty");
    expect(await page!.isChecked("#grid-hide-empty")).toBe(false);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("swaps two rooms by drag/drop and moves a room into an empty slot", async () => {
    await gotoFixture({ view: "rooms" });
    await page!.waitForSelector("#room-grid-board");

    await dragItem("room-grid-board", "room-main", 1);
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      method: "POST",
      path: "/api/groups/group-a/inventory/room-grid/move",
      requestedWith: "XMLHttpRequest",
      body: { roomId: "room-main", slot: 1 },
    });
    await expect.poll(() => slotItemId("room-grid-board", 1)).toBe("room-main");
    expect(await slotItemId("room-grid-board", 0)).toBe("room-b");

    await dragItem("room-grid-board", "room-c", 2);
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toEqual({
      method: "POST",
      path: "/api/groups/group-a/inventory/room-grid/move",
      requestedWith: "XMLHttpRequest",
      body: { roomId: "room-c", slot: 2 },
    });
    await expect.poll(() => slotItemId("room-grid-board", 2)).toBe("room-c");
    expect(await page!.locator('#room-grid-board [data-slot-index="3"] .empty-slot').count()).toBe(1);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("moves a room with Ctrl+Arrow and restores focus to it", async () => {
    await gotoFixture({ view: "rooms" });
    await page!.waitForSelector("#room-grid-board");

    await page!.focus('#room-grid-board [data-grid-item-id="room-main"]');
    await page!.keyboard.press("Control+ArrowRight");
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      method: "POST",
      path: "/api/groups/group-a/inventory/room-grid/move",
      requestedWith: "XMLHttpRequest",
      body: { roomId: "room-main", slot: 1 },
    });
    await expect.poll(() => slotItemId("room-grid-board", 1)).toBe("room-main");
    await expect.poll(focusedGridItem).toBe("room-main");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("lists unpositioned rooms in the overflow strip and lets them join the grid", async () => {
    await gotoFixture({ view: "rooms" });
    await page!.waitForSelector("#room-grid-board .grid-overflow");

    const overflow = page!.locator("#room-grid-board .grid-overflow");
    expect(await overflow.textContent()).toContain("Unplaced rooms");
    expect(await overflow.locator("[data-grid-item-id]").count()).toBe(1);
    expect(await overflow.locator('[data-grid-item-id="room-d"]').count()).toBe(1);

    await dragItem("room-grid-board", "room-d", 2);
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      method: "POST",
      path: "/api/groups/group-a/inventory/room-grid/move",
      requestedWith: "XMLHttpRequest",
      body: { roomId: "room-d", slot: 2 },
    });
    await expect.poll(() => slotItemId("room-grid-board", 2)).toBe("room-d");
    await expect.poll(() => page!.locator("#room-grid-board .grid-overflow").count()).toBe(0);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("hides grid mutation controls and requests from readers", async () => {
    await gotoFixture({ view: "rooms", role: "reader" });
    await page!.waitForSelector("#room-grid-board");

    expect(await page!.locator("#btn-room-grid").count()).toBe(0);
    await assertStreamlinedBoard("room-grid-board", "Room grid");
    expect(await page!.locator('#room-grid-board [data-grid-item-id="room-main"]').getAttribute("draggable")).not.toBe("true");

    await page!.focus('#room-grid-board [data-grid-item-id="room-main"]');
    await page!.keyboard.press("Control+ArrowRight");
    await dragItem("room-grid-board", "room-main", 1);
    await page!.waitForTimeout(150);
    expect(writes).toEqual([]);
    expect(await slotItemId("room-grid-board", 0)).toBe("room-main");
    expect(pageErrors).toEqual([]);
  }, 40_000);
});

describe("container grid", () => {
  it("creates and updates the container grid while enforcing the five-column cap", async () => {
    await gotoFixture({ view: "containers", containerGrid: "off" });
    await page!.waitForSelector("#btn-container-grid");
    expect(await page!.locator("#view-containers .view-header-actions #btn-container-grid").count()).toBe(1);
    expect(await page!.locator(".grid-view-actions").count()).toBe(0);
    expect(await page!.locator("#containers-split").count()).toBe(1);

    await page!.click("#btn-container-grid");
    await page!.waitForSelector("#grid-rows");
    expect(await page!.getAttribute("#grid-columns", "max")).toBe("5");
    expect(await page!.textContent("#grid-movement-help")).toContain("drag items to a slot");
    expect(await page!.isChecked("#grid-hide-empty")).toBe(false);
    expect(await page!.locator("#grid-settings-use-default").count()).toBe(1);
    expect(await page!.textContent("#grid-default-view-help")).toContain("Containers are not deleted");

    await page!.fill("#grid-rows", "2");
    await page!.fill("#grid-columns", "6");
    expect(await page!.$eval("#grid-columns", (input) => (input as HTMLInputElement).checkValidity())).toBe(false);
    await page!.click("#grid-settings-save");
    await page!.waitForTimeout(100);
    expect(writes).toEqual([]);

    // Bypass the browser's native max constraint to prove the component guard
    // also rejects six columns without sending a request.
    await page!.$eval(".grid-settings", (form) =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await page!.waitForSelector("#grid-settings-error");
    expect(await page!.textContent("#grid-settings-error")).toContain("1 to 5");
    expect(writes).toEqual([]);

    await page!.fill("#grid-columns", "3");
    await page!.click("#grid-settings-save");
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      method: "PUT",
      path: "/api/groups/group-a/inventory/rooms/room-main/container-grid",
      requestedWith: "XMLHttpRequest",
      body: { rows: 2, columns: 3, hideEmptySlots: false },
    });
    await page!.waitForSelector("#grid-rows", { state: "detached" });
    await page!.waitForSelector("#container-grid-board");
    await assertStreamlinedBoard("container-grid-board", "Container grid");
    expect(await page!.locator("#containers-split").count()).toBe(0);
    expect(await page!.getAttribute("#container-grid-board .grid-board-grid", "aria-rowcount")).toBe("2");
    expect(await page!.getAttribute("#container-grid-board .grid-board-grid", "aria-colcount")).toBe("3");

    await page!.click("#btn-container-grid");
    await page!.waitForSelector("#grid-rows");
    expect(await page!.inputValue("#grid-rows")).toBe("2");
    expect(await page!.inputValue("#grid-columns")).toBe("3");
    expect(await page!.isChecked("#grid-hide-empty")).toBe(false);
    expect(await page!.locator("#grid-settings-use-default").count()).toBe(1);
    await page!.fill("#grid-rows", "3");
    await page!.fill("#grid-columns", "5");
    await page!.click("#grid-settings-save");
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toEqual({
      method: "PUT",
      path: "/api/groups/group-a/inventory/rooms/room-main/container-grid",
      requestedWith: "XMLHttpRequest",
      body: { rows: 3, columns: 5, hideEmptySlots: false },
    });
    await page!.waitForSelector("#grid-rows", { state: "detached" });
    await expect.poll(() => page!.getAttribute("#container-grid-board .grid-board-grid", "aria-rowcount")).toBe("3");
    expect(await page!.getAttribute("#container-grid-board .grid-board-grid", "aria-colcount")).toBe("5");
    expect(await page!.locator("#container-grid-board [data-slot-index]").count()).toBe(15);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("replaces the Cabinet/Fridge/Freezer columns while keeping direct room chemicals visible", async () => {
    await gotoFixture({ view: "containers" });
    await page!.waitForSelector("#container-grid-board");
    await page!.waitForSelector("#room-direct-chemicals-table");
    await assertStreamlinedBoard("container-grid-board", "Container grid");

    expect(await page!.locator("#containers-split").count()).toBe(0);
    expect(await page!.locator("#cabinets-grid").count()).toBe(0);
    expect(await page!.locator("#fridges-grid").count()).toBe(0);
    expect(await page!.locator("#freezers-grid").count()).toBe(0);

    const boardText = await page!.textContent("#container-grid-board");
    expect(boardText).toContain("Main Cabinet");
    expect(boardText).toContain("Main Fridge");
    expect(boardText).toContain("Main Freezer");
    expect(await slotItemId("container-grid-board", 0)).toBe("c-cabinet");
    expect(await slotItemId("container-grid-board", 1)).toBe("c-fridge");
    expect(await slotItemId("container-grid-board", 3)).toBe("c-freezer");
    await assertSameRowSlotSizes("container-grid-board", 0, 2);
    await assertSameRowSlotSizes("container-grid-board", 3, 4);
    await assertRowsAlign("container-grid-board", 0, 3);

    expect(await page!.locator("#room-direct-chemicals").count()).toBe(1);
    expect(await page!.textContent("#room-direct-chemicals-table")).toContain("Direct room reagent");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("persists hide-empty and restores default columns with DELETE while preserving room contents", async () => {
    await gotoFixture({ view: "containers" });
    await page!.waitForSelector("#container-grid-board");
    const before = (await treeState()).tree;
    const beforeRoom = findRoom(before, "room-main")!;
    expect(beforeRoom.containers).toHaveLength(3);
    expect(beforeRoom.containers?.[0]?.shelves).toHaveLength(1);
    expect(beforeRoom.chemicals).toHaveLength(1);

    await page!.click("#btn-container-grid");
    await page!.waitForSelector("#grid-hide-empty");
    expect(await page!.isChecked("#grid-hide-empty")).toBe(false);
    await page!.check("#grid-hide-empty");
    await page!.click("#grid-settings-save");
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      method: "PUT",
      path: "/api/groups/group-a/inventory/rooms/room-main/container-grid",
      requestedWith: "XMLHttpRequest",
      body: { rows: 2, columns: 3, hideEmptySlots: true },
    });
    await page!.waitForSelector("#grid-rows", { state: "detached" });
    await expect.poll(() => slotIndices("container-grid-board")).toEqual([0, 1, 3]);
    expect(await slotItemId("container-grid-board", 0)).toBe("c-cabinet");
    expect(await slotItemId("container-grid-board", 1)).toBe("c-fridge");
    expect(await slotItemId("container-grid-board", 3)).toBe("c-freezer");
    expect((await treeState()).tree.rooms.find((room) => room.id === "room-main")?.containerGrid?.positions).toEqual({
      "c-cabinet": 0,
      "c-fridge": 1,
      "c-freezer": 3,
    });

    await page!.click("#btn-container-grid");
    await page!.waitForSelector("#grid-hide-empty");
    expect(await page!.isChecked("#grid-hide-empty")).toBe(true);
    expect(await page!.textContent("#grid-default-view-help")).toContain("Cabinet/Fridge/Freezer");
    expect(await page!.textContent("#grid-default-view-help")).toContain("Containers are not deleted");
    await page!.click("#grid-settings-use-default");
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toEqual({
      method: "DELETE",
      path: "/api/groups/group-a/inventory/rooms/room-main/container-grid",
      requestedWith: "XMLHttpRequest",
      body: null,
    });
    await page!.waitForSelector("#containers-split");
    await page!.waitForSelector("#container-grid-board", { state: "detached" });
    expect(await page!.textContent("#cabinets-grid")).toContain("Main Cabinet");
    expect(await page!.textContent("#fridges-grid")).toContain("Main Fridge");
    expect(await page!.textContent("#freezers-grid")).toContain("Main Freezer");
    expect(await page!.textContent("#room-direct-chemicals-table")).toContain("Direct room reagent");

    const after = (await treeState()).tree;
    const afterRoom = findRoom(after, "room-main")!;
    expect(afterRoom.containerGrid).toBeUndefined();
    expect(afterRoom.containers).toEqual(beforeRoom.containers);
    expect(afterRoom.chemicals).toEqual(beforeRoom.chemicals);
    expect(afterRoom.name).toBe(beforeRoom.name);
    expect(afterRoom.description).toBe(beforeRoom.description);
    expect(after.roomGrid).toEqual(before.roomGrid);
    expect(after.deepFreezers).toEqual(before.deepFreezers);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("moves containers by drag/drop and Ctrl+Arrow with exact requests", async () => {
    await gotoFixture({ view: "containers" });
    await page!.waitForSelector("#container-grid-board");

    await dragItem("container-grid-board", "c-cabinet", 2);
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      method: "POST",
      path: "/api/groups/group-a/inventory/rooms/room-main/container-grid/move",
      requestedWith: "XMLHttpRequest",
      body: { containerId: "c-cabinet", slot: 2 },
    });
    await expect.poll(() => slotItemId("container-grid-board", 2)).toBe("c-cabinet");
    expect(await page!.locator('#container-grid-board [data-slot-index="0"] .empty-slot').count()).toBe(1);

    await page!.focus('#container-grid-board [data-grid-item-id="c-freezer"]');
    await page!.keyboard.press("Control+ArrowRight");
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toEqual({
      method: "POST",
      path: "/api/groups/group-a/inventory/rooms/room-main/container-grid/move",
      requestedWith: "XMLHttpRequest",
      body: { containerId: "c-freezer", slot: 4 },
    });
    await expect.poll(() => slotItemId("container-grid-board", 4)).toBe("c-freezer");
    await expect.poll(focusedGridItem).toBe("c-freezer");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("keeps hidden-empty geometry and overflow usable at 390px in both themes", async () => {
    for (const design of ["original", "bauhaus"] as const) {
      await gotoFixture({ view: "containers", design, hideEmpty: "on" });
      await assertBoardAt390("container-grid-board", design, true);
      expect(await page!.locator("#container-grid-board .grid-overflow").count()).toBe(0);
      expect(await page!.getAttribute('#container-grid-board [data-grid-item-id="c-freezer"]', "aria-label")).toBe("Open container Main Freezer");
    }
    expect(pageErrors).toEqual([]);
  }, 60_000);

  it("keeps shared-assets on the legacy fallback with no grid button", async () => {
    await gotoFixture({ view: "containers", room: "shared-assets" });
    await page!.waitForSelector("#containers-split", { state: "attached" });

    expect(await page!.locator("#btn-container-grid").count()).toBe(0);
    expect(await page!.locator("#container-grid-board").count()).toBe(0);
    expect(await page!.locator("#cabinets-grid").count()).toBe(1);
    expect(await page!.locator("#fridges-grid").count()).toBe(1);
    expect(await page!.locator("#freezers-grid").count()).toBe(1);
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  }, 40_000);
});

describe("grid layout", () => {
  it("keeps the room grid inside a 390px document in both themes", async () => {
    for (const design of ["original", "bauhaus"] as const) {
      await gotoFixture({ view: "rooms", design });
      await assertBoardAt390("room-grid-board", design);
    }
    expect(pageErrors).toEqual([]);
  }, 60_000);

  it("keeps the container grid inside a 390px document in both themes", async () => {
    for (const design of ["original", "bauhaus"] as const) {
      await gotoFixture({ view: "containers", design });
      await assertBoardAt390("container-grid-board", design);
    }
    expect(pageErrors).toEqual([]);
  }, 60_000);
});
