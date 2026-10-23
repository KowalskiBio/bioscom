import type { Instrument } from "@bioscom/shared";
import { api } from "../api";

let instruments = $state<Instrument[]>([]);
let loaded = $state(false);

export const instrumentList = {
  get items(): Instrument[] {
    return instruments;
  },
  get loaded(): boolean {
    return loaded;
  },
};

export async function fetchInstruments(): Promise<void> {
  const body = await api.get<{ instruments: Instrument[] }>("/api/instruments");
  instruments = body.instruments;
  loaded = true;
}

export function clearInstruments(): void {
  instruments = [];
  loaded = false;
}
