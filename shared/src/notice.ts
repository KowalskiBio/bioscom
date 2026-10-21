import { z } from "zod";
import {
  idSchema,
  optionalIdSchema,
  looseTextSchema,
  optionalTextSchema,
  epochMsSchema,
  rtdbArray,
} from "./common.js";

export const NoticeReactionSchema = z.looseObject({
  id: optionalIdSchema,
  text: optionalTextSchema,
  timestamp: epochMsSchema,
  userId: optionalTextSchema,
  userName: optionalTextSchema,
  userAvatar: optionalTextSchema,
});

export const NoticeSchema = z.looseObject({
  id: idSchema,
  title: optionalTextSchema,
  content: optionalTextSchema,
  category: optionalTextSchema,
  authorName: optionalTextSchema,
  authorUid: optionalTextSchema,
  authorLab: optionalTextSchema,
  authorAvatar: optionalTextSchema,
  timestamp: epochMsSchema,
  reactions: rtdbArray(NoticeReactionSchema).catch([]),
});

export type NoticeReaction = z.infer<typeof NoticeReactionSchema>;
export type Notice = z.infer<typeof NoticeSchema>;
