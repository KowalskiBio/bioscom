import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { closeDatabase } from "../src/db.js";

let app: FastifyInstance;
let baseUrl: string;

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("server did not return an address");
  }
  return `http://127.0.0.1:${address.port}`;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "bioscom-server-test-"));
  app = await buildApp({ config: { dbPath: join(dir, "test.db"), logLevel: "silent" } });
  baseUrl = await listen(app);
});

afterAll(async () => {
  await app.close();
  closeDatabase();
});

describe("GET /api/health", () => {
  it("returns 200 ok with a working database", async () => {
    const response = await request(baseUrl).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("sets helmet-style security headers", async () => {
    const response = await request(baseUrl).get("/api/health");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });
});

describe("unknown routes", () => {
  it("returns JSON 404 for unknown api routes", async () => {
    const response = await request(baseUrl).get("/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found" });
    expect(response.headers["content-type"]).toContain("application/json");
  });
});

describe("GET /", () => {
  it("serves an html page", async () => {
    const response = await request(baseUrl).get("/");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
  });
});

describe("database failure", () => {
  it("returns 503 on health and keeps serving when the db path is unusable", async () => {
    const dirPath = mkdtempSync(join(tmpdir(), "bioscom-server-bad-"));
    const badApp = await buildApp({ config: { dbPath: dirPath, logLevel: "silent" } });
    const badUrl = await listen(badApp);
    try {
      const first = await request(badUrl).get("/api/health");
      expect(first.status).toBe(503);
      expect(first.body.status).toBe("error");
      const second = await request(badUrl).get("/api/health");
      expect(second.status).toBe(503);
      const other = await request(badUrl).get("/api/nope");
      expect(other.status).toBe(404);
    } finally {
      await badApp.close();
    }
  });
});
