import { z } from "zod";

/**
 * Per-account Dashboard attention dismissals.
 *
 * Dismissals are personal preferences only: they never mutate stock, notices,
 * expiry data or group/lab state. The stable key formats shared with the web
 * client are:
 *
 * - `stock-low:<chemicalId>`
 * - `stock-expiry:<chemicalId>:<expiresAtEpochMs>`
 * - `notice:<noticeId>`
 *
 * IDs are slash-free legacy/UUID-like identifiers made of ASCII letters,
 * digits, hyphens and underscores. Expiry suffixes are canonical non-negative
 * integer epoch milliseconds.
 */
export const DASHBOARD_DISMISSAL_KEY_MAX_LENGTH = 160;
export const DASHBOARD_DISMISSALS_MAX_KEYS = 500;

/** Root property inside the additive `user_settings.settings` JSON document. */
export const DASHBOARD_DISMISSED_ALERTS_SETTINGS_KEY = "dashboardDismissedAlerts";

const ID_PATTERN = "[A-Za-z0-9_-]+";
const EPOCH_PATTERN = "(?:0|[1-9][0-9]*)";
const DASHBOARD_DISMISSAL_KEY_PATTERN = new RegExp(
  `^(?:stock-low:${ID_PATTERN}|stock-expiry:${ID_PATTERN}:${EPOCH_PATTERN}|notice:${ID_PATTERN})$`,
);

/**
 * The regex above rejects whitespace, slashes and colons inside IDs. Expiry
 * epoch values must also fit in a JavaScript safe integer so a syntactically
 * valid but unusable timestamp cannot be persisted.
 */
export function isDashboardDismissalKey(value: string): boolean {
  if (value.length === 0 || value.length > DASHBOARD_DISMISSAL_KEY_MAX_LENGTH) {
    return false;
  }
  if (!DASHBOARD_DISMISSAL_KEY_PATTERN.test(value)) {
    return false;
  }
  if (value.startsWith("stock-expiry:")) {
    const epoch = value.slice(value.lastIndexOf(":") + 1);
    return Number.isSafeInteger(Number(epoch));
  }
  return true;
}

export const DashboardDismissalKeySchema = z
  .string()
  .min(1)
  .max(DASHBOARD_DISMISSAL_KEY_MAX_LENGTH)
  .refine(isDashboardDismissalKey, { message: "invalid dashboard dismissal key" });

export const DashboardDismissalUpdateBodySchema = z.object({
  key: DashboardDismissalKeySchema,
  dismissed: z.boolean(),
});

export type DashboardDismissalUpdateBody = z.infer<typeof DashboardDismissalUpdateBodySchema>;

export interface DashboardDismissalsResponse {
  dismissals: string[];
  updatedAt: number;
}

export function stockLowDismissalKey(chemicalId: string): string {
  return `stock-low:${chemicalId}`;
}

export function stockExpiryDismissalKey(chemicalId: string, expiresAtEpochMs: number): string {
  return `stock-expiry:${chemicalId}:${expiresAtEpochMs}`;
}

export function noticeDismissalKey(noticeId: string): string {
  return `notice:${noticeId}`;
}

/** Raised when persisted dismissal data is structurally invalid. */
export class DashboardDismissalKeysError extends Error {}

/** Raised when adding a new dismissal would exceed the per-account cap. */
export class DashboardDismissalLimitError extends Error {}

/**
 * Normalises the stored `dashboardDismissedAlerts` property. A missing value is
 * an empty list; any present but invalid value fails closed so the caller can
 * return a generic 500 without wiping the user's document.
 *
 * Deduplication uses a `Set` rather than object property assignment so keys
 * such as `__proto__` can never touch an object prototype.
 */
export function normalizeDashboardDismissalKeys(raw: unknown): string[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new DashboardDismissalKeysError("dashboardDismissedAlerts must be an array");
  }
  if (raw.length > DASHBOARD_DISMISSALS_MAX_KEYS) {
    throw new DashboardDismissalKeysError("dashboardDismissedAlerts exceeds the key limit");
  }
  const seen = new Set<string>();
  const dismissals: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw new DashboardDismissalKeysError("dashboardDismissedAlerts entries must be strings");
    }
    const parsed = DashboardDismissalKeySchema.safeParse(entry);
    if (!parsed.success) {
      throw new DashboardDismissalKeysError("dashboardDismissedAlerts contains an invalid key");
    }
    if (seen.has(parsed.data)) {
      continue;
    }
    seen.add(parsed.data);
    dismissals.push(parsed.data);
  }
  return dismissals;
}

/**
 * Applies one idempotent dismissal change to an already-normalised list.
 * Removing an absent key or repeating an existing dismissal is a no-op
 * (`changed: false`); adding at the cap is rejected instead of evicting an
 * existing personal preference.
 */
export function applyDashboardDismissal(
  current: readonly string[],
  key: string,
  dismissed: boolean,
): { dismissals: string[]; changed: boolean } {
  const present = current.includes(key);
  if (dismissed) {
    if (present) {
      return { dismissals: [...current], changed: false };
    }
    if (current.length >= DASHBOARD_DISMISSALS_MAX_KEYS) {
      throw new DashboardDismissalLimitError("too many dismissed dashboard alerts");
    }
    return { dismissals: [...current, key], changed: true };
  }
  if (!present) {
    return { dismissals: [...current], changed: false };
  }
  return { dismissals: current.filter((entry) => entry !== key), changed: true };
}
