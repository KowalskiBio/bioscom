import { z } from "zod";
import { idSchema, optionalTextSchema, epochMsSchema } from "./common.js";

export const GameTypeSchema = z.enum(["chess", "frog"]);

export const GameChallengeSchema = z.looseObject({
  id: idSchema,
  gameType: GameTypeSchema,
  challengerName: optionalTextSchema,
  challengerUid: optionalTextSchema,
  opponentName: optionalTextSchema,
  opponentUid: optionalTextSchema,
  winnerUid: optionalTextSchema,
  status: optionalTextSchema,
  createdAt: epochMsSchema,
  turn: z.enum(["white", "black"]).nullish().catch(undefined),
  board: z.array(z.array(z.string())).nullish().catch(undefined),
  frogRound: z.record(z.string(), z.coerce.number()).nullish().catch(undefined),
  frogScores: z.record(z.string(), z.coerce.number()).nullish().catch(undefined),
  frogStatus: z.record(z.string(), z.string()).nullish().catch(undefined),
});

export type GameChallenge = z.infer<typeof GameChallengeSchema>;
