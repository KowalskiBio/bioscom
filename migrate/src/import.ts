import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
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
  InstrumentBookingSchema,
  InstrumentSchema,
  InventoryTreeSchema,
  NoticeReactionSchema,
  NoticeSchema,
  PrintCatalogItemSchema,
  PrintRequestSchema,
  ProtocolSchema,
  RoomSchema,
  ShelfSchema,
  UserSchema,
  legacyArray,
} from "@bioscom/shared";
import { schemaSqlPath } from "./paths.js";
import { loadSource, type AuthUserRecord } from "./source.js";
import { asArray, asRecord } from "./walk.js";

interface QuarantineEntry {
  source: string;
  reason: string;
  payload: unknown;
}

type Runnable = { run: (...params: unknown[]) => unknown };
type Pair = [string, unknown];

function firstIssue(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  return issue === undefined ? "unknown issue" : `${issue.path.map(String).join(".")}: ${issue.message}`;
}

function pairsOf(raw: unknown): Pair[] {
  if (Array.isArray(raw)) {
    return asArray(raw).map((item, index) => [String(index), item] as Pair);
  }
  return Object.entries(asRecord(raw));
}

function main(): void {
  const { values } = parseArgs({
    options: {
      legacy: { type: "string" },
      dir: { type: "string" },
      db: { type: "string" },
    },
  });
  const source = loadSource({ legacy: values.legacy, dir: values.dir });
  const dbPath = values.db ?? "bioscom.db";
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(readFileSync(schemaSqlPath, "utf8"));

  const quarantined: QuarantineEntry[] = [];
  const quarantine = (label: string, reason: string, payload: unknown): void => {
    quarantined.push({ source: label, reason, payload });
  };
  const tryRun = (stmt: Runnable, label: string, payload: unknown, ...params: unknown[]): void => {
    try {
      stmt.run(...params);
    } catch (error) {
      quarantine(label, `insert failed: ${error instanceof Error ? error.message : String(error)}`, payload);
    }
  };

  const run = db.transaction((): void => {
    for (const table of [
      "quarantined_rows",
      "game_challenges",
      "sandbox_docs",
      "print_requests",
      "print_catalog",
      "instrument_bookings",
      "instruments",
      "notice_reactions",
      "notices",
      "history",
      "group_backups",
      "group_inventory_docs",
      "sessions",
      "users",
      "groups",
    ]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }

    const insQuarantine = db.prepare("INSERT INTO quarantined_rows (source, reason, payload) VALUES (?, ?, ?)");
    const insGroup = db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, ?, ?, ?)");
    const insUser = db.prepare(
      "INSERT INTO users (uid, email, password_hash, password_salt, hash_version, name, role, group_id, avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insDoc = db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)");
    const insSandbox = db.prepare("INSERT INTO sandbox_docs (key, tree, version) VALUES (?, ?, 0)");
    const insHistory = db.prepare(
      "INSERT INTO history (group_id, src_id, timestamp, user_name, action) VALUES (?, ?, ?, ?, ?)",
    );
    const insBackup = db.prepare("INSERT INTO group_backups (id, group_id, timestamp, data) VALUES (?, ?, ?, ?)");
    const insNotice = db.prepare(
      "INSERT INTO notices (id, scope, group_id, title, content, category, author_name, author_uid, author_lab, author_avatar, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insReaction = db.prepare(
      "INSERT INTO notice_reactions (id, notice_id, text, timestamp, user_id, user_name, user_avatar) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insInstrument = db.prepare(
      "INSERT INTO instruments (id, source, group_id, name, description, location, contact_person, contact_email, owner_lab_id, owner_lab_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insBooking = db.prepare(
      "INSERT INTO instrument_bookings (id, instrument_id, date, start_time, end_time, user_id, user_name, lab_name, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insCatalog = db.prepare(
      "INSERT INTO print_catalog (id, group_id, name, description, category, material, estimated_time, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insPrintRequest = db.prepare(
      "INSERT INTO print_requests (id, source, group_id, catalog_item_id, catalog_item_name, custom_design, note, quantity, request_date, requested_by, requested_by_uid, requested_by_lab_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insGame = db.prepare(
      "INSERT INTO game_challenges (id, game_type, challenger_name, challenger_uid, opponent_name, opponent_uid, winner_uid, status, created_at, turn, board, frog_round, frog_scores, frog_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );

    for (const [gid, raw] of Object.entries(asRecord(source.paths.groups))) {
      const result = GroupSchema.safeParse({ ...asRecord(raw), id: gid });
      if (!result.success) {
        quarantine(`groups/${gid}`, firstIssue(result.error), raw);
        continue;
      }
      tryRun(insGroup, `groups/${gid}`, raw, result.data.id, result.data.name, result.data.joinCode ?? null, result.data.created);
    }

    const authByUid = new Map<string, AuthUserRecord>();
    const authByEmail = new Map<string, AuthUserRecord>();
    for (const user of source.authUsers) {
      authByUid.set(user.uid, user);
      if (user.email !== null && !authByEmail.has(user.email)) {
        authByEmail.set(user.email, user);
      }
    }
    const importedUids = new Set<string>();
    for (const [uid, raw] of Object.entries(asRecord(source.paths.users))) {
      const record = asRecord(raw);
      const auth = authByUid.get(uid) ?? (typeof record.email === "string" ? authByEmail.get(record.email) : undefined);
      const result = UserSchema.safeParse({ ...record, uid });
      if (!result.success) {
        quarantine(`users/${uid}`, firstIssue(result.error), raw);
        continue;
      }
      const user = result.data;
      const passwordHash = auth?.passwordHash ?? null;
      tryRun(
        insUser,
        `users/${uid}`,
        raw,
        uid,
        user.email ?? auth?.email ?? null,
        passwordHash === null ? "" : passwordHash,
        auth?.passwordSalt ?? null,
        passwordHash === null ? "unverified" : "firebase-scrypt",
        user.name ?? auth?.displayName ?? null,
        user.role,
        user.groupId ?? null,
        user.avatar ?? null,
      );
      importedUids.add(uid);
    }
    for (const auth of source.authUsers) {
      if (auth.uid === "" || importedUids.has(auth.uid)) continue;
      tryRun(
        insUser,
        `auth-users/${auth.uid}`,
        auth,
        auth.uid,
        auth.email,
        auth.passwordHash === null ? "" : auth.passwordHash,
        auth.passwordSalt,
        auth.passwordHash === null ? "unverified" : "firebase-scrypt",
        auth.displayName,
        "reader",
        null,
        null,
      );
    }

    const importNotices = (scope: string, gid: string | null, noticePairs: Pair[], label: string): void => {
      for (const [key, rawNotice] of noticePairs) {
        const record = asRecord(rawNotice);
        const noticeId = typeof record.id === "string" && record.id !== "" ? record.id : key;
        const result = NoticeSchema.safeParse({ ...record, reactions: [] });
        if (!result.success) {
          quarantine(`${label}/${key}`, firstIssue(result.error), rawNotice);
          continue;
        }
        const notice = result.data;
        tryRun(
          insNotice,
          `${label}/${key}`,
          rawNotice,
          noticeId,
          scope,
          gid,
          notice.title ?? null,
          notice.content ?? null,
          notice.category ?? null,
          notice.authorName ?? null,
          notice.authorUid ?? null,
          notice.authorLab ?? null,
          notice.authorAvatar ?? null,
          notice.timestamp,
        );
        for (const [reactionKey, rawReaction] of pairsOf(record.reactions)) {
          const reactionRecord = asRecord(rawReaction);
          const reactionId =
            typeof reactionRecord.id === "string" && reactionRecord.id !== "" ? reactionRecord.id : `${noticeId}:${reactionKey}`;
          const reactionResult = NoticeReactionSchema.safeParse(reactionRecord);
          if (!reactionResult.success) {
            quarantine(`${label}/${key}/reactions/${reactionKey}`, firstIssue(reactionResult.error), rawReaction);
            continue;
          }
          const reaction = reactionResult.data;
          tryRun(
            insReaction,
            `${label}/${key}/reactions/${reactionKey}`,
            rawReaction,
            reactionId,
            noticeId,
            reaction.text ?? null,
            reaction.timestamp,
            reaction.userId ?? null,
            reaction.userName ?? null,
            reaction.userAvatar ?? null,
          );
        }
      }
    };

    const importInstruments = (sourceKind: string, gid: string | null, instrumentPairs: Pair[], label: string): void => {
      for (const [key, rawInstrument] of instrumentPairs) {
        const record = asRecord(rawInstrument);
        const instrumentId = typeof record.id === "string" && record.id !== "" ? record.id : key;
        const result = InstrumentSchema.safeParse({ ...record, bookings: [] });
        if (!result.success) {
          quarantine(`${label}/${key}`, firstIssue(result.error), rawInstrument);
          continue;
        }
        const instrument = result.data;
        tryRun(
          insInstrument,
          `${label}/${key}`,
          rawInstrument,
          instrumentId,
          sourceKind,
          gid,
          instrument.name,
          instrument.description ?? null,
          instrument.location ?? null,
          instrument.contactPerson ?? null,
          instrument.contactEmail ?? null,
          instrument.ownerLabId ?? null,
          instrument.ownerLabName ?? null,
        );
        for (const [bookingKey, rawBooking] of pairsOf(record.bookings)) {
          const bookingRecord = asRecord(rawBooking);
          const bookingId =
            typeof bookingRecord.id === "string" && bookingRecord.id !== "" ? bookingRecord.id : `${instrumentId}:${bookingKey}`;
          const bookingResult = InstrumentBookingSchema.safeParse(bookingRecord);
          if (!bookingResult.success) {
            quarantine(`${label}/${key}/bookings/${bookingKey}`, firstIssue(bookingResult.error), rawBooking);
            continue;
          }
          const booking = bookingResult.data;
          tryRun(
            insBooking,
            `${label}/${key}/bookings/${bookingKey}`,
            rawBooking,
            bookingId,
            instrumentId,
            booking.date ?? null,
            booking.startTime ?? null,
            booking.endTime ?? null,
            booking.userId ?? null,
            booking.userName ?? null,
            booking.labName ?? null,
            booking.note ?? null,
          );
        }
      }
    };

    const importCatalog = (gid: string | null, rawCatalog: unknown, label: string): void => {
      for (const rawItem of legacyArray(rawCatalog)) {
        const record = asRecord(rawItem);
        const itemId = typeof record.id === "string" && record.id !== "" ? record.id : null;
        const result = PrintCatalogItemSchema.safeParse(record);
        if (!result.success || itemId === null) {
          quarantine(label, result.success ? "missing id" : firstIssue(result.error), rawItem);
          continue;
        }
        const item = result.data;
        tryRun(
          insCatalog,
          label,
          rawItem,
          itemId,
          gid,
          item.name,
          item.description ?? null,
          item.category ?? null,
          item.material ?? null,
          item.estimatedTime ?? null,
          item.image ?? null,
        );
      }
    };

    const importPrintRequests = (sourceKind: string, gid: string | null, rawRequests: unknown, label: string): void => {
      for (const rawItem of legacyArray(rawRequests)) {
        const record = asRecord(rawItem);
        const itemId = typeof record.id === "string" && record.id !== "" ? record.id : null;
        const result = PrintRequestSchema.safeParse(record);
        if (!result.success || itemId === null) {
          quarantine(label, result.success ? "missing id" : firstIssue(result.error), rawItem);
          continue;
        }
        const item = result.data;
        tryRun(
          insPrintRequest,
          label,
          rawItem,
          itemId,
          sourceKind,
          gid,
          item.catalogItemId ?? null,
          item.catalogItemName ?? null,
          item.customDesign === undefined || item.customDesign === null ? null : item.customDesign ? 1 : 0,
          item.note ?? null,
          item.quantity ?? null,
          item.requestDate ?? null,
          item.requestedBy ?? null,
          item.requestedByUid ?? null,
          item.requestedByLabName ?? null,
          item.status ?? null,
        );
      }
    };

    const cleanTree = (label: string, doc: unknown): string | null => {
      const rooms: unknown[] = [];
      for (const rawRoom of legacyArray(asRecord(doc).rooms)) {
        const containers: unknown[] = [];
        for (const rawContainer of legacyArray(asRecord(rawRoom).containers)) {
          const shelves: unknown[] = [];
          for (const rawShelf of legacyArray(asRecord(rawContainer).shelves)) {
            const chemicals: unknown[] = [];
            for (const rawChemical of legacyArray(asRecord(rawShelf).chemicals)) {
              const chemicalResult = ChemicalSchema.safeParse(rawChemical);
              if (chemicalResult.success) {
                chemicals.push(chemicalResult.data);
              } else {
                quarantine(`${label} chemical`, firstIssue(chemicalResult.error), rawChemical);
              }
            }
            const shelfResult = ShelfSchema.safeParse({ ...asRecord(rawShelf), chemicals });
            if (shelfResult.success) {
              shelves.push(shelfResult.data);
            } else {
              quarantine(`${label} shelf`, firstIssue(shelfResult.error), rawShelf);
            }
          }
          const containerResult = ContainerSchema.safeParse({ ...asRecord(rawContainer), shelves });
          if (containerResult.success) {
            containers.push(containerResult.data);
          } else {
            quarantine(`${label} container`, firstIssue(containerResult.error), rawContainer);
          }
        }
        const roomResult = RoomSchema.safeParse({ ...asRecord(rawRoom), containers });
        if (roomResult.success) {
          rooms.push(roomResult.data);
        } else {
          quarantine(`${label} room`, firstIssue(roomResult.error), rawRoom);
        }
      }
      const pickList = (raw: unknown, schema: z.ZodType, kind: string): unknown[] => {
        const out: unknown[] = [];
        for (const rawItem of legacyArray(raw)) {
          const itemResult = schema.safeParse(rawItem);
          if (itemResult.success) {
            out.push(itemResult.data);
          } else {
            quarantine(`${label} ${kind}`, firstIssue(itemResult.error), rawItem);
          }
        }
        return out;
      };
      const tree = {
        rooms,
        assetRooms: pickList(asRecord(doc).assetRooms, AssetRoomSchema, "assetRoom"),
        assets: pickList(asRecord(doc).assets, AssetSchema, "asset"),
        protocols: pickList(asRecord(doc).protocols, ProtocolSchema, "protocol"),
      };
      const treeResult = InventoryTreeSchema.safeParse(tree);
      if (!treeResult.success) {
        quarantine(`${label} tree`, firstIssue(treeResult.error), tree);
        return null;
      }
      return JSON.stringify(treeResult.data);
    };

    for (const [gid, doc] of Object.entries(asRecord(source.paths.inventories))) {
      const record = asRecord(doc);
      const treeJson = cleanTree(`inventories/${gid}`, doc);
      if (treeJson !== null) {
        tryRun(insDoc, `inventories/${gid}`, doc, gid, treeJson);
      }
      importInstruments("group", gid, pairsOf(record.instruments), `inventories/${gid}/instruments`);
      importNotices("group", gid, pairsOf(record.notices), `inventories/${gid}/notices`);
      importCatalog(gid, record.printCatalog, `inventories/${gid}/printCatalog`);
      importPrintRequests("group", gid, record.printRequests, `inventories/${gid}/printRequests`);
    }

    importNotices("shared", null, Object.entries(asRecord(source.paths.shared_notices)), "shared_notices");
    importInstruments("shared", null, Object.entries(asRecord(source.paths.shared_instruments)), "shared_instruments");
    importCatalog(null, source.paths.shared_print_catalog, "shared_print_catalog");
    importPrintRequests("shared", null, source.paths.shared_print_requests, "shared_print_requests");

    for (const [key, raw] of Object.entries(asRecord(source.paths.game_challenges))) {
      const record = asRecord(raw);
      const result = GameChallengeSchema.safeParse(record);
      if (!result.success) {
        quarantine(`game_challenges/${key}`, firstIssue(result.error), raw);
        continue;
      }
      const game = result.data;
      tryRun(
        insGame,
        `game_challenges/${key}`,
        raw,
        game.id,
        game.gameType,
        game.challengerName ?? null,
        game.challengerUid ?? null,
        game.opponentName ?? null,
        game.opponentUid ?? null,
        game.winnerUid ?? null,
        game.status ?? null,
        game.createdAt,
        game.turn ?? null,
        game.board === undefined || game.board === null ? null : JSON.stringify(game.board),
        game.frogRound === undefined || game.frogRound === null ? null : JSON.stringify(game.frogRound),
        game.frogScores === undefined || game.frogScores === null ? null : JSON.stringify(game.frogScores),
        game.frogStatus === undefined || game.frogStatus === null ? null : JSON.stringify(game.frogStatus),
      );
    }

    for (const [gid, entries] of Object.entries(asRecord(source.paths.history))) {
      for (const [key, raw] of Object.entries(asRecord(entries))) {
        const result = HistoryEntrySchema.safeParse(raw);
        if (!result.success) {
          quarantine(`history/${gid}/${key}`, firstIssue(result.error), raw);
          continue;
        }
        tryRun(insHistory, `history/${gid}/${key}`, raw, gid, key, result.data.timestamp, result.data.user, result.data.action);
      }
    }

    for (const [gid, entries] of Object.entries(asRecord(source.paths.backups))) {
      for (const [key, raw] of Object.entries(asRecord(entries))) {
        const result = BackupSchema.safeParse({ ...asRecord(raw), id: key });
        if (!result.success) {
          quarantine(`backups/${gid}/${key}`, firstIssue(result.error), raw);
          continue;
        }
        tryRun(insBackup, `backups/${gid}/${key}`, raw, key, gid, result.data.timestamp, JSON.stringify(result.data.data ?? null));
      }
    }

    if (source.paths.inventory !== undefined) {
      const globalTree = cleanTree("inventory", source.paths.inventory);
      if (globalTree !== null) {
        tryRun(insSandbox, "inventory", source.paths.inventory, "global", globalTree);
      }
    }
    const sandboxRaw = source.paths.inventory_sandbox ?? source.paths.empty_sandbox_placeholder ?? {};
    const sandboxTree = cleanTree("inventory_sandbox", sandboxRaw);
    tryRun(
      insSandbox,
      "inventory_sandbox",
      sandboxRaw,
      "sandbox",
      sandboxTree ?? JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] }),
    );

    for (const entry of quarantined) {
      insQuarantine.run(entry.source, entry.reason, JSON.stringify(entry.payload));
    }
  });
  run();

  const tables = [
    "groups",
    "users",
    "group_inventory_docs",
    "sandbox_docs",
    "history",
    "group_backups",
    "notices",
    "notice_reactions",
    "instruments",
    "instrument_bookings",
    "print_catalog",
    "print_requests",
    "game_challenges",
    "quarantined_rows",
  ];
  console.log(`Imported into ${dbPath} (source: ${source.origin}):`);
  for (const table of tables) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    console.log(`  ${table.padEnd(22)} ${String(row.n).padStart(6)}`);
  }
  const integrity = db.pragma("integrity_check", { simple: true }) as string;
  console.log(`integrity_check: ${integrity}`);
  if (quarantined.length > 0) {
    console.log("");
    console.log(`QUARANTINED ROWS: ${quarantined.length}`);
    for (const entry of quarantined) {
      console.log(`  [${entry.source}] ${entry.reason}`);
    }
  }
  db.close();
}

main();
