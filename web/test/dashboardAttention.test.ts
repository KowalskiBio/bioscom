import { describe, expect, it } from "vitest";
import type { Chemical, InventoryTree, Notice } from "@bioscom/shared";
import {
  buildDashboardNoticeAlerts,
  buildDashboardStockAlerts,
  cleanDashboardText,
  collectDashboardStockLocations,
  dashboardExpiryAlert,
  dashboardQuantityAlert,
  withoutDismissedAlerts,
} from "../src/lib/dashboardAttention";

const NOW = Date.UTC(2026, 10, 15, 12);
const days = (count: number): number => Date.UTC(2026, 10, 15 + count);

function chemical(
  id: string,
  name: string,
  quantity: unknown,
  expiresAt?: unknown,
  availability?: Chemical["availability"],
): Chemical {
  return {
    id,
    name,
    quantity,
    unit: "mL",
    ...(availability === undefined ? {} : { availability }),
    ...(expiresAt === undefined ? {} : { batchInfo: { expiresAt } }),
  } as Chemical;
}

function locationTree(): InventoryTree {
  return {
    rooms: [
      {
        id: "room-main",
        name: "Main 🧪 Room",
        chemicals: [chemical("room-stock", "Room stock", 0)],
        containers: [
          {
            id: "cont-main",
            name: "Cabinet",
            type: "cabinet",
            chemicals: [chemical("container-stock", "Container stock", 4, undefined, "low")],
            shelves: [
              {
                id: "shelf-a",
                name: "Shelf A",
                chemicals: [chemical("shelf-stock", "Shelf stock", 12)],
              },
              {
                id: "box-b",
                name: "Nested Box B",
                parentShelfId: "shelf-a",
                chemicals: [chemical("nested-stock", "Nested stock", 2, days(2), "low")],
              },
            ],
          },
        ],
      },
    ],
    deepFreezers: [
      {
        id: "freezer-root",
        name: "Root Freezer",
        type: "deepfreezer",
        chemicals: [chemical("freezer-direct", "Freezer direct stock", 20)],
        shelves: [
          {
            id: "freezer-box",
            name: "Rack A 2 / Box B 4",
            chemicals: [chemical("freezer-stock", "Freezer stock", 12, days(-1))],
          },
        ],
      },
    ],
  } as InventoryTree;
}

describe("dashboard quantity and expiry triggers", () => {
  it("uses explicit availability without automatic low thresholds", () => {
    expect(dashboardQuantityAlert({ quantity: -1 })).toEqual({ quantity: -1, level: "low" });
    expect(dashboardQuantityAlert({ quantity: 0 })).toEqual({ quantity: 0, level: "low" });
    expect(dashboardQuantityAlert({ quantity: 0, availability: "low" })).toEqual({ quantity: 0, level: "low" });
    expect(dashboardQuantityAlert({ quantity: undefined })).toEqual({ quantity: 0, level: "low" });
    expect(dashboardQuantityAlert({ quantity: null })).toEqual({ quantity: 0, level: "low" });
    expect(dashboardQuantityAlert({ quantity: Number.NaN })).toEqual({ quantity: 0, level: "low" });
    expect(dashboardQuantityAlert({ quantity: "not-a-number" })).toEqual({ quantity: 0, level: "low" });
    expect(dashboardQuantityAlert({ quantity: "9残り" })).toEqual({ quantity: 0, level: "low" });

    for (const quantity of [0.01, 2, 4, 9.999, 10, 100]) {
      expect(dashboardQuantityAlert({ quantity })).toBeNull();
      expect(dashboardQuantityAlert({ quantity, availability: "available" })).toBeNull();
    }
    for (const quantity of [0.01, 2, 4, 9.999, 100]) {
      expect(dashboardQuantityAlert({ quantity, availability: "low" })).toEqual({ quantity, level: "medium" });
    }
  });

  it("uses the catalog UTC-day boundary for expired, today, 60 and 61 days", () => {
    expect(dashboardExpiryAlert(days(-2), NOW)).toMatchObject({
      daysUntilExpiry: -2,
      level: "low",
    });
    expect(dashboardExpiryAlert(days(-1), NOW)?.detail).toMatch(/^Expired /);
    expect(dashboardExpiryAlert(days(0), NOW)).toMatchObject({
      daysUntilExpiry: 0,
      level: "low",
    });
    expect(dashboardExpiryAlert(days(0), NOW)?.detail).toMatch(/^Expires today/);
    expect(dashboardExpiryAlert(days(1), NOW)).toMatchObject({
      daysUntilExpiry: 1,
      level: "medium",
    });
    expect(dashboardExpiryAlert(days(60), NOW)).toMatchObject({
      daysUntilExpiry: 60,
      level: "medium",
    });
    expect(dashboardExpiryAlert(days(61), NOW)).toBeNull();
  });

  it("ignores missing, non-numeric, non-canonical and invalid expiry values", () => {
    for (const value of [undefined, null, "", "2026-11-20", "bad", NaN, Infinity, -1, 1.5]) {
      expect(dashboardExpiryAlert(value, NOW)).toBeNull();
    }
    expect(dashboardExpiryAlert(Number.MAX_SAFE_INTEGER, NOW)).toBeNull();
  });
});

describe("dashboard stock locations and alert identity", () => {
  it("covers direct, shelf, nested-box and root-freezer stock with complete paths and links", () => {
    const locations = collectDashboardStockLocations(locationTree());
    const byId = new Map(locations.map((location) => [location.chemical.id, location]));

    expect([...byId.keys()]).toEqual([
      "room-stock",
      "container-stock",
      "shelf-stock",
      "nested-stock",
      "freezer-direct",
      "freezer-stock",
    ]);
    expect(byId.get("room-stock")).toMatchObject({
      path: "Main Room",
      href: "#containers/room-main",
    });
    expect(byId.get("container-stock")).toMatchObject({
      path: "Main Room · Cabinet",
      href: "#detail/room-main/cont-main",
    });
    expect(byId.get("shelf-stock")).toMatchObject({
      path: "Main Room · Cabinet · Shelf A",
      href: "#detail/room-main/cont-main",
    });
    expect(byId.get("nested-stock")).toMatchObject({
      path: "Main Room · Cabinet · Shelf A · Nested Box B",
      href: "#detail/room-main/cont-main",
    });
    expect(byId.get("freezer-direct")).toMatchObject({
      path: "Root Freezer",
      href: "#detail/freezer-root/freezer-root",
    });
    expect(byId.get("freezer-stock")).toMatchObject({
      path: "Root Freezer · Rack A 2 · Box B 4",
      href: "#detail/freezer-root/freezer-root/rack/A%202/box/B%204",
    });
  });

  it("keeps distinct low and expiry reasons for one stock entity and filters exact keys", () => {
    const alerts = buildDashboardStockAlerts(locationTree(), NOW);
    const nested = alerts.filter((alert) => alert.chemicalId === "nested-stock");
    expect(nested).toHaveLength(2);
    expect(nested.map((alert) => alert.kind).sort()).toEqual(["expiry", "quantity"]);
    expect(nested.map((alert) => alert.dismissalKey).sort()).toEqual([
      `stock-expiry:nested-stock:${days(2)}`,
      "stock-low:nested-stock",
    ]);
    expect(nested.find((alert) => alert.kind === "quantity")?.detail).toContain("Low stock · 2 mL remaining");
    expect(nested.find((alert) => alert.kind === "expiry")?.detail).toContain("Expires in 2 days");

    const remaining = withoutDismissedAlerts(alerts, ["stock-low:nested-stock"]);
    expect(remaining.some((alert) => alert.dismissalKey === "stock-low:nested-stock")).toBe(false);
    expect(remaining.some((alert) => alert.dismissalKey === `stock-expiry:nested-stock:${days(2)}`)).toBe(true);
  });

  it("does not count duplicate discoveries of one trigger as extra entities", () => {
    const tree = locationTree();
    const duplicated = tree.rooms[0]!.chemicals![0]!;
    tree.rooms[0]!.containers![0]!.chemicals!.push(duplicated);
    const alerts = buildDashboardStockAlerts(tree, NOW);
    expect(alerts.filter((alert) => alert.dismissalKey === "stock-low:room-stock")).toHaveLength(1);
  });
});

describe("dashboard notice posts and cleaning", () => {
  it("includes plain issue/info/suggestion/general categories and cleans all post strings", () => {
    const notices = ["issue", "info", "suggestion", "general"].map((category, index) => ({
      id: `notice-${category}`,
      title: ` ${category} 🚨 title\nline `,
      content: ` ${category} body   with 🧪 detail `,
      category,
      authorName: ` Author ${index} 👩‍🔬 `,
      authorLab: ` Lab ${index} 🏢 `,
      timestamp: Date.UTC(2026, 10, index),
      reactions: [
        {
          id: `comment-${category}`,
          text: "comment must not enter the model",
          userName: "reaction user",
          userAvatar: "avatar-url",
        },
      ],
    })) as Notice[];

    const alerts = buildDashboardNoticeAlerts(notices);
    expect(alerts.map((alert) => alert.category).sort()).toEqual([
      "General",
      "Info",
      "Issue",
      "Suggestion",
    ]);
    for (const alert of alerts) {
      const category = alert.category.toLowerCase();
      expect(alert.title).toBe(`${category} title line`);
      expect(alert.content).toBe(`${category} body with detail`);
      expect(alert.authorName).not.toContain("👩");
      expect(alert.authorLab).not.toContain("🏢");
      expect(alert.href).toBe("#noticeboard");
      expect(JSON.stringify(alert)).not.toContain("comment must not enter the model");
      expect(JSON.stringify(alert)).not.toContain("reaction user");
      expect(JSON.stringify(alert)).not.toContain("avatar-url");
    }
  });

  it("collapses all whitespace and strips emoji independently of theme", () => {
    expect(cleanDashboardText("  Hello\n🧪   world\t!  ")).toBe("Hello world !");
    expect(cleanDashboardText(undefined)).toBe("");
  });
});
