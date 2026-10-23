import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { test, expect } from "@playwright/test";

const LOCAL_URL = process.env.LOCAL_URL ?? "http://localhost:4173";
const APP_URL = process.env.APP_URL ?? "https://bioscom-ca01a.web.app";
const EVIDENCE_DIR = ".omo/evidence";

test("task-14: login screen visual parity vs legacy app", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const legacyPage = await context.newPage();
  await legacyPage.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await legacyPage.waitForFunction(
    () => {
      const sel = document.querySelector("#auth-lab-select") as HTMLSelectElement | null;
      return sel !== null && sel.selectedOptions[0]?.textContent === "Choose a laboratory...";
    },
    undefined,
    { timeout: 30_000 },
  );
  await legacyPage.evaluate(() => document.fonts.ready);
  await legacyPage.waitForTimeout(500);
  const legacyPng = PNG.sync.read(await legacyPage.screenshot());

  const localPage = await context.newPage();
  await localPage.goto(LOCAL_URL, { waitUntil: "domcontentloaded" });
  await localPage.waitForSelector("#auth-panel-welcome");
  await localPage.evaluate(() => document.fonts.ready);
  await localPage.waitForTimeout(500);
  const localPng = PNG.sync.read(await localPage.screenshot());

  expect(legacyPng.width, "screenshot widths must match").toBe(localPng.width);
  expect(legacyPng.height, "screenshot heights must match").toBe(localPng.height);
  const { width, height } = legacyPng;

  const diff = new PNG({ width, height });
  const changed = pixelmatch(legacyPng.data, localPng.data, diff.data, width, height, { threshold: 0.1 });
  const ratio = changed / (width * height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      if (diff.data[i]! > 200 && diff.data[i + 1]! < 100 && diff.data[i + 2]! < 100) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const region =
    maxX < 0 ? "none" : `x ${minX}-${maxX}, y ${minY}-${maxY} (${maxX - minX + 1}x${maxY - minY + 1}px)`;

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(`${EVIDENCE_DIR}/task-14-bioscom-vm-migration-legacy.png`, PNG.sync.write(legacyPng));
  writeFileSync(`${EVIDENCE_DIR}/task-14-bioscom-vm-migration-local.png`, PNG.sync.write(localPng));
  writeFileSync(`${EVIDENCE_DIR}/task-14-bioscom-vm-migration-diff.png`, PNG.sync.write(diff));

  expect(
    ratio,
    `login screen pixel diff ${(ratio * 100).toFixed(3)}% (changed ${changed}/${width * height} px, region ${region}) exceeds 2%`,
  ).toBeLessThanOrEqual(0.02);
});

test("task-14: hash router switches views with legacy semantics", async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(LOCAL_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#view-rooms");

  const activeView = () => page.evaluate(() => document.querySelector(".view.active")?.id);

  await page.evaluate(() => {
    window.location.hash = "#protocols";
  });
  await expect
    .poll(activeView)
    .toBe("view-protocols");

  await page.evaluate(() => {
    window.location.hash = "#containers/room-1";
  });
  await expect
    .poll(activeView)
    .toBe("view-containers");

  await page.evaluate(() => {
    window.location.hash = "#detail/room-1/container-2";
  });
  await expect
    .poll(activeView)
    .toBe("view-detail");

  await page.evaluate(() => {
    window.location.hash = "#minigames";
  });
  await expect
    .poll(activeView)
    .toBe("view-minigames");

  await page.evaluate(() => {
    window.location.hash = "#not-a-real-view";
  });
  await expect
    .poll(activeView)
    .toBe("view-rooms");

  await page.evaluate(() => {
    document.getElementById("login-overlay")!.classList.add("hidden");
    window.location.hash = "#rooms";
  });
  await page.click("#tab-printing");
  await expect
    .poll(activeView)
    .toBe("view-printing");
  await expect(page).toHaveURL(/#printing$/);

  const navDisplay = await page.evaluate(() => getComputedStyle(document.querySelector(".main-nav")!).display);
  expect(navDisplay).toBe("flex");
  const breadcrumbDisplay = await page.evaluate(() => getComputedStyle(document.querySelector("#breadcrumb")!).display);
  expect(breadcrumbDisplay).toBe("none");
});

