import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
let cookieDashA: string;
let cookieDashB: string;
let cookieDashMalformed: string;
let cookieDashCap: string;

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
  insert.run("uid-dash-a", "dash-a@settings.test", await argonHash("pw-dash-a"), "Dash A", "reader", "group-a");
  insert.run("uid-dash-b", "dash-b@settings.test", await argonHash("pw-dash-b"), "Dash B", "reader", "group-b");
  insert.run(
    "uid-dash-malformed",
    "dash-malformed@settings.test",
    await argonHash("pw-dash-malformed"),
    "Dash Malformed",
    "reader",
    "group-a",
  );
  insert.run("uid-dash-cap", "dash-cap@settings.test", await argonHash("pw-dash-cap"), "Dash Cap", "reader", "group-a");

  cookieA = await login("a@settings.test", "pw-a");
  cookieB = await login("b@settings.test", "pw-b");
  cookieReader = await login("reader@settings.test", "pw-reader");
  cookieSuper = await login("super@settings.test", "pw-super");
  cookieLegacy = await login("legacy@settings.test", "pw-legacy");
  cookieDashA = await login("dash-a@settings.test", "pw-dash-a");
  cookieDashB = await login("dash-b@settings.test", "pw-dash-b");
  cookieDashMalformed = await login("dash-malformed@settings.test", "pw-dash-malformed");
  cookieDashCap = await login("dash-cap@settings.test", "pw-dash-cap");
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

describe("dashboard attention dismissals", () => {
  const DISMISSALS_PATH = "/api/users/me/dashboard-dismissals";
  const DASH_ACCOUNTS = ["uid-dash-a", "uid-dash-b", "uid-dash-malformed", "uid-dash-cap"];

  function getDismissals(cookie: string) {
    return request(baseUrl).get(DISMISSALS_PATH).set("Cookie", cookie);
  }

  function putDismissal(cookie: string, key: unknown, dismissed: unknown) {
    return request(baseUrl).put(DISMISSALS_PATH).set(XRW).set("Cookie", cookie).send({ key, dismissed });
  }

  function storedRoot(uid: string): Record<string, unknown> {
    return JSON.parse(storedSettings(uid) ?? "{}") as Record<string, unknown>;
  }

  beforeEach(() => {
    for (const uid of DASH_ACCOUNTS) {
      db.prepare("DELETE FROM user_settings WHERE uid = ?").run(uid);
    }
  });

  it("rejects unauthenticated GET and PUT with 401", async () => {
    expect((await request(baseUrl).get(DISMISSALS_PATH)).status).toBe(401);
    const put = await request(baseUrl)
      .put(DISMISSALS_PATH)
      .set(XRW)
      .send({ key: "notice:n_1", dismissed: true });
    expect(put.status).toBe(401);
  });

  it("defaults to an empty list and timestamp 0 for a new account", async () => {
    const response = await getDismissals(cookieDashA);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ dismissals: [], updatedAt: 0 });
  });

  it("round-trips a dismissal and persists it for the account", async () => {
    const key = "stock-low:chem_legacy-1";
    const put = await putDismissal(cookieDashA, key, true);
    expect(put.status).toBe(200);
    expect(put.body.dismissals).toEqual([key]);
    expect(typeof put.body.updatedAt).toBe("number");
    expect(put.body.updatedAt).toBeGreaterThan(0);

    const get = await getDismissals(cookieDashA);
    expect(get.status).toBe(200);
    expect(get.body).toEqual(put.body);
    expect(storedRoot("uid-dash-a").dashboardDismissedAlerts).toEqual([key]);
  });

  it("lets a reader dismiss their own dashboard alerts", async () => {
    const key = "notice:n_reader_dismiss";
    const put = await putDismissal(cookieReader, key, true);
    expect(put.status).toBe(200);
    expect(put.body.dismissals).toContain(key);

    const get = await getDismissals(cookieReader);
    expect(get.status).toBe(200);
    expect(get.body.dismissals).toContain(key);
  });

  it("is idempotent when the same dismissal is repeated", async () => {
    const key = "stock-low:chem-repeat";
    const first = await putDismissal(cookieDashA, key, true);
    const second = await putDismissal(cookieDashA, key, true);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.dismissals).toEqual([key]);
    expect(storedRoot("uid-dash-a").dashboardDismissedAlerts).toEqual([key]);
  });

  it("preserves two independent keys and removes only the requested one", async () => {
    const lowKey = "stock-low:chem-two";
    const noticeKey = "notice:n_two";
    expect((await putDismissal(cookieDashA, lowKey, true)).status).toBe(200);
    const both = await putDismissal(cookieDashA, noticeKey, true);
    expect(both.status).toBe(200);
    expect(both.body.dismissals).toEqual([lowKey, noticeKey]);

    const removed = await putDismissal(cookieDashA, lowKey, false);
    expect(removed.status).toBe(200);
    expect(removed.body.dismissals).toEqual([noticeKey]);

    const get = await getDismissals(cookieDashA);
    expect(get.body.dismissals).toEqual([noticeKey]);
  });

  it("supports restoring a dismissal with dismissed false", async () => {
    const key = "stock-expiry:chem-restore:1893456000000";
    expect((await putDismissal(cookieDashA, key, true)).status).toBe(200);
    expect(storedRoot("uid-dash-a").dashboardDismissedAlerts).toEqual([key]);

    const restore = await putDismissal(cookieDashA, key, false);
    expect(restore.status).toBe(200);
    expect(restore.body.dismissals).toEqual([]);
    expect(storedRoot("uid-dash-a").dashboardDismissedAlerts).toEqual([]);

    const idempotentRemove = await putDismissal(cookieDashA, key, false);
    expect(idempotentRemove.status).toBe(200);
    expect(idempotentRemove.body.dismissals).toEqual([]);
  });

  it("keeps dismissals isolated between two accounts", async () => {
    const aKey = "stock-low:chem-account-a";
    const bKey = "notice:n_account_b";
    expect((await putDismissal(cookieDashA, aKey, true)).status).toBe(200);

    const bBefore = await getDismissals(cookieDashB);
    expect(bBefore.status).toBe(200);
    expect(bBefore.body).toEqual({ dismissals: [], updatedAt: 0 });

    expect((await putDismissal(cookieDashB, bKey, true)).status).toBe(200);
    const aAfter = await getDismissals(cookieDashA);
    const bAfter = await getDismissals(cookieDashB);
    expect(aAfter.body.dismissals).toEqual([aKey]);
    expect(bAfter.body.dismissals).toEqual([bKey]);
    expect(storedRoot("uid-dash-a").dashboardDismissedAlerts).toEqual([aKey]);
    expect(storedRoot("uid-dash-b").dashboardDismissedAlerts).toEqual([bKey]);
  });

  it("merges additively without changing columnsByType or unknown roots", async () => {
    const columns = ["name", "quantity", "actions", "cas_number"];
    const columnPut = await request(baseUrl)
      .put("/api/users/me/catalog-columns")
      .set(XRW)
      .set("Cookie", cookieDashA)
      .send({ scope: "chemical", columns });
    expect(columnPut.status).toBe(200);

    const rootBefore = storedRoot("uid-dash-a");
    db.prepare("UPDATE user_settings SET settings = ? WHERE uid = ?").run(
      JSON.stringify({ ...rootBefore, futureRoot: { keep: true } }),
      "uid-dash-a",
    );

    const dismissal = "notice:n_merge";
    expect((await putDismissal(cookieDashA, dismissal, true)).status).toBe(200);

    const catalog = await request(baseUrl)
      .get("/api/users/me/catalog-columns")
      .set("Cookie", cookieDashA);
    expect(catalog.status).toBe(200);
    expect(catalog.body.columnsByType).toEqual(columnPut.body.columnsByType);

    const rootAfter = storedRoot("uid-dash-a");
    expect(rootAfter.columnsByType).toEqual(columnPut.body.columnsByType);
    expect(rootAfter.futureRoot).toEqual({ keep: true });
    expect(rootAfter.dashboardDismissedAlerts).toEqual([dismissal]);
  });

  it("rejects malformed, blank, oversize and unsupported keys without writing", async () => {
    const invalidKeys: unknown[] = [
      "",
      " ",
      "stock-low:",
      "stock-low:chem/slash",
      "stock-low:chem space",
      "stock-expiry:chem-no-epoch",
      "stock-expiry:chem-1:1.5",
      "stock-expiry:chem-1:-1",
      "stock-expiry:chem-1:01",
      "stock-expiry:chem-1:99999999999999999999",
      "notice:",
      "notice:bad/id",
      "unknown:chem-1",
      `stock-low:${"a".repeat(200)}`,
      42,
      null,
    ];
    for (const key of invalidKeys) {
      const response = await putDismissal(cookieDashA, key, true);
      expect(response.status).toBe(400);
    }
    expect(storedSettings("uid-dash-a")).toBeNull();
  });

  it("rejects a non-boolean dismissed flag without writing", async () => {
    const key = "notice:n_bad_boolean";
    for (const dismissed of ["true", 1, null, undefined]) {
      const response = await putDismissal(cookieDashA, key, dismissed);
      expect(response.status).toBe(400);
    }
    expect(storedSettings("uid-dash-a")).toBeNull();
  });

  it("fails closed on malformed stored JSON or dismissal lists without wiping", async () => {
    const malformedDocuments = [
      '{"dashboardDismissedAlerts":',
      '{"dashboardDismissedAlerts":{}}',
      '{"dashboardDismissedAlerts":"notice:n_1"}',
      '{"dashboardDismissedAlerts":["notice:bad/id"]}',
      '{"dashboardDismissedAlerts":[42]}',
      JSON.stringify({
        dashboardDismissedAlerts: Array.from({ length: 501 }, (_, index) => `notice:n_cap_${index}`),
      }),
    ];

    for (const raw of malformedDocuments) {
      db.prepare("INSERT OR REPLACE INTO user_settings (uid, settings, updated_at) VALUES (?, ?, ?)").run(
        "uid-dash-malformed",
        raw,
        1,
      );
      const get = await getDismissals(cookieDashMalformed);
      expect(get.status).toBe(500);
      expect(get.body.error).toContain("invalid");

      const put = await putDismissal(cookieDashMalformed, "notice:n_new", true);
      expect(put.status).toBe(500);
      expect(storedSettings("uid-dash-malformed")).toBe(raw);
    }
  });

  it("deduplicates valid stored keys safely instead of duplicating them", async () => {
    const raw = JSON.stringify({
      dashboardDismissedAlerts: ["notice:n_dup", "notice:n_dup", "stock-low:chem-dup", "notice:n_dup"],
    });
    db.prepare("INSERT INTO user_settings (uid, settings, updated_at) VALUES (?, ?, ?)").run(
      "uid-dash-malformed",
      raw,
      1,
    );
    const get = await getDismissals(cookieDashMalformed);
    expect(get.status).toBe(200);
    expect(get.body.dismissals).toEqual(["notice:n_dup", "stock-low:chem-dup"]);
    expect(storedSettings("uid-dash-malformed")).toBe(raw);
  });

  it("caps stored keys at 500 without evicting existing dismissals", async () => {
    const storedKeys = Array.from({ length: 499 }, (_, index) => `notice:n_cap_${index}`);
    db.prepare("INSERT INTO user_settings (uid, settings, updated_at) VALUES (?, ?, ?)").run(
      "uid-dash-cap",
      JSON.stringify({ dashboardDismissedAlerts: storedKeys }),
      1,
    );

    const initial = await getDismissals(cookieDashCap);
    expect(initial.status).toBe(200);
    expect(initial.body.dismissals).toHaveLength(499);

    const add = await putDismissal(cookieDashCap, "notice:n_cap_new", true);
    expect(add.status).toBe(200);
    expect(add.body.dismissals).toHaveLength(500);
    expect(add.body.dismissals).toContain(storedKeys[0]);
    expect(add.body.dismissals).toContain("notice:n_cap_new");

    // Repeating an already-stored dismissal at the cap must remain a no-op.
    const repeat = await putDismissal(cookieDashCap, storedKeys[0], true);
    expect(repeat.status).toBe(200);
    expect(repeat.body.dismissals).toHaveLength(500);

    const overflow = await putDismissal(cookieDashCap, "notice:n_cap_overflow", true);
    expect(overflow.status).toBe(400);
    const atCap = storedRoot("uid-dash-cap").dashboardDismissedAlerts as string[];
    expect(atCap).toHaveLength(500);
    expect(atCap).toContain(storedKeys[0]);
    expect(atCap).toContain("notice:n_cap_new");
    expect(atCap).not.toContain("notice:n_cap_overflow");

    const remove = await putDismissal(cookieDashCap, storedKeys[0], false);
    expect(remove.status).toBe(200);
    expect(remove.body.dismissals).toHaveLength(499);
    expect(remove.body.dismissals).not.toContain(storedKeys[0]);

    const refill = await putDismissal(cookieDashCap, "notice:n_cap_refill", true);
    expect(refill.status).toBe(200);
    expect(refill.body.dismissals).toHaveLength(500);
    expect(refill.body.dismissals).not.toContain(storedKeys[0]);
    expect(refill.body.dismissals).toContain("notice:n_cap_refill");
  });

  it("returns 400 rather than 500 when a valid add would exceed the document size", async () => {
    const MAX_SETTINGS_LENGTH = 64 * 1024;
    const storedKeys = Array.from(
      { length: 427 },
      (_, index) => `notice:n_${"a".repeat(137)}_${String(index).padStart(3, "0")}`,
    );
    const root = {
      columnsByType: { all: ["name", "actions"] },
      futureRoot: { keep: true },
      dashboardDismissedAlerts: storedKeys,
    };
    const raw = JSON.stringify(root);
    // The stored document and its list are valid and under both the 64 KiB
    // document cap and the 500-key cap, but one more full-length key cannot fit.
    expect(raw.length).toBeLessThanOrEqual(MAX_SETTINGS_LENGTH);
    expect(storedKeys.length).toBeLessThan(500);

    db.prepare("INSERT INTO user_settings (uid, settings, updated_at) VALUES (?, ?, ?)").run(
      "uid-dash-cap",
      raw,
      1,
    );

    const nextKey = `notice:${"b".repeat(153)}`;
    const wouldBeSerialized = JSON.stringify({
      ...root,
      dashboardDismissedAlerts: [...storedKeys, nextKey],
    });
    expect(wouldBeSerialized.length).toBeGreaterThan(MAX_SETTINGS_LENGTH);

    const response = await putDismissal(cookieDashCap, nextKey, true);
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Too many");

    expect(storedSettings("uid-dash-cap")).toBe(raw);
    const after = storedRoot("uid-dash-cap");
    expect(after.columnsByType).toEqual({ all: ["name", "actions"] });
    expect(after.futureRoot).toEqual({ keep: true });
    expect(after.dashboardDismissedAlerts).toEqual(storedKeys);
  });

  it("never changes stock quantities, notices, reactions or history", async () => {
    db.prepare("INSERT INTO locations (id, group_id, kind, name) VALUES (?, ?, ?, ?)").run(
      "loc-dash-dismiss",
      "group-a",
      "shelf",
      "Dash shelf",
    );
    db.prepare(
      "INSERT INTO materials (id, group_id, type_key, name, attributes) VALUES (?, ?, ?, ?, ?)",
    ).run("mat-dash-dismiss", "group-a", "chemical", "Dash material", "{}");
    db.prepare("INSERT INTO batches (id, material_id, lot_code) VALUES (?, ?, ?)").run(
      "batch-dash-dismiss",
      "mat-dash-dismiss",
      "LOT-DASH",
    );
    db.prepare(
      "INSERT INTO stocks (id, group_id, batch_id, location_id, current_quantity, quantity_unit) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("stock-dash-dismiss", "group-a", "batch-dash-dismiss", "loc-dash-dismiss", 4.25, "mL");
    db.prepare(
      "INSERT INTO notices (id, scope, title, content, category, timestamp) VALUES (?, 'shared', ?, ?, ?, ?)",
    ).run("n_dash_dismiss", "Dash notice", "Body", "info", 1);
    db.prepare("INSERT INTO notice_reactions (id, notice_id, text, timestamp) VALUES (?, ?, ?, ?)").run(
      "r_dash_dismiss",
      "n_dash_dismiss",
      "+1",
      1,
    );
    db.prepare("INSERT INTO history (group_id, timestamp, user_name, action) VALUES (?, ?, ?, ?)").run(
      "group-a",
      1,
      "tester",
      "before dismissal",
    );

    const stockBefore = db.prepare("SELECT * FROM stocks WHERE id = ?").get("stock-dash-dismiss");
    const noticeBefore = db.prepare("SELECT * FROM notices WHERE id = ?").get("n_dash_dismiss");
    const reactionsBefore = db.prepare("SELECT * FROM notice_reactions ORDER BY id").all();
    const historyBefore = db.prepare("SELECT * FROM history ORDER BY id").all();

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    expect((await putDismissal(cookieDashB, "stock-low:stock-dash-dismiss", true)).status).toBe(200);
    expect(
      (await putDismissal(cookieDashB, `stock-expiry:stock-dash-dismiss:${expiresAt}`, true)).status,
    ).toBe(200);
    expect((await putDismissal(cookieDashB, "notice:n_dash_dismiss", true)).status).toBe(200);

    expect(db.prepare("SELECT * FROM stocks WHERE id = ?").get("stock-dash-dismiss")).toEqual(stockBefore);
    expect(db.prepare("SELECT * FROM notices WHERE id = ?").get("n_dash_dismiss")).toEqual(noticeBefore);
    expect(db.prepare("SELECT * FROM notice_reactions ORDER BY id").all()).toEqual(reactionsBefore);
    expect(db.prepare("SELECT * FROM history ORDER BY id").all()).toEqual(historyBefore);
  });
});
