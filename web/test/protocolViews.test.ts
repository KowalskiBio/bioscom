import http from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { PROTOCOL_COLUMNS_STORAGE_KEY } from "../src/lib/protocol";

let vite: ViteDevServer | null = null;
let server: http.Server | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let fixtureUrl = "";
const pageErrors: string[] = [];
const requests: Array<{ method: string; path: string; body: unknown }> = [];
const describedContent = [
  "## Preparation",
  "",
  "- **Mix** the buffer",
  "- ~~Discard~~ incubate",
  "",
  "[Assay guide](https://example.test/protocol)",
  "",
  "<script>window.__protocolXss = true</script>",
  '<img src="x" onerror="window.__protocolXss = true">',
].join("\n");

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
    if (request.url?.split("?")[0] === "/protocols") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Protocols fixture</title></head>
        <body><div id="app"></div><div id="toast-app"></div>
        <script type="module" src="/test/fixtures/protocols.ts"></script></body></html>`);
      return;
    }
    next();
  });
  server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/protocols`;

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
  await page.route("**/api/groups/group-a/members", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{\"members\":[]}" }),
  );
  await page.route("**/api/notices", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{\"notices\":[]}" }),
  );
  await page.route("**/api/users/me/dashboard-dismissals", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{\"dismissals\":[],\"updatedAt\":0}" }),
  );
  await page.route("**/api/groups/group-a/inventory/protocols**", (route) => {
    const request = route.request();
    if (["POST", "PUT", "DELETE"].includes(request.method())) {
      requests.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
        body: request.method() === "DELETE" ? null : request.postDataJSON(),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
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

beforeEach(async () => {
  requests.length = 0;
  await page!.setViewportSize({ width: 1280, height: 900 });
  await page!.goto(fixtureUrl, { waitUntil: "networkidle" });
  await page!.waitForSelector('#view-protocols.active [data-protocol-id="protocol-described"]');
});

async function openAddForm(): Promise<void> {
  await page!.click("#btn-add-protocol");
  await page!.waitForSelector("#modal-overlay.active #p-title");
}

async function closeActiveModal(): Promise<void> {
  await page!.click("#modal-close");
  await page!.waitForSelector("#modal-overlay.active", { state: "detached" });
}

async function openContent(protocolId = "protocol-described"): Promise<void> {
  await page!.click(`[data-protocol-id="${protocolId}"]`);
  await page!.waitForSelector("#modal-overlay.active .protocol-detail");
}

async function solveDeleteCaptcha(): Promise<void> {
  const imageUrl = await page!.getAttribute('#modal-body img[alt="Frog"]', "src");
  const filename = decodeURIComponent(imageUrl?.split("/").pop()?.split("?")[0] ?? "");
  const frogName = filename.startsWith("pralesnicka-")
    ? "Phyllobates vittatus"
    : filename.replace(/\.[^.]+$/, "").replaceAll("_", " ");
  await page!.getByRole("button", { name: frogName, exact: true }).click();
}

async function gridTrackCount(): Promise<number> {
  return page!.$eval("#protocols-container", (grid) =>
    getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length,
  );
}

describe("protocol overview", () => {
  it("shows descriptions or safe Markdown content excerpts and renders tags as chips", async () => {
    const described = page!.locator('[data-protocol-id="protocol-described"]');
    expect((await described.locator(".protocol-title").textContent())?.trim()).toBe("Protein assay");
    expect((await described.locator(".protocol-description").textContent())?.trim()).toBe(
      "Quantify protein with a standard curve.",
    );
    expect(await described.locator(".protocol-content-fallback").count()).toBe(0);
    expect((await described.locator(".protocol-tag").allTextContents()).map((tag) => tag.trim())).toEqual([
      "assay",
      "protein",
      "buffer",
    ]);

    const fallback = page!.locator('[data-protocol-id="protocol-fallback"]');
    expect(await fallback.locator(".protocol-description").count()).toBe(0);
    expect((await fallback.locator(".protocol-content-fallback").textContent())?.trim()).toBe(
      "Quick start Prepare the sample, then follow the remaining steps carefully.",
    );
    expect(await fallback.locator(".protocol-tag").count()).toBe(2);

    const sanitized = page!.locator('[data-protocol-id="protocol-script"]');
    expect((await sanitized.locator(".protocol-content-fallback").textContent())?.trim()).toBe("Before after");
    expect(await sanitized.locator("script").count()).toBe(0);
    expect(await page!.evaluate(() => (window as unknown as { __protocolXss?: boolean }).__protocolXss)).toBeUndefined();
    expect(pageErrors).toEqual([]);
  });

  it("places Columns before Add Protocol in the header, removes the old toolbar, and persists the layout", async () => {
    expect(await page!.locator("#view-protocols .view-header-actions #protocol-columns").count()).toBe(1);
    const columnsPrecedeAdd = await page!.$eval("#view-protocols .view-header-actions", (actions) => {
      const columns = actions.querySelector("#protocol-columns");
      const add = actions.querySelector("#btn-add-protocol");
      return columns !== null && add !== null && (columns.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(columnsPrecedeAdd).toBe(true);
    expect(await page!.locator(".protocols-toolbar").count()).toBe(0);
    expect(await page!.locator(".protocols-view #protocol-columns").count()).toBe(0);

    await page!.evaluate((key) => localStorage.removeItem(key), PROTOCOL_COLUMNS_STORAGE_KEY);
    await page!.reload({ waitUntil: "networkidle" });
    expect(await page!.inputValue("#protocol-columns")).toBe("1");
    expect(await page!.getAttribute("#protocols-container", "data-columns")).toBe("1");
    expect(await gridTrackCount()).toBe(1);

    await page!.selectOption("#protocol-columns", "3");
    await page!.waitForSelector('#protocols-container[data-columns="3"]');
    expect(await gridTrackCount()).toBe(3);
    expect(await page!.evaluate((key) => localStorage.getItem(key), PROTOCOL_COLUMNS_STORAGE_KEY)).toBe("3");

    await page!.reload({ waitUntil: "networkidle" });
    expect(await page!.inputValue("#protocol-columns")).toBe("3");
    expect(await gridTrackCount()).toBe(3);

    await page!.selectOption("#protocol-columns", "4");
    expect(await gridTrackCount()).toBe(4);
    expect(await page!.evaluate((key) => localStorage.getItem(key), PROTOCOL_COLUMNS_STORAGE_KEY)).toBe("4");

    await page!.setViewportSize({ width: 1000, height: 900 });
    expect(await gridTrackCount()).toBe(2);
    await page!.setViewportSize({ width: 600, height: 900 });
    expect(await gridTrackCount()).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  it("opens full details as large, sanitized, non-editable rich text when a card is clicked", async () => {
    await openContent();

    expect((await page!.textContent("#modal-title"))?.trim()).toBe("Protein assay");
    const headerActions = page!.locator("#modal-overlay.active .modal-header-actions");
    expect(await headerActions.getByRole("button", { name: "Edit protocol Protein assay", exact: true }).count()).toBe(1);
    expect(await headerActions.getByRole("button", { name: "Remove protocol Protein assay", exact: true }).count()).toBe(1);
    expect(await headerActions.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual([
      "Edit protocol Protein assay",
      "Remove protocol Protein assay",
      "Close modal",
    ]);
    expect((await page!.textContent("#protocol-detail-description"))?.trim()).toBe("Quantify protein with a standard curve.");
    expect((await page!.locator("#protocol-detail-tags .protocol-detail-tag").allTextContents()).map((tag) => tag.trim())).toEqual([
      "assay",
      "protein",
      "buffer",
    ]);
    expect((await page!.textContent(".protocol-detail-content h2"))?.trim()).toBe("Preparation");
    expect((await page!.textContent(".protocol-detail-content strong"))?.trim()).toBe("Mix");
    expect((await page!.textContent(".protocol-detail-content del"))?.trim()).toBe("Discard");
    expect(await page!.getAttribute(".protocol-detail-content a", "href")).toBe("https://example.test/protocol");
    expect(await page!.locator(".protocol-detail-content script").count()).toBe(0);
    expect(await page!.locator(".protocol-detail-content img").getAttribute("onerror")).toBeNull();
    expect(await page!.evaluate(() => (window as unknown as { __protocolXss?: boolean }).__protocolXss)).toBeUndefined();
    expect(await page!.locator("#protocol-detail input, #protocol-detail textarea, #protocol-detail [contenteditable]").count()).toBe(0);
    expect(await page!.locator("#protocol-detail-content").getAttribute("tabindex")).toBe("0");
    const contentLayout = await page!.$eval("#protocol-detail-content", (element) => ({
      height: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(contentLayout.height).toBeGreaterThanOrEqual(320);
    expect(contentLayout.overflowY).toBe("auto");
    expect(await page!.locator("#p-title").count()).toBe(0);
    expect(await page!.isVisible("#modal-confirm")).toBe(false);
    expect(pageErrors).toEqual([]);
  }, 20_000);

  it("opens the read-only viewer with Enter and Space rather than the editor", async () => {
    for (const key of ["Enter", " "]) {
      const card = page!.locator('[data-protocol-id="protocol-described"]');
      await card.focus();
      await page!.keyboard.press(key);
      await page!.waitForSelector("#modal-overlay.active .protocol-detail");
      expect((await page!.textContent("#modal-title"))?.trim()).toBe("Protein assay");
      expect(await page!.locator("#p-title").count()).toBe(0);
      await closeActiveModal();
    }
    expect(pageErrors).toEqual([]);
  });

  it("opens a populated editor from detail Edit with the keyboard and retains Bauhaus styling", async () => {
    await page!.goto(`${fixtureUrl}?design=bauhaus`, { waitUntil: "networkidle" });
    await page!.waitForSelector('#view-protocols.active [data-protocol-id="protocol-described"]');
    await openContent();

    const headerActions = page!.locator("#modal-overlay.active .modal-header-actions");
    const edit = headerActions.getByRole("button", { name: "Edit protocol Protein assay", exact: true });
    const remove = headerActions.getByRole("button", { name: "Remove protocol Protein assay", exact: true });
    expect(await edit.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("0px");
    expect(await remove.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("0px");
    expect(await headerActions.getByRole("button", { name: "Close modal", exact: true }).evaluate((element) => getComputedStyle(element).borderRadius)).toBe("0px");

    await edit.press("Enter");
    await page!.waitForSelector("#modal-overlay.active #p-title");
    expect((await page!.textContent("#modal-title"))?.trim()).toBe("Edit Protocol");
    expect(await page!.locator(".protocol-detail").count()).toBe(0);
    expect(await page!.inputValue("#p-title")).toBe("Protein assay");
    expect(await page!.inputValue("#p-description")).toBe("Quantify protein with a standard curve.");
    expect(await page!.inputValue("#p-tags")).toBe("assay, protein, buffer");
    expect(await page!.inputValue("#p-content")).toBe(describedContent);
    expect(await page!.locator("#modal-overlay.active .modal-header-actions button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual(["Close modal"]);
    expect(requests).toEqual([]);
    expect(pageErrors).toEqual([]);
  }, 20_000);

  it("lets readers open read-only details without exposing Edit or Delete and retains Bauhaus styling", async () => {
    await page!.goto(`${fixtureUrl}?role=reader&design=bauhaus`, { waitUntil: "networkidle" });
    const card = page!.locator('[data-protocol-id="protocol-described"]');
    await card.waitFor();
    expect(await card.getAttribute("role")).toBe("button");
    expect(await card.getAttribute("tabindex")).toBe("0");
    expect(await card.evaluate((element) => getComputedStyle(element).cursor)).toBe("pointer");
    expect(await card.getByRole("button", { name: "Edit protocol Protein assay", exact: true }).count()).toBe(0);
    expect(await card.getByRole("button", { name: "Delete protocol Protein assay", exact: true }).count()).toBe(0);

    await card.click();
    await page!.waitForSelector("#modal-overlay.active .protocol-detail");
    expect((await page!.textContent("#modal-title"))?.trim()).toBe("Protein assay");
    const headerActions = page!.locator("#modal-overlay.active .modal-header-actions");
    expect(await headerActions.getByRole("button", { name: "Edit protocol Protein assay", exact: true }).count()).toBe(0);
    expect(await headerActions.getByRole("button", { name: "Remove protocol Protein assay", exact: true }).count()).toBe(0);
    expect(await headerActions.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual(["Close modal"]);
    expect(await page!.locator("#protocol-detail input, #protocol-detail textarea").count()).toBe(0);
    expect(await card.locator(".protocol-tag").first().evaluate((element) => getComputedStyle(element).borderRadius)).toBe(
      "0px",
    );
    expect(await page!.locator("#protocol-detail-content").evaluate((element) => getComputedStyle(element).borderRadius)).toBe("0px");
    expect(pageErrors).toEqual([]);
  });

  it("handles missing description, tags, and content gracefully in the viewer", async () => {
    await openContent("protocol-empty");
    expect((await page!.textContent("#modal-title"))?.trim()).toBe("Empty protocol");
    expect(await page!.locator("#protocol-detail-description").count()).toBe(0);
    expect(await page!.locator("#protocol-detail-tags").count()).toBe(0);
    expect((await page!.textContent(".protocol-detail-empty"))?.trim()).toBe("No content provided.");
    expect(await page!.locator("#protocol-detail input, #protocol-detail textarea").count()).toBe(0);
  });

  it("opens confirmation from detail Remove and only deletes after the CAPTCHA succeeds", async () => {
    await openContent();
    await page!.locator("#modal-overlay.active .modal-header-actions")
      .getByRole("button", { name: "Remove protocol Protein assay", exact: true })
      .click();
    await page!.waitForSelector("#modal-overlay.active");
    expect((await page!.textContent("#modal-title"))?.trim()).toBe("Delete Protocol");
    expect((await page!.textContent("#modal-body strong"))?.trim()).toBe("Protein assay");
    expect(await page!.locator(".protocol-detail").count()).toBe(0);
    expect(await page!.locator("#p-title").count()).toBe(0);
    expect(requests).toEqual([]);

    await page!.click("#modal-confirm");
    await page!.waitForSelector('#modal-overlay.active img[alt="Frog"]');
    expect(requests).toEqual([]);
    await solveDeleteCaptcha();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({
      method: "DELETE",
      path: "/api/groups/group-a/inventory/protocols/protocol-described",
      body: null,
    });
    await page!.waitForSelector("#modal-overlay.active", { state: "detached" });
    expect(pageErrors).toEqual([]);
  });

  it("opens delete confirmation without opening the viewer and completes the guarded delete", async () => {
    await page!.locator('[data-protocol-id="protocol-described"]')
      .getByRole("button", { name: "Delete protocol Protein assay", exact: true })
      .click();
    await page!.waitForSelector("#modal-overlay.active");
    expect((await page!.textContent("#modal-title"))?.trim()).toBe("Delete Protocol");
    expect(await page!.locator(".protocol-detail").count()).toBe(0);
    expect(await page!.locator("#p-title").count()).toBe(0);

    await page!.click("#modal-confirm");
    await page!.waitForSelector('#modal-overlay.active img[alt="Frog"]');
    expect(await page!.locator(".protocol-detail").count()).toBe(0);
    expect(requests).toEqual([]);
    await solveDeleteCaptcha();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({
      method: "DELETE",
      path: "/api/groups/group-a/inventory/protocols/protocol-described",
      body: null,
    });
    await page!.waitForSelector("#modal-overlay.active", { state: "detached" });
    expect(pageErrors).toEqual([]);
  });

  it("wraps long tags without horizontal overflow on narrow screens", async () => {
    await page!.setViewportSize({ width: 360, height: 740 });
    const layout = await page!.evaluate(() => {
      const tag = document.querySelector('[data-protocol-id="protocol-fallback"] .protocol-tag:last-child');
      return {
        viewport: window.innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        tagClientWidth: tag?.clientWidth ?? 0,
        tagScrollWidth: tag?.scrollWidth ?? 0,
      };
    });
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.tagClientWidth).toBeGreaterThan(0);
    expect(layout.tagScrollWidth).toBeLessThanOrEqual(layout.tagClientWidth);
    expect(await gridTrackCount()).toBe(1);
    expect(pageErrors).toEqual([]);
  });
});

describe("protocol form", () => {
  it("uses a large full-width editor without a live preview and submits parsed values", async () => {
    await openAddForm();
    const content = [
      "## Preparation",
      "",
      "- **Mix** the buffer",
      "- ~~Discard~~ incubate",
      "",
      "<script>window.__protocolXss = true</script>",
      '<img src="x" onerror="window.__protocolXss = true">',
    ].join("\n");
    await page!.fill("#p-title", "  Buffer preparation  ");
    await page!.fill("#p-description", "  Prepare the assay buffer.  ");
    await page!.fill("#p-tags", " buffer, assay, BUFFER, , protein,assay ");
    await page!.fill("#p-content", content);

    expect(await page!.locator(".protocol-preview, #p-preview-label, .protocol-form .protocol-markdown").count()).toBe(0);
    expect(await page!.getByText("Live preview", { exact: true }).count()).toBe(0);
    const editorLayout = await page!.$eval("#p-content", (element) => ({
      height: element.clientHeight,
      width: element.clientWidth,
      formWidth: element.closest(".protocol-form")?.clientWidth ?? 0,
    }));
    expect(editorLayout.height).toBeGreaterThanOrEqual(384);
    expect(Math.abs(editorLayout.width - editorLayout.formWidth)).toBeLessThanOrEqual(2);
    expect(await page!.evaluate(() => (window as unknown as { __protocolXss?: boolean }).__protocolXss)).toBeUndefined();

    await page!.click("#modal-confirm");
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({
      method: "POST",
      path: "/api/groups/group-a/inventory/protocols",
      body: {
        title: "Buffer preparation",
        description: "Prepare the assay buffer.",
        tags: ["buffer", "assay", "protein"],
        content,
      },
    });
    await page!.waitForSelector("#modal-overlay.active", { state: "detached" });
    expect(pageErrors).toEqual([]);
  }, 20_000);

  it("opens a populated editor from Edit, with no preview, and clears optional values on save", async () => {
    const card = page!.locator('[data-protocol-id="protocol-described"]');
    await card.getByRole("button", { name: "Edit protocol Protein assay", exact: true }).click();
    await page!.waitForSelector("#modal-overlay.active #p-title");
    expect((await page!.textContent("#modal-title"))?.trim()).toBe("Edit Protocol");
    expect(await page!.locator(".protocol-detail").count()).toBe(0);
    expect(await page!.locator(".protocol-preview, .protocol-form .protocol-markdown").count()).toBe(0);
    expect(await page!.inputValue("#p-title")).toBe("Protein assay");
    expect(await page!.inputValue("#p-description")).toBe("Quantify protein with a standard curve.");
    expect(await page!.inputValue("#p-tags")).toBe("assay, protein, buffer");
    expect(await page!.inputValue("#p-content")).toBe(describedContent);

    await page!.fill("#p-title", "Protein assay updated");
    await page!.fill("#p-description", "   ");
    await page!.fill("#p-tags", " , ,  ");
    await page!.fill("#p-content", "Updated **content**.");
    await page!.click("#modal-confirm");
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({
      method: "PUT",
      path: "/api/groups/group-a/inventory/protocols/protocol-described",
      body: {
        title: "Protein assay updated",
        description: "",
        tags: [],
        content: "Updated **content**.",
      },
    });
    expect(pageErrors).toEqual([]);
  }, 20_000);
});
