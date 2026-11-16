import type { Instrument } from "@bioscom/shared";
import { api } from "../api";

let instruments = $state<Instrument[]>([]);
let loaded = $state(false);
let loading = $state(false);
let loadError = $state("");
let requestSequence = 0;

export const instrumentList = {
  get items(): Instrument[] {
    return instruments;
  },
  get loaded(): boolean {
    return loaded;
  },
  get loading(): boolean {
    return loading;
  },
  get loadError(): string {
    return loadError;
  },
};

export async function fetchInstruments(): Promise<boolean> {
  const request = ++requestSequence;
  loading = true;
  loadError = "";
  try {
    const body = await api.get<{ instruments: Instrument[] }>("/api/instruments");
    if (request !== requestSequence) {
      return false;
    }
    instruments = body.instruments;
    loaded = true;
    return true;
  } catch {
    if (request === requestSequence) {
      // Keep the last confirmed catalogue visible during a failed refresh. On an
      // initial failure `loaded` remains false, so callers cannot mistake [] for
      // a confirmed empty result.
      loadError = "Couldn’t load instruments.";
    }
    return false;
  } finally {
    if (request === requestSequence) {
      loading = false;
    }
  }
}

export function clearInstruments(): void {
  requestSequence += 1;
  instruments = [];
  loaded = false;
  loading = false;
  loadError = "";
}
