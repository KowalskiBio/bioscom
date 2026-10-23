import { config as loadDotenv } from "dotenv";
import type { FirebaseScryptParams } from "@bioscom/shared";
import { defaultDbPath, envFile } from "./paths.js";

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  sessionSecret: string;
  resendApiKey: string;
  resendFrom: string;
  publicUrl: string;
  logLevel: string;
  loginRateLimit: number;
  firebaseScrypt: FirebaseScryptParams | null;
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

function loadFirebaseScrypt(override: FirebaseScryptParams | null | undefined): FirebaseScryptParams | null {
  if (override !== undefined) {
    return override;
  }
  const signerKey = process.env.FIREBASE_SCRYPT_SIGNER_KEY?.trim() || "";
  const saltSeparator = process.env.FIREBASE_SCRYPT_SALT_SEPARATOR?.trim() || "";
  const rounds = Number(process.env.FIREBASE_SCRYPT_ROUNDS?.trim());
  const memCost = Number(process.env.FIREBASE_SCRYPT_MEM_COST?.trim());
  if (signerKey === "" || saltSeparator === "" || !Number.isFinite(rounds) || rounds <= 0 || !Number.isFinite(memCost) || memCost <= 0) {
    return null;
  }
  return { signerKey, saltSeparator, rounds, memCost };
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  ensureDotenv();
  return {
    port: overrides.port ?? envNumber("PORT", 8003),
    host: overrides.host ?? (process.env.HOST?.trim() || "127.0.0.1"),
    dbPath: overrides.dbPath ?? (process.env.DB_PATH?.trim() || defaultDbPath),
    sessionSecret: overrides.sessionSecret ?? (process.env.SESSION_SECRET?.trim() || ""),
    resendApiKey: overrides.resendApiKey ?? (process.env.RESEND_API_KEY?.trim() || ""),
    resendFrom: overrides.resendFrom ?? (process.env.RESEND_FROM?.trim() || "BioSCom <bioscom@ubch.sci.muni.cz>"),
    publicUrl: overrides.publicUrl ?? (process.env.PUBLIC_URL?.trim() || "http://localhost:8003"),
    logLevel: overrides.logLevel ?? (process.env.LOG_LEVEL?.trim() || "info"),
    loginRateLimit: overrides.loginRateLimit ?? envNumber("LOGIN_RATE_LIMIT", 5),
    firebaseScrypt: loadFirebaseScrypt(overrides.firebaseScrypt),
  };
}
