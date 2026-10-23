import type { Notice } from "@bioscom/shared";
import { api } from "../api";

let notices = $state<Notice[]>([]);
let loaded = $state(false);

export const noticeList = {
  get items(): Notice[] {
    return notices;
  },
  get loaded(): boolean {
    return loaded;
  },
};

export async function fetchNotices(): Promise<void> {
  const body = await api.get<{ notices: Notice[] }>("/api/notices");
  notices = body.notices;
  loaded = true;
}

export function clearNotices(): void {
  notices = [];
  loaded = false;
}
