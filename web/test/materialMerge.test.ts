import http from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page, type Request, type Route } from "playwright";

let vite: ViteDevServer | null = null;
let server: http.Server | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let fixtureUrl = "";
const pageErrors: string[] = [];
const requests: Array<{ method: string; path: string }> = [];

function record(request: Request): void {
  requests.push({ method: request.method(), path: new URL(request.url()).pathname });
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
    if (request.url?.split("?")[0] === "/material-merge") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Material merge fixture</title></head>
        <body><div id="app"></div><div id="toast-app"></div>
        <script type="module" src="/test/fixtures/materialMerge.ts"></script></body></html>`);
      return;
    }
    next();
  });
  server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/material-merge`;

  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = existsSync(chromium.executablePath())
      ? await chromium.launch({ headless: true, channel: "chromium" })
      : await chromium.launch({ headless: true, channel: "msedge" });
  }
  page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "log" || message.type() === "error") {
      console.log("BROWSER", message.text());
    }
  });

  await page.route("**/api/**", (route) => {
    record(route.request());
    return json(route, { error: "Unexpected API request" }, 500);
  });
  await page.route(/\/api\/groups\/group-a\/materials\/m-source$/, (route) => {
    record(route.request());
    return json(route, { material: { type: "chemical" } });
  });
  await page.route(/\/api\/groups\/group-a\/materials\?/, (route) => {
    record(route.request());
    return json(route, {
      materials: [
        {
          id: "m-target",
          groupId: "group-a",
          type: "chemical",
          name: "Acetone target",
          description: null,
          attributes: {},
          createdAt: 0,
          updatedAt: 0,
          archivedAt: null,
          counts: { products: 1, batches: 2, stocks: 2, locations: 1 },
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
  });
  await page.route("**/api/groups/group-a/materials/merge", (route) => {
    record(route.request());
    return json(route, {
      source: { id: "m-source", name: "Acetone source", archived: true },
      target: { id: "m-target", name: "Acetone target" },
      moved: { products: 1, batches: 1, stocks: 1 },
    });
  });
  await page.route("**/api/groups/group-a/stocks**", (route) => {
    record(route.request());
    return json(route, { stocks: [], total: 0, page: 1, limit: 25 });
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
  requests.length = 0;
  pageErrors.length = 0;
});

describe("material merge refresh", () => {
  it("refreshes both material and stock catalogs after a successful merge", async () => {
    await page!.goto(fixtureUrl, { waitUntil: "networkidle" });
    await page!.waitForSelector('[data-material-id="m-target"]');

    await page!.click('[data-material-id="m-target"]');
    await page!.click("#merge-confirm");

    await expect
      .poll(
        () =>
          requests.filter((request) => request.method === "GET" && request.path === "/api/groups/group-a/stocks").length,
        { timeout: 10_000 },
      )
      .toBe(1);

    expect(requests.some((request) => request.method === "POST" && request.path === "/api/groups/group-a/materials/merge")).toBe(true);
    expect(requests.some((request) => request.method === "GET" && request.path === "/api/groups/group-a/materials")).toBe(true);
    expect(requests.some((request) => request.method === "GET" && request.path === "/api/groups/group-a/stocks")).toBe(true);
    expect(pageErrors).toEqual([]);
  }, 20_000);
});
