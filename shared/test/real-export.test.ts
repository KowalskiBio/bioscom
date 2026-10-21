import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AssetRoomSchema,
  AssetSchema,
  BackupSchema,
  ChemicalSchema,
  ContainerSchema,
  GameChallengeSchema,
  GroupSchema,
  HistoryEntrySchema,
  InstrumentSchema,
  LegacyGroupDocSchema,
  NoticeSchema,
  PrintCatalogItemSchema,
  PrintRequestSchema,
  ProtocolSchema,
  RoomSchema,
  ShelfSchema,
  UserSchema,
  legacyArray,
} from "../src/index.js";

const exportPath = new URL("../../migration/bioscom-db-export.json", import.meta.url);
const hasExport = existsSync(exportPath);

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};

const data = hasExport ? asRecord(JSON.parse(readFileSync(exportPath, "utf8"))) : null;

describe.skipIf(!hasExport)("real legacy export", () => {
  it("validates every entity against the schemas", () => {
    const failures: string[] = [];
    const check = (label: string, schema: z.ZodType, value: unknown) => {
      const result = schema.safeParse(value);
      if (!result.success) {
        const issue = result.error.issues[0];
        failures.push(
          `${label} → ${issue ? `${issue.path.map(String).join(".")}: ${issue.message}` : "unknown issue"}`,
        );
      }
    };

    for (const [uid, value] of Object.entries(asRecord(data?.users))) {
      check(`users/${uid}`, UserSchema, { ...asRecord(value), uid });
    }
    for (const [gid, value] of Object.entries(asRecord(data?.groups))) {
      check(`groups/${gid}`, GroupSchema, { ...asRecord(value), id: gid });
    }

    const walkTree = (label: string, doc: unknown) => {
      const parsed = LegacyGroupDocSchema.parse(doc);
      parsed.rooms.forEach((room, roomIdx) => {
        check(`${label}/rooms[${roomIdx}]`, RoomSchema, room);
        legacyArray(asRecord(room).containers).forEach((container, containerIdx) => {
          check(`${label}/rooms[${roomIdx}]/containers[${containerIdx}]`, ContainerSchema, container);
          legacyArray(asRecord(container).shelves).forEach((shelf, shelfIdx) => {
            check(`${label}/rooms[${roomIdx}]/containers[${containerIdx}]/shelves[${shelfIdx}]`, ShelfSchema, shelf);
            legacyArray(asRecord(shelf).chemicals).forEach((chemical, chemicalIdx) => {
              check(
                `${label}/rooms[${roomIdx}]/containers[${containerIdx}]/shelves[${shelfIdx}]/chemicals[${chemicalIdx}]`,
                ChemicalSchema,
                chemical,
              );
            });
          });
        });
      });
      parsed.assetRooms.forEach((assetRoom, i) => check(`${label}/assetRooms[${i}]`, AssetRoomSchema, assetRoom));
      parsed.assets.forEach((asset, i) => check(`${label}/assets[${i}]`, AssetSchema, asset));
      parsed.protocols.forEach((protocol, i) => check(`${label}/protocols[${i}]`, ProtocolSchema, protocol));
      parsed.instruments.forEach((instrument, i) => check(`${label}/instruments[${i}]`, InstrumentSchema, instrument));
      parsed.notices.forEach((notice, i) => check(`${label}/notices[${i}]`, NoticeSchema, notice));
      parsed.printCatalog.forEach((item, i) => check(`${label}/printCatalog[${i}]`, PrintCatalogItemSchema, item));
      parsed.printRequests.forEach((request, i) => check(`${label}/printRequests[${i}]`, PrintRequestSchema, request));
    };

    for (const [gid, doc] of Object.entries(asRecord(data?.inventories))) {
      walkTree(`inventories/${gid}`, doc);
    }
    if (data?.inventory) {
      walkTree("inventory", data.inventory);
    }

    for (const [gid, entries] of Object.entries(asRecord(data?.history))) {
      for (const [key, entry] of Object.entries(asRecord(entries))) {
        check(`history/${gid}/${key}`, HistoryEntrySchema, entry);
      }
    }
    for (const [gid, entries] of Object.entries(asRecord(data?.backups))) {
      for (const [key, entry] of Object.entries(asRecord(entries))) {
        check(`backups/${gid}/${key}`, BackupSchema, { ...asRecord(entry), id: key });
      }
    }
    for (const [key, value] of Object.entries(asRecord(data?.shared_notices))) {
      check(`shared_notices/${key}`, NoticeSchema, value);
    }
    for (const [key, value] of Object.entries(asRecord(data?.shared_instruments))) {
      check(`shared_instruments/${key}`, InstrumentSchema, value);
    }
    for (const [key, value] of Object.entries(asRecord(data?.shared_print_catalog))) {
      check(`shared_print_catalog/${key}`, PrintCatalogItemSchema, value);
    }
    for (const [key, value] of Object.entries(asRecord(data?.shared_print_requests))) {
      check(`shared_print_requests/${key}`, PrintRequestSchema, value);
    }
    for (const [key, value] of Object.entries(asRecord(data?.game_challenges))) {
      check(`game_challenges/${key}`, GameChallengeSchema, value);
    }

    expect(failures).toEqual([]);
  });
});
