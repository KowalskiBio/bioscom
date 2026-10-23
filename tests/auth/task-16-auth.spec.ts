import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "@node-rs/argon2";
import Database from "better-sqlite3";
import { afterAll, beforeAll, expect, test } from "@playwright/test";

const BASE = "http://127.0.0.1:8003";
const TEST_EMAIL = "e2e-auth@bioscom.test";
const TEST_PASSWORD = "e2e-password-123";
const EMPTY_TREE = JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] });

let server: ChildProcess | null = null;
let dbPath = "";
let emailsPath = "";

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

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-e2e-auth-"));
  dbPath = join(dir, "e2e.db");
  emailsPath = join(dir, "emails.jsonl");
  server = spawn("node", ["server/dist/index.js"], {
    env: {
      ...process.env,
      PORT: "8003",
      DB_PATH: dbPath,
      SESSION_SECRET: "e2e-test-secret",
      LOGIN_RATE_LIMIT: "1000",
      EMAIL_CAPTURE_FILE: emailsPath,
    },
    stdio: "ignore",
  });
  server.on("error", () => {
    // another worker may already own the port; waitForHealth decides
  });
  await waitForHealth();
  const db = new Database(dbPath);
  const insertUser = db.prepare(
    "INSERT OR IGNORE INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, 'admin', ?)",
  );
  insertUser.run("uid-e2e", TEST_EMAIL, await hash(TEST_PASSWORD), "E2E Tester", "group-e2e");
  db.prepare("INSERT OR IGNORE INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)").run(
    "group-e2e",
    "E2E Lab",
    "E2E-111",
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

test("full login reaches the app shell", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(BASE);
  await page.waitForSelector("#auth-panel-welcome");
  await expect(page.locator("#auth-lab-select option")).toHaveCount(2);
  await page.selectOption("#auth-lab-select", "group-e2e");
  await page.click("#btn-to-login");
  await expect(page.locator("#auth-login-subtitle")).toHaveText("Sign In to E2E Lab");
  await page.fill("#login-email", TEST_EMAIL);
  await page.fill("#login-password-field", TEST_PASSWORD);
  await page.click("#btn-login-submit");
  await expect(page.locator("#login-overlay")).toHaveClass(/hidden/);
  await expect(page.locator("#view-rooms")).toHaveClass(/active/);
  await expect(page.locator("#user-badge-name")).toHaveText("E2E Tester");
  await expect(page.locator("#user-badge-lab")).toHaveText("E2E Lab");
  expect(pageErrors).toEqual([]);
});

test("wrong password shows a legacy-style error with no page errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(BASE);
  await page.click("#btn-to-login");
  await page.fill("#login-email", TEST_EMAIL);
  await page.fill("#login-password-field", "definitely-wrong");
  await page.click("#btn-login-submit");
  await expect(page.locator("#auth-login-error")).toHaveClass(/visible/);
  await expect(page.locator("#auth-login-error")).toHaveText("Invalid email or password");
  await expect(page.locator("#auth-panel-login")).toHaveClass(/shake/);
  await page.waitForTimeout(500);
  await expect(page.locator("#auth-panel-login")).not.toHaveClass(/shake/);
  await expect(page.locator("#login-overlay")).not.toHaveClass(/hidden/);
  expect(pageErrors).toEqual([]);
});

test("register-group creates the lab and makes the creator its admin", async ({ page }) => {
  await page.goto(BASE);
  await page.click("#btn-to-register-group");
  await page.fill("#reg-group-labname", "E2E Created Lab");
  await page.fill("#reg-group-name", "E2E Creator");
  await page.fill("#reg-group-email", "creator@bioscom.test");
  await page.fill("#reg-group-password", "creator-pass-1");
  await page.click("#btn-reg-group-submit");
  await expect(page.locator("#login-overlay")).toHaveClass(/hidden/, { timeout: 10_000 });
  await expect(page.locator(".toast", { hasText: "Laboratory group created successfully!" })).toBeVisible();
  await expect(page.locator(".toast", { hasText: /join code is BIOS-/ })).toBeVisible();

  const db = new Database(dbPath);
  const group = db.prepare("SELECT id FROM groups WHERE name = ?").get("E2E Created Lab") as { id: string };
  expect(group).toBeDefined();
  const creator = db
    .prepare("SELECT group_id, role FROM users WHERE email = ?")
    .get("creator@bioscom.test") as { group_id: string; role: string };
  expect(creator.group_id).toBe(group.id);
  expect(creator.role).toBe("admin");
  db.close();
});

test("register-user with a bad join code is blocked with the legacy message", async ({ page }) => {
  await page.goto(BASE);
  await page.click("#btn-to-register-user");
  await page.fill("#reg-user-name", "Joiner");
  await page.fill("#reg-user-email", `joiner-${Date.now()}@bioscom.test`);
  await page.fill("#reg-user-password", "joiner-pass-1");
  await page.fill("#reg-user-code", "NOPE-999");
  await page.click("#btn-reg-user-submit");
  await expect(page.locator("#auth-reg-user-error")).toHaveClass(/visible/);
  await expect(page.locator("#auth-reg-user-error")).toHaveText("Invalid laboratory join code");
  await expect(page.locator("#login-overlay")).not.toHaveClass(/hidden/);
});

test("forgot-password sends a reset link and the reset flow sets a new password", async ({ page }) => {
  await page.goto(BASE);
  await page.click("#btn-to-login");
  await page.fill("#login-email", TEST_EMAIL);
  await page.click("#btn-forgot-password");
  await expect(page.locator(".toast", { hasText: "Password reset email sent!" })).toBeVisible();

  expect(existsSync(emailsPath)).toBe(true);
  const lines = readFileSync(emailsPath, "utf8").trim().split("\n");
  const last = JSON.parse(lines[lines.length - 1]!) as { to: string; resetLink: string };
  expect(last.to).toBe(TEST_EMAIL);
  const token = last.resetLink.split("token=")[1] ?? "";
  expect(token).not.toBe("");

  await page.goto(`${BASE}/#/reset-password?token=${token}`);
  await page.waitForSelector("#auth-panel-reset:not(.hidden)");
  await page.fill("#reset-password-field", "brand-new-pass-1");
  await page.click("#btn-reset-submit");
  await expect(page.locator(".toast", { hasText: "Password has been reset." })).toBeVisible();
  await expect(page.locator("#auth-panel-login:not(.hidden)")).toBeVisible();

  await page.fill("#login-email", TEST_EMAIL);
  await page.fill("#login-password-field", "brand-new-pass-1");
  await page.click("#btn-login-submit");
  await expect(page.locator("#login-overlay")).toHaveClass(/hidden/);
  await expect(page.locator("#view-rooms")).toHaveClass(/active/);
});
