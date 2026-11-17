import { describe, expect, it } from "vitest";
import { CreateInstrumentBodySchema, InstrumentSchema, UpdateInstrumentBodySchema } from "../src/index.js";
import { instrumentFixture } from "./fixtures.js";

const validLink = { roomGroupId: "group-a", roomId: "room-1" };

function expectRejected(schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false);
}

describe("InstrumentSchema room links", () => {
  it("keeps legacy instruments without links and preserves their location", () => {
    const parsed = InstrumentSchema.parse(instrumentFixture);
    expect(parsed.location).toBe("Room B302, Desk 4");
    expect(parsed.roomGroupId).toBeUndefined();
    expect(parsed.roomId).toBeUndefined();
  });

  it("accepts flattened stable room group and room ids", () => {
    const parsed = InstrumentSchema.parse({ ...instrumentFixture, ...validLink });
    expect(parsed.roomGroupId).toBe("group-a");
    expect(parsed.roomId).toBe("room-1");
  });

  it("preserves explicit nulls as a legacy unassigned record", () => {
    const parsed = InstrumentSchema.parse({ ...instrumentFixture, roomGroupId: null, roomId: null });
    expect(parsed.roomGroupId).toBeNull();
    expect(parsed.roomId).toBeNull();
  });
});

describe("CreateInstrumentBodySchema canonical room requirement", () => {
  it("requires a nonempty room pair and treats location as optional placement detail", () => {
    const parsed = CreateInstrumentBodySchema.parse({ name: "HPLC Agilent 1260", ...validLink });
    expect(parsed).toMatchObject(validLink);
    expect(parsed.location).toBeUndefined();

    const withLocation = CreateInstrumentBodySchema.parse({
      name: "HPLC Agilent 1260",
      location: "Room B302, Desk 4",
      ...validLink,
    });
    expect(withLocation.location).toBe("Room B302, Desk 4");
  });

  it("accepts a blank location because the room link is authoritative", () => {
    const parsed = CreateInstrumentBodySchema.parse({ name: "HPLC", location: "   ", ...validLink });
    expect(parsed.location).toBe("");
  });

  it("rejects legacy location-only creation, missing, half, null and empty pairs", () => {
    for (const broken of [
      { name: "Location only", location: "Room B302" },
      { name: "No pair" },
      { name: "Group only", roomGroupId: "group-a" },
      { name: "Room only", roomId: "room-1" },
      { name: "Both null", roomGroupId: null, roomId: null },
      { name: "Null group", roomGroupId: null, roomId: "room-1" },
      { name: "Null room", roomGroupId: "group-a", roomId: null },
      { name: "Empty group", roomGroupId: "", roomId: "room-1" },
      { name: "Blank group", roomGroupId: "   ", roomId: "room-1" },
      { name: "Empty room", roomGroupId: "group-a", roomId: "" },
      { name: "Undefined room", roomGroupId: "group-a", roomId: undefined },
      { name: "Undefined group", roomGroupId: undefined, roomId: "room-1" },
    ]) {
      expectRejected(CreateInstrumentBodySchema, broken);
    }
  });
});

describe("UpdateInstrumentBodySchema room links", () => {
  it("keeps legacy partial updates valid and treats omitted links as no change", () => {
    const parsed = UpdateInstrumentBodySchema.parse({ name: "Renamed HPLC" });
    expect(parsed.name).toBe("Renamed HPLC");
    expect("roomGroupId" in parsed).toBe(false);
    expect("roomId" in parsed).toBe(false);
  });

  it("allows link-only assignment and keeps the explicit clear shape for the API to reject", () => {
    const assigned = UpdateInstrumentBodySchema.parse(validLink);
    expect(assigned).toMatchObject(validLink);

    // The API rejects this with a clear 4xx because a room is mandatory; the
    // schema only preserves the explicit shape.
    const cleared = UpdateInstrumentBodySchema.parse({ roomGroupId: null, roomId: null });
    expect(cleared.roomGroupId).toBeNull();
    expect(cleared.roomId).toBeNull();
  });

  it("allows an empty placement note while keeping the room assignment separate", () => {
    const parsed = UpdateInstrumentBodySchema.parse({ location: "" });
    expect(parsed.location).toBe("");
    expect("roomGroupId" in parsed).toBe(false);
    expect("roomId" in parsed).toBe(false);
  });

  it("still rejects an empty update", () => {
    expect(UpdateInstrumentBodySchema.safeParse({}).success).toBe(false);
  });

  it("rejects half-pairs, mixed null/string pairs and undefined centers on update", () => {
    for (const broken of [
      { roomGroupId: "group-a" },
      { roomId: "room-1" },
      { roomGroupId: null, roomId: "room-1" },
      { roomGroupId: "group-a", roomId: null },
      { roomGroupId: "group-a", roomId: undefined },
      { roomGroupId: undefined, roomId: "room-1" },
      { roomGroupId: undefined, roomId: undefined },
    ]) {
      expectRejected(UpdateInstrumentBodySchema, broken);
    }
  });
});
