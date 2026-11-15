import { describe, expect, it } from "vitest";
import {
  DASHBOARD_DISMISSALS_MAX_KEYS,
  DashboardDismissalKeySchema,
  DashboardDismissalLimitError,
  DashboardDismissalKeysError,
  applyDashboardDismissal,
  isDashboardDismissalKey,
  normalizeDashboardDismissalKeys,
  noticeDismissalKey,
  stockExpiryDismissalKey,
  stockLowDismissalKey,
} from "../src/dashboardAlerts.js";

describe("dashboard dismissal key formats", () => {
  it("accepts the three documented stable key formats", () => {
    expect(isDashboardDismissalKey(stockLowDismissalKey("chem-1"))).toBe(true);
    expect(isDashboardDismissalKey(stockLowDismissalKey("chem_legacy-1"))).toBe(true);
    expect(isDashboardDismissalKey(stockExpiryDismissalKey("chem-1", 1893456000000))).toBe(true);
    expect(isDashboardDismissalKey(noticeDismissalKey("n_abcdef123456"))).toBe(true);
  });

  it("rejects unsupported prefixes, malformed IDs and invalid epoch suffixes", () => {
    const invalid = [
      "",
      " ",
      "stock-low:",
      "stock-low:chem/slash",
      "stock-low:chem space",
      "stock-expiry:chem-1",
      "stock-expiry:chem-1:1.5",
      "stock-expiry:chem-1:-1",
      "stock-expiry:chem-1:01",
      "stock-expiry:chem-1:99999999999999999999",
      "notice:",
      "notice:bad/id",
      "unknown:chem-1",
      `stock-low:${"a".repeat(200)}`,
    ];
    for (const key of invalid) {
      expect(isDashboardDismissalKey(key)).toBe(false);
      expect(DashboardDismissalKeySchema.safeParse(key).success).toBe(false);
    }
  });
});

describe("normalizeDashboardDismissalKeys", () => {
  it("treats a missing stored value as an empty list", () => {
    expect(normalizeDashboardDismissalKeys(undefined)).toEqual([]);
  });

  it("deduplicates valid keys without touching object prototypes", () => {
    const result = normalizeDashboardDismissalKeys([
      "notice:__proto__",
      "notice:__proto__",
      "notice:constructor",
      "notice:__proto__",
    ]);
    expect(result).toEqual(["notice:__proto__", "notice:constructor"]);
    expect(({} as Record<string, unknown>).__proto__).toBe(Object.prototype);
  });

  it("fails closed on non-arrays, non-string entries, invalid keys and oversized lists", () => {
    const invalid: unknown[] = [
      {},
      "notice:n_1",
      [42],
      ["notice:bad/id"],
      Array.from({ length: DASHBOARD_DISMISSALS_MAX_KEYS + 1 }, (_, index) => `notice:n_${index}`),
    ];
    for (const value of invalid) {
      expect(() => normalizeDashboardDismissalKeys(value)).toThrow(DashboardDismissalKeysError);
    }
  });
});

describe("applyDashboardDismissal", () => {
  it("adds, repeats and removes keys idempotently", () => {
    const key = "notice:n_1";
    const added = applyDashboardDismissal([], key, true);
    expect(added).toEqual({ dismissals: [key], changed: true });

    const repeated = applyDashboardDismissal(added.dismissals, key, true);
    expect(repeated).toEqual({ dismissals: [key], changed: false });

    const removed = applyDashboardDismissal(repeated.dismissals, key, false);
    expect(removed).toEqual({ dismissals: [], changed: true });

    const removeAbsent = applyDashboardDismissal(removed.dismissals, key, false);
    expect(removeAbsent).toEqual({ dismissals: [], changed: false });
  });

  it("rejects a new key at the cap without evicting existing keys", () => {
    const current = Array.from({ length: DASHBOARD_DISMISSALS_MAX_KEYS }, (_, index) => `notice:n_${index}`);
    expect(() => applyDashboardDismissal(current, "notice:n_overflow", true)).toThrow(
      DashboardDismissalLimitError,
    );
    expect(applyDashboardDismissal(current, current[0]!, true)).toEqual({
      dismissals: current,
      changed: false,
    });
  });
});
