import type { Backup, HistoryEntry } from "@bioscom/shared";
import { api } from "../api";

export interface HistoryPage {
  entries: HistoryEntry[];
  total: number;
  page: number;
  limit: number;
}

let entries = $state<HistoryEntry[]>([]);
let total = $state(0);
let page = $state(1);
let backups = $state<Backup[]>([]);
let loaded = $state(false);

export const historyData = {
  get entries(): HistoryEntry[] {
    return entries;
  },
  get total(): number {
    return total;
  },
  get page(): number {
    return page;
  },
  get backups(): Backup[] {
    return backups;
  },
  get loaded(): boolean {
    return loaded;
  },
};

export async function fetchHistory(groupId: string, page_ = 1, limit = 100): Promise<void> {
  const body = await api.get<HistoryPage>(
    `/api/groups/${encodeURIComponent(groupId)}/history?page=${page_}&limit=${limit}`,
  );
  entries = body.entries;
  total = body.total;
  page = body.page;
  loaded = true;
}

export async function fetchBackups(groupId: string): Promise<void> {
  const body = await api.get<{ backups: Backup[] }>(
    `/api/groups/${encodeURIComponent(groupId)}/backups`,
  );
  backups = body.backups;
}

export function clearHistory(): void {
  entries = [];
  total = 0;
  page = 1;
  backups = [];
  loaded = false;
}
