import { z } from "zod";
import {
  idSchema,
  optionalIdSchema,
  looseTextSchema,
  optionalTextSchema,
  rtdbArray,
} from "./common.js";

export const InstrumentBookingSchema = z.looseObject({
  id: optionalIdSchema,
  date: optionalTextSchema,
  startTime: optionalTextSchema,
  endTime: optionalTextSchema,
  userId: optionalTextSchema,
  userName: optionalTextSchema,
  labName: optionalTextSchema,
  note: optionalTextSchema,
});

export const InstrumentSchema = z.looseObject({
  id: idSchema,
  name: looseTextSchema,
  description: optionalTextSchema,
  location: optionalTextSchema,
  contactPerson: optionalTextSchema,
  contactEmail: optionalTextSchema,
  ownerLabId: optionalTextSchema,
  ownerLabName: optionalTextSchema,
  // Optional stable links to a physical chemical room group/room. Omitted or
  // null means legacy/unassigned; the free-text `location` stays authoritative
  // for display until a link is explicitly assigned.
  roomGroupId: optionalIdSchema,
  roomId: optionalIdSchema,
  bookings: rtdbArray(InstrumentBookingSchema).catch([]),
});

export type InstrumentBooking = z.infer<typeof InstrumentBookingSchema>;
export type Instrument = z.infer<typeof InstrumentSchema>;
