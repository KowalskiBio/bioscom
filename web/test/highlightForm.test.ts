import http from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { HIGHLIGHT_COLOR_OPTIONS } from "../src/lib/highlight";

let vite: ViteDevServer | null = null;
let server: http.Server | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let fixtureUrl = "";
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
    if (request.url?.split("?")[0] === "/highlight-form") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Highlight form fixture</title>
        <link rel="stylesheet" href="/src/app.css"></head>
        <body>
          <div id="room-form"></div>
          <div id="container-form"></div>
          <div id="edit-container-form"></div>
          <div id="deep-freezer-form"></div>
          <div id="shelf-form"></div>
          <script type="module" src="/test/fixtures/highlightForm.ts"></script>
        </body></html>`);
      return;
    }
    next();
  });
  server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/highlight-form`;

  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = existsSync(chromium.executablePath())
      ? await chromium.launch({ headless: true, channel: "chromium" })
      : await chromium.launch({ headless: true, channel: "msedge" });
  }
  page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
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

describe("highlight selectors", () => {
  it("renders Default followed by backend options and updates add forms", async () => {
    await page!.goto(fixtureUrl, { waitUntil: "networkidle" });
    await page!.waitForSelector("#r-highlight");

    expect(await page!.locator('label[for="r-highlight"]').textContent()).toBe("Highlight stripe");
    expect(await page!.getAttribute("#r-highlight", "aria-describedby")).toBe("r-highlight-hint");
    expect(await page!.locator("#r-highlight-hint").isVisible()).toBe(true);
    expect(await page!.textContent("#r-highlight-hint")).toBe(
      "Default keeps current card styling. Choose No highlight to remove the stripe.",
    );
    expect(await page!.locator("#r-highlight option").evaluateAll((options) =>
      options.map((option) => ({ value: (option as HTMLOptionElement).value, label: option.textContent })),
    )).toEqual([
      { value: "default", label: "Default" },
      ...HIGHLIGHT_COLOR_OPTIONS,
    ]);

    await page!.selectOption("#r-highlight", "yellow");
    await page!.waitForFunction(() =>
      (globalThis as unknown as {
        __highlightForms?: { room: { highlightColor: string } };
      }).__highlightForms?.room.highlightColor === "yellow",
    );
    expect(await page!.inputValue("#r-highlight")).toBe("yellow");
    expect(await page!.textContent("#r-highlight option:checked")).toBe("Yellow");

    await page!.selectOption("#c-highlight", "none");
    await page!.waitForFunction(() =>
      (globalThis as unknown as {
        __highlightForms?: { addContainer: { highlightColor: string } };
      }).__highlightForms?.addContainer.highlightColor === "none",
    );
    expect(pageErrors).toEqual([]);
  }, 15_000);

  it("updates the edit-container prompt without adding the field to other prompts", async () => {
    expect(await page!.inputValue("#c-edit-highlight")).toBe("orange");
    await page!.selectOption("#c-edit-highlight", "default");
    await page!.waitForFunction(() =>
      (globalThis as unknown as {
        __highlightForms?: { editContainer: { highlightColor: string } };
      }).__highlightForms?.editContainer.highlightColor === "default",
    );
    await page!.selectOption("#c-edit-highlight", "none");
    await page!.waitForFunction(() =>
      (globalThis as unknown as {
        __highlightForms?: { editContainer: { highlightColor: string } };
      }).__highlightForms?.editContainer.highlightColor === "none",
    );

    expect(await page!.locator("#deep-freezer-form .highlight-select-group").count()).toBe(0);
    expect(await page!.locator("#shelf-form .highlight-select-group").count()).toBe(0);
    expect(pageErrors).toEqual([]);
  }, 15_000);
});
