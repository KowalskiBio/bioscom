import http from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import type { Notice } from "@bioscom/shared";

let vite: ViteDevServer | null = null;
let server: http.Server | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let fixtureUrl = "";
const pageErrors: string[] = [];

const SAMPLE_NOTICES: Notice[] = [
  {
    id: "notice-global-1",
    title: " Global board 🚨 post ",
    content: " Board body 🧪 detail ",
    category: "issue",
    authorName: "Board Author 👩‍🔬",
    authorLab: "Shared Lab 🏢",
    timestamp: Date.UTC(2026, 10, 14),
    reactions: [
      {
        id: "reaction-1",
        text: "Reaction 🧪 must not render",
        userName: "Reaction User",
        userAvatar: "data:image/png;base64,reaction-avatar",
      },
    ],
  } as Notice,
  {
    id: "notice-global-2",
    title: "Second info post",
    content: "Second board content",
    category: "info",
    timestamp: Date.UTC(2026, 10, 15),
  } as Notice,
];

const NOTICE_CATEGORY_CASES = [
  {
    id: "notice-category-issue",
    sourceCategory: "issue",
    dataCategory: "issue",
    label: "Issue",
    colorToken: "--accent-red",
  },
  {
    id: "notice-category-info",
    sourceCategory: "info",
    dataCategory: "info",
    label: "Info",
    colorToken: "--accent-blue",
  },
  {
    id: "notice-category-suggestion",
    sourceCategory: "suggestion",
    dataCategory: "suggestion",
    label: "Suggestion",
    colorToken: "--accent-green",
  },
  {
    id: "notice-category-general",
    sourceCategory: "general",
    dataCategory: "general",
    label: "General",
    colorToken: "--text-muted",
  },
  {
    id: "notice-category-other",
    sourceCategory: "other",
    dataCategory: "general",
    label: "General",
    colorToken: "--text-muted",
  },
] as const;
const CATEGORY_NOTICES = NOTICE_CATEGORY_CASES.map((item, index) => ({
  id: item.id,
  title: `${item.label} category post`,
  content: `${item.sourceCategory} board content`,
  category: item.sourceCategory,
  timestamp: Date.UTC(2026, 10, 15 - index),
})) as Notice[];

type DismissalPut = { method: string; path: string; body: unknown };
let dismissals: string[] = [];
let noticesPayload: Notice[] = [];
let noticesStatus = 200;
let dismissalsGetStatus = 200;
let putStatus = 200;
let noticesCalls = 0;
let dismissalsGetCalls = 0;
let putCalls: DismissalPut[] = [];

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
    if (request.url?.split("?")[0] === "/dashboard-view") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Dashboard view fixture</title></head>
        <body><div id="app"></div><script type="module" src="/test/fixtures/dashboardView.ts"></script></body></html>`);
      return;
    }
    next();
  });
  server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/dashboard-view`;

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
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{\"error\":\"Unexpected API request\"}" }),
  );
  await page.route("**/api/notices", (route) => {
    noticesCalls += 1;
    return route.fulfill({
      status: noticesStatus,
      contentType: "application/json",
      body: JSON.stringify(noticesStatus === 200 ? { notices: noticesPayload } : { error: "Synthetic board failure" }),
    });
  });
  await page.route("**/api/users/me/dashboard-dismissals", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      const body = JSON.parse(request.postData() ?? "null") as { key?: string; dismissed?: boolean };
      putCalls.push({ method: request.method(), path: new URL(request.url()).pathname, body });
      if (putStatus !== 200) {
        return route.fulfill({
          status: putStatus,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic dismissal failure" }),
        });
      }
      if (typeof body.key === "string") dismissals = [...new Set([...dismissals, body.key])];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ dismissals, updatedAt: 100 + putCalls.length }),
      });
    }
    dismissalsGetCalls += 1;
    return route.fulfill({
      status: dismissalsGetStatus,
      contentType: "application/json",
      body: JSON.stringify(
        dismissalsGetStatus === 200 ? { dismissals, updatedAt: 1 } : { error: "Synthetic dismissals failure" },
      ),
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
  dismissals = [];
  noticesPayload = [];
  noticesStatus = 200;
  dismissalsGetStatus = 200;
  putStatus = 200;
  noticesCalls = 0;
  dismissalsGetCalls = 0;
  putCalls = [];
  pageErrors.length = 0;
});

function url(query = ""): string {
  return query === "" ? fixtureUrl : `${fixtureUrl}?${query}`;
}

async function gotoDashboard(query = ""): Promise<void> {
  await page!.setViewportSize({ width: 1100, height: 900 });
  await page!.goto(url(query), { waitUntil: "networkidle" });
  await page!.waitForSelector("#dash-attention");
}

async function waitForBoardReady(): Promise<void> {
  await page!.waitForFunction(
    () => document.getElementById("dash-attention")?.getAttribute("data-board-ready") === "true",
  );
}

async function resolvedThemeColor(token: string): Promise<string> {
  return page!.evaluate((property) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${property})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

type StockRow = { id: string; kind: string; href: string; path: string; detail: string; text: string };
async function stockRows(): Promise<StockRow[]> {
  return page!.$$eval("#dash-stock-attention-list .dash-attention-item", (rows) =>
    rows.map((row) => {
      const element = row as HTMLElement;
      return {
        id: element.dataset.stockId ?? "",
        kind: element.dataset.alertKind ?? "",
        href: element.querySelector("a")?.getAttribute("href") ?? "",
        path: element.querySelector(".dash-item-sub")?.textContent?.trim() ?? "",
        detail: element.querySelector(".dash-attention-detail")?.textContent?.trim() ?? "",
        text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
      };
    }),
  );
}

type NoticeRow = { id: string; title: string; content: string; category: string; text: string };
async function noticeRows(): Promise<NoticeRow[]> {
  return page!.$$eval("#dash-notice-attention-list .dash-notice-item", (rows) =>
    rows.map((row) => {
      const element = row as HTMLElement;
      return {
        id: element.dataset.noticeId ?? "",
        title: element.querySelector(".dash-item-title")?.textContent?.trim() ?? "",
        content: element.querySelector(".dash-notice-content")?.textContent?.trim() ?? "",
        category: element.querySelector(".dash-notice-category")?.textContent?.trim() ?? "",
        text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
      };
    }),
  );
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const DISMISSAL_PATH = "/api/users/me/dashboard-dismissals";

describe("mounted Dashboard attention", () => {
  it("renders real stock/expiry reasons and clean global board posts with accurate links", async () => {
    noticesPayload = SAMPLE_NOTICES;
    await gotoDashboard("case=main");
    await waitForBoardReady();

    const rows = await stockRows();
    const find = (id: string, kind: string): StockRow[] =>
      rows.filter((row) => row.id === id && row.kind === kind);
    expect(rows).toHaveLength(6);

    expect(find("room-direct", "quantity")[0]).toMatchObject({
      detail: "Out of stock · 0 mL remaining",
      path: "Main Room",
      href: "#containers/room-main",
    });
    expect(find("container-direct", "quantity")[0]).toMatchObject({
      detail: "Low stock · 4 mL remaining",
      path: "Main Room · Main Cabinet",
      href: "#detail/room-main/cont-main",
    });
    expect(find("nested-stock", "quantity")[0]).toMatchObject({
      detail: "Low stock · 2 mL remaining",
      path: "Main Room · Main Cabinet · Shelf A · Nested Box B",
      href: "#detail/room-main/cont-main",
    });
    expect(find("nested-stock", "expiry")[0]?.detail).toContain("Expires in 2 days");
    expect(find("shelf-stock", "expiry")[0]?.detail).toContain("Expires in 30 days");
    expect(find("freezer-stock", "expiry")[0]).toMatchObject({
      path: "Root Freezer · Rack A 2 · Box B 4",
      href: "#detail/freezer-root/freezer-root/rack/A%202/box/B%204",
    });
    expect(find("freezer-stock", "expiry")[0]?.detail).toMatch(/^Expired /);
    expect(find("freezer-direct", "quantity")).toHaveLength(0);
    expect(rows.some((row) => EMOJI.test(row.text))).toBe(false);

    const notices = await noticeRows();
    expect(notices.map((notice) => notice.id).sort()).toEqual(["notice-global-1", "notice-global-2"]);
    expect(notices.find((notice) => notice.id === "notice-global-1")).toMatchObject({
      title: "Global board post",
      content: "Board body detail",
      category: "Issue",
    });
    expect(notices.find((notice) => notice.id === "notice-global-1")?.text).toContain("Board Author");
    expect(notices.some((notice) => /Reaction|must not render|reaction-avatar/.test(notice.text))).toBe(false);
    expect(notices.some((notice) => EMOJI.test(notice.text))).toBe(false);

    expect(await page!.textContent("#dash-attention-count")).toBe("8");
    expect(await page!.textContent("#dash-stock-attention-summary")).toContain("6 stock alerts shown.");
    expect(await page!.textContent("#dash-notice-attention-summary")).toContain("2 current posts shown");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  for (const design of ["bauhaus", "original"] as const) {
    it(`uses notice-board category colors and preserves interactions in ${design}`, async () => {
      noticesPayload = CATEGORY_NOTICES;
      await gotoDashboard(`case=category-colors&design=${design}`);
      await waitForBoardReady();
      await page!.waitForFunction(
        (count) => document.querySelectorAll("#dash-notice-attention-list .dash-notice-item").length === count,
        NOTICE_CATEGORY_CASES.length,
      );

      for (const item of NOTICE_CATEGORY_CASES) {
        const row = page!.locator(`#dash-notice-attention-list [data-notice-id="${item.id}"]`);
        const expectedColor = await resolvedThemeColor(item.colorToken);
        expect(await row.getAttribute("data-notice-category")).toBe(item.dataCategory);
        expect((await row.locator(".dash-notice-category").textContent())?.trim()).toBe(item.label);

        const readColors = () =>
          row.evaluate((element) => {
            const rowStyle = getComputedStyle(element);
            const label = element.querySelector(".dash-notice-category");
            const glyph = element.querySelector(".stat-glyph");
            if (label === null || glyph === null) throw new Error("Missing notice label or glyph");
            return {
              borderColor: rowStyle.borderLeftColor,
              borderStyle: rowStyle.borderLeftStyle,
              borderWidth: rowStyle.borderLeftWidth,
              labelColor: getComputedStyle(label).color,
              glyphColor: getComputedStyle(glyph).backgroundColor,
            };
          });

        expect(await readColors()).toEqual({
          borderColor: expectedColor,
          borderStyle: "solid",
          borderWidth: "4px",
          labelColor: expectedColor,
          glyphColor: expectedColor,
        });
        await row.locator(".dash-notice-link").hover();
        expect((await readColors()).labelColor).toBe(expectedColor);
      }

      const issueLink = page!.locator(
        '#dash-notice-attention-list [data-notice-id="notice-category-issue"] .dash-notice-link',
      );
      await page!.keyboard.press("Tab");
      await issueLink.focus();
      const focusStyle = await issueLink.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          focusVisible: element.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });
      expect(focusStyle.focusVisible).toBe(true);
      expect(focusStyle.outlineStyle).not.toBe("none");
      expect(focusStyle.outlineWidth).not.toBe("0px");

      await page!.setViewportSize({ width: 390, height: 844 });
      const mobileRows = await page!.$$eval("#dash-notice-attention-list .dash-notice-item", (rows) =>
        rows.map((row) => {
          const rowRect = row.getBoundingClientRect();
          const buttonRect = row.querySelector("button")!.getBoundingClientRect();
          return {
            rowLeft: rowRect.left,
            rowRight: rowRect.right,
            buttonLeft: buttonRect.left,
            buttonRight: buttonRect.right,
            scrollWidth: (row as HTMLElement).scrollWidth,
            clientWidth: (row as HTMLElement).clientWidth,
          };
        }),
      );
      for (const row of mobileRows) {
        expect(row.rowLeft).toBeGreaterThanOrEqual(0);
        expect(row.rowRight).toBeLessThanOrEqual(390.5);
        expect(row.buttonLeft).toBeGreaterThanOrEqual(row.rowLeft);
        expect(row.buttonRight).toBeLessThanOrEqual(row.rowRight + 0.5);
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
      }

      const issueDismiss = page!.locator(
        '#dash-notice-attention-list [data-notice-id="notice-category-issue"] [data-dashboard-dismiss]',
      );
      await issueDismiss.focus();
      await page!.keyboard.press("Enter");
      await page!.waitForSelector('#dash-notice-attention-list [data-notice-id="notice-category-issue"]', {
        state: "detached",
      });
      await page!.waitForFunction(
        () =>
          (document.activeElement as HTMLElement | null)?.dataset.dismissalKey ===
          "notice:notice-category-info",
      );
      expect(putCalls).toEqual([
        {
          method: "PUT",
          path: DISMISSAL_PATH,
          body: { key: "notice:notice-category-issue", dismissed: true },
        },
      ]);
      expect(pageErrors).toEqual([]);
    }, 40_000);
  }

  it("caps visible stock rows at 8 while reporting the true total", async () => {
    await gotoDashboard("case=cap");
    await waitForBoardReady();
    await page!.waitForFunction(
      () => document.querySelectorAll("#dash-stock-attention-list .dash-attention-item").length === 8,
    );

    expect(await stockRows()).toHaveLength(8);
    expect((await page!.textContent("#dash-stock-attention-summary"))?.replace(/\s+/g, " ").trim()).toBe(
      "Showing 8 of 10 stock alerts · the stock list is limited to 8 rows.",
    );
    expect(await page!.textContent("#dash-attention-count")).toBe("8");
    expect(
      await page!.$eval('section[aria-labelledby="dash-notice-attention-title"]', (section) =>
        section.textContent?.replace(/\s+/g, " ").trim(),
      ),
    ).toContain("No current board posts after your personal dismissals.");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("shows explicit section empty states after personal dismissals", async () => {
    dismissals = Array.from({ length: 10 }, (_, index) => `stock-low:cap-${index}`);
    await gotoDashboard("case=cap");
    await waitForBoardReady();

    expect(await stockRows()).toEqual([]);
    expect(await page!.textContent("#dash-stock-attention-summary")).toContain("0 stock alerts shown.");
    expect(
      await page!.$eval('section[aria-labelledby="dash-stock-attention-title"]', (section) =>
        section.textContent?.replace(/\s+/g, " ").trim(),
      ),
    ).toContain("No active stock or expiry alerts.");
    expect(await page!.textContent("#dash-attention-empty")).toContain("caught up");
    expect(
      await page!.$eval('section[aria-labelledby="dash-notice-attention-title"]', (section) =>
        section.textContent?.replace(/\s+/g, " ").trim(),
      ),
    ).toContain("No current board posts after your personal dismissals.");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("switches stock to the active lab while global board posts stay loaded", async () => {
    noticesPayload = [SAMPLE_NOTICES[0]!];
    await gotoDashboard();
    await waitForBoardReady();

    await page!.evaluate(() =>
      (
        window as unknown as {
          __dashboardFixtureSwitch(next: { uid: string; groupId: string }): void;
        }
      ).__dashboardFixtureSwitch({ uid: "synthetic-dashboard-reader", groupId: "group-b" }),
    );
    await page!.waitForFunction(
      () => document.querySelector('#dash-stock-attention-list [data-stock-id="other-lab-stock"]') !== null,
    );

    expect((await stockRows()).map((row) => row.id)).toEqual(["other-lab-stock"]);
    expect(
      await page!.locator('#dash-notice-attention-list [data-notice-id="notice-global-1"]').count(),
    ).toBe(1);
    expect(noticesCalls).toBe(1);
    expect(dismissalsGetCalls).toBe(1);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("reproduces late inventory delivery for the already-selected lab", async () => {
    // Real app order: Dashboard mounts, then fetchInventory/applyBroadcast sets
    // the tree while the selected group ID stays "group-a".
    await gotoDashboard("case=main&load=delayed");
    await waitForBoardReady();

    // Before the delayed tree arrives the lab is unconfirmed, never zero-as-fact,
    // and no stock from another lab may leak in.
    expect(await page!.getAttribute("#dash-attention", "data-stock-ready")).toBe("false");
    expect(await page!.textContent("#stat-chems .stat-value")).toBe("0");
    expect(await page!.textContent("#stat-protocols .stat-value")).toBe("0");
    expect(await page!.textContent("#dash-stock-attention-loading")).toContain(
      "Waiting for confirmed inventory for this lab",
    );
    expect(await page!.locator("#dash-stock-attention-list").count()).toBe(0);

    await page!.evaluate(() =>
      (window as unknown as { __dashboardFixtureDeliver(): void }).__dashboardFixtureDeliver(),
    );
    await page!
      .waitForFunction(
        () => document.querySelector("#dash-attention")?.getAttribute("data-stock-ready") === "true",
        undefined,
        { timeout: 5_000 },
      )
      .catch(() => undefined);

    const delivered = {
      chems: await page!.textContent("#stat-chems .stat-value"),
      containers: await page!.textContent("#stat-containers .stat-value"),
      protocols: await page!.textContent("#stat-protocols .stat-value"),
      ready: await page!.getAttribute("#dash-attention", "data-stock-ready"),
      rows: (await stockRows()).map((row) => row.id).sort(),
    };
    expect(delivered).toEqual({
      chems: "6",
      containers: "2",
      protocols: "2",
      ready: "true",
      rows: [
        "container-direct",
        "freezer-stock",
        "nested-stock",
        "nested-stock",
        "room-direct",
        "shelf-stock",
      ],
    });

    // Selecting a different lab must not show the previous lab's stock before
    // its own tree arrives, even though the old tree is still in the store.
    await page!.evaluate(() =>
      (
        window as unknown as { __dashboardFixtureSelectGroup(groupId: string): void }
      ).__dashboardFixtureSelectGroup("group-b"),
    );
    await page!.waitForFunction(
      () => document.querySelector("#dash-attention")?.getAttribute("data-stock-ready") === "false",
    );
    expect(await page!.textContent("#stat-chems .stat-value")).toBe("0");
    expect(await page!.textContent("#stat-protocols .stat-value")).toBe("0");
    expect(
      await page!.locator('#dash-stock-attention-list [data-stock-id="room-direct"]').count(),
    ).toBe(0);
    expect(await page!.textContent("#dash-stock-attention-loading")).toContain(
      "Waiting for confirmed inventory for this lab",
    );

    await page!.evaluate(() =>
      (
        window as unknown as { __dashboardFixtureDeliver(groupId: string): void }
      ).__dashboardFixtureDeliver("group-b"),
    );
    await page!.waitForFunction(
      () => document.querySelector("#dash-attention")?.getAttribute("data-stock-ready") === "true",
    );
    expect(await page!.textContent("#stat-chems .stat-value")).toBe("1");
    expect(await page!.textContent("#stat-protocols .stat-value")).toBe("0");
    expect((await stockRows()).map((row) => row.id)).toEqual(["other-lab-stock"]);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("sends the exact key with dismissed:true and removes only the confirmed row", async () => {
    noticesPayload = [SAMPLE_NOTICES[0]!];
    await gotoDashboard();
    await waitForBoardReady();
    expect(await page!.textContent("#stat-chems .stat-value")).toBe("6");

    await page!.click(
      '#dash-stock-attention-list [data-stock-id="container-direct"] [data-dashboard-dismiss]',
    );
    await page!.waitForSelector('#dash-stock-attention-list [data-stock-id="container-direct"]', {
      state: "detached",
    });
    expect(putCalls).toEqual([
      { method: "PUT", path: DISMISSAL_PATH, body: { key: "stock-low:container-direct", dismissed: true } },
    ]);
    const remaining = await stockRows();
    expect(remaining.map((row) => row.id)).not.toContain("container-direct");
    expect(remaining.map((row) => row.id)).toContain("room-direct");
    // Dismissal is a personal preference, not a stock/notice mutation.
    expect(await page!.textContent("#stat-chems .stat-value")).toBe("6");
    expect(
      await page!.locator('#dash-notice-attention-list [data-notice-id="notice-global-1"]').count(),
    ).toBe(1);

    await page!.click(
      '#dash-notice-attention-list [data-notice-id="notice-global-1"] [data-dashboard-dismiss]',
    );
    await page!.waitForSelector('#dash-notice-attention-list [data-notice-id="notice-global-1"]', {
      state: "detached",
    });
    expect(putCalls[1]).toEqual({
      method: "PUT",
      path: DISMISSAL_PATH,
      body: { key: "notice:notice-global-1", dismissed: true },
    });
    expect((await stockRows()).map((row) => row.id)).not.toContain("container-direct");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("keeps the row visible with a row error when the dismissal save fails", async () => {
    noticesPayload = [SAMPLE_NOTICES[0]!];
    putStatus = 500;
    await gotoDashboard();
    await waitForBoardReady();

    await page!.click(
      '#dash-stock-attention-list [data-stock-id="container-direct"] [data-dashboard-dismiss]',
    );
    await page!.waitForSelector(
      '#dash-stock-attention-list [data-stock-id="container-direct"] .dash-attention-row-error',
    );

    const row = await page!.$eval(
      '#dash-stock-attention-list [data-stock-id="container-direct"]',
      (element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "",
    );
    expect(row).toContain("Couldn’t dismiss this item for you. It is still visible");
    expect(
      await page!.locator('#dash-stock-attention-list [data-stock-id="container-direct"]').count(),
    ).toBe(1);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]?.body).toEqual({ key: "stock-low:container-direct", dismissed: true });
    expect(
      await page!.locator('#dash-notice-attention-list [data-notice-id="notice-global-1"]').count(),
    ).toBe(1);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("makes one automatic board request after failure and recovers on explicit retry", async () => {
    noticesPayload = SAMPLE_NOTICES;
    noticesStatus = 401;
    await gotoDashboard();
    await page!.waitForFunction(() =>
      document
        .getElementById("dash-board-attention-loading")
        ?.textContent?.includes("Board posts stay unconfirmed until the shared board loads successfully."),
    );

    await page!.waitForTimeout(700);
    expect(noticesCalls).toBe(1);
    expect(await page!.locator("#dash-notice-attention-list").count()).toBe(0);
    expect(await page!.textContent("#dash-attention-error")).toContain("Couldn’t load board posts");

    noticesStatus = 200;
    await page!.click("#dash-attention-retry");
    await page!.waitForSelector('#dash-notice-attention-list [data-notice-id="notice-global-1"]');
    expect(noticesCalls).toBe(2);
    await page!.waitForTimeout(500);
    expect(noticesCalls).toBe(2);
    expect(await page!.locator("#dash-attention-error").count()).toBe(0);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("shows global board posts without a selected lab and prompts for stock", async () => {
    noticesPayload = [SAMPLE_NOTICES[0]!];
    await gotoDashboard("group=none");
    await page!.waitForSelector('#dash-notice-attention-list [data-notice-id="notice-global-1"]');

    expect((await page!.textContent("#dash-stock-attention-loading"))?.replace(/\s+/g, " ").trim()).toContain(
      "Select a lab to confirm its stock and expiry alerts",
    );
    expect(await page!.locator("#dash-stock-attention-list").count()).toBe(0);
    expect(
      await page!.textContent('#dash-notice-attention-list [data-notice-id="notice-global-1"]'),
    ).toContain("Global board post");

    await page!.click(
      '#dash-notice-attention-list [data-notice-id="notice-global-1"] [data-dashboard-dismiss]',
    );
    await page!.waitForSelector('#dash-notice-attention-list [data-notice-id="notice-global-1"]', {
      state: "detached",
    });
    expect(putCalls).toEqual([
      { method: "PUT", path: DISMISSAL_PATH, body: { key: "notice:notice-global-1", dismissed: true } },
    ]);
    expect(await page!.textContent("#dash-stock-attention-loading")).toContain("Select a lab");
    expect(pageErrors).toEqual([]);
  }, 40_000);
});
