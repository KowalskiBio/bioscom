export const NOTICE_COLUMNS_STORAGE_KEY = "bioscom-notice-columns";

export type NoticeColumnCount = 1 | 2 | 3 | 4;

export function normalizeNoticeColumnCount(value: unknown): NoticeColumnCount {
  const count = typeof value === "number" ? value : Number(value);
  return count === 2 || count === 3 || count === 4 ? count : 1;
}

export function readNoticeColumnCount(): NoticeColumnCount {
  try {
    return normalizeNoticeColumnCount(localStorage.getItem(NOTICE_COLUMNS_STORAGE_KEY));
  } catch {
    return 1;
  }
}

export function storeNoticeColumnCount(count: NoticeColumnCount): void {
  try {
    localStorage.setItem(NOTICE_COLUMNS_STORAGE_KEY, String(count));
  } catch {
    // The visual selection still works when storage is blocked or full.
  }
}
