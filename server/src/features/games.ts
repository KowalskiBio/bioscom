import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { ChessMoveBodySchema, CreateGameBodySchema, FinishGameBodySchema, FrogAnswerBodySchema } from "@bioscom/shared";
import { getDatabase } from "../db.js";
import type { ServerConfig } from "../config.js";
import { requireUser } from "../auth/guards.js";
import type { InventoryHub } from "../inventory/ws.js";

interface GameRow {
  id: string;
  game_type: string;
  challenger_name: string | null;
  challenger_uid: string | null;
  opponent_name: string | null;
  opponent_uid: string | null;
  winner_uid: string | null;
  status: string | null;
  created_at: number;
  turn: string | null;
  board: string | null;
  frog_round: string | null;
  frog_scores: string | null;
  frog_status: string | null;
}

const INITIAL_BOARD = [
  ["r", "n", "b", "q", "k", "b", "", "r"],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["P", "P", "P", "P", "P", "P", "P", "P"],
  ["R", "N", "B", "Q", "K", "B", "", "R"],
];

export function registerGameRoutes(app: FastifyInstance, config: ServerConfig, hub: InventoryHub): void {
  const db = (): Database.Database => getDatabase(config.dbPath);

  const serialize = (row: GameRow): unknown => ({
    id: row.id,
    gameType: row.game_type,
    challengerName: row.challenger_name,
    challengerUid: row.challenger_uid,
    opponentName: row.opponent_name,
    opponentUid: row.opponent_uid,
    winnerUid: row.winner_uid,
    status: row.status,
    createdAt: row.created_at,
    turn: row.turn,
    board: row.board === null ? null : (JSON.parse(row.board) as unknown),
    frogRound: row.frog_round === null ? null : (JSON.parse(row.frog_round) as unknown),
    frogScores: row.frog_scores === null ? null : (JSON.parse(row.frog_scores) as unknown),
    frogStatus: row.frog_status === null ? null : (JSON.parse(row.frog_status) as unknown),
  });

  const loadGame = (id: string): GameRow | undefined =>
    db().prepare("SELECT * FROM game_challenges WHERE id = ?").get(id) as GameRow | undefined;

  const isParticipant = (row: GameRow, uid: string): boolean =>
    row.challenger_uid === uid || row.opponent_uid === uid;

  app.get("/api/games", async (request, reply) => {
    if (requireUser(db(), request, reply) === null) return;
    const rows = db().prepare("SELECT * FROM game_challenges ORDER BY created_at DESC").all() as GameRow[];
    return { games: rows.map(serialize) };
  });

  app.post("/api/games", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const body = CreateGameBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const opponent = db()
      .prepare("SELECT uid, name FROM users WHERE uid = ?")
      .get(body.data.opponentUid) as { uid: string; name: string | null } | undefined;
    if (opponent === undefined) {
      return reply.status(404).send({ error: "Opponent not found" });
    }
    if (opponent.uid === user.uid) {
      return reply.status(400).send({ error: "Cannot challenge yourself" });
    }
    const id = `g_${randomBytes(9).toString("hex")}`;
    const frogMaps = body.data.gameType === "frog"
      ? JSON.stringify({ [user.uid]: 0, [opponent.uid]: 0 })
      : null;
    db()
      .prepare(
        "INSERT INTO game_challenges (id, game_type, challenger_name, challenger_uid, opponent_name, opponent_uid, status, created_at, turn, board, frog_round, frog_scores, frog_status) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        body.data.gameType,
        user.name ?? user.uid,
        user.uid,
        opponent.name ?? opponent.uid,
        opponent.uid,
        Date.now(),
        body.data.gameType === "chess" ? "white" : null,
        body.data.gameType === "chess" ? JSON.stringify(INITIAL_BOARD) : null,
        frogMaps,
        frogMaps,
        frogMaps,
      );
    hub.broadcastAll({ type: "reload", resource: "games" });
    return reply.status(201).send({ id });
  });

  app.post("/api/games/:id/chess-move", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const id = (request.params as { id: string }).id;
    const game = loadGame(id);
    if (game === undefined) {
      return reply.status(404).send({ error: "Game not found" });
    }
    if (game.game_type !== "chess") {
      return reply.status(400).send({ error: "Not a chess game" });
    }
    if (!isParticipant(game, user.uid)) {
      return reply.status(403).send({ error: "Not a participant" });
    }
    const body = ChessMoveBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    db()
      .prepare("UPDATE game_challenges SET board = ?, turn = ? WHERE id = ?")
      .run(JSON.stringify(body.data.board), body.data.turn === "white" ? "black" : "white", id);
    hub.broadcastAll({ type: "reload", resource: "games" });
    return { ok: true };
  });

  app.post("/api/games/:id/frog-answer", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const id = (request.params as { id: string }).id;
    const game = loadGame(id);
    if (game === undefined) {
      return reply.status(404).send({ error: "Game not found" });
    }
    if (game.game_type !== "frog") {
      return reply.status(400).send({ error: "Not a frog game" });
    }
    if (!isParticipant(game, user.uid)) {
      return reply.status(403).send({ error: "Not a participant" });
    }
    const body = FrogAnswerBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const rounds = game.frog_round === null ? {} : (JSON.parse(game.frog_round) as Record<string, number>);
    const scores = game.frog_scores === null ? {} : (JSON.parse(game.frog_scores) as Record<string, number>);
    rounds[user.uid] = body.data.round;
    scores[user.uid] = body.data.score;
    db()
      .prepare("UPDATE game_challenges SET frog_round = ?, frog_scores = ? WHERE id = ?")
      .run(JSON.stringify(rounds), JSON.stringify(scores), id);
    hub.broadcastAll({ type: "reload", resource: "games" });
    return { ok: true };
  });

  app.post("/api/games/:id/finish", async (request, reply) => {
    const user = requireUser(db(), request, reply);
    if (user === null) return;
    const id = (request.params as { id: string }).id;
    const game = loadGame(id);
    if (game === undefined) {
      return reply.status(404).send({ error: "Game not found" });
    }
    if (!isParticipant(game, user.uid) && user.role !== "superadmin") {
      return reply.status(403).send({ error: "Not a participant" });
    }
    const body = FinishGameBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    if (game.game_type === "frog") {
      const status = game.frog_status === null ? {} : (JSON.parse(game.frog_status) as Record<string, string>);
      status[user.uid] = "completed";
      db().prepare("UPDATE game_challenges SET frog_status = ? WHERE id = ?").run(JSON.stringify(status), id);
    }
    db()
      .prepare("UPDATE game_challenges SET status = 'completed', winner_uid = ? WHERE id = ?")
      .run(body.data.winnerUid ?? null, id);
    hub.broadcastAll({ type: "reload", resource: "games" });
    return { ok: true };
  });
}
