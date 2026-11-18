import {
  isDashboardDismissalKey,
  type DashboardDismissalsResponse,
} from "@bioscom/shared";
import { api } from "../api";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

const LOAD_ERROR = "Couldn’t load your personal dashboard dismissals. Your dismissal settings are not confirmed yet.";
const SAVE_ERROR = "Couldn’t dismiss this item for you. It is still visible, and no inventory or board data was changed.";

let accountId = $state<string | null>(null);
let dismissals = $state<string[]>([]);
let status = $state<LoadStatus>("idle");
let confirmed = $state(false);
let updatedAt = $state<number | null>(null);
let loadError = $state("");
let pendingKeys = $state<ReadonlySet<string>>(new Set());
let rowErrors = $state<Readonly<Record<string, string>>>({});
let loadRequest = 0;
let generation = 0;
let pendingLoad: Promise<boolean> | null = null;
let mutationTail: Promise<void> = Promise.resolve();

function validateResponse(raw: unknown): DashboardDismissalsResponse {
  if (raw === null || typeof raw !== "object") {
    throw new Error("Invalid dashboard dismissals response");
  }
  const candidate = raw as { dismissals?: unknown; updatedAt?: unknown };
  if (!Array.isArray(candidate.dismissals)) {
    throw new Error("Invalid dashboard dismissals list");
  }
  if (
    !candidate.dismissals.every(
      (key): key is string => typeof key === "string" && isDashboardDismissalKey(key),
    ) ||
    new Set(candidate.dismissals).size !== candidate.dismissals.length
  ) {
    throw new Error("Invalid dashboard dismissal key");
  }
  if (
    typeof candidate.updatedAt !== "number" ||
    !Number.isSafeInteger(candidate.updatedAt) ||
    candidate.updatedAt < 0
  ) {
    throw new Error("Invalid dashboard dismissals timestamp");
  }
  return { dismissals: [...candidate.dismissals], updatedAt: candidate.updatedAt };
}

function applyResponse(response: DashboardDismissalsResponse): void {
  dismissals = response.dismissals;
  updatedAt = response.updatedAt;
  confirmed = true;
}

export function clearDashboardDismissals(): void {
  loadRequest += 1;
  generation += 1;
  pendingLoad = null;
  mutationTail = Promise.resolve();
  accountId = null;
  dismissals = [];
  status = "idle";
  confirmed = false;
  updatedAt = null;
  loadError = "";
  pendingKeys = new Set();
  rowErrors = {};
}

export async function loadDashboardDismissals(
  userId: string | null,
  force = false,
): Promise<boolean> {
  if (userId === null) {
    clearDashboardDismissals();
    return false;
  }
  if (accountId !== userId) {
    clearDashboardDismissals();
    accountId = userId;
  }
  if (!force && status === "loaded") return true;
  if (!force && status === "error") return false;
  if (pendingLoad !== null) return pendingLoad;

  const request = ++loadRequest;
  const requestGeneration = generation;
  status = "loading";
  loadError = "";
  const promise = (async () => {
    try {
      const raw = await api.get<unknown>("/api/users/me/dashboard-dismissals");
      const response = validateResponse(raw);
      if (
        request !== loadRequest ||
        requestGeneration !== generation ||
        accountId !== userId
      ) {
        return false;
      }
      applyResponse(response);
      status = "loaded";
      return true;
    } catch {
      if (
        request === loadRequest &&
        requestGeneration === generation &&
        accountId === userId
      ) {
        status = "error";
        loadError = LOAD_ERROR;
      }
      return false;
    } finally {
      if (request === loadRequest && requestGeneration === generation) {
        pendingLoad = null;
      }
    }
  })();
  pendingLoad = promise;
  return promise;
}

/**
 * Serialize mutations for this account because every response is an
 * authoritative full list. Rows for queued requests remain visible and pending.
 */
export function dismissDashboardAlert(userId: string, key: string): Promise<boolean> {
  if (accountId !== userId || status !== "loaded" || !isDashboardDismissalKey(key)) {
    if (accountId === userId) rowErrors = { ...rowErrors, [key]: SAVE_ERROR };
    return Promise.resolve(false);
  }
  if (pendingKeys.has(key)) return Promise.resolve(false);

  const requestGeneration = generation;
  pendingKeys = new Set(pendingKeys).add(key);
  const nextErrors = { ...rowErrors };
  delete nextErrors[key];
  rowErrors = nextErrors;

  const operation = mutationTail.then(async (): Promise<boolean> => {
    if (requestGeneration !== generation || accountId !== userId) return false;
    try {
      const raw = await api.put<unknown>("/api/users/me/dashboard-dismissals", {
        key,
        dismissed: true,
      });
      const response = validateResponse(raw);
      if (!response.dismissals.includes(key)) {
        throw new Error("Server did not confirm the requested dismissal");
      }
      if (requestGeneration !== generation || accountId !== userId) return false;
      applyResponse(response);
      status = "loaded";
      loadError = "";
      return true;
    } catch {
      if (requestGeneration === generation && accountId === userId) {
        rowErrors = { ...rowErrors, [key]: SAVE_ERROR };
      }
      return false;
    } finally {
      if (requestGeneration === generation && accountId === userId) {
        const nextPending = new Set(pendingKeys);
        nextPending.delete(key);
        pendingKeys = nextPending;
      }
    }
  });
  mutationTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export const dashboardDismissals = {
  get accountId(): string | null {
    return accountId;
  },
  get status(): LoadStatus {
    return status;
  },
  get loading(): boolean {
    return status === "loading";
  },
  get confirmed(): boolean {
    return confirmed;
  },
  get updatedAt(): number | null {
    return updatedAt;
  },
  get loadError(): string {
    return loadError;
  },
  get canDismiss(): boolean {
    return accountId !== null && status === "loaded";
  },
  dismissalsFor(userId: string): readonly string[] {
    return accountId === userId && confirmed ? dismissals : [];
  },
  pendingFor(userId: string, key: string): boolean {
    return accountId === userId && pendingKeys.has(key);
  },
  errorFor(userId: string, key: string): string {
    return accountId === userId ? (rowErrors[key] ?? "") : "";
  },
};
