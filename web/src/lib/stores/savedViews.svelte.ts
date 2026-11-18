const STORAGE_KEY = "bioscom-stocks-views-v1";

export interface SavedStockView {
  id: string;
  name: string;
  type: string;
  q: string;
  status: string;
  expDays: string;
  createdAt: number;
}

export type SavedStockViewDraft = Omit<SavedStockView, "id" | "createdAt">;

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isSavedView(value: unknown): value is SavedStockView {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.q === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.expDays === "string" &&
    typeof candidate.createdAt === "number"
  );
}

function load(): SavedStockView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }
    const views = (parsed as { views?: unknown }).views;
    if (!Array.isArray(views)) {
      return [];
    }
    return views.filter(isSavedView);
  } catch {
    return [];
  }
}

let views = $state<SavedStockView[]>(load());

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ views }));
}

export const savedViews = {
  get views(): SavedStockView[] {
    return views;
  },
  saveView(draft: SavedStockViewDraft): void {
    const name = draft.name.trim();
    if (name === "") {
      return;
    }
    const existing = views.find((view) => view.name === name);
    if (existing !== undefined) {
      views = views.map((view) =>
        view.id === existing.id
          ? { ...view, type: draft.type, q: draft.q, status: draft.status, expDays: draft.expDays }
          : view,
      );
    } else {
      views = [...views, { id: genId(), name, type: draft.type, q: draft.q, status: draft.status, expDays: draft.expDays, createdAt: Date.now() }];
    }
    persist();
  },
  deleteView(id: string): void {
    views = views.filter((view) => view.id !== id);
    persist();
  },
};
