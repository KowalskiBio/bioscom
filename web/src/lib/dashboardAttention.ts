import {
  chemicalAvailability,
  noticeDismissalKey,
  stockExpiryDismissalKey,
  stockLowDismissalKey,
  type Chemical,
  type ChemicalAvailability,
  type Container,
  type InventoryTree,
  type Notice,
  type Room,
  type Shelf,
} from "@bioscom/shared";
import { parseDeepFreezerShelf, stripEmoji } from "./inventoryUtils";

export const DASHBOARD_STOCK_ALERT_LIMIT = 8;
const DAY_MS = 86_400_000;

export type DashboardAttentionLevel = "low" | "medium";

export interface DashboardStockLocation {
  chemical: Chemical;
  path: string;
  href: string;
}

interface DashboardStockAlertBase {
  chemicalId: string;
  dismissalKey: string;
  name: string;
  path: string;
  href: string;
  level: DashboardAttentionLevel;
  detail: string;
}

export interface DashboardQuantityAlert extends DashboardStockAlertBase {
  kind: "quantity";
  quantity: number;
  unit: string;
}

export interface DashboardExpiryAlert extends DashboardStockAlertBase {
  kind: "expiry";
  expiresAt: number;
  daysUntilExpiry: number;
}

export type DashboardStockAlert = DashboardQuantityAlert | DashboardExpiryAlert;

export interface DashboardNoticeAlert {
  noticeId: string;
  dismissalKey: string;
  title: string;
  content: string;
  category: string;
  authorName: string | null;
  authorLab: string | null;
  date: string | null;
  timestamp: number | null;
  href: "#noticeboard";
}

/** Dashboard attention text is emoji-free in every design, not only Bauhaus. */
export function cleanDashboardText(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return stripEmoji(String(value)).replace(/\s+/gu, " ").trim();
}

export function dashboardQuantityAlert(chemical: {
  quantity?: unknown;
  availability?: ChemicalAvailability | null;
}): { quantity: number; level: DashboardAttentionLevel } | null {
  const availability = chemicalAvailability({
    quantity: typeof chemical.quantity === "number" ? chemical.quantity : null,
    availability: chemical.availability,
  });
  if (availability === "available") return null;
  return {
    quantity:
      typeof chemical.quantity === "number" && Number.isFinite(chemical.quantity)
        ? chemical.quantity
        : 0,
    level: availability === "out_of_stock" ? "low" : "medium",
  };
}

export function formatDashboardQuantity(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 }).format(value);
}

export function formatDashboardDay(value: number): string | null {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Match CatalogView's UTC-day warning window: today/red, then 1–60 days/amber. */
export function dashboardExpiryAlert(
  value: unknown,
  now = Date.now(),
): {
  expiresAt: number;
  daysUntilExpiry: number;
  level: DashboardAttentionLevel;
  detail: string;
} | null {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return null;
  const expiresAt = value as number;
  const expiry = new Date(expiresAt);
  const nowDate = new Date(now);
  if (!Number.isFinite(expiry.getTime()) || !Number.isFinite(nowDate.getTime())) return null;

  const expiryDay = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  const today = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
  const daysUntilExpiry = Math.round((expiryDay - today) / DAY_MS);
  if (daysUntilExpiry > 60) return null;

  const formatted = formatDashboardDay(expiresAt);
  if (formatted === null) return null;
  const detail =
    daysUntilExpiry < 0
      ? `Expired ${formatted}`
      : daysUntilExpiry === 0
        ? `Expires today · ${formatted}`
        : `Expires in ${daysUntilExpiry} ${daysUntilExpiry === 1 ? "day" : "days"} · ${formatted}`;
  return {
    expiresAt,
    daysUntilExpiry,
    level: daysUntilExpiry <= 0 ? "low" : "medium",
    detail,
  };
}

function displayName(value: unknown, fallback: string): string {
  return cleanDashboardText(value) || fallback;
}

function stockHref(roomId: string, containerId: string | null, rack?: string, box?: string): string {
  if (containerId === null) return `#containers/${roomId}`;
  let href = `#detail/${roomId}/${containerId}`;
  if (rack !== undefined) {
    href += `/rack/${encodeURIComponent(rack)}`;
    if (box !== undefined) href += `/box/${encodeURIComponent(box)}`;
  }
  return href;
}

function shelfNames(shelf: Shelf, shelvesById: ReadonlyMap<string, Shelf>): string[] {
  const names: string[] = [];
  const visited = new Set<string>();
  let current: Shelf | undefined = shelf;
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(displayName(current.name, current.id));
    current = current.parentShelfId ? shelvesById.get(current.parentShelfId) : undefined;
  }
  return names;
}

function collectDeepFreezer(freezer: Container, output: DashboardStockLocation[]): void {
  const freezerName = displayName(freezer.name, freezer.id);
  for (const chemical of freezer.chemicals ?? []) {
    output.push({
      chemical,
      path: freezerName,
      href: stockHref(freezer.id, freezer.id),
    });
  }
  for (const shelf of freezer.shelves ?? []) {
    const parsed = parseDeepFreezerShelf(shelf);
    const rack = displayName(parsed.rack, "Other");
    const box = displayName(parsed.box, "Other");
    const path = `${freezerName} · Rack ${rack} · Box ${box}`;
    for (const chemical of shelf.chemicals ?? []) {
      output.push({
        chemical,
        path,
        href: stockHref(freezer.id, freezer.id, rack, box),
      });
    }
  }
}

function collectRoom(room: Room, output: DashboardStockLocation[]): void {
  const roomName = displayName(room.name, room.id);
  for (const chemical of room.chemicals ?? []) {
    output.push({ chemical, path: roomName, href: stockHref(room.id, null) });
  }

  for (const container of room.containers ?? []) {
    // Deep freezers keep their special root identity even in legacy nested data.
    if (container.type === "deepfreezer") {
      collectDeepFreezer(container, output);
      continue;
    }
    const containerName = displayName(container.name, container.id);
    const containerPath = `${roomName} · ${containerName}`;
    for (const chemical of container.chemicals ?? []) {
      output.push({
        chemical,
        path: containerPath,
        href: stockHref(room.id, container.id),
      });
    }

    const shelvesById = new Map((container.shelves ?? []).map((shelf) => [shelf.id, shelf]));
    for (const shelf of container.shelves ?? []) {
      const path = [containerPath, ...shelfNames(shelf, shelvesById)].join(" · ");
      for (const chemical of shelf.chemicals ?? []) {
        output.push({ chemical, path, href: stockHref(room.id, container.id) });
      }
    }
  }
}

/** Flatten every stock-bearing location without inventing parent containers. */
export function collectDashboardStockLocations(tree: InventoryTree | null): DashboardStockLocation[] {
  if (tree === null) return [];
  const output: DashboardStockLocation[] = [];
  for (const room of tree.rooms ?? []) collectRoom(room, output);
  for (const freezer of tree.deepFreezers ?? []) collectDeepFreezer(freezer, output);
  return output;
}

/**
 * Return alert records, not chemical entities. A chemical can have one quantity
 * and one expiry alert; duplicate discoveries of the same trigger are collapsed
 * by the exact server dismissal key.
 */
export function buildDashboardStockAlerts(
  tree: InventoryTree | null,
  now = Date.now(),
): DashboardStockAlert[] {
  const alertsByKey = new Map<string, DashboardStockAlert>();
  for (const location of collectDashboardStockLocations(tree)) {
    const chemical = location.chemical;
    const name = displayName(chemical.name, chemical.id);
    const base = {
      chemicalId: chemical.id,
      name,
      path: location.path,
      href: location.href,
    };

    const quantity = dashboardQuantityAlert(chemical);
    if (quantity !== null) {
      const dismissalKey = stockLowDismissalKey(chemical.id);
      if (!alertsByKey.has(dismissalKey)) {
        const unit = cleanDashboardText(chemical.unit);
        const quantityText = `${formatDashboardQuantity(quantity.quantity)}${unit === "" ? "" : ` ${unit}`} remaining`;
        alertsByKey.set(dismissalKey, {
          ...base,
          kind: "quantity",
          dismissalKey,
          level: quantity.level,
          quantity: quantity.quantity,
          unit,
          detail: `${quantity.level === "low" ? "Out of stock" : "Low stock"} · ${quantityText}`,
        });
      }
    }

    const expiry = dashboardExpiryAlert(chemical.batchInfo?.expiresAt, now);
    if (expiry !== null) {
      const dismissalKey = stockExpiryDismissalKey(chemical.id, expiry.expiresAt);
      if (!alertsByKey.has(dismissalKey)) {
        alertsByKey.set(dismissalKey, {
          ...base,
          kind: "expiry",
          dismissalKey,
          level: expiry.level,
          expiresAt: expiry.expiresAt,
          daysUntilExpiry: expiry.daysUntilExpiry,
          detail: expiry.detail,
        });
      }
    }
  }

  return [...alertsByKey.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "quantity" ? -1 : 1;
    if (a.kind === "quantity" && b.kind === "quantity") {
      return a.quantity - b.quantity || a.chemicalId.localeCompare(b.chemicalId);
    }
    if (a.kind === "expiry" && b.kind === "expiry") {
      return a.daysUntilExpiry - b.daysUntilExpiry || a.chemicalId.localeCompare(b.chemicalId);
    }
    return 0;
  });
}

export function dashboardNoticeCategory(value: unknown): string {
  switch (cleanDashboardText(value).toLowerCase()) {
    case "issue":
      return "Issue";
    case "info":
      return "Info";
    case "suggestion":
      return "Suggestion";
    default:
      return "General";
  }
}

/** Only root post fields enter this model; reactions and avatars are ignored. */
export function buildDashboardNoticeAlerts(notices: readonly Notice[]): DashboardNoticeAlert[] {
  const alertsByKey = new Map<string, DashboardNoticeAlert>();
  for (const notice of notices) {
    const dismissalKey = noticeDismissalKey(notice.id);
    if (alertsByKey.has(dismissalKey)) continue;
    const timestamp =
      typeof notice.timestamp === "number" && Number.isFinite(notice.timestamp) ? notice.timestamp : null;
    alertsByKey.set(dismissalKey, {
      noticeId: notice.id,
      dismissalKey,
      title: cleanDashboardText(notice.title) || "Untitled notice",
      content: cleanDashboardText(notice.content),
      category: dashboardNoticeCategory(notice.category),
      authorName: cleanDashboardText(notice.authorName) || null,
      authorLab: cleanDashboardText(notice.authorLab) || null,
      date: timestamp === null ? null : formatDashboardDay(timestamp),
      timestamp,
      href: "#noticeboard",
    });
  }
  return [...alertsByKey.values()].sort(
    (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0) || a.noticeId.localeCompare(b.noticeId),
  );
}

export function withoutDismissedAlerts<T extends { dismissalKey: string }>(
  alerts: readonly T[],
  dismissals: readonly string[],
): T[] {
  const dismissed = new Set(dismissals);
  return alerts.filter((alert) => !dismissed.has(alert.dismissalKey));
}
