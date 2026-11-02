const STORAGE_KEY = "bioscom-prefs";

export type RadioMode = "ask" | "never";

interface Prefs {
  radioMode: RadioMode;
}

function load(): Prefs {
  const out: Prefs = { radioMode: "ask" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.radioMode === "ask" || parsed.radioMode === "never") {
        out.radioMode = parsed.radioMode;
      }
    }
  } catch {
    return out;
  }
  return out;
}

let state = $state<Prefs>(load());

export const prefs = {
  get radioMode(): RadioMode {
    return state.radioMode;
  },
};

export function setRadioMode(mode: RadioMode): void {
  state = { ...state, radioMode: mode };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable (private mode / quota); keep the in-memory value.
  }
}
