import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { closeDatabase } from "./db.js";

const config = loadConfig();
const app = await buildApp(config);
await app.listen({ port: config.port, host: config.host });
app.log.info(`BioSCom server listening on http://${config.host}:${config.port}`);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void (async () => {
      app.log.info(`${signal} received, shutting down`);
      await app.close();
      closeDatabase();
      process.exit(0);
    })();
  });
}
