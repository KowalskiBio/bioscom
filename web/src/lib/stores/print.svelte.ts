import type { PrintCatalogItem, PrintRequest } from "@bioscom/shared";
import { api } from "../api";

let catalog = $state<PrintCatalogItem[]>([]);
let requests = $state<PrintRequest[]>([]);
let loaded = $state(false);

export const printData = {
  get catalog(): PrintCatalogItem[] {
    return catalog;
  },
  get requests(): PrintRequest[] {
    return requests;
  },
  get loaded(): boolean {
    return loaded;
  },
};

export async function fetchPrint(): Promise<void> {
  const [catalogBody, requestsBody] = await Promise.all([
    api.get<{ catalog: PrintCatalogItem[] }>("/api/print/catalog"),
    api.get<{ requests: PrintRequest[] }>("/api/print/requests"),
  ]);
  catalog = catalogBody.catalog;
  requests = requestsBody.requests;
  loaded = true;
}

export function clearPrint(): void {
  catalog = [];
  requests = [];
  loaded = false;
}
