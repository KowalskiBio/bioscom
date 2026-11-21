import http from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { defaultCatalogColumnSelections, MATERIAL_TYPES } from "@bioscom/shared";

let vite: ViteDevServer | null = null;
let server: http.Server | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let fixtureUrl = "";
let navigation = 0;
let preferenceStatus = 200;
const allRoomPreferenceColumns = [
  "name",
  "type",
  "quantity",
  "location",
  "concentration",
  "cas_number",
  "molecular_formula",
  "target_species",
  "manufacturer",
  "catalog_number",
  "lot",
  "received",
  "expires",
  "status",
  "note",
  "actions",
];
let roomPreferenceColumns = [...allRoomPreferenceColumns];
const pageErrors: string[] = [];
const adjustCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
const chemicalWrites: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
const okabeIto = {
  chemical: { hex: "#0072B2", rgb: "0, 114, 178", color: "rgb(0, 114, 178)", ink: "#A9C7FF", inkColor: "rgb(169, 199, 255)" },
  reagent: { hex: "#56B4E9", rgb: "86, 180, 233", color: "rgb(86, 180, 233)", ink: "#8FE3DC", inkColor: "rgb(143, 227, 220)" },
  antibody: { hex: "#CC79A7", rgb: "204, 121, 167", color: "rgb(204, 121, 167)", ink: "#D0B8FA", inkColor: "rgb(208, 184, 250)" },
  primer: { hex: "#009E73", rgb: "0, 158, 115", color: "rgb(0, 158, 115)", ink: "#ABDDB6", inkColor: "rgb(171, 221, 182)" },
  solution: { hex: "#F0E442", rgb: "240, 228, 66", color: "rgb(240, 228, 66)", ink: "#EBCB83", inkColor: "rgb(235, 203, 131)" },
  biological_stock: { hex: "#D55E00", rgb: "213, 94, 0", color: "rgb(213, 94, 0)", ink: "#F0B2A6", inkColor: "rgb(240, 178, 166)" },
  other: { hex: "#999999", rgb: "153, 153, 153", color: "rgb(153, 153, 153)", ink: "#C3CAD4", inkColor: "rgb(195, 202, 212)" },
} as const;
const materialKeys = MATERIAL_TYPES.map(({ key }) => key);
const generatedPositionCases = [
  { key: "empty", customPosition: "", expected: "AH1" },
  { key: "null", customPosition: null, expected: "AH1" },
  { key: "absent", customPosition: undefined, expected: "AH1" },
  { key: "whitespace", customPosition: "   ", expected: "AH1" },
  { key: "manual", customPosition: "Z9", expected: "Z9" },
  { key: "missing", customPosition: null, expected: null },
] as const;

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
    if (request.url?.split("?")[0] === "/chemical-views") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html><head><meta charset="UTF-8"><title>Chemical column fixture</title></head>
        <body><div id="app"></div><div id="modal-app"></div><div id="toast-app"></div><script type="module" src="/test/fixtures/chemicalViews.ts"></script></body></html>`);
      return;
    }
    next();
  });
  server = http.createServer(vite.middlewares);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/chemical-views`;

  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = existsSync(chromium.executablePath())
      ? await chromium.launch({ headless: true, channel: "chromium" })
      : await chromium.launch({ headless: true, channel: "msedge" });
  }
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{\"error\":\"Unexpected API request\"}" }),
  );
  await page.route("**/api/users/me/catalog-columns", (route) => {
    if (preferenceStatus !== 200) {
      return route.fulfill({
        status: preferenceStatus,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic preferences unavailable" }),
      });
    }
    const columnsByType = defaultCatalogColumnSelections();
    columnsByType.all = [...roomPreferenceColumns];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ columnsByType, updatedAt: navigation }),
    });
  });
  await page.route("**/api/groups/group-a/stocks*", (route) => {
    const stocks = materialKeys.map((key, index) => ({
      id: `palette-stock-${key}`,
      name: `Palette ${key}`,
      type: key,
      quantity: index + 1,
      unit: "pcs",
      concentration: null,
      concentrationUnit: null,
      note: `Synthetic ${key} catalog stock`,
      status: "available",
      position: `P-${index + 1}` as string | null,
      customPosition: null as string | null | undefined,
      location: {
        id: "loc-palette",
        name: "Palette Shelf",
        rackName: null,
        boxName: null,
        containerId: "cont-main",
        containerName: "Main Cabinet",
        roomId: "room-main",
        roomName: "Main Test Room",
        path: "Main Test Room / Main Cabinet / Palette Shelf",
      },
      batch: {
        id: `batch-palette-${key}`,
        lotCode: null,
        originType: "unknown",
        expiresAt: null,
        receivedAt: null,
        preparedAt: null,
      },
      product: null,
      materialId: `material-palette-${key}`,
      attributes: {},
    }));
    if (new URL(page!.url()).searchParams.get("positions") === "1") {
      const template = stocks[0]!;
      stocks.push(...generatedPositionCases.map((positionCase) => ({
        ...template,
        id: `position-stock-${positionCase.key}`,
        name: `Position catalog ${positionCase.key}`,
        materialId: `material-position-${positionCase.key}`,
        position: positionCase.key === "missing" ? null : "AH1",
        customPosition: positionCase.customPosition,
      })));
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stocks, total: stocks.length, page: 1, limit: 25 }),
    });
  });
  await page.route(/\/api\/groups\/group-a\/inventory\/chemicals(?:\/[^/]+)?$/, (route) => {
    const request = route.request();
    chemicalWrites.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postDataJSON() as Record<string, unknown>,
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/groups/group-a/inventory/chemicals/*/adjust-qty", (route) => {
    adjustCalls.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
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

async function openView(hash: string, params = ""): Promise<void> {
  navigation += 1;
  const separator = params === "" ? "" : "&";
  await page!.goto(`${fixtureUrl}?case=${navigation}${separator}${params}#${hash}`, { waitUntil: "networkidle" });
}

async function continueWithoutRadio(): Promise<void> {
  await page!.waitForSelector('[data-radio-action="none"]');
  expect(await page!.textContent("#modal-title")).toBe("Laboratory Background Radio");
  await page!.locator('[data-radio-action="none"]').click();
  await page!.waitForSelector("#f-cn2");
  expect(await page!.textContent("#modal-title")).toBe("Add Chemical");
}

async function openChemicalFromContext(containerId: string, shelfId?: string): Promise<void> {
  await page!.evaluate(async ({ containerId: selectedContainerId, shelfId: selectedShelfId }) => {
    // Vitest rewrites direct dynamic imports for SSR; this fixture needs the browser's native importer.
    const browserImport = new Function("modulePath", "return import(modulePath)") as (modulePath: string) => Promise<Record<string, any>>;
    const { openChemicalRadioPrompt } = await browserImport("/src/lib/forms.ts");
    const { inventory } = await browserImport("/src/lib/stores/inventory.svelte.ts");
    const room = inventory.tree?.rooms.find((candidate: { id: string }) => candidate.id === "room-main");
    const container = room?.containers.find((candidate: { id: string }) => candidate.id === selectedContainerId);
    if (room === undefined || container === undefined) {
      throw new Error(`Missing chemical form fixture: ${selectedContainerId}`);
    }
    openChemicalRadioPrompt(room, container, selectedShelfId);
  }, { containerId, shelfId });
  await continueWithoutRadio();
}

async function columnIds(tableId: string): Promise<string[]> {
  return page!.$$eval(`#${tableId} thead th`, (headers) =>
    headers.map((header) => (header as HTMLElement).dataset.column ?? ""),
  );
}

async function cellText(tableId: string, chemicalId: string, columnId: string): Promise<string> {
  const cell = page!.locator(`#${tableId} tbody tr[data-chemid="${chemicalId}"] td[data-column="${columnId}"]`);
  return (await cell.textContent())?.trim() ?? "";
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

async function computedTypeStyle(selector: string, pseudo: string | null = null) {
  const locator = page!.locator(selector);
  await locator.waitFor();
  return locator.evaluate((element, pseudoElement) => {
    const own = getComputedStyle(element);
    const target = getComputedStyle(element, pseudoElement);
    return {
      accent: own.getPropertyValue("--material-type-accent").trim(),
      rgbToken: own.getPropertyValue("--material-type-rgb").trim(),
      inkToken: own.getPropertyValue("--material-type-ink").trim(),
      background: target.backgroundColor,
      color: target.color,
      elementBackground: own.backgroundColor,
      elementColor: own.color,
      width: target.width,
      height: target.height,
      outlineStyle: target.outlineStyle,
      outlineWidth: target.outlineWidth,
      outlineColor: target.outlineColor,
      outlineOffset: target.outlineOffset,
    };
  }, pseudo);
}

async function expectOriginalMaterial(selector: string, key: keyof typeof okabeIto): Promise<void> {
  const style = await computedTypeStyle(selector);
  const expected = okabeIto[key];
  expect(style.accent.toUpperCase()).toBe(expected.hex);
  expect(style.rgbToken).toBe(expected.rgb);
  expect(style.background).toBe(`rgba(${expected.rgb}, 0.14)`);
  expect(style.inkToken.toUpperCase()).toBe(expected.ink);
  expect(style.color).toBe(expected.inkColor);
}

async function expectBauhausMark(selector: string, key: keyof typeof okabeIto): Promise<void> {
  const style = await computedTypeStyle(selector, "::before");
  const expected = okabeIto[key];
  const needsKeyline = key === "reagent" || key === "solution";
  expect(style.background).toBe(expected.color);
  expect(style.width).toBe("8px");
  expect(style.height).toBe("8px");
  expect(style.outlineStyle).toBe(needsKeyline ? "solid" : "none");
  if (needsKeyline) {
    expect(style.outlineWidth).toBe("1px");
    expect(style.outlineColor).toBe("rgb(23, 21, 18)");
    expect(style.outlineOffset).toBe("-1px");
  }
}

interface InlineChipGeometry {
  name: { top: number; bottom: number; left: number; right: number; lineCount: number } | null;
  chip: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
    lineCount: number;
    whiteSpace: string;
  } | null;
  cellWidth: number;
  documentWidth: number;
  viewportWidth: number;
}

async function inlineChipGeometry(tableId: string, chemicalId: string): Promise<InlineChipGeometry> {
  const cell = page!.locator(`#${tableId} tbody tr[data-chemid="${chemicalId}"] td[data-column="name"]`);
  return cell.evaluate((element) => {
    const textRects = (target: Node): DOMRect[] => {
      const nodes: Node[] = target.nodeType === Node.TEXT_NODE ? [target] : [];
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node !== null) {
        nodes.push(node);
        node = walker.nextNode();
      }
      return nodes.flatMap((text) => {
        if ((text.textContent ?? "").trim() === "") return [];
        const range = document.createRange();
        range.selectNodeContents(text);
        return Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      });
    };
    const chip = element.querySelector<HTMLElement>(".status-badge");
    const nameTarget = element.querySelector(".chemical-name-text") ?? Array.from(element.childNodes).find((node) =>
      node !== chip && !(node instanceof HTMLElement && node.classList.contains("room-chemical-meta")) &&
      (node.textContent ?? "").trim() !== "",
    );
    let name: InlineChipGeometry["name"] = null;
    if (nameTarget !== undefined) {
      const rectangles = textRects(nameTarget);
      if (rectangles.length > 0) {
        name = {
          top: Math.min(...rectangles.map((rect) => rect.top)),
          bottom: Math.max(...rectangles.map((rect) => rect.bottom)),
          left: Math.min(...rectangles.map((rect) => rect.left)),
          right: Math.max(...rectangles.map((rect) => rect.right)),
          lineCount: new Set(rectangles.map((rect) => Math.round(rect.top))).size,
        };
      }
    }
    let chipGeometry: InlineChipGeometry["chip"] = null;
    if (chip !== null) {
      const rect = chip.getBoundingClientRect();
      chipGeometry = {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        lineCount: new Set(textRects(chip).map((textRect) => Math.round(textRect.top))).size,
        whiteSpace: getComputedStyle(chip).whiteSpace,
      };
    }
    return {
      name,
      chip: chipGeometry,
      cellWidth: element.getBoundingClientRect().width,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
}

const inlineChipContexts = [
  { name: "container detail", hash: "detail/room-main/cont-main", query: "Chip", table: "container-direct-chemicals-table", prefix: "container-chip" },
  { name: "shelf", hash: "detail/room-main/cont-main", query: "Chip", table: "shelf-chemicals-table-shelf-main", prefix: "shelf-chip" },
  { name: "box", hash: "detail/room-main/cont-main", query: "Chip", table: "nested-box-chemicals-table-nested-box", prefix: "nested-chip" },
  { name: "root deep-freezer search", hash: "detail/room-main/cont-freezer", query: "Chip", table: "deepfreezer-search-chemicals-table", prefix: "deep-chip" },
  { name: "deep-freezer box", hash: "detail/room-main/cont-freezer/rack/7/box/B4", query: "", table: "deepfreezer-box-chemicals-table", prefix: "deep-chip" },
] as const;

function expectSameVisualLine(geometry: InlineChipGeometry): void {
  expect(geometry.name).not.toBeNull();
  expect(geometry.chip).not.toBeNull();
  expect(geometry.name!.lineCount, JSON.stringify(geometry)).toBe(1);
  expect(geometry.chip!.top, JSON.stringify(geometry)).toBeLessThan(geometry.name!.bottom);
  expect(geometry.chip!.bottom, JSON.stringify(geometry)).toBeGreaterThan(geometry.name!.top);
  expect(geometry.chip!.lineCount, JSON.stringify(geometry)).toBe(1);
  expect(geometry.chip!.whiteSpace).toBe("nowrap");
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
}

describe("mounted material type chips", () => {
  afterEach(() => {
    roomPreferenceColumns = [...allRoomPreferenceColumns];
  });

  it("uses exact Okabe–Ito accents and matching RGB tints on all original-theme material consumers", async () => {
    roomPreferenceColumns = ["name", "type", "note", "actions"];
    await openView("containers/room-main", "palette=room&design=original");
    for (const key of materialKeys) {
      await expectOriginalMaterial(
        `#room-direct-chemicals-table tr[data-chemid="palette-room-${key}"] td[data-column="type"] .status-badge.material-type-${key}`,
        key,
      );
    }

    await openView("catalog", "design=original");
    for (const key of materialKeys) {
      await expectOriginalMaterial(
        `#stocks-table tr[data-stock-id="palette-stock-${key}"] .chem-pos.material-type-${key}`,
        key,
      );
    }
    expect(pageErrors).toEqual([]);
  }, 60_000);

  it("uses short room Type cells while keeping full names in the item edit form", async () => {
    roomPreferenceColumns = ["name", "type", "note", "actions"];
    await openView("containers/room-main", "palette=room&design=original");
    for (const type of MATERIAL_TYPES) {
      const typeCell = page!.locator(
        `#room-direct-chemicals-table tr[data-chemid="palette-room-${type.key}"] td[data-column="type"] .status-badge`,
      );
      expect(await typeCell.textContent()).toBe(type.shortLabel);
      expect(await typeCell.getAttribute("title")).toBe(type.label);
    }

    await openView("containers/room-main", "case=edit-full-types");
    const row = page!.locator('#room-direct-chemicals-table tr[data-chemid="room-chem"]');
    await row.getByRole("button", { name: "Edit Room primer stock" }).click();
    await page!.waitForSelector("#f-type");
    expect(await page!.locator("#f-type option").allTextContents()).toEqual(
      MATERIAL_TYPES.map((type) => type.label),
    );
    expect(pageErrors).toEqual([]);
  }, 60_000);

  it("limits Bauhaus keylines to light reagent and solution marks without changing geometry or active filters", async () => {
    roomPreferenceColumns = ["name", "type", "note", "actions"];
    await openView("catalog", "design=bauhaus");
    for (const key of materialKeys) {
      await expectBauhausMark(`#catalog-type-${key}.filter-pill.material-type-${key}`, key);
      await expectBauhausMark(
        `#stocks-table tr[data-stock-id="palette-stock-${key}"] .chem-pos.material-type-${key}`,
        key,
      );
    }

    for (const key of materialKeys) {
      const activeFilter = page!.locator(`#catalog-type-${key}`);
      await activeFilter.click();
      await expect.poll(async () => (await activeFilter.getAttribute("class"))?.split(/\s+/).includes("active")).toBe(true);
      await expect.poll(async () =>
        (await computedTypeStyle(`#catalog-type-${key}`, "::before")).elementBackground,
      ).toBe("rgb(23, 21, 18)");
      const active = await computedTypeStyle(`#catalog-type-${key}`, "::before");
      expect(active.elementBackground).toBe("rgb(23, 21, 18)");
      expect(active.elementColor).toBe("rgb(255, 255, 255)");
      expect(active.background).toBe("rgb(255, 255, 255)");
      expect(active.outlineStyle).toBe("none");
      expect(active.width).toBe("8px");
      expect(active.height).toBe("8px");
    }

    await openView("containers/room-main", "palette=room&design=bauhaus");
    for (const key of materialKeys) {
      await expectBauhausMark(
        `#room-direct-chemicals-table tr[data-chemid="palette-room-${key}"] td[data-column="type"] .status-badge.material-type-${key}`,
        key,
      );
    }
    expect(pageErrors).toEqual([]);
  }, 90_000);

  it("shows Chemical for explicit and legacy detail rows while preserving its material palette", async () => {
    roomPreferenceColumns = ["name", "type", "quantity", "location", "note", "actions"];
    await openView("detail/room-main/cont-main", "case=inline-chemical&q=Chip&design=original");
    for (const chemicalId of ["container-chip-chemical", "container-chip-legacy"]) {
      const chip = page!.locator(`#container-direct-chemicals-table tr[data-chemid="${chemicalId}"] td[data-column="name"] .status-badge`);
      expect(await chip.isVisible()).toBe(true);
      expect(await chip.textContent()).toBe("Chemical");
      expect(await chip.getAttribute("class")).toContain("material-type-chemical");
      const geometry = await inlineChipGeometry("container-direct-chemicals-table", chemicalId);
      expectSameVisualLine(geometry);
    }
  }, 40_000);

  it("keeps compact biological chips on the Name line in every shared detail context and theme", async () => {
    roomPreferenceColumns = ["name", "type", "quantity", "location", "note", "actions"];
    await page!.setViewportSize({ width: 390, height: 844 });
    for (const design of ["original", "bauhaus"]) {
      for (const context of inlineChipContexts) {
        const query = context.query === "" ? "" : `&q=${context.query}`;
        await openView(context.hash, `case=inline-${design}-${context.prefix}${query}&design=${design}`);
        await page!.waitForSelector(`#${context.table} tr[data-chemid="${context.prefix}-bio"]`);
        const bioChip = page!.locator(`#${context.table} tr[data-chemid="${context.prefix}-bio"] td[data-column="name"] .status-badge`);
        expect(await bioChip.isVisible()).toBe(true);
        const geometry = await inlineChipGeometry(context.table, `${context.prefix}-bio`);
        expectSameVisualLine(geometry);
        expect(await bioChip.textContent()).toBe("Biological stock");
        expect(await bioChip.getAttribute("title")).toBe("Biological / glycerol stock");
        expect(await bioChip.getAttribute("class")).toContain("material-type-biological_stock");

        const chemicalChip = page!.locator(`#${context.table} tr[data-chemid="${context.prefix}-chemical"] td[data-column="name"] .status-badge`);
        expect(await chemicalChip.isVisible()).toBe(true);
        expect(await chemicalChip.textContent()).toBe("Chemical");
        expect(await chemicalChip.getAttribute("class")).toContain("material-type-chemical");
      }
    }
    await page!.setViewportSize({ width: 1200, height: 800 });
    expect(pageErrors).toEqual([]);
  }, 120_000);

  it("honors hidden Type, keeps direct-room labels canonical, and contains narrow overflow locally", async () => {
    roomPreferenceColumns = ["name", "quantity", "location", "note", "actions"];
    await openView("detail/room-main/cont-main", "case=inline-hidden&q=Chip");
    await page!.waitForSelector('#container-direct-chemicals-table tr[data-chemid="container-chip-bio"]');
    expect(await page!.locator('#container-direct-chemicals-table td[data-column="name"] .status-badge').count()).toBe(0);

    roomPreferenceColumns = ["name", "type", "quantity", "location", "note", "actions"];
    await openView("containers/room-main", "case=inline-room-types");
    const roomBioType = page!.locator('#room-direct-chemicals-table tr[data-chemid="room-chip-bio"] td[data-column="type"] .status-badge');
    expect(await roomBioType.textContent()).toBe("Biological stock");
    expect(await roomBioType.getAttribute("title")).toBe("Biological / glycerol stock");
    expect(await roomBioType.getAttribute("class")).toContain("material-type-biological_stock");
    const roomChemicalType = page!.locator('#room-direct-chemicals-table tr[data-chemid="room-blank"] td[data-column="type"] .status-badge');
    expect(await roomChemicalType.textContent()).toBe("Chemical");
    expect(await roomChemicalType.getAttribute("class")).toContain("material-type-chemical");
    expect(await page!.locator('#room-direct-chemicals-table td[data-column="name"] .status-badge').count()).toBe(0);

    for (const design of ["original", "bauhaus"]) {
      await page!.setViewportSize({ width: 390, height: 844 });
      await openView("detail/room-main/cont-main", `case=inline-mobile-${design}&q=Chip&design=${design}`);
      await page!.waitForSelector('#container-direct-chemicals-table tr[data-chemid="container-chip-bio"]');
      const geometry = await inlineChipGeometry("container-direct-chemicals-table", "container-chip-bio");
      expectSameVisualLine(geometry);
      expect(geometry.documentWidth).toBeLessThanOrEqual(390);
      const scrolling = await page!.locator("#container-direct-chemicals-table").evaluate((table) => {
        let ancestor = table.parentElement;
        while (ancestor !== null && ancestor.scrollWidth <= ancestor.clientWidth) ancestor = ancestor.parentElement;
        return ancestor === null ? null : {
          clientWidth: ancestor.clientWidth,
          scrollWidth: ancestor.scrollWidth,
          overflowX: getComputedStyle(ancestor).overflowX,
        };
      });
      expect(scrolling, `missing local table scroller in ${design}`).not.toBeNull();
      expect(scrolling!.scrollWidth).toBeGreaterThan(scrolling!.clientWidth);
      expect(["auto", "scroll"]).toContain(scrolling!.overflowX);
      const actions = page!.locator('#container-direct-chemicals-table tr[data-chemid="container-chip-bio"] td[data-column="actions"]');
      expect(await actions.count()).toBe(1);
      await page!.setViewportSize({ width: 1200, height: 800 });
    }
  }, 90_000);
});

describe("mounted generated-position displays and labels", () => {
  afterEach(() => {
    roomPreferenceColumns = [...allRoomPreferenceColumns];
  });

  it("uses generated positions in the full catalog unless a meaningful override exists", async () => {
    roomPreferenceColumns = ["name", "location", "note", "actions"];
    await openView("catalog", "positions=1");

    for (const positionCase of generatedPositionCases) {
      const row = page!.locator(`#stocks-table tr[data-stock-id="position-stock-${positionCase.key}"]`);
      await row.waitFor();
      expect(await row.locator(".stocks-dim").textContent()).toBe("Main Test Room / Main Cabinet / Palette Shelf");
      const badge = row.locator(".chem-pos");
      if (positionCase.expected === null) {
        expect(await badge.count()).toBe(0);
      } else {
        expect(await badge.textContent()).toBe(positionCase.expected);
      }
    }
  }, 40_000);

  it("uses generated positions in direct and shelf tables and preserves room-label contents", async () => {
    roomPreferenceColumns = ["name", "location", "note", "actions"];
    await openView("detail/room-main/cont-main", "positions=1&q=Position");
    for (const [area, table] of [
      ["container", "container-direct-chemicals-table"],
      ["shelf", "shelf-chemicals-table-shelf-main"],
    ] as const) {
      for (const positionCase of generatedPositionCases) {
        expect(await cellText(table, `position-${area}-${positionCase.key}`, "position")).toBe(positionCase.expected ?? "—");
      }
    }

    await openView("containers/room-main", "positions=1");
    for (const positionCase of generatedPositionCases) {
      const row = page!.locator(`#room-direct-chemicals-table tr[data-chemid="position-room-${positionCase.key}"]`);
      await row.locator('button[title^="Print label"]').click();
      await page!.waitForSelector(".stock-label-card");
      expect(await page!.locator(".stock-label-name").textContent()).toBe(`Position room ${positionCase.key}`);
      expect(await page!.locator(".stock-label-barcode-text").textContent()).toBe(`POSITION-ROOM-${positionCase.key.toUpperCase()}`);
      const metadata = page!.locator(".stock-label-meta");
      expect(await metadata.first().textContent()).toContain("Main Test Room");
      expect(await metadata.count()).toBe(positionCase.expected === null ? 1 : 2);
      if (positionCase.expected !== null) {
        expect(await metadata.nth(1).textContent()).toBe(positionCase.expected);
      }
      await page!.click("#modal-close");
      await page!.waitForSelector(".stock-label-card", { state: "detached" });
    }
  }, 90_000);

  it("passes generated positions to both container and shelf label entry paths", async () => {
    roomPreferenceColumns = ["name", "location", "note", "actions"];
    await openView("detail/room-main/cont-main", "positions=1&q=Position");
    for (const area of ["container", "shelf"] as const) {
      for (const positionCase of generatedPositionCases) {
        const row = page!.locator(`tr[data-chemid="position-${area}-${positionCase.key}"]`);
        await row.locator('button[title="Print label"]').click();
        await page!.waitForSelector(".stock-label-card");
        expect(await page!.locator(".stock-label-name").textContent()).toBe(`Position ${area} ${positionCase.key}`);
        expect(await page!.locator(".stock-label-barcode-text").textContent()).toBe(
          `POSITION-${area.toUpperCase()}-${positionCase.key.toUpperCase()}`,
        );
        const metadata = page!.locator(".stock-label-meta");
        expect(await metadata.first().textContent()).toContain("Main Test Room / Main Cabinet");
        expect(await metadata.count()).toBe(positionCase.expected === null ? 1 : 2);
        if (positionCase.expected !== null) {
          expect(await metadata.nth(1).textContent()).toBe(positionCase.expected);
        }
        await page!.click("#modal-close");
        await page!.waitForSelector(".stock-label-card", { state: "detached" });
      }
    }
  }, 90_000);
});

describe("mounted room All column preferences", () => {
  it("renders real direct-room values, descriptors, Note and status in semantic column order", async () => {
    await openView("containers/room-main", "case=values");
    await page!.waitForSelector('#room-direct-chemicals-table tbody tr[data-chemid="room-chem"]');

    const table = "room-direct-chemicals-table";
    expect(await columnIds(table)).toEqual([
      "name",
      "type",
      "quantity",
      "unit",
      "location",
      "concentration",
      "cas_number",
      "molecular_formula",
      "target_species",
      "manufacturer",
      "catalog_number",
      "lot",
      "received",
      "expires",
      "status",
      "note",
      "actions",
    ]);
    expect(await cellText(table, "room-chem", "type")).toBe("Primer");
    expect(await cellText(table, "room-chem", "location")).toBe("Main Test Room");
    expect(await cellText(table, "room-chem", "concentration")).toBe("0 mM");
    expect(await cellText(table, "room-chem", "cas_number")).toBe("77-86-1");
    expect(await cellText(table, "room-chem", "target_species")).toBe("tobacco");
    expect(await cellText(table, "room-chem", "manufacturer")).toBe("Room Products");
    expect(await cellText(table, "room-chem", "catalog_number")).toBe("ROOM-1");
    expect(await cellText(table, "room-chem", "lot")).toBe("ROOM-LOT");
    expect(await cellText(table, "room-chem", "received")).toBe("1970-01-01");
    expect(await cellText(table, "room-chem", "expires")).toBe("2027-01-02");
    expect(await cellText(table, "room-chem", "status")).toBe("Available");
    expect(await cellText(table, "room-chem", "note")).toBe("Actual room stock note");
    expect(await cellText(table, "room-chem", "cas_number")).not.toBe("50-00-0");
    expect(await page!.locator(`#${table} tr[data-chemid="room-chem"] td[data-column="molecular_formula"] sub`).first().textContent()).toBe("6");
    expect(await cellText(table, "room-blank", "status")).toBe("Available");
    expect(await cellText(table, "room-blank", "note")).toBe("—");
    expect(await cellText(table, "room-blank", "target_species")).toBe("—");
    expect(await cellText(table, "room-other", "note")).toBe("Other room descriptor fallback");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("normalizes legacy custom_notes to actual Note and applies type/quantity/location visibility to rooms and detail", async () => {
    roomPreferenceColumns = ["name", "custom_notes", "actions"];
    await openView("containers/room-main", "case=alias");
    await page!.waitForSelector("#room-direct-chemicals-table");
    expect(await columnIds("room-direct-chemicals-table")).toEqual(["name", "note", "actions"]);
    expect(await cellText("room-direct-chemicals-table", "room-chem", "note")).toBe("Actual room stock note");
    expect(await cellText("room-direct-chemicals-table", "room-blank", "note")).toBe("—");
    expect(await cellText("room-direct-chemicals-table", "room-other", "note")).toBe("Other room descriptor fallback");

    await openView("detail/room-main/cont-main", "case=detail-minimal");
    await page!.waitForSelector("#container-direct-chemicals-table");
    expect(await columnIds("container-direct-chemicals-table")).toEqual(["name", "note", "actions"]);
    expect(await cellText("container-direct-chemicals-table", "container-chem", "note")).toBe("Container direct note");

    // On detail rows the Type preference controls the legacy inline chip, not a fake Type filter.
    roomPreferenceColumns = ["name", "type", "quantity", "location", "note", "actions"];
    await openView("detail/room-main/cont-main", "case=detail-types&q=Nested");
    await page!.waitForSelector("#nested-box-chemicals-table-nested-box");
    expect(await columnIds("nested-box-chemicals-table-nested-box")).toEqual([
      "position",
      "name",
      "quantity",
      "unit",
      "note",
      "actions",
    ]);
    expect(await page!.locator('#nested-box-chemicals-table-nested-box tr[data-chemid="nested-chem"] .status-badge').textContent()).toBe(
      "Primer",
    );
    expect(await cellText("nested-box-chemicals-table-nested-box", "nested-chem", "note")).toBe("Nested box note");
  }, 40_000);

  it("shows legacy direct-room columns and an honest error while initial preferences are unconfirmed", async () => {
    preferenceStatus = 503;
    await openView("containers/room-main", "case=load-error&uid=synthetic-room-user-error");
    await page!.waitForSelector("#room-direct-chemicals-table");
    expect(await columnIds("room-direct-chemicals-table")).toEqual([
      "name",
      "type",
      "quantity",
      "unit",
      "location",
      "actions",
    ]);
    expect(await page!.locator('[role="alert"]').textContent()).toContain("not confirmed account settings");
    expect(await page!.locator('#room-direct-chemicals-table tr[data-chemid="room-chem"] .room-chemical-meta').textContent()).toBe("0 mM");
    preferenceStatus = 200;
  }, 40_000);

  it("keeps matched-box navigation through the chemical name when Location is hidden", async () => {
    roomPreferenceColumns = ["name", "actions"];
    await openView("detail/room-main/cont-freezer", "case=deep-navigation&q=Deep");
    await page!.waitForSelector('#deepfreezer-search-chemicals-table tr[data-chemid="deep-chem"]');
    expect(await columnIds("deepfreezer-search-chemicals-table")).toEqual(["name", "actions"]);
    const nameLink = page!.locator('#deepfreezer-search-chemicals-table tr[data-chemid="deep-chem"] .chemical-name-link');
    expect(await nameLink.getAttribute("title")).toBe("Open Rack 7 / Box B4");
    await nameLink.click();
    await page!.waitForFunction(() => window.location.hash === "#detail/room-main/cont-freezer/rack/7/box/B4");
  }, 40_000);

  it("renders selected deep-freezer boxes with the same actual values and penultimate Note", async () => {
    roomPreferenceColumns = [
      "name",
      "type",
      "quantity",
      "location",
      "concentration",
      "target_species",
      "manufacturer",
      "catalog_number",
      "lot",
      "received",
      "expires",
      "status",
      "note",
      "actions",
    ];
    await openView("detail/room-main/cont-freezer/rack/7/box/B4", "case=deep-values");
    await page!.waitForSelector('#deepfreezer-box-chemicals-table tr[data-chemid="deep-chem"]');
    const table = "deepfreezer-box-chemicals-table";
    const ids = await columnIds(table);
    expect(ids.at(-2)).toBe("note");
    expect(ids.at(-1)).toBe("actions");
    expect(ids).toContain("position");
    expect(await cellText(table, "deep-chem", "position")).toBe("D-1");
    expect(await cellText(table, "deep-chem", "concentration")).toBe("0 µM");
    expect(await cellText(table, "deep-chem", "target_species")).toBe("mouse");
    expect(await cellText(table, "deep-chem", "manufacturer")).toBe("Cold Products");
    expect(await cellText(table, "deep-chem", "lot")).toBe("DEEP-LOT");
    expect(await cellText(table, "deep-chem", "status")).toBe("Available");
    expect(await cellText(table, "deep-chem", "note")).toBe("Deep freezer note");
  }, 40_000);

  it("keeps Directly-in-room printing for readers without exposing write controls", async () => {
    roomPreferenceColumns = ["name", "type", "quantity", "location", "note", "actions"];
    await openView("containers/room-main", "case=reader&role=reader&uid=synthetic-room-reader");
    await page!.waitForSelector('#room-direct-chemicals-table tr[data-chemid="room-chem"]');
    const row = page!.locator('#room-direct-chemicals-table tr[data-chemid="room-chem"]');
    expect(await row.getByRole("button", { name: "Print label for Room primer stock" }).isVisible()).toBe(true);
    expect(await row.locator(".btn-qty").count()).toBe(0);
    expect(await row.getByRole("button", { name: "Edit Room primer stock" }).count()).toBe(0);
    expect(await row.getByRole("button", { name: "Delete Room primer stock" }).count()).toBe(0);
    expect(adjustCalls).toHaveLength(0);
  }, 40_000);
});

describe("mounted chemical availability", () => {
  beforeEach(() => {
    chemicalWrites.length = 0;
    roomPreferenceColumns = ["name", "quantity", "status", "actions"];
  });

  afterEach(() => {
    roomPreferenceColumns = [...allRoomPreferenceColumns];
  });

  it("colors quantities and labels status from derived availability", async () => {
    await openView("containers/room-main", "availability=1&case=availability-table&design=original");
    await page!.waitForSelector('#room-direct-chemicals-table tr[data-chemid="room-out-of-stock"]');

    const cases = [
      { id: "room-out-of-stock", quantity: "0", label: "Out of stock", statusClass: "rejected", quantityClass: "low", color: "--accent-red" },
      { id: "room-low", quantity: "4", label: "Low", statusClass: "pending", quantityClass: "medium", color: "--accent-amber" },
      { id: "room-available", quantity: "4", label: "Available", statusClass: "done", quantityClass: "ok", color: "--accent-green" },
    ];
    for (const item of cases) {
      const row = page!.locator(`#room-direct-chemicals-table tr[data-chemid="${item.id}"]`);
      const quantity = row.locator('td[data-column="quantity"] .chem-quantity');
      const status = row.locator('td[data-column="status"] .status-badge');
      expect((await quantity.textContent())?.trim()).toBe(item.quantity);
      expect(await quantity.getAttribute("class")).toContain(item.quantityClass);
      expect((await status.textContent())?.trim()).toBe(item.label);
      expect(await status.getAttribute("class")).toContain(item.statusClass);
      const expectedColor = await resolvedThemeColor(item.color);
      expect(await quantity.evaluate((element) => getComputedStyle(element).color)).toBe(expectedColor);
      expect(await status.evaluate((element) => getComputedStyle(element).color)).toBe(expectedColor);
    }
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("opens the writer editor with available by default and preserves explicit low", async () => {
    await openView("containers/room-main", "availability=1&case=availability-default");
    await page!.locator('#room-direct-chemicals-table tr[data-chemid="room-available"]')
      .getByRole("button", { name: "Edit Room available stock" }).click();
    await page!.waitForSelector("#f-availability");
    expect(await page!.inputValue("#f-availability")).toBe("available");
    expect(await page!.$$eval("#f-availability option", (options) => options.map((option) => ({
      value: (option as HTMLOptionElement).value,
      label: option.textContent?.trim() ?? "",
    })))).toEqual([
      { value: "available", label: "Available" },
      { value: "low", label: "Low" },
    ]);
    expect((await page!.textContent("#f-availability-hint"))?.trim()).toBe("Zero quantity is always Out of stock.");
    expect(await page!.getByRole("option", { name: "Out of stock", exact: true }).count()).toBe(0);

    await openView("containers/room-main", "availability=1&case=availability-existing-low");
    await page!.locator('#room-direct-chemicals-table tr[data-chemid="room-low"]')
      .getByRole("button", { name: "Edit Room explicit low stock" }).click();
    await page!.waitForSelector("#f-availability");
    expect(await page!.inputValue("#f-availability")).toBe("low");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("sends explicit available and low values in add payloads", async () => {
    for (const [index, availability] of ["available", "low"].entries()) {
      await openView("dashboard", `case=availability-add-${availability}`);
      await page!.click("#btn-dash-add-chemical");
      await page!.waitForSelector("#f-availability");
      await page!.selectOption("#f-room", "room-main");
      await page!.fill("#f-cn2", `Availability ${availability} stock`);
      await page!.fill("#f-cq", "12");
      expect(await page!.inputValue("#f-availability")).toBe("available");
      await page!.selectOption("#f-availability", availability);
      await page!.click("#modal-confirm");
      await expect.poll(() => chemicalWrites.length, { timeout: 10_000 }).toBe(index + 1);
      expect(chemicalWrites[index]).toMatchObject({
        method: "POST",
        path: "/api/groups/group-a/inventory/chemicals",
        body: {
          roomId: "room-main",
          name: `Availability ${availability} stock`,
          quantity: 12,
          availability,
        },
      });
    }
    expect(pageErrors).toEqual([]);
  }, 60_000);

  it("sends the selected availability in an edit payload", async () => {
    await openView("containers/room-main", "availability=1&case=availability-edit");
    await page!.locator('#room-direct-chemicals-table tr[data-chemid="room-low"]')
      .getByRole("button", { name: "Edit Room explicit low stock" }).click();
    await page!.waitForSelector("#f-availability");
    expect(await page!.inputValue("#f-availability")).toBe("low");
    await page!.selectOption("#f-availability", "available");
    await page!.click("#modal-confirm");

    await expect.poll(() => chemicalWrites.length, { timeout: 10_000 }).toBe(1);
    expect(chemicalWrites[0]).toMatchObject({
      method: "PUT",
      path: "/api/groups/group-a/inventory/chemicals/room-low",
      body: {
        roomId: "room-main",
        name: "Room explicit low stock",
        quantity: 4,
        availability: "available",
      },
    });
    expect(pageErrors).toEqual([]);
  }, 40_000);
});

describe("mounted chemical placement context", () => {
  beforeEach(() => {
    chemicalWrites.length = 0;
    roomPreferenceColumns = ["name", "quantity", "note", "actions"];
  });

  afterEach(() => {
    roomPreferenceColumns = [...allRoomPreferenceColumns];
  });

  it("preselects the clicked cabinet shelf instead of Auto, first shelf or direct container", async () => {
    await openView("detail/room-main/cont-placement-cabinet", "placement=1&case=placement-cabinet");
    await page!.locator('.shelf-section[data-sid="cabinet-shelf-b"]')
      .getByTitle("Add Chemical to Shelf").click();
    await continueWithoutRadio();

    const placement = page!.locator("#f-cab-shelf");
    expect(await placement.inputValue()).toBe("cabinet-shelf-b");
    expect(await placement.locator("option:checked").textContent()).toBe("Manual: Shelf B");
    expect(await placement.inputValue()).not.toBe("auto");
    expect(await placement.inputValue()).not.toBe("cabinet-shelf-a");
    expect(await placement.inputValue()).not.toBe("cont-placement-cabinet");

    await page!.fill("#f-cn2", "Cabinet targeted stock");
    await page!.click("#modal-confirm");
    await expect.poll(() => chemicalWrites.length, { timeout: 10_000 }).toBe(1);
    expect(chemicalWrites[0]).toMatchObject({
      method: "POST",
      path: "/api/groups/group-a/inventory/chemicals",
      body: {
        roomId: "room-main",
        containerId: "cont-placement-cabinet",
        shelfId: "cabinet-shelf-b",
        name: "Cabinet targeted stock",
      },
    });
    expect(chemicalWrites[0]?.body).not.toHaveProperty("boxId");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  for (const entry of [
    { label: "fridge", containerId: "cont-placement-fridge", shelfId: "fridge-shelf-b" },
    { label: "freezer", containerId: "cont-placement-freezer", shelfId: "freezer-shelf-b" },
  ] as const) {
    it(`preselects and submits the clicked ${entry.label} shelf`, async () => {
      await openView(`detail/room-main/${entry.containerId}`, `placement=1&case=placement-${entry.label}`);
      await page!.locator(`.shelf-section[data-sid="${entry.shelfId}"]`)
        .getByTitle("Add Chemical to Shelf").click();
      await continueWithoutRadio();

      expect(await page!.inputValue("#f-shelf")).toBe(entry.shelfId);
      await page!.fill("#f-cn2", `${entry.label} targeted stock`);
      await page!.click("#modal-confirm");
      await expect.poll(() => chemicalWrites.length, { timeout: 10_000 }).toBe(1);
      expect(chemicalWrites[0]).toMatchObject({
        method: "POST",
        path: "/api/groups/group-a/inventory/chemicals",
        body: {
          roomId: "room-main",
          containerId: entry.containerId,
          shelfId: entry.shelfId,
          name: `${entry.label} targeted stock`,
        },
      });
      expect(chemicalWrites[0]?.body).not.toHaveProperty("boxId");
      expect(pageErrors).toEqual([]);
    }, 40_000);
  }

  it("preselects a nested box and submits its parent shelf and box ids", async () => {
    await openView("detail/room-main/cont-placement-fridge", "placement=1&case=placement-nested&q=Nested");
    const boxSection = page!.locator(".box-chemicals-section").filter({ hasText: "Placement Nested Box Chemicals" });
    await boxSection.getByRole("button", { name: /Add Chemical/ }).click();
    await continueWithoutRadio();

    expect(await page!.inputValue("#f-shelf")).toBe("fridge-nested-box");
    expect(await page!.locator("#f-shelf option:checked").textContent()).toBe("Box: Placement Nested Box");
    await page!.fill("#f-cn2", "Nested box targeted stock");
    await page!.click("#modal-confirm");
    await expect.poll(() => chemicalWrites.length, { timeout: 10_000 }).toBe(1);
    expect(chemicalWrites[0]).toMatchObject({
      method: "POST",
      path: "/api/groups/group-a/inventory/chemicals",
      body: {
        roomId: "room-main",
        containerId: "cont-placement-fridge",
        shelfId: "fridge-shelf-b",
        boxId: "fridge-nested-box",
        name: "Nested box targeted stock",
      },
    });
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("keeps Auto as the top Add Chemical default when no shelf context is provided", async () => {
    await openView("detail/room-main/cont-placement-cabinet", "placement=1&case=placement-top-default");
    await openChemicalFromContext("cont-placement-cabinet");

    const placement = page!.locator("#f-cab-shelf");
    expect(await placement.inputValue()).toBe("auto");
    expect(await placement.locator("option:checked").textContent()).toBe("Auto – alphabetically by first letter");
    expect(chemicalWrites).toHaveLength(0);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("preselects and submits an explicit deep-freezer box", async () => {
    await openView("detail/room-main/cont-freezer", "placement=1&case=placement-deep-freezer");
    await openChemicalFromContext("cont-freezer", "box-cryo-second");

    expect(await page!.inputValue("#f-shelf")).toBe("box-cryo-second");
    await page!.fill("#f-cn2", "Deep freezer targeted stock");
    await page!.click("#modal-confirm");
    await expect.poll(() => chemicalWrites.length, { timeout: 10_000 }).toBe(1);
    expect(chemicalWrites[0]).toMatchObject({
      method: "POST",
      path: "/api/groups/group-a/inventory/chemicals",
      body: {
        roomId: "room-main",
        containerId: "cont-freezer",
        shelfId: "box-cryo-second",
        name: "Deep freezer targeted stock",
      },
    });
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("falls back to the existing cabinet default when the requested shelf no longer exists", async () => {
    await openView("detail/room-main/cont-main", "case=placement-stale-shelf");
    await openChemicalFromContext("cont-main", "deleted-shelf");

    expect(await page!.inputValue("#f-cab-shelf")).not.toBe("deleted-shelf");
    await page!.fill("#f-cn2", "Recovered shelf stock");
    await page!.click("#modal-confirm");
    await expect.poll(() => chemicalWrites.length, { timeout: 10_000 }).toBe(1);
    expect(chemicalWrites[0]).toMatchObject({
      method: "POST",
      body: {
        roomId: "room-main",
        containerId: "cont-main",
        shelfId: "shelf-main",
        name: "Recovered shelf stock",
      },
    });
    expect(chemicalWrites[0]?.body.shelfId).not.toBe("deleted-shelf");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("preserves valid direct-container placement for a fridge add", async () => {
    await openView("detail/room-main/cont-placement-fridge", "placement=1&case=placement-direct-add");
    await openChemicalFromContext("cont-placement-fridge", "cont-placement-fridge");

    expect(await page!.inputValue("#f-shelf")).toBe("cont-placement-fridge");
    await page!.fill("#f-cn2", "Direct container targeted stock");
    await page!.click("#modal-confirm");
    await expect.poll(() => chemicalWrites.length, { timeout: 10_000 }).toBe(1);
    expect(chemicalWrites[0]).toMatchObject({
      method: "POST",
      body: {
        roomId: "room-main",
        containerId: "cont-placement-fridge",
        name: "Direct container targeted stock",
      },
    });
    expect(chemicalWrites[0]?.body).not.toHaveProperty("shelfId");
    expect(chemicalWrites[0]?.body).not.toHaveProperty("boxId");
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("keeps direct-container cabinet editing selected as before", async () => {
    await openView("detail/room-main/cont-main", "case=placement-direct-edit");
    await page!.locator('#container-direct-chemicals-table tr[data-chemid="container-chem"]')
      .getByRole("button", { name: "Edit Container direct stock" }).click();
    await page!.waitForSelector("#f-cab-shelf");

    expect(await page!.textContent("#modal-title")).toBe("Edit Chemical");
    expect(await page!.inputValue("#f-cab-shelf")).toBe("cont-main");
    expect(await page!.locator("#f-cab-shelf option:checked").textContent()).toBe("Directly in this container");
    expect(chemicalWrites).toHaveLength(0);
    expect(pageErrors).toEqual([]);
  }, 40_000);
});

describe("mounted shelf rename action", () => {
  it("uses the edit SVG in both themes and opens the rename modal", async () => {
    for (const design of ["original", "bauhaus"] as const) {
      await openView("detail/room-main/cont-main", `design=${design}`);
      const renameButton = page!.locator('.shelf-section[data-sid="shelf-main"]')
        .getByRole("button", { name: "Rename shelf Shelf A", exact: true });

      expect(await renameButton.locator("svg").count()).toBe(1);
      expect((await renameButton.textContent()) ?? "").not.toContain("R");
      await renameButton.click();
      await page!.waitForSelector("#f-sn");
      expect(await page!.textContent("#modal-title")).toBe("Rename Shelf");
      expect(await page!.inputValue("#f-sn")).toBe("Shelf A");
    }
    expect(pageErrors).toEqual([]);
  }, 40_000);
});

describe("mounted chemical writer context", () => {
  it("uses the real room/container/shelf/box IDs for direct, nested and deep-freezer quantity writers", async () => {
    roomPreferenceColumns = ["name", "quantity", "note", "actions"];
    const cases = [
      {
        hash: "containers/room-main",
        params: "case=writer-room",
        table: "room-direct-chemicals-table",
        chemical: "room-chem",
        expected: { roomId: "room-main", delta: 1 },
      },
      {
        hash: "detail/room-main/cont-main",
        params: "case=writer-container",
        table: "container-direct-chemicals-table",
        chemical: "container-chem",
        expected: { roomId: "room-main", containerId: "cont-main", delta: 1 },
      },
      {
        hash: "detail/room-main/cont-main",
        params: "case=writer-shelf&q=Shelf",
        table: "shelf-chemicals-table-shelf-main",
        chemical: "shelf-chem",
        expected: { roomId: "room-main", containerId: "cont-main", shelfId: "shelf-main", delta: 1 },
      },
      {
        hash: "detail/room-main/cont-main",
        params: "case=writer-nested&q=Nested",
        table: "nested-box-chemicals-table-nested-box",
        chemical: "nested-chem",
        expected: { roomId: "room-main", containerId: "cont-main", shelfId: "nested-box", delta: 1 },
      },
      {
        hash: "detail/room-main/cont-freezer",
        params: "case=writer-search&q=Deep",
        table: "deepfreezer-search-chemicals-table",
        chemical: "deep-chem",
        expected: { roomId: "room-main", containerId: "cont-freezer", shelfId: "box-cryo", delta: 1 },
      },
      {
        hash: "detail/room-main/cont-freezer/rack/7/box/B4",
        params: "case=writer-deep-box",
        table: "deepfreezer-box-chemicals-table",
        chemical: "deep-chem",
        expected: { roomId: "room-main", containerId: "cont-freezer", shelfId: "box-cryo", delta: 1 },
      },
    ];

    for (const [index, entry] of cases.entries()) {
      await openView(entry.hash, entry.params);
      await page!.waitForSelector(`#${entry.table} tr[data-chemid="${entry.chemical}"]`);
      await page!.locator(`#${entry.table} tr[data-chemid="${entry.chemical}"] button[aria-label^="Increase quantity"]`).click();
      await expect.poll(() => adjustCalls.length, { timeout: 10_000 }).toBe(index + 1);
      expect(adjustCalls[index]).toEqual({
        path: `/api/groups/group-a/inventory/chemicals/${entry.chemical}/adjust-qty`,
        body: entry.expected,
      });
    }
    expect(pageErrors).toEqual([]);
  }, 90_000);
});
