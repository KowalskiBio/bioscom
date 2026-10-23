import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, cert, getApps, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { loadEnv } from "./env.js";
import { RTDB_PATHS, dumpsDir } from "./paths.js";

const DEFAULT_DATABASE_URL = "https://bioscom-ca01a-default-rtdb.europe-west1.firebasedatabase.app";

interface AuthUserRecord {
  uid: string;
  email: string | null;
  displayName: string | null;
  passwordHash: string | null;
  passwordSalt: string | null;
}

async function main(): Promise<void> {
  loadEnv();
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!serviceAccountPath) {
    console.error("FIREBASE_SERVICE_ACCOUNT is not set — export cannot run.");
    console.error("");
    console.error("How to obtain the key:");
    console.error("  Firebase console → Project settings → Service accounts → Generate new private key");
    console.error("Then set it in migrate/.env (see migrate/.env.example):");
    console.error("  FIREBASE_SERVICE_ACCOUNT=/absolute/path/to/serviceAccount.json");
    process.exit(2);
  }
  if (!existsSync(serviceAccountPath)) {
    console.error(`Service account file not found: ${serviceAccountPath}`);
    process.exit(2);
  }

  const databaseUrl = process.env.FIREBASE_DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
  const credential = cert(JSON.parse(readFileSync(serviceAccountPath, "utf8")) as ServiceAccount);
  const app = getApps()[0] ?? initializeApp({ credential, databaseURL: databaseUrl });
  const db = getDatabase(app);
  const auth = getAuth(app);

  mkdirSync(dumpsDir, { recursive: true });
  chmodSync(dumpsDir, 0o700);
  console.log(`Exporting RTDB paths to ${dumpsDir}`);

  const written: Array<{ path: string; records: number; bytes: number }> = [];
  const skipped: string[] = [];
  for (const path of RTDB_PATHS) {
    const snapshot = await db.ref(path).once("value");
    if (!snapshot.exists()) {
      skipped.push(path);
      continue;
    }
    const value = snapshot.val() as unknown;
    const file = join(dumpsDir, `${path}.json`);
    writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
    const records = Array.isArray(value)
      ? value.length
      : value && typeof value === "object"
        ? Object.keys(value).length
        : 1;
    written.push({ path, records, bytes: statSync(file).size });
  }

  const users: AuthUserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      users.push({
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        passwordHash: user.passwordHash ?? null,
        passwordSalt: user.passwordSalt ?? null,
      });
    }
    pageToken = page.pageToken;
  } while (pageToken !== undefined);

  const authFile = join(dumpsDir, "auth-users.json");
  writeFileSync(authFile, JSON.stringify(users, null, 2), { mode: 0o600 });

  console.log("");
  for (const entry of written) {
    console.log(
      `  ${entry.path.padEnd(26)} ${String(entry.records).padStart(7)} records  ${(entry.bytes / 1024).toFixed(1)} kB`,
    );
  }
  console.log(`  ${"auth-users.json".padEnd(26)} ${String(users.length).padStart(7)} users`);
  if (skipped.length > 0) {
    console.log(`  skipped (missing/empty): ${skipped.join(", ")}`);
  }
  const withHash = users.filter((user) => user.passwordHash !== null).length;
  console.log("");
  console.log(`Auth users: ${users.length} (${withHash} with password hash)`);
  if (users.length > 0 && withHash === 0) {
    console.error("WARNING: no password hashes returned — the service account lacks Auth read permission.");
  }
}

main().catch((error: unknown) => {
  console.error("Export failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
