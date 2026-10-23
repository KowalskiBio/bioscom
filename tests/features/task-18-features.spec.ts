import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "@node-rs/argon2";
import Database from "better-sqlite3";
import { afterAll, beforeAll, expect, test } from "@playwright/test";

const BASE = "http://127.0.0.1:8003";
const TEST_EMAIL = "e2e-features@bioscom.test";
const TEST_PASSWORD = "e2e-features-pass";
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
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-e2e-features-"));
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
  const insert = db.prepare(
    "INSERT OR IGNORE INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  );
  insert.run("uid-feat", TEST_EMAIL, await hash(TEST_PASSWORD), "Feat Tester", "superadmin", "group-feat");
  insert.run("uid-colleague", "colleague@bioscom.test", await hash("colleague-pass-1"), "Colleague", "member", "group-feat");
  db.prepare("INSERT OR IGNORE INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)").run(
    "group-feat",
    "E2E Features Lab",
    "E2EF-111",
    Date.now(),
  );
  db.prepare("INSERT OR IGNORE INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)").run(
    "group-feat",
    EMPTY_TREE,
  );
  db.close();
}, 120_000);

afterAll(() => {
  server?.kill();
});

test.describe.configure({ mode: "serial" });

test("noticeboard: create, react, edit, delete with captcha", async ({ page }) => {
  await login(page);
  await page.click("#tab-noticeboard");
  await expect(page.locator("#view-noticeboard")).toHaveClass(/active/);

  await page.click("#btn-add-notice");
  await page.fill("#n-title", "E2E Notice Title");
  await page.selectOption("#n-category", "suggestion");
  await page.fill("#n-content", "Please label the acid bottles.");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "Notice added successfully" })).toBeVisible();
  await expect(page.locator(".protocol-card", { hasText: "E2E Notice Title" })).toBeVisible();

  await page.locator(".protocol-card", { hasText: "E2E Notice Title" }).locator("button[title='Heart']").click();
  await expect(page.locator(".protocol-card", { hasText: "E2E Notice Title" }).locator(".notice-reactions-container", { hasText: "❤️" })).toBeVisible();

  await page.locator(".protocol-card", { hasText: "E2E Notice Title" }).locator("button[title='Edit']").click();
  await page.fill("#n-title", "E2E Notice Title Edited");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "Notice updated successfully" })).toBeVisible();

  await page.locator(".protocol-card", { hasText: "E2E Notice Title Edited" }).locator("button[title='Delete']").click();
  await page.click("#modal-confirm");
  await expect(page.locator("#modal-body img[alt='Frog']")).toBeVisible();
  const src = await page.getAttribute("#modal-body img", "src");
  const match = (src!.split("/").pop() ?? "").split("-");
  match.pop();
  const names: Record<string, string> = {
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
  const correct = names[match.join("-")] ?? "";
  expect(correct).not.toBe("");
  const options = await page.locator("#modal-body .btn-primary").allTextContents();
  const wrongOption = options.map((o) => o.trim()).find((o) => o !== correct);
  expect(wrongOption).toBeDefined();
  await page.locator("#modal-body .btn-primary", { hasText: wrongOption! }).click();
  await expect(page.locator(".toast", { hasText: "Wrong frog! Try again." })).toBeVisible();
  await expect(page.locator(".protocol-card", { hasText: "E2E Notice Title Edited" })).toBeVisible();

  await page.locator(".protocol-card", { hasText: "E2E Notice Title Edited" }).locator("button[title='Delete']").click();
  await page.click("#modal-confirm");
  const src2 = await page.getAttribute("#modal-body img", "src");
  const dashParts2 = (src2!.split("/").pop() ?? "").split("-");
  dashParts2.pop();
  const correct2 = names[dashParts2.join("-")] ?? "";
  expect(correct2).not.toBe("");
  await page.locator("#modal-body .btn-primary", { hasText: correct2 }).click();
  await expect(page.locator(".toast", { hasText: "Notice deleted" })).toBeVisible();
  await expect(page.locator(".protocol-card", { hasText: "E2E Notice Title Edited" })).toHaveCount(0);
});

test("instrument booking: create, book, conflict rejected, cancel", async ({ page }) => {
  await login(page);
  await page.click("#tab-instruments");
  await page.click("#btn-add-instrument");
  await page.fill("#i-name", "E2E Spectrophotometer");
  await page.fill("#i-location", "Room B12");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "Instrument added" })).toBeVisible();

  const card = page.locator(".asset-card", { hasText: "E2E Spectrophotometer" });
  await card.locator("button", { hasText: "📅 Book" }).click();
  const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.fill("#b-date", day);
  await page.fill("#b-start", "10:00");
  await page.fill("#b-end", "11:00");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "Instrument booked" })).toBeVisible();
  await expect(card.locator("text=10:00–11:00")).toBeVisible();

  await card.locator("button", { hasText: "📅 Book" }).click();
  await page.fill("#b-date", day);
  await page.fill("#b-start", "10:30");
  await page.fill("#b-end", "11:30");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "already booked" })).toBeVisible();
  await page.click("#modal-cancel");

  await card.locator("button", { hasText: "Cancel" }).click();
  await expect(card.locator("text=10:00–11:00")).toHaveCount(0);
});

test("printing: catalog item, request, status transition", async ({ page }) => {
  await login(page);
  await page.click("#tab-printing");
  await page.click("#btn-add-catalog-item");
  await page.fill("#pc-name", "E2E Tube Rack");
  await page.selectOption("#pc-category", "Racks & Holders");
  await page.fill("#pc-material", "PLA");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "Catalog item added" })).toBeVisible();

  const catalogCard = page.locator(".print-catalog-card", { hasText: "E2E Tube Rack" });
  await catalogCard.locator("button", { hasText: "🖨️ Request" }).click();
  await page.fill("#pr-note", "Please use green filament");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "Print request sent" })).toBeVisible();

  await page.click("#print-tab-requests-btn");
  const requestCard = page.locator(".print-request-card", { hasText: "E2E Tube Rack" });
  await expect(requestCard).toBeVisible();
  await expect(requestCard.locator("text=pending")).toBeVisible();
  await requestCard.locator("button", { hasText: "Start" }).click();
  await expect(requestCard.locator("text=printing")).toBeVisible();
});

test("history: log shows actions, manual backup + restore works", async ({ page }) => {
  await login(page);
  await page.click("#tab-history");
  await expect(page.locator("#view-history")).toHaveClass(/active/);
  await expect(page.locator("#history-log-list .protocol-card").first()).toBeVisible();

  await page.click("#history-tab-backups-btn");
  await page.click("#history-backups-actions button");
  await expect(page.locator(".toast", { hasText: "Backup created" })).toBeVisible();
  const backupCard = page.locator("#history-backups-list .protocol-card").first();
  await expect(backupCard).toBeVisible();
  await backupCard.locator("button", { hasText: "Restore" }).click();
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "Backup restored" })).toBeVisible();
});

test("minigames: frog quiz challenge flow between two users", async ({ page, browser }) => {
  await login(page);
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(BASE);
  await other.click("#btn-to-login");
  await other.fill("#login-email", "colleague@bioscom.test");
  await other.fill("#login-password-field", "colleague-pass-1");
  await other.click("#btn-login-submit");
  await expect(other.locator("#login-overlay")).toHaveClass(/hidden/);

  await page.click("#tab-minigames");
  await page.selectOption("#game-opponent-select", { label: "Colleague" });
  await page.selectOption("#game-type-select", "frog");
  await page.click("#btn-send-game-challenge");
  await expect(page.locator(".toast", { hasText: "Challenge sent" })).toBeVisible();

  await other.click("#tab-minigames");
  await expect(other.locator("#game-active-list", { hasText: "Feat Tester" })).toBeVisible();
  await other.locator("#game-active-list button", { hasText: "Play" }).click();
  await expect(other.locator("#active-game-workspace")).toBeVisible();
  await expect(other.locator("h2", { hasText: "Frog CAPTCHA Quiz — Round 1/5" })).toBeVisible();

  await other.locator(".quiz-option-btn").first().click();
  await other.waitForTimeout(500);
  await expect(other.locator("h2", { hasText: "Frog CAPTCHA Quiz — Round 2/5" })).toBeVisible();
  await context.close();
});

test("user dropdown: profile edit + members modal + theme toggle", async ({ page }) => {
  await login(page);

  await page.click("#btn-user-menu");
  const ddLogs: string[] = [];
  page.on("console", (m) => {
    if (m.text().startsWith("[dd]")) {
      ddLogs.push(m.text());
    }
  });
  await expect(page.locator("#user-dropdown-content")).toHaveClass(/show/);
  await page.locator("#btn-toggle-theme").dispatchEvent("click");
  await expect(page.locator("body")).toHaveClass(/lite-mode/);
  await page.locator("#btn-user-menu").dispatchEvent("click");
  await page.locator("#btn-toggle-theme").dispatchEvent("click");
  await expect(page.locator("body")).not.toHaveClass(/lite-mode/);

  await page.click("#btn-user-menu");
  await page.click("#btn-edit-profile");
  await page.fill("#pf-name", "Feat Tester Renamed");
  await page.click("#modal-confirm");
  await expect(page.locator(".toast", { hasText: "Profile updated" })).toBeVisible();
  await expect(page.locator("#user-badge-name")).toHaveText("Feat Tester Renamed");

  await page.click("#btn-user-menu");
  await page.click("#btn-group-members");
  await expect(page.locator("#modal-body", { hasText: "Feat Tester Renamed" })).toBeVisible();
  await expect(page.locator("#modal-body", { hasText: "Colleague" })).toBeVisible();
  await page.click("#modal-confirm");
});

test("radio widget: play state toggles (network stubbed)", async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    window.addEventListener("play", () => {}, true);
  });
  await page.click("#btn-add-room");
  await page.fill("#f-rn", "Radio Room");
  await page.click("#modal-confirm");
  await page.waitForTimeout(400);
  await page.click("#rooms-grid .card:has-text('Radio Room')");
  await page.click("#btn-add-cabinet");
  await page.fill("#c-name", "Radio Cabinet");
  await page.click("#modal-confirm");
  await page.waitForTimeout(400);
  await page.click("#cabinets-grid .card:has-text('Radio Cabinet')");
  await page.click("#btn-add-chemical");
  await page.click("#modal-body button[data-radio-action='cechomor']");
  await expect(page.locator("#lab-radio-widget")).not.toHaveClass(/hidden/);
  await expect(page.locator("#radio-station")).toHaveText("Čechomor Radio");
  await expect(page.locator("#lab-radio-audio")).toHaveAttribute(
    "src",
    "https://icecast6.play.cz/jihcimbalka128.mp3",
  );
  await page.click("#btn-radio-close");
  await expect(page.locator("#lab-radio-widget")).toHaveClass(/hidden/);
});
