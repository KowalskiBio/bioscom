import { legacyArray } from "@bioscom/shared";

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface TreeEntities {
  rooms: unknown[];
  containers: unknown[];
  shelves: unknown[];
  chemicals: unknown[];
  assetRooms: unknown[];
  assets: unknown[];
  protocols: unknown[];
  instruments: unknown[];
  notices: unknown[];
  printCatalog: unknown[];
  printRequests: unknown[];
}

export function collectTreeEntities(doc: unknown): TreeEntities {
  const entities: TreeEntities = {
    rooms: [],
    containers: [],
    shelves: [],
    chemicals: [],
    assetRooms: legacyArray(asRecord(doc).assetRooms),
    assets: legacyArray(asRecord(doc).assets),
    protocols: legacyArray(asRecord(doc).protocols),
    instruments: legacyArray(asRecord(doc).instruments),
    notices: legacyArray(asRecord(doc).notices),
    printCatalog: legacyArray(asRecord(doc).printCatalog),
    printRequests: legacyArray(asRecord(doc).printRequests),
  };
  for (const room of legacyArray(asRecord(doc).rooms)) {
    entities.rooms.push(room);
    for (const container of legacyArray(asRecord(room).containers)) {
      entities.containers.push(container);
      for (const shelf of legacyArray(asRecord(container).shelves)) {
        entities.shelves.push(shelf);
        for (const chemical of legacyArray(asRecord(shelf).chemicals)) {
          entities.chemicals.push(chemical);
        }
      }
    }
  }
  return entities;
}
