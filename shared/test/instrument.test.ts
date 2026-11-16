import { describe, expect, it } from "vitest";
import { CreateInstrumentBodySchema, InstrumentSchema, UpdateInstrumentBodySchema } from "../src/index.js";
import { instrumentFixture } from "./fixtures.js";

const legacyCreateBody = {
  name: "HPLC Agilent 1260",
  location: "Room B302, Desk 4",
};

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

  it("preserves explicit nulls as an unassigned link", () => {
    const parsed = InstrumentSchema.parse({ ...instrumentFixture, roomGroupId: null, roomId: null });
    expect(parsed.roomGroupId).toBeNull();
    expect(parsed.roomId).toBeNull();
  });
});

describe("CreateInstrumentBodySchema room links", () => {
  it("keeps the legacy name/location body valid and free of link keys", () => {
    const parsed = CreateInstrumentBodySchema.parse(legacyCreateBody);
    expect(parsed).toMatchObject(legacyCreateBody);
    expect("roomGroupId" in parsed).toBe(false);
    expect("roomId" in parsed).toBe(false);
  });

  it("accepts an assigned pair and an explicit clear pair", () => {
    expect(CreateInstrumentBodySchema.parse({ ...legacyCreateBody, ...validLink })).toMatchObject(validLink);
    const cleared = CreateInstrumentBodySchema.parse({
      ...legacyCreateBody,
      roomGroupId: null,
      roomId: null,
    });
    expect(cleared.roomGroupId).toBeNull();
    expect(cleared.roomId).toBeNull();
  });

  it("rejects half-pairs, mixed null/string pairs, empty ids and undefined centers", () => {
    for (const broken of [
      { roomGroupId: "group-a" },
      { roomId: "room-1" },
      { roomGroupId: null },
      { roomId: null },
      { roomGroupId: null, roomId: "room-1" },
      { roomGroupId: "group-a", roomId: null },
      { roomGroupId: "", roomId: "room-1" },
      { roomGroupId: "   ", roomId: "room-1" },
      { roomGroupId: "group-a", roomId: "" },
      { roomGroupId: "group-a", roomId: undefined },
      { roomGroupId: undefined, roomId: "room-1" },
      { roomGroupId: undefined, roomId: undefined },
    ]) {
      expectRejected(CreateInstrumentBodySchema, { ...legacyCreateBody, ...broken });
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

  it("allows link-only set and clear updates without dropping explicit nulls", () => {
    const assigned = UpdateInstrumentBodySchema.parse(validLink);
    expect(assigned).toMatchObject(validLink);

    const cleared = UpdateInstrumentBodySchema.parse({ roomGroupId: null, roomId: null });
    expect(cleared.roomGroupId).toBeNull();
    expect(cleared.roomId).toBeNull();
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
