import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { FastifyInstance } from "fastify";
import { hash as argonHash } from "@node-rs/argon2";
import { buildApp } from "../src/app.js";
import { closeDatabase, getDatabase } from "../src/db.js";

const XRW = { "X-Requested-With": "XMLHttpRequest" };
const GROUP = "group-protocol";

let app: FastifyInstance;
let baseUrl: string;
let cookie: string;

interface ProtocolDoc {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  content?: string;
}

function createProtocol(payload: Record<string, unknown>) {
  return request(baseUrl)
    .post(`/api/groups/${GROUP}/inventory/protocols`)
    .set("Cookie", cookie)
    .set(XRW)
    .send(payload);
}

function editProtocol(id: string, payload: Record<string, unknown>) {
  return request(baseUrl)
    .put(`/api/groups/${GROUP}/inventory/protocols/${id}`)
    .set("Cookie", cookie)
    .set(XRW)
    .send(payload);
}

async function inventoryProtocols(): Promise<ProtocolDoc[]> {
  const res = await request(baseUrl).get(`/api/groups/${GROUP}/inventory`).set("Cookie", cookie).set(XRW);
  expect(res.status).toBe(200);
  return res.body.tree.protocols as ProtocolDoc[];
}

async function inventoryProtocol(id: string): Promise<ProtocolDoc | undefined> {
  return (await inventoryProtocols()).find((protocol) => protocol.id === id);
}

function protocolFromResponse(res: request.Response, title: string): ProtocolDoc {
  const found = (res.body.tree.protocols as ProtocolDoc[]).find((protocol) => protocol.title === title);
  if (found === undefined) throw new Error(`protocol "${title}" not found in response`);
  return found;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-protocol-test-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const db = getDatabase(dbPath);
  db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  ).run("uid-protocol", "admin@protocol.test", await argonHash("pw"), "Admin", "admin", GROUP);
  db.prepare("INSERT INTO groups (id, name, join_code, created) VALUES (?, 'Protocol Lab', 'BIOS-PR', 1)").run(GROUP);
  db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, 0)").run(
    GROUP,
    JSON.stringify({ rooms: [], assetRooms: [], assets: [], protocols: [] }),
  );
  const login = await request(baseUrl)
    .post("/api/login")
    .set(XRW)
    .send({ email: "admin@protocol.test", password: "pw" });
  const setCookie = login.headers["set-cookie"];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("protocol create", () => {
  it("persists description, tags and raw markdown content and exposes them via GET", async () => {
    const content = "\n# Rich Protocol\n\n- step one\n\n```\ncode\n```\n";
    const res = await createProtocol({
      title: "Rich",
      description: "Short summary",
      tags: [" lab ", "protocol"],
      content,
    });
    expect(res.status).toBe(201);
    const created = protocolFromResponse(res, "Rich");
    expect(created.description).toBe("Short summary");
    expect(created.tags).toEqual(["lab", "protocol"]);
    expect(created.content).toBe(content);

    const stored = await inventoryProtocol(created.id);
    expect(stored?.description).toBe("Short summary");
    expect(stored?.tags).toEqual(["lab", "protocol"]);
    expect(stored?.content).toBe(content);
  });

  it("keeps legacy-shaped creates without description or tags", async () => {
    const res = await createProtocol({ title: "Legacy" });
    expect(res.status).toBe(201);
    const created = protocolFromResponse(res, "Legacy");
    expect(created.description).toBeUndefined();
    expect(created.tags).toBeUndefined();
    expect(created.content).toBe("");
  });

  it("omits empty description and tags instead of storing blank values", async () => {
    const res = await createProtocol({ title: "Blank meta", description: "   ", tags: [] });
    expect(res.status).toBe(201);
    const created = protocolFromResponse(res, "Blank meta");
    expect(created.description).toBeUndefined();
    expect(created.tags).toBeUndefined();
  });
});

describe("protocol edit", () => {
  it("preserves fields omitted from the update", async () => {
    const content = "# Keep\n\nbody";
    const created = protocolFromResponse(
      await createProtocol({
        title: "Preserved",
        description: "keep me",
        tags: ["a", "b"],
        content,
      }),
      "Preserved",
    );

    const res = await editProtocol(created.id, { title: "Renamed" });
    expect(res.status).toBe(200);
    const stored = await inventoryProtocol(created.id);
    expect(stored?.title).toBe("Renamed");
    expect(stored?.description).toBe("keep me");
    expect(stored?.tags).toEqual(["a", "b"]);
    expect(stored?.content).toBe(content);
  });

  it("clears the description when given an empty string", async () => {
    const created = protocolFromResponse(
      await createProtocol({ title: "Clear desc", description: "old" }),
      "Clear desc",
    );
    const res = await editProtocol(created.id, { description: "" });
    expect(res.status).toBe(200);
    expect((await inventoryProtocol(created.id))?.description).toBeUndefined();
  });

  it("clears and replaces tags", async () => {
    const created = protocolFromResponse(
      await createProtocol({ title: "Clear tags", tags: ["old"] }),
      "Clear tags",
    );

    expect((await editProtocol(created.id, { tags: ["new", "set"] })).status).toBe(200);
    expect((await inventoryProtocol(created.id))?.tags).toEqual(["new", "set"]);

    expect((await editProtocol(created.id, { tags: [] })).status).toBe(200);
    expect((await inventoryProtocol(created.id))?.tags).toBeUndefined();
  });

  it("sets raw markdown content exactly when present", async () => {
    const created = protocolFromResponse(await createProtocol({ title: "Content edit" }), "Content edit");
    const content = "\n## New\n\n  indented\n";
    expect((await editProtocol(created.id, { content })).status).toBe(200);
    expect((await inventoryProtocol(created.id))?.content).toBe(content);
  });
});

describe("protocol validation", () => {
  it("rejects invalid tags, description and content on create with 400", async () => {
    const before = (await inventoryProtocols()).length;
    const cases: Array<Record<string, unknown>> = [
      { title: "Too many tags", tags: Array.from({ length: 25 }, (_, i) => `t${i}`) },
      { title: "Oversized tag", tags: ["x".repeat(51)] },
      { title: "Blank tag", tags: [""] },
      { title: "Oversized description", description: "x".repeat(1001) },
      { title: "Oversized content", content: "x".repeat(8001) },
    ];
    for (const payload of cases) {
      expect((await createProtocol(payload)).status).toBe(400);
    }
    expect((await inventoryProtocols()).length).toBe(before);
  });

  it("rejects invalid tags, description and content edits with 400 without mutating", async () => {
    const created = protocolFromResponse(
      await createProtocol({
        title: "Guarded",
        description: "stable",
        tags: ["stable"],
        content: "stable body",
      }),
      "Guarded",
    );

    const cases: Array<Record<string, unknown>> = [
      { tags: Array.from({ length: 25 }, (_, i) => `t${i}`) },
      { tags: ["x".repeat(51)] },
      { description: "x".repeat(1001) },
      { content: "x".repeat(8001) },
      {},
    ];
    for (const payload of cases) {
      expect((await editProtocol(created.id, payload)).status).toBe(400);
    }

    const stored = await inventoryProtocol(created.id);
    expect(stored?.description).toBe("stable");
    expect(stored?.tags).toEqual(["stable"]);
    expect(stored?.content).toBe("stable body");
  });
});
