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
  // Canonical physical-room assignment. New instruments/bookings require a
  // complete pair pointing at a real room in an inventory tree. Legacy records
  // may omit or null these until migrated; the free-text `location` is only a
  // placement note and never a room locator.
  roomGroupId: optionalIdSchema,
  roomId: optionalIdSchema,
  bookings: rtdbArray(InstrumentBookingSchema).catch([]),
});

export type InstrumentBooking = z.infer<typeof InstrumentBookingSchema>;
export type Instrument = z.infer<typeof InstrumentSchema>;
