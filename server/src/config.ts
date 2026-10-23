import { config as loadDotenv } from "dotenv";
import { defaultDbPath, envFile } from "./paths.js";

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  sessionSecret: string;
  resendApiKey: string;
  logLevel: string;
}

let dotenvLoaded = false;

function ensureDotenv(): void {
  if (!dotenvLoaded) {
    loadDotenv({ path: envFile });
    dotenvLoaded = true;
  }
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  ensureDotenv();
  return {
    port: overrides.port ?? envNumber("PORT", 8003),
    host: overrides.host ?? (process.env.HOST?.trim() || "127.0.0.1"),
    dbPath: overrides.dbPath ?? (process.env.DB_PATH?.trim() || defaultDbPath),
    sessionSecret: overrides.sessionSecret ?? (process.env.SESSION_SECRET?.trim() || ""),
    resendApiKey: overrides.resendApiKey ?? (process.env.RESEND_API_KEY?.trim() || ""),
    logLevel: overrides.logLevel ?? (process.env.LOG_LEVEL?.trim() || "info"),
  };
}
