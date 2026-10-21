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
  bookings: rtdbArray(InstrumentBookingSchema).catch([]),
});

export type InstrumentBooking = z.infer<typeof InstrumentBookingSchema>;
export type Instrument = z.infer<typeof InstrumentSchema>;
