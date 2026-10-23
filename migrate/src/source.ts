import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RTDB_PATHS, dumpsDir, repoRoot } from "./paths.js";
import { asArray, asRecord } from "./walk.js";

export interface AuthUserRecord {
  uid: string;
  email: string | null;
  displayName: string | null;
  passwordHash: string | null;
  passwordSalt: string | null;
}

export interface LegacySource {
  origin: string;
  paths: Record<string, unknown>;
  authUsers: AuthUserRecord[];
  missing: string[];
}

export function loadSource(opts: { legacy?: string; dir?: string } = {}): LegacySource {
  if (opts.legacy !== undefined) {
    const legacyPath = existsSync(opts.legacy) ? opts.legacy : join(repoRoot, opts.legacy);
    const raw = asRecord(JSON.parse(readFileSync(legacyPath, "utf8")));
    const paths: Record<string, unknown> = {};
    const missing: string[] = [];
    for (const path of RTDB_PATHS) {
      const value = raw[path];
      if (value !== undefined && value !== null) {
        paths[path] = value;
      } else {
        missing.push(path);
      }
    }
    return { origin: `legacy stand-in file: ${opts.legacy}`, paths, authUsers: [], missing };
  }
  const dir = opts.dir ?? dumpsDir;
  const paths: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const path of RTDB_PATHS) {
    const file = join(dir, `${path}.json`);
    if (existsSync(file)) {
      paths[path] = JSON.parse(readFileSync(file, "utf8"));
    } else {
      missing.push(path);
    }
  }
  const authUsers: AuthUserRecord[] = [];
  const authFile = join(dir, "auth-users.json");
  if (existsSync(authFile)) {
    for (const user of asArray(JSON.parse(readFileSync(authFile, "utf8")))) {
      authUsers.push(toAuthUser(user));
    }
  }
  return { origin: `dumps dir: ${dir}`, paths, authUsers, missing };
}

function toAuthUser(value: unknown): AuthUserRecord {
  const record = asRecord(value);
  const str = (key: string): string | null =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  return {
    uid: str("uid") ?? "",
    email: str("email"),
    displayName: str("displayName"),
    passwordHash: str("passwordHash"),
    passwordSalt: str("passwordSalt"),
  };
}
