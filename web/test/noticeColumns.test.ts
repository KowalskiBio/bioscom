import http from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { NOTICE_COLUMNS_STORAGE_KEY } from "../src/lib/noticeColumns";
import { PROTOCOL_COLUMNS_STORAGE_KEY } from "../src/lib/protocol";

const NOTICES = [
  {
    id: "notice-suggestion",
    title: "🧪 Improve buffer station",
    content: "Add a labelled tray for freshly prepared buffers.",
    category: "suggestion",
    authorName: "Notice Test User",
    authorUid: "synthetic-notice-user",
    authorLab: "Notice Test Lab",
    timestamp: 400,
    reactions: {
      "reaction-1": {
        id: "reaction-1",
        text: "Looks good",
        timestamp: 401,
        userId: "synthetic-lab-mate",
        userName: "Lab Mate",
      },
    },
  },
  {
    id: "notice-issue",
    title: "Replace the balance label",
    content: "The label beside the analytical balance is peeling.",
    category: "issue",
    authorName: "Notice Test User",
    authorUid: "synthetic-notice-user",
    authorLab: "Notice Test Lab",
    timestamp: 300,
    reactions: {},
  },
  {
    id: "notice-info",
    title: "Friday clean-up",
    content: "The shared benches will be cleaned on Friday afternoon.",
    category: "info",
    authorName: "Notice Test User",
    authorUid: "synthetic-notice-user",
    authorLab: "Notice Test Lab",
    timestamp: 200,
    reactions: {},
  },
  {
    id: "notice-general",
    title: "A very long notice title that should wrap cleanly inside every selected column layout",
    content: "LongContentWithoutNaturalBreakpointsShouldNotForceTheNoticeCardOrPageBeyondTheAvailableViewportWidth",
    category: "general",
    authorName: "Notice Test User",
    authorUid: "synthetic-notice-user",
    authorLab: "Notice Test Lab",
    timestamp: 100,
    reactions: {},
  },
];

let vite: ViteDevServer | null = null;
let server: http.Server | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let fixtureUrl = "";
let noticesPayload: unknown = NOTICES;
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
    if (request.url?.split("?")[0] === "/notice-columns") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Notice columns fixture</title></head>
        <body><div id="app"></div><div id="toast-app"></div>
        <script type="module" src="/test/fixtures/noticeColumns.ts"></script></body></html>`);
      return;
    }
    next();
  });
  server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/notice-columns`;

  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = existsSync(chromium.executablePath())
      ? await chromium.launch({ headless: true, channel: "chromium" })
      : await chromium.launch({ headless: true, channel: "msedge" });
  }
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{\"error\":\"Unexpected API request\"}" }),
  );
  await page.route("**/api/notices", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notices: noticesPayload }) }),
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

beforeEach(async () => {
  pageErrors.length = 0;
  noticesPayload = NOTICES;
  await page!.setViewportSize({ width: 1280, height: 900 });
  await page!.goto(`${fixtureUrl}?design=original`, { waitUntil: "networkidle" });
  await page!.evaluate(
    ({ noticeKey, protocolKey }) => {
      localStorage.removeItem(noticeKey);
      localStorage.removeItem(protocolKey);
    },
    { noticeKey: NOTICE_COLUMNS_STORAGE_KEY, protocolKey: PROTOCOL_COLUMNS_STORAGE_KEY },
  );
  await page!.reload({ waitUntil: "networkidle" });
  await page!.waitForSelector('#view-noticeboard.active [data-notice-id="notice-suggestion"]');
});

async function waitForNoticeboard(): Promise<void> {
  await page!.waitForSelector('#view-noticeboard.active [data-notice-id="notice-suggestion"]');
}

async function gridTrackCount(): Promise<number> {
  return page!.$eval("#noticeboard-container", (grid) =>
    getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length,
  );
}

async function selectColumns(count: 1 | 2 | 3 | 4): Promise<void> {
  await page!.selectOption("#notice-columns", String(count));
  await page!.waitForSelector(`#noticeboard-container[data-columns="${count}"]`);
}

async function controlPresentation(kind: "notice" | "protocol"): Promise<Record<string, string>> {
  return page!.$eval(`#${kind}-columns`, (select) => {
    const label = document.querySelector(`label[for="${select.id}"]`);
    if (label === null) throw new Error(`Missing label for ${select.id}`);
    const selectStyle = getComputedStyle(select);
    const labelStyle = getComputedStyle(label);
    return {
      width: selectStyle.width,
      minHeight: selectStyle.minHeight,
      paddingTop: selectStyle.paddingTop,
      paddingBottom: selectStyle.paddingBottom,
      borderRadius: selectStyle.borderRadius,
      labelColor: labelStyle.color,
      labelFontSize: labelStyle.fontSize,
      labelFontWeight: labelStyle.fontWeight,
      labelTextTransform: labelStyle.textTransform,
    };
  });
}

describe("notice board column layout", () => {
  it("places Columns before Add Note in the header and keeps the selector out of the notice grid", async () => {
    const select = page!.locator("#view-noticeboard .view-header-actions #notice-columns");
    expect(await select.count()).toBe(1);
    expect(await page!.locator('label[for="notice-columns"]').textContent()).toBe("Columns");
    expect(await select.locator("option").allTextContents()).toEqual(["1", "2", "3", "4"]);
    expect(await select.inputValue()).toBe("1");
    expect(await page!.getAttribute("#noticeboard-container", "data-columns")).toBe("1");
    expect(await gridTrackCount()).toBe(1);

    const columnsPrecedeAdd = await page!.$eval("#view-noticeboard .view-header-actions", (actions) => {
      const columns = actions.querySelector("#notice-columns");
      const add = actions.querySelector("#btn-add-notice");
      return columns !== null && add !== null && (columns.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(columnsPrecedeAdd).toBe(true);
    expect(await page!.locator("#noticeboard-container #notice-columns").count()).toBe(0);
    expect(await page!.locator(".noticeboard-view #notice-columns").count()).toBe(0);

    const firstCard = page!.locator('[data-notice-id="notice-suggestion"]');
    expect((await firstCard.locator(".protocol-title").textContent())?.trim()).toBe("🧪 Improve buffer station");
    expect((await firstCard.locator(".notice-category-chip").textContent())?.trim()).toBe("💡 Suggestion");
    expect(await firstCard.locator(".notice-reactions-container").textContent()).toContain("Lab Mate");
    expect(await firstCard.locator(".notice-reactions-container").textContent()).toContain("Looks good");
    expect(await firstCard.locator('button[title="Edit"]').count()).toBe(1);
    expect(await firstCard.locator('button[title="Delete"]').count()).toBe(1);
    expect(await page!.locator("#noticeboard-container [data-notice-id]").count()).toBe(4);
    expect(pageErrors).toEqual([]);
  });

  it("selects 2, 3, and 4 columns and persists independently from protocols", async () => {
    await page!.evaluate((key) => localStorage.setItem(key, "4"), PROTOCOL_COLUMNS_STORAGE_KEY);
    await page!.reload({ waitUntil: "networkidle" });
    await waitForNoticeboard();
    expect(await page!.inputValue("#protocol-columns")).toBe("4");
    expect(await page!.inputValue("#notice-columns")).toBe("1");

    for (const count of [2, 3, 4] as const) {
      await selectColumns(count);
      expect(await gridTrackCount()).toBe(count);
      expect(await page!.evaluate((key) => localStorage.getItem(key), NOTICE_COLUMNS_STORAGE_KEY)).toBe(String(count));
      expect(await page!.evaluate((key) => localStorage.getItem(key), PROTOCOL_COLUMNS_STORAGE_KEY)).toBe("4");
    }

    await page!.reload({ waitUntil: "networkidle" });
    await waitForNoticeboard();
    expect(await page!.inputValue("#notice-columns")).toBe("4");
    expect(await page!.inputValue("#protocol-columns")).toBe("4");
    expect(await gridTrackCount()).toBe(4);
    expect(pageErrors).toEqual([]);
  });

  it("uses the protocol responsive fallbacks without overflowing or losing card controls", async () => {
    await selectColumns(4);
    expect(await gridTrackCount()).toBe(4);

    await page!.setViewportSize({ width: 1000, height: 900 });
    await expect.poll(gridTrackCount).toBe(2);
    await page!.setViewportSize({ width: 600, height: 900 });
    await expect.poll(gridTrackCount).toBe(1);
    await page!.setViewportSize({ width: 360, height: 740 });
    await expect.poll(gridTrackCount).toBe(1);

    const layout = await page!.evaluate(() => ({
      viewport: window.innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      cards: document.querySelectorAll("#noticeboard-container [data-notice-id]").length,
    }));
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.cards).toBe(4);
    expect(await page!.isVisible("#notice-columns")).toBe(true);
    const firstCard = page!.locator('[data-notice-id="notice-suggestion"]');
    expect(await firstCard.locator('button[title="Edit"]').count()).toBe(1);
    expect(await firstCard.locator('button[title="Delete"]').count()).toBe(1);
    expect(await firstCard.locator('button[title="Thumbs Up"]').count()).toBe(1);
    expect(await firstCard.locator('input[placeholder="Type a comment..."]').count()).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  for (const design of ["original", "bauhaus"] as const) {
    it(`matches the protocol control and card presentation in the ${design} theme`, async () => {
      await page!.goto(`${fixtureUrl}?design=${design}`, { waitUntil: "networkidle" });
      await waitForNoticeboard();
      await selectColumns(2);

      expect(await controlPresentation("notice")).toEqual(await controlPresentation("protocol"));
      expect(await gridTrackCount()).toBe(2);
      const firstCard = page!.locator('[data-notice-id="notice-suggestion"]');
      expect((await firstCard.locator(".protocol-title").textContent())?.trim()).toBe(
        design === "bauhaus" ? "Improve buffer station" : "🧪 Improve buffer station",
      );
      expect((await firstCard.locator(".notice-category-chip").textContent())?.trim()).toBe(
        design === "bauhaus" ? "Suggestion" : "💡 Suggestion",
      );
      if (design === "bauhaus") {
        expect(await page!.locator("#notice-columns").evaluate((element) => getComputedStyle(element).borderRadius)).toBe("0px");
        expect(await page!.locator(".notice-columns-label").evaluate((element) => getComputedStyle(element).textTransform)).toBe("uppercase");
        expect(await firstCard.locator('button[title="Thumbs Up"] .glyph-circle-blue').count()).toBe(1);
      } else {
        expect(await firstCard.locator('button[title="Thumbs Up"]').textContent()).toContain("👍");
      }
      expect(pageErrors).toEqual([]);
    });
  }

  it("hides the column selector when there are no notices", async () => {
    noticesPayload = [];
    await page!.reload({ waitUntil: "networkidle" });
    await page!.waitForSelector("#noticeboard-empty", { state: "visible" });
    expect(await page!.locator("#notice-columns").count()).toBe(0);
    expect(await page!.locator("#btn-add-notice").count()).toBe(1);
    expect(pageErrors).toEqual([]);
  });
});
