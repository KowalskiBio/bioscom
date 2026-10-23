import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { loadConfig, type ServerConfig } from "./config.js";
import { checkDatabase } from "./db.js";
import { webDistDir } from "./paths.js";
import { createResendEmailer, createFileCaptureEmailer, noopEmailer, type Emailer } from "./auth/emails.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { registerUserRoutes } from "./routes/users.js";
import { InventoryHub, registerInventoryWs } from "./inventory/ws.js";
import { registerInventoryRoutes } from "./inventory/routes.js";
import { registerSharedContainerRoutes } from "./inventory/shared.js";
import { registerNoticeRoutes } from "./features/notices.js";
import { registerInstrumentRoutes } from "./features/instruments.js";
import { registerPrintRoutes } from "./features/print.js";
import { registerGameRoutes } from "./features/games.js";
import { registerHistoryAndBackupRoutes } from "./features/history.js";
import { registerSandboxRoutes } from "./features/sandbox.js";

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>BioSCom</title></head>
<body>
<h1>BioSCom server is running</h1>
<p>The web client has not been built yet. Run <code>npm run build -w web</code> once Wave 3 lands.</p>
</body>
</html>
`;

export interface AppOptions {
  config?: Partial<ServerConfig>;
  emailer?: Emailer;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig(options.config);
  const app = Fastify({ logger: { level: config.logLevel } });

  await app.register(cookie);

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "frame-ancestors 'none'");
    reply.header("Referrer-Policy", "no-referrer");
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/api/") && MUTATING_METHODS.has(request.method)) {
      if (request.headers["x-requested-with"] !== "XMLHttpRequest") {
        return reply.status(403).send({ error: "Missing X-Requested-With header" });
      }
    }
  });

  app.get("/api/health", async (_request, reply) => {
    const result = checkDatabase(config.dbPath);
    if (result.ok) {
      return { status: "ok" };
    }
    reply.status(503);
    return { status: "error", detail: result.error };
  });

  const emailer =
    options.emailer ??
      (process.env.EMAIL_CAPTURE_FILE?.trim() !== undefined && process.env.EMAIL_CAPTURE_FILE !== ""
        ? createFileCaptureEmailer(process.env.EMAIL_CAPTURE_FILE.trim())
        : config.resendApiKey !== ""
          ? createResendEmailer(config.resendApiKey, config.resendFrom)
          : noopEmailer);
  registerAuthRoutes(app, { config, emailer });
  registerGroupRoutes(app, config);
  registerUserRoutes(app, config);
  const hub = new InventoryHub();
  await app.register(websocket);
  registerInventoryWs(app, config, hub);
  registerInventoryRoutes(app, config, hub);
  registerSharedContainerRoutes(app, config, hub);
  registerNoticeRoutes(app, config, hub);
  registerInstrumentRoutes(app, config, hub);
  registerPrintRoutes(app, config, hub);
  registerGameRoutes(app, config, hub);
  registerHistoryAndBackupRoutes(app, config, hub);
  registerSandboxRoutes(app, config, hub);

  if (existsSync(webDistDir)) {
    await app.register(fastifyStatic, { root: webDistDir });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.status(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.get("/", async (_request, reply) => {
      reply.type("text/html; charset=utf-8");
      return PLACEHOLDER_HTML;
    });
    app.setNotFoundHandler(async (_request, reply) => {
      return reply.status(404).send({ error: "Not found" });
    });
  }

  return app;
}
