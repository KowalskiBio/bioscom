import {
  defaultCatalogColumnSelections,
  defaultCatalogColumnsForScope,
  type CatalogColumnScope,
  type CatalogColumnSelections,
} from "@bioscom/shared";
import {
  cloneCatalogColumnSelections,
  fetchCatalogColumnPreferences,
  updateCatalogColumnPreferences,
  type CatalogColumnsResponse,
} from "../catalogColumns";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

const LOAD_ERROR = "Couldn’t load your saved column preferences. Your account settings have not been changed.";
const SAVE_ERROR = "Couldn’t save column preferences. Your previous saved settings are still active.";

let accountId = $state<string | null>(null);
let selections = $state<CatalogColumnSelections>(defaultCatalogColumnSelections());
let status = $state<LoadStatus>("idle");
let confirmed = $state(false);
let updatedAt = $state<number | null>(null);
let loadError = $state("");
let saveError = $state("");
let saving = $state(false);
let loadRequest = 0;
let saveRequest = 0;
let pendingLoad: Promise<boolean> | null = null;
let pendingSave: Promise<boolean> | null = null;

function applyResponse(response: CatalogColumnsResponse): void {
  if (!Number.isFinite(response.updatedAt)) {
    throw new Error("Invalid catalog column preferences response");
  }
  selections = cloneCatalogColumnSelections(response.columnsByType);
  updatedAt = response.updatedAt;
  confirmed = true;
}

export function clearCatalogColumnPreferences(): void {
  loadRequest += 1;
  saveRequest += 1;
  pendingLoad = null;
  pendingSave = null;
  accountId = null;
  selections = defaultCatalogColumnSelections();
  status = "idle";
  confirmed = false;
  updatedAt = null;
  loadError = "";
  saveError = "";
  saving = false;
}

export async function loadCatalogColumnPreferences(
  userId: string | null,
  force = false,
): Promise<boolean> {
  if (userId === null) {
    clearCatalogColumnPreferences();
    return false;
  }
  if (accountId !== userId) {
    clearCatalogColumnPreferences();
    accountId = userId;
  }
  if (saving && pendingSave !== null) {
    await pendingSave;
    if (accountId !== userId) {
      return false;
    }
  }
  if (!force && status === "loaded") {
    return true;
  }
  if (!force && status === "error") {
    return false;
  }
  if (pendingLoad !== null) {
    return pendingLoad;
  }

  const request = ++loadRequest;
  status = "loading";
  loadError = "";
  saveError = "";
  const promise = (async () => {
    try {
      const response = await fetchCatalogColumnPreferences();
      if (request !== loadRequest || accountId !== userId) {
        return false;
      }
      applyResponse(response);
      status = "loaded";
      return true;
    } catch {
      if (request === loadRequest && accountId === userId) {
        status = "error";
        loadError = LOAD_ERROR;
      }
      return false;
    } finally {
      if (request === loadRequest) {
        pendingLoad = null;
      }
    }
  })();
  pendingLoad = promise;
  return promise;
}

export function saveCatalogColumnPreferences(
  userId: string,
  scope: CatalogColumnScope,
  columns: readonly string[],
): Promise<boolean> {
  if (accountId !== userId || status !== "loaded" || saving) {
    saveError = "Load your saved package columns before making changes.";
    return Promise.resolve(false);
  }

  const request = ++saveRequest;
  saving = true;
  saveError = "";
  const promise = (async () => {
    try {
      const response = await updateCatalogColumnPreferences(scope, columns);
      if (request !== saveRequest || accountId !== userId) {
        return false;
      }
      applyResponse(response);
      status = "loaded";
      loadError = "";
      return true;
    } catch {
      if (request === saveRequest && accountId === userId) {
        saveError = SAVE_ERROR;
      }
      return false;
    } finally {
      if (request === saveRequest) {
        saving = false;
        pendingSave = null;
      }
    }
  })();
  pendingSave = promise;
  return promise;
}

export const catalogColumnPreferences = {
  get accountId(): string | null {
    return accountId;
  },
  get status(): LoadStatus {
    return status;
  },
  get loading(): boolean {
    return status === "loading";
  },
  get loaded(): boolean {
    return status === "loaded";
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
  get saveError(): string {
    return saveError;
  },
  get saving(): boolean {
    return saving;
  },
  get canSave(): boolean {
    return accountId !== null && status === "loaded" && !saving;
  },
  columnsForUser(userId: string, scope: CatalogColumnScope): readonly string[] {
    return accountId === userId ? selections[scope] : defaultCatalogColumnsForScope(scope);
  },
};
