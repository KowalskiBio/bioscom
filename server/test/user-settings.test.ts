import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { FastifyInstance } from "fastify";
import { hash as argonHash } from "@node-rs/argon2";
import { defaultCatalogColumnSelections } from "@bioscom/shared";
import { buildApp } from "../src/app.js";
import { closeDatabase, getDatabase } from "../src/db.js";

const XRW = { "X-Requested-With": "XMLHttpRequest" };

let app: FastifyInstance;
let baseUrl: string;
let db: ReturnType<typeof getDatabase>;
let cookieA: string;
let cookieB: string;
let cookieReader: string;
let cookieSuper: string;
let cookieLegacy: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(baseUrl).post("/api/login").set(XRW).send({ email, password });
  const setCookie = response.headers["set-cookie"];
  return (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? "").split(";")[0] ?? "";
}

function storedSettings(uid: string): string | null {
  const row = db.prepare("SELECT settings FROM user_settings WHERE uid = ?").get(uid) as
    | { settings: string }
    | undefined;
  return row?.settings ?? null;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-user-settings-test-"));
  const dbPath = join(dir, "test.db");
  app = await buildApp({ config: { dbPath, logLevel: "silent", loginRateLimit: 1000 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  db = getDatabase(dbPath);

  const insert = db.prepare(
    "INSERT INTO users (uid, email, password_hash, hash_version, name, role, group_id) VALUES (?, ?, ?, 'argon2id', ?, ?, ?)",
  );
  insert.run("uid-a", "a@settings.test", await argonHash("pw-a"), "A", "admin", "group-a");
  insert.run("uid-b", "b@settings.test", await argonHash("pw-b"), "B", "admin", "group-b");
  insert.run("uid-reader", "reader@settings.test", await argonHash("pw-reader"), "Reader", "reader", "group-a");
  insert.run("uid-super", "super@settings.test", await argonHash("pw-super"), "Super", "superadmin", "group-a");
  insert.run("uid-malformed", "malformed@settings.test", await argonHash("pw-malformed"), "Malformed", "reader", "group-a");
  insert.run("uid-legacy", "legacy@settings.test", await argonHash("pw-legacy"), "Legacy", "reader", "group-a");

  cookieA = await login("a@settings.test", "pw-a");
  cookieB = await login("b@settings.test", "pw-b");
  cookieReader = await login("reader@settings.test", "pw-reader");
  cookieSuper = await login("super@settings.test", "pw-super");
  cookieLegacy = await login("legacy@settings.test", "pw-legacy");
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("catalog column preferences", () => {
  it("rejects unauthenticated GET and PUT with 401", async () => {
    expect((await request(baseUrl).get("/api/users/me/catalog-columns")).status).toBe(401);
    const put = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .send({ scope: "all", columns: ["name", "actions"] });
    expect(put.status).toBe(401);
  });

  it("returns the complete defaults and timestamp 0 for a new account", async () => {
    const response = await request(baseUrl).get("/api/users/me/catalog-columns").set("Cookie", cookieA);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ columnsByType: defaultCatalogColumnSelections(), updatedAt: 0 });
  });

  it("merges a single scope and persists it across requests", async () => {
    const columns = ["name", "quantity", "actions", "cas_number"];
    const put = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieA)
      .send({ scope: "chemical", columns });
    expect(put.status).toBe(200);
    expect(put.body.columnsByType.chemical).toEqual(columns);
    expect(put.body.columnsByType.all).toEqual(defaultCatalogColumnSelections().all);
    expect(put.body.columnsByType.antibody).toEqual(defaultCatalogColumnSelections().antibody);
    expect(typeof put.body.updatedAt).toBe("number");
    expect(put.body.updatedAt).toBeGreaterThan(0);

    const get = await request(baseUrl).get("/api/users/me/catalog-columns").set("Cookie", cookieA);
    expect(get.status).toBe(200);
    expect(get.body.columnsByType).toEqual(put.body.columnsByType);
    expect(get.body.updatedAt).toBe(put.body.updatedAt);

    const root = JSON.parse(storedSettings("uid-a") ?? "{}") as Record<string, unknown>;
    expect(root.columnsByType).toEqual(put.body.columnsByType);
    expect(root).not.toHaveProperty("groupId");
    expect(root).not.toHaveProperty("group_id");
  });

  it("lets a reader save their own preferences", async () => {
    const columns = ["name", "actions"];
    const put = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieReader)
      .send({ scope: "all", columns });
    expect(put.status).toBe(200);
    expect(put.body.columnsByType.all).toEqual(columns);

    const get = await request(baseUrl).get("/api/users/me/catalog-columns").set("Cookie", cookieReader);
    expect(get.status).toBe(200);
    expect(get.body.columnsByType.all).toEqual(columns);
  });

  it("never lets one user read or affect another user's preferences", async () => {
    const aColumns = ["name", "actions", "cas_number"];
    const aPut = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieA)
      .send({ scope: "chemical", columns: aColumns });
    expect(aPut.status).toBe(200);

    const bGet = await request(baseUrl).get("/api/users/me/catalog-columns").set("Cookie", cookieB);
    expect(bGet.status).toBe(200);
    expect(bGet.body).toEqual({ columnsByType: defaultCatalogColumnSelections(), updatedAt: 0 });

    const bColumns = ["name", "actions"];
    const bPut = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieB)
      .send({ scope: "all", columns: bColumns });
    expect(bPut.status).toBe(200);

    const aGet = await request(baseUrl).get("/api/users/me/catalog-columns").set("Cookie", cookieA);
    expect(aGet.body.columnsByType.chemical).toEqual(aColumns);
    expect(aGet.body.columnsByType.all).toEqual(defaultCatalogColumnSelections().all);
  });

  it("stores product-derived core extras and the primer-only target_species", async () => {
    const allColumns = ["name", "actions", "manufacturer", "catalog_number"];
    const allPut = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieReader)
      .send({ scope: "all", columns: allColumns });
    expect(allPut.status).toBe(200);
    expect(allPut.body.columnsByType.all).toEqual(allColumns);

    const primerColumns = ["name", "actions", "sequence", "target_species"];
    const primerPut = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieReader)
      .send({ scope: "primer", columns: primerColumns });
    expect(primerPut.status).toBe(200);
    expect(primerPut.body.columnsByType.primer).toEqual(primerColumns);

    const wrongScope = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieReader)
      .send({ scope: "antibody", columns: ["name", "actions", "target_species"] });
    expect(wrongScope.status).toBe(400);

    const get = await request(baseUrl).get("/api/users/me/catalog-columns").set("Cookie", cookieReader);
    expect(get.status).toBe(200);
    expect(get.body.columnsByType.all).toEqual(allColumns);
    expect(get.body.columnsByType.primer).toEqual(primerColumns);
  });

  it("normalises a legacy All custom_notes PUT to the canonical stock Note", async () => {
    const legacyPut = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieReader)
      .send({ scope: "all", columns: ["name", "actions", "custom_notes"] });
    expect(legacyPut.status).toBe(200);
    expect(legacyPut.body.columnsByType.all).toEqual(["name", "actions", "note"]);

    // Repeating the request, including both aliases together, stays valid and
    // never produces a duplicate Note column.
    const bothPut = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieReader)
      .send({ scope: "all", columns: ["name", "actions", "note", "custom_notes"] });
    expect(bothPut.status).toBe(200);
    expect(bothPut.body.columnsByType.all).toEqual(["name", "actions", "note"]);

    const get = await request(baseUrl).get("/api/users/me/catalog-columns").set("Cookie", cookieReader);
    expect(get.status).toBe(200);
    expect(get.body.columnsByType.all).toEqual(["name", "actions", "note"]);

    const root = JSON.parse(storedSettings("uid-reader") ?? "{}") as {
      columnsByType: { all: string[] };
    };
    expect(root.columnsByType.all).toEqual(["name", "actions", "note"]);
  });

  it("returns a stored legacy All preference as canonical Note and preserves other scopes", async () => {
    db.prepare("INSERT INTO user_settings (uid, settings, updated_at) VALUES (?, ?, ?)").run(
      "uid-legacy",
      JSON.stringify({
        columnsByType: {
          all: ["name", "actions", "custom_notes"],
          other: ["name", "actions", "custom_notes", "note"],
        },
      }),
      1,
    );

    const get = await request(baseUrl).get("/api/users/me/catalog-columns").set("Cookie", cookieLegacy);
    expect(get.status).toBe(200);
    expect(get.body.columnsByType.all).toEqual(["name", "actions", "note"]);
    // Other's material descriptor is not an All alias: keep it verbatim.
    expect(get.body.columnsByType.other).toEqual(["name", "actions", "custom_notes", "note"]);

    const otherPut = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieLegacy)
      .send({ scope: "other", columns: ["name", "actions", "custom_notes", "note"] });
    expect(otherPut.status).toBe(200);
    expect(otherPut.body.columnsByType.other).toEqual(["name", "actions", "custom_notes", "note"]);

    const afterPut = await request(baseUrl)
      .get("/api/users/me/catalog-columns")
      .set("Cookie", cookieLegacy);
    expect(afterPut.status).toBe(200);
    expect(afterPut.body.columnsByType.all).toEqual(["name", "actions", "note"]);
  });

  it("rejects custom_notes for non-Other material scopes", async () => {
    const response = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieReader)
      .send({ scope: "chemical", columns: ["name", "actions", "custom_notes"] });
    expect(response.status).toBe(400);
  });

  it("returns 400 for missing name/actions without writing anything", async () => {
    const before = storedSettings("uid-reader");
    for (const columns of [["name", "quantity"], ["actions", "quantity"]]) {
      const response = await request(baseUrl)
        .put("/api/users/me/catalog-columns")
        .set(XRW)
        .set("Cookie", cookieReader)
        .send({ scope: "solution", columns });
      expect(response.status).toBe(400);
    }
    expect(storedSettings("uid-reader")).toBe(before);
  });

  it("returns 400 for a descriptor from the wrong scope without writing anything", async () => {
    const before = storedSettings("uid-reader");
    const response = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieReader)
      .send({ scope: "antibody", columns: ["name", "actions", "cas_number"] });
    expect(response.status).toBe(400);
    expect(storedSettings("uid-reader")).toBe(before);
  });

  it("rejects malformed stored settings explicitly instead of silently resetting", async () => {
    db.prepare("INSERT INTO user_settings (uid, settings, updated_at) VALUES (?, ?, ?)").run(
      "uid-malformed",
      '{"columnsByType":{"all":["name"]}}',
      1,
    );
    const response = await request(baseUrl)
      .get("/api/users/me/catalog-columns")
      .set("Cookie", await login("malformed@settings.test", "pw-malformed"));
    expect(response.status).toBe(500);
    expect(response.body.error).toContain("invalid");
  });

  it("removes only the deleted user's settings row on admin deletion", async () => {
    const bPut = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieB)
      .send({ scope: "all", columns: ["name", "actions"] });
    expect(bPut.status).toBe(200);
    expect(storedSettings("uid-b")).not.toBeNull();

    const response = await request(baseUrl)
      .delete("/api/admin/users/uid-b")
      .set(XRW)
      .set("Cookie", cookieSuper);
    expect(response.status).toBe(200);

    const deleted = db.prepare("SELECT COUNT(*) AS n FROM user_settings WHERE uid = 'uid-b'").get() as { n: number };
    const survivor = db.prepare("SELECT COUNT(*) AS n FROM user_settings WHERE uid = 'uid-a'").get() as {
      n: number;
    };
    expect(deleted.n).toBe(0);
    expect(survivor.n).toBe(1);
  });
});
