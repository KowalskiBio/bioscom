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
let primerFormUrl = "";
const pageErrors: string[] = [];

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
    if (request.url?.split("?")[0] === "/modal-swap") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Modal renderer fixture</title></head>
        <body><div id="app"></div><script type="module" src="/test/fixtures/modalSwap.ts"></script></body></html>`);
      return;
    }
    if (request.url?.split("?")[0] === "/primer-form") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Primer form fixture</title></head>
        <body><div id="app"></div><script type="module" src="/test/fixtures/primerForm.ts"></script></body></html>`);
      return;
    }
    next();
  });
  server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/modal-swap`;
  primerFormUrl = `http://127.0.0.1:${address.port}/primer-form`;

  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = existsSync(chromium.executablePath())
      ? await chromium.launch({ headless: true, channel: "chromium" })
      : await chromium.launch({ headless: true, channel: "msedge" });
  }
  page = await browser.newPage({ viewport: { width: 800, height: 700 } });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{\"error\":\"Unexpected API request\"}" }),
  );
  await page.route("**/api/users/me/catalog-columns", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ columnsByType: defaultCatalogColumnSelections(), updatedAt: 0 }),
    }),
  );
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

describe("modal renderer", () => {
  it("replaces Settings with CatalogColumns when another component modal opens", async () => {
    await page!.goto(fixtureUrl, { waitUntil: "networkidle" });
    await page!.waitForSelector("#theme-picker");

    await page!.click("#btn-settings-catalog-columns");
    await page!.waitForSelector("#catalog-column-scope");
    await page!.waitForFunction(() => {
      const save = document.getElementById("catalog-columns-save");
      return save instanceof HTMLButtonElement && !save.disabled;
    });

    expect(await page!.textContent("#modal-title")).toBe("Package columns");
    expect(await page!.locator("#modal-body #theme-picker").count()).toBe(0);
    expect(await page!.locator("#modal-body #catalog-columns-save").isEnabled()).toBe(true);

    await page!.click(".catalog-column-save-actions .btn-secondary");
    await page!.waitForFunction(
      () => !document.getElementById("modal-overlay")?.classList.contains("active"),
    );
    expect(pageErrors).toEqual([]);
  }, 15_000);

  it("renders and updates the registry-driven primer target species input", async () => {
    await page!.goto(primerFormUrl, { waitUntil: "networkidle" });
    await page!.waitForSelector("#f-attr-target_species");
    expect(await page!.inputValue("#f-attr-sequence")).toBe("ACGT");
    expect(await page!.inputValue("#f-attr-target_species")).toBe("tobacco");

    await page!.fill("#f-attr-target_species", "human");
    await page!.waitForFunction(
      () => (globalThis as { __primerForm?: { attributes: Record<string, unknown> } }).__primerForm?.attributes.target_species === "human",
    );
    expect(pageErrors).toEqual([]);
  }, 15_000);
});
