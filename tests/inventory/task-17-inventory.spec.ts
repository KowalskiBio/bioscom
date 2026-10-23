import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "@node-rs/argon2";
import Database from "better-sqlite3";
import { afterAll, beforeAll, expect, test } from "@playwright/test";

const BASE = "http://127.0.0.1:8003";
const TEST_EMAIL = "e2e-inventory@bioscom.test";
const TEST_PASSWORD = "e2e-inventory-pass";
const EMPTY_TREE = JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] });

let server: ChildProcess | null = null;
let dbPath = "";

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("local server did not become healthy");
}

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(BASE);
  await page.click("#btn-to-login");
  await page.fill("#login-email", TEST_EMAIL);
  await page.fill("#login-password-field", TEST_PASSWORD);
  await page.click("#btn-login-submit");
  await expect(page.locator("#login-overlay")).toHaveClass(/hidden/);
  await expect(page.locator("#view-rooms")).toHaveClass(/active/);
}

async function apiGetInventory(): Promise<{ tree: { rooms: unknown[] } }> {
  const res = await fetch(`${BASE}/api/groups/group-e2e/inventory`, {
    headers: { cookie: await apiLoginCookie() },
  });
  return (await res.json()) as { tree: { rooms: unknown[] } };
}

let cachedCookie = "";
async function apiLoginCookie(): Promise<string> {
  if (cachedCookie !== "") {
    return cachedCookie;
  }
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "XMLHttpRequest" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  cachedCookie = setCookie.split(";")[0] ?? "";
  return cachedCookie;
}

const FROG_FILE_NAMES: Record<string, string> = {
  Dendrobates_auratus: "Dendrobates auratus",
  Dendrobates_azureus: "Dendrobates azureus",
  Dendrobates_leucomelas: "Dendrobates leucomelas",
  Dendrobates_tinctorius_citronella: "Dendrobates tinctorius citronella",
  Dendrobates_tinctorius_nominant: "Dendrobates tinctorius nominant",
  Dendrobates_tinctorius_tumucumaque: "Dendrobates tinctorius tumucumaque",
  Dendrobates_truncatus: "Dendrobates truncatus",
  Excidobates_captivus: "Excidobates captivus",
  Excidobates_mysteriosus: "Excidobates mysteriosus",
  Oophaga_histrionica: "Oophaga histrionica",
  Oophaga_pumilio: "Oophaga pumilio",
  Oophaga_sylvatica: "Oophaga sylvatica",
  Phyllobates_aurotaenia: "Phyllobates aurotaenia",
  Phyllobates_bicolor: "Phyllobates bicolor",
  Phyllobates_terribillis: "Phyllobates terribillis",
  Ranitomeya_fulgurita: "Ranitomeya fulgurita",
  "pralesnicka-pruhovana-phyllobates-vittatus-2631": "Phyllobates vittatus",
};

async function captchaAnswer(page: import("@playwright/test").Page): Promise<{ correct: string; wrong: string }> {
  const src = await page.getAttribute("#modal-body img", "src");
  expect(src).not.toBeNull();
  const match = src!.match(/\/([A-Za-z0-9_-]+)-[A-Za-z0-9]{8}\.(?:jpg|webp|png)/);
  expect(match).not.toBeNull();
  const correct = FROG_FILE_NAMES[match![1]!] ?? "";
  expect(correct).not.toBe("");
  const options = await page.locator("#modal-body .btn-primary").allTextContents();
  const wrong = options.map((o) => o.trim()).find((o) => o !== correct);
  expect(wrong).toBeDefined();
  return { correct, wrong: wrong! };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-e2e-inventory-"));
  dbPath = join(dir, "e2e.db");
  server = spawn("node", ["server/dist/index.js"], {
    env: {
      ...process.env,
      PORT: "8003",
      DB_PATH: dbPath,
      SESSION_SECRET: "e2e-test-secret",
      LOGIN_RATE_LIMIT: "1000",
    },
    stdio: "ignore",
  });
  server.on("error", () => {
    // another worker may own the port
  });
  await waitForHealth();
  const db = new Database(dbPath);
  db.prepare(
    "INSERT OR IGNORE INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, 'admin', ?)",
  ).run("uid-e2e-inv", TEST_EMAIL, await hash(TEST_PASSWORD), "Inv Tester", "group-e2e");
  db.prepare("INSERT OR IGNORE INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)").run(
    "group-e2e",
    "E2E Inv Lab",
    "E2EI-111",
    Date.now(),
  );
  db.prepare("INSERT OR IGNORE INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)").run(
    "group-e2e",
    EMPTY_TREE,
  );
  db.close();
}, 120_000);

afterAll(() => {
  server?.kill();
});

test.describe.configure({ mode: "serial" });

test("add room -> add freezer -> add shelf -> add chemical with position -> appears in shelf row", async ({ page }) => {
  await login(page);

  await page.click("#btn-add-room");
  await page.fill("#f-rn", "E2E Room");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: 'Room "E2E Room" added' })).toBeVisible();
  await expect(page.locator("#rooms-grid .card-title", { hasText: "E2E Room" })).toBeVisible();

  await page.click("#rooms-grid .card:has-text('E2E Room')");
  await expect(page.locator("#containers-title")).toHaveText("Room: E2E Room");

  await page.click("#btn-add-freezer");
  await page.fill("#c-name", "E2E Freezer");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: 'Freezer "E2E Freezer" added' })).toBeVisible();
  await expect(page.locator("#freezers-grid .card-title", { hasText: "E2E Freezer" })).toBeVisible();

  await page.click("#freezers-grid .card:has-text('E2E Freezer')");
  await expect(page.locator("#view-detail")).toHaveClass(/active/);
  await expect(page.locator(".shelf-section")).toHaveCount(4);

  await page.click("#btn-add-shelf");
  await page.fill("#f-sn", "E2E Extra Shelf");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: 'Shelf "E2E Extra Shelf" added' })).toBeVisible();
  await expect(page.locator(".shelf-section")).toHaveCount(5);

  await page.click("#btn-add-chemical");
  await page.click("#modal-body button[data-radio-action='none']");
  await page.fill("#f-cn2", "Sodium Chloride");
  await page.fill("#f-cf", "NaCl");
  await page.fill("#f-cq", "5");
  await page.selectOption("#f-cu", "g");
  await page.fill("#f-cpos", "M4-custom");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: 'Chemical "Sodium Chloride" added' })).toBeVisible();
  await expect(page.locator("tr[data-chemid] .chem-name", { hasText: "Sodium Chloride" })).toBeVisible();
  await expect(page.locator("tr[data-chemid] .chem-pos", { hasText: "M4-custom" })).toBeVisible();
});

test("chemical form with empty name is blocked with the legacy error and nothing is written", async ({ page }) => {
  await login(page);
  await page.click("#rooms-grid .card:has-text('E2E Room')");
  await page.click("#freezers-grid .card:has-text('E2E Freezer')");
  const before = await apiGetInventory();

  await page.click("#btn-add-chemical");
  await page.click("#modal-body button[data-radio-action='none']");
  await page.fill("#f-cn2", "");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "Chemical name is required (max 100 chars)" })).toBeVisible();
  await page.waitForTimeout(300);

  const after = await apiGetInventory();
  expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  await page.click("#modal-cancel");
  await expect(page.locator("#modal-overlay")).not.toHaveClass(/active/);
});

async function openShelfWith(page: import("@playwright/test").Page, text: string): Promise<void> {
  const shelf = page.locator(".shelf-section", { hasText: text }).first();
  if ((await shelf.getAttribute("class"))?.includes("open") !== true) {
    await shelf.locator(".shelf-header").click();
    await page.waitForTimeout(400);
  }
}

test("adjustQty minus and plus clamp at zero and update the row", async ({ page }) => {
  await login(page);
  await page.click("#rooms-grid .card:has-text('E2E Room')");
  await page.click("#freezers-grid .card:has-text('E2E Freezer')");
  await openShelfWith(page, "Sodium Chloride");

  const row = page.locator("tr[data-chemid]", { hasText: "Sodium Chloride" });
  await expect(row.locator(".chem-quantity")).toHaveText("5");
  await row.locator(".btn-qty").first().click();
  await expect(row.locator(".chem-quantity")).toHaveText("4");
  for (let i = 0; i < 6; i += 1) {
    await row.locator(".btn-qty").first().click();
  }
  await expect(row.locator(".chem-quantity")).toHaveText("0");
  await row.locator(".btn-qty").nth(1).click();
  await expect(row.locator(".chem-quantity")).toHaveText("1");
});

test("edit chemical saves the new name", async ({ page }) => {
  await login(page);
  await page.click("#rooms-grid .card:has-text('E2E Room')");
  await page.click("#freezers-grid .card:has-text('E2E Freezer')");
  await openShelfWith(page, "Sodium Chloride");
  const row = page.locator("tr[data-chemid]", { hasText: "Sodium Chloride" });
  await row.locator(".btn-inline").first().click();
  await page.fill("#f-cn2", "Sodium Chloride Pure");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "Chemical saved" })).toBeVisible();
  await expect(page.locator("tr[data-chemid] .chem-name", { hasText: "Sodium Chloride Pure" })).toBeVisible();
});

test("global search finds the chemical and navigates to its row", async ({ page }) => {
  await login(page);
  await page.fill("#search-input", "sodium chl");
  await expect(page.locator("#autocomplete-list .autocomplete-item", { hasText: "Sodium Chloride Pure" })).toBeVisible();
  await page.click("#autocomplete-list .autocomplete-item:has-text('Sodium Chloride Pure')");
  await expect(page.locator("#view-detail")).toHaveClass(/active/);
  await expect(page.locator("tr[data-chemid] .chem-name", { hasText: "Sodium Chloride Pure" })).toBeVisible();
});

test("wrong captcha blocks deletion; correct captcha deletes", async ({ page }) => {
  await login(page);
  await page.click("#rooms-grid .card:has-text('E2E Room')");
  await page.click("#freezers-grid .card:has-text('E2E Freezer')");
  await openShelfWith(page, "Sodium Chloride Pure");
  const row = page.locator("tr[data-chemid]", { hasText: "Sodium Chloride Pure" });
  await row.locator(".btn-inline.danger").click();
  await expect(page.locator("#modal-overlay")).toHaveClass(/active/);
  await page.click("#modal-confirm");

  const { correct, wrong } = await captchaAnswer(page);
  await page.locator("#modal-body .btn-primary", { hasText: wrong }).click();
  await expect(page.locator(".toast", { hasText: "Wrong frog! Try again." })).toBeVisible();
  await expect(row).toBeVisible();
  expect((await apiGetInventory()).tree.rooms.length).toBeGreaterThan(0);

  await row.locator(".btn-inline.danger").click();
  await page.click("#modal-confirm");
  const answer = await captchaAnswer(page);
  await page.locator("#modal-body .btn-primary", { hasText: answer.correct }).click();
  await expect(page.locator(".toast", { hasText: "Deleted" })).toBeVisible();
  await expect(page.locator("tr[data-chemid]", { hasText: "Sodium Chloride Pure" })).toHaveCount(0);
});

test("asset with barcode renders the barcode SVG with expected content", async ({ page }) => {
  await login(page);
  await page.click("#tab-assets");
  await expect(page.locator("#view-assets")).toHaveClass(/active/);

  await page.click("#btn-add-asset-room");
  await page.fill("#ar-name", "E2E Asset Room");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "Asset room added" })).toBeVisible();

  await page.click("#btn-add-asset");
  await page.fill("#a-name", "E2E Centrifuge");
  await page.fill("#a-barcode", "12345678");
  await page.selectOption("#a-room", { label: "E2E Asset Room" });
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "Asset added" })).toBeVisible();

  const barcode = page.locator(".asset-card .barcode-render");
  await expect(barcode).toBeVisible();
  await expect(barcode).toHaveAttribute("data-barcode", "12345678");
  const bbox = await barcode.evaluate((el) => {
    const box = (el as SVGSVGElement).getBBox();
    return { width: box.width, height: box.height, rects: el.querySelectorAll("rect, path").length };
  });
  expect(bbox.width).toBeGreaterThan(50);
  expect(bbox.rects).toBeGreaterThan(10);
});

test("PDF export opens a printable popup with the inventory content", async ({ page }) => {
  await login(page);
  const popupPromise = page.waitForEvent("popup");
  await page.click("#btn-export-pdf");
  const popup = await popupPromise;
  await popup.waitForFunction(() => document.readyState === "complete");
  await popup.waitForTimeout(300);
  const body = await popup.evaluate(() => document.body.innerText);
  expect(body).toContain("BioSCom – Chemical Inventory");
  expect(body).toContain("E2E Room");
  expect(body).toContain("E2E Freezer");
  await popup.close();
});
