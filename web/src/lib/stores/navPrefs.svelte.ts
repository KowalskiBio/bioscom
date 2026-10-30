const STORAGE_KEY = "bioscom-nav";

export interface NavItemDef {
  view: string;
  tabId: string;
  label: string;
  labelBauhaus: string;
  defaultVisible: boolean;
}

export const NAV_ITEMS: NavItemDef[] = [
  { view: "protocols", tabId: "tab-protocols", label: "Solutions & Protocols", labelBauhaus: "Protocols", defaultVisible: true },
  { view: "assets", tabId: "tab-assets", label: "Inventory", labelBauhaus: "Inventory", defaultVisible: true },
  { view: "noticeboard", tabId: "tab-noticeboard", label: "Notice Board", labelBauhaus: "Notice Board", defaultVisible: true },
  { view: "instruments", tabId: "tab-instruments", label: "Instruments", labelBauhaus: "Reservations", defaultVisible: true },
  { view: "history", tabId: "tab-history", label: "History & Backups", labelBauhaus: "History", defaultVisible: true },
  { view: "printing", tabId: "tab-printing", label: "3D Print", labelBauhaus: "3D Print", defaultVisible: false },
  { view: "minigames", tabId: "tab-minigames", label: "Mini-games", labelBauhaus: "Mini-games", defaultVisible: false },
];

function load(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const item of NAV_ITEMS) {
    out[item.view] = item.defaultVisible;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const item of NAV_ITEMS) {
        const value = parsed[item.view];
        if (typeof value === "boolean") {
          out[item.view] = value;
        }
      }
    }
  } catch {
    return out;
  }
  return out;
}

let visibility = $state<Record<string, boolean>>(load());

export const navPrefs = {
  visible(view: string): boolean {
    return visibility[view] ?? true;
  },
  setVisible(view: string, value: boolean): void {
    visibility = { ...visibility, [view]: value };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  },
};
