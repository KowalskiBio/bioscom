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

const pageErrors: string[] = [];
const writes: Array<{ method: string; path: string; body: unknown }> = [];

function record(request: Request): void {
  let body: unknown;
  try {
    body = request.postDataJSON();
  } catch {
    body = request.postData() ?? null;
  }
  writes.push({ method: request.method(), path: new URL(request.url()).pathname, body });
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
    if (request.url?.split("?")[0] === "/container-type") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Container type fixture</title></head>
        <body><div id="app"></div><div id="modal-app"></div><div id="toast-app"></div><script type="module" src="/test/fixtures/roomEquipment.ts"></script></body></html>`);
      return;
    }
    next();
  });
  server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/container-type`;

  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = existsSync(chromium.executablePath())
      ? await chromium.launch({ headless: true, channel: "chromium" })
      : await chromium.launch({ headless: true, channel: "msedge" });
  }
  page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.setDefaultTimeout(10_000);
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
  await page.route("**/api/groups/group-a/stocks*", (route) =>
    json(route, { stocks: [], total: 0, page: 1, limit: 25 }),
  );
  await page.route("**/api/me", (route) => json(route, {
    user: {
      uid: "synthetic-container-type-user",
      name: "Synthetic Container Type User",
      role: "member",
      groupId: "group-a",
      email: null,
    },
  }));
  await page.route("**/api/groups/group-a/backups", (route) => json(route, { backups: [] }));
  await page.route("**/api/groups/group-a/history", (route) => json(route, { history: [] }));
  await page.route("**/api/groups/group-a/inventory", async (route) => {
    const tree = await page!.evaluate(() =>
      (window as unknown as { __roomEquipmentTree?: () => unknown }).__roomEquipmentTree?.(),
    );
    return json(route, { version: 1, tree });
  });
  await page.route("**/api/groups/group-a/inventory/containers", (route) => {
    record(route.request());
    return json(route, { id: "synthetic-new-container" }, 201);
  });
  await page.route("**/api/instruments", (route) => json(route, { instruments: [] }));
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
  writes.length = 0;
  pageErrors.length = 0;
});

async function gotoContainers(options: { design?: string; role?: string; roomId?: string } = {}): Promise<void> {
  const design = options.design ?? "original";
  const role = options.role ?? "member";
  const roomId = options.roomId ?? "room-main";
  await page!.goto(`${fixtureUrl}?design=${design}&role=${role}&shell=1#containers/${roomId}`, { waitUntil: "networkidle" });
  await page!.waitForSelector("#view-containers.active");
}

async function openContainerModal(): Promise<void> {
  await page!.click("#btn-add-container");
  await page!.waitForSelector("#c-type");
}

describe("add-container type selection", () => {
  for (const design of ["original", "bauhaus"] as const) {
    it(`replaces the old buttons and blocks an unselected submission in ${design}`, async () => {
      await gotoContainers({ design });
      expect(await page!.getByRole("button", { name: "Add Container", exact: true }).count()).toBe(1);
      expect(await page!.locator("#btn-add-cabinet, #btn-add-fridge, #btn-add-freezer").count()).toBe(0);

      await page!.focus("#btn-add-container");
      await page!.keyboard.press("Enter");
      await page!.waitForSelector("#c-type");
      expect(await page!.textContent("#modal-title")).toBe("Add Container");
      expect(await page!.textContent('label[for="c-type"]')).toBe("Container type *");
      expect(await page!.inputValue("#c-type")).toBe("");
      expect(await page!.$$("#c-type option").then((options) => Promise.all(options.map((option) => option.getAttribute("value")))))
        .toEqual(["", "cabinet", "fridge", "freezer"]);
      expect(await page!.locator("#c-system, #c-count-num, #c-count-alpha, #c-count, #c-door-count").count()).toBe(0);
      expect(await page!.locator("#c-highlight").isVisible()).toBe(true);
      expect(await page!.locator("#c-is-shared").isVisible()).toBe(true);

      await page!.fill("#c-name", "Untyped Container");
      await page!.click("#modal-confirm");
      await page!.locator(".toast.error", { hasText: "Select a container type." }).waitFor({ state: "visible" });
      expect(await page!.locator("#c-type").isVisible()).toBe(true);
      expect(await page!.evaluate(() => document.activeElement?.id)).toBe("c-type");
      expect(writes).toEqual([]);
      expect(pageErrors).toEqual([]);
    }, 30_000);
  }

  it("reveals the existing cabinet, fridge and freezer fields after selection", async () => {
    await gotoContainers();
    await openContainerModal();

    await page!.selectOption("#c-type", "cabinet");
    await page!.waitForSelector("#c-system");
    expect(await page!.locator("#c-count-num").isVisible()).toBe(true);
    expect(await page!.locator("#c-count, #c-door-count").count()).toBe(0);
    await page!.selectOption("#c-system", "alphabetical");
    await page!.waitForSelector("#c-count-alpha");
    expect(await page!.locator("#c-count-num").count()).toBe(0);
    await page!.selectOption("#c-system", "custom");
    await page!.waitForSelector("#c-custom-prefix");
    expect(await page!.locator("#c-custom-extra-names").isVisible()).toBe(true);
    await page!.click("#btn-add-custom-range");
    expect(await page!.locator("#c-custom-ranges-container .custom-range-row").count()).toBe(1);

    for (const type of ["fridge", "freezer"] as const) {
      await page!.selectOption("#c-type", type);
      await page!.waitForSelector("#c-count");
      expect(await page!.locator("#c-door-count").isVisible()).toBe(true);
      expect(await page!.locator("#c-system, #c-count-num, #c-count-alpha, #c-custom-prefix").count()).toBe(0);
      expect(await page!.getAttribute("#c-name", "placeholder")).toBe(`e.g. ${type === "fridge" ? "Fridge" : "Freezer"} 1`);
    }

    await page!.check("#c-is-shared");
    expect(await page!.locator("#c-share-wrap").isVisible()).toBe(true);
    await page!.selectOption("#c-highlight", "yellow");
    expect(await page!.inputValue("#c-highlight")).toBe("yellow");

    await page!.selectOption("#c-type", "");
    expect(await page!.locator("#c-system, #c-count, #c-door-count").count()).toBe(0);
    expect(pageErrors).toEqual([]);
  }, 30_000);

  it("submits the selected fridge configuration and keeps the typed success toast", async () => {
    await gotoContainers({ design: "bauhaus" });
    await openContainerModal();
    await page!.selectOption("#c-type", "fridge");
    await page!.fill("#c-name", "Cold Unit");
    await page!.fill("#c-count", "3");
    await page!.fill("#c-door-count", "2");
    await page!.selectOption("#c-highlight", "yellow");
    await page!.click("#modal-confirm");

    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      method: "POST",
      path: "/api/groups/group-a/inventory/containers",
      body: {
        roomId: "room-main",
        name: "Cold Unit",
        highlightColor: "yellow",
        type: "fridge",
        shelves: ["Shelf 1", "Shelf 2", "Shelf 3", "Door shelf 1", "Door shelf 2"],
      },
    });
    await page!.locator(".toast", { hasText: 'Fridge "Cold Unit" added' }).waitFor({ state: "visible" });
    await page!.waitForSelector("#c-type", { state: "detached" });
    expect(pageErrors).toEqual([]);
  }, 30_000);

  it("keeps reader access denial and hides the action in the virtual shared room", async () => {
    await gotoContainers({ role: "reader" });
    expect(await page!.locator("#btn-add-container").isVisible()).toBe(true);
    await page!.click("#btn-add-container");
    await page!.locator(".toast.error", { hasText: "Access Denied" }).waitFor({ state: "visible" });
    expect(await page!.locator("#c-type").count()).toBe(0);
    expect(writes).toEqual([]);

    await gotoContainers({ roomId: "shared-assets" });
    expect(await page!.locator("#btn-add-container").isVisible()).toBe(false);
    expect(await page!.locator("#c-type").count()).toBe(0);
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  }, 30_000);
});
