import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { verifyFirebaseScrypt, type FirebaseScryptParams } from "@bioscom/shared";
import { loadEnv } from "./env.js";
import { dumpsDir, reportsDir } from "./paths.js";
import type { AuthUserRecord } from "./source.js";

const FALLBACK_DIRECTIVE = [
  "FALLBACK DIRECTIVE (hash_port: infeasible):",
  "  1. Import users with hash_version='unverified'.",
  "  2. Backend implements reset-first-login: a login attempt for an 'unverified' user is",
  "     rejected and a password-reset email (single-use token, via Resend) is sent.",
  "  3. Do NOT proceed to cutover on an unverified hash port unless this fallback is",
  "     explicitly enabled.",
].join("\n");

const BASE64_RE = /^[A-Za-z0-9+/=\-_]+$/;

interface StructuralResult {
  uid: string;
  ok: boolean;
  reason: string;
}

function infeasible(reason: string): never {
  const lines: string[] = [];
  lines.push("# BioSCom hash-port verification report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Decision: hash_port INFEASIBLE");
  lines.push("");
  lines.push(`Reason: ${reason}`);
  lines.push("");
  lines.push("```");
  lines.push(FALLBACK_DIRECTIVE);
  lines.push("```");
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, "hash-report.md"), `${lines.join("\n")}\n`);
  console.error(`hash_port: infeasible — ${reason}`);
  console.error(FALLBACK_DIRECTIVE);
  process.exit(3);
}

function decodeLen(encoded: string): number {
  return Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").length;
}

function structuralCheck(users: AuthUserRecord[], expectedHashLength: number): StructuralResult[] {
  return users.map((user) => {
    if (user.passwordHash === null || user.passwordSalt === null) {
      return { uid: user.uid, ok: true, reason: "no password hash (passwordless account)" };
    }
    if (!BASE64_RE.test(user.passwordHash)) {
      return { uid: user.uid, ok: false, reason: "passwordHash is not valid base64" };
    }
    if (!BASE64_RE.test(user.passwordSalt)) {
      return { uid: user.uid, ok: false, reason: "passwordSalt is not valid base64" };
    }
    const hashLength = decodeLen(user.passwordHash);
    if (hashLength !== expectedHashLength) {
      return {
        uid: user.uid,
        ok: false,
        reason: `passwordHash decodes to ${hashLength} bytes, expected ${expectedHashLength}`,
      };
    }
    if (decodeLen(user.passwordSalt) === 0) {
      return { uid: user.uid, ok: false, reason: "passwordSalt decodes to 0 bytes" };
    }
    return { uid: user.uid, ok: true, reason: "ok" };
  });
}

function main(): void {
  loadEnv();
  const { values } = parseArgs({ options: { dir: { type: "string" } } });
  const dir = values.dir ?? dumpsDir;
  const authFile = join(dir, "auth-users.json");
  if (!existsSync(authFile)) {
    infeasible(`auth-users.json not found in ${dir} — run the export (todo 3) first.`);
  }
  const users = JSON.parse(readFileSync(authFile, "utf8")) as AuthUserRecord[];

  const signerKey = process.env.FIREBASE_SCRYPT_SIGNER_KEY?.trim();
  const saltSeparator = process.env.FIREBASE_SCRYPT_SALT_SEPARATOR?.trim();
  const rounds = Number(process.env.FIREBASE_SCRYPT_ROUNDS?.trim());
  const memCost = Number(process.env.FIREBASE_SCRYPT_MEM_COST?.trim());
  const hashParamsPath = "Firebase console → Authentication → Users → ⋮ → Password hash parameters";
  if (signerKey === undefined || signerKey === "") {
    infeasible(`password hash parameter FIREBASE_SCRYPT_SIGNER_KEY not configured (${hashParamsPath})`);
  }
  if (saltSeparator === undefined || saltSeparator === "") {
    infeasible(`password hash parameter FIREBASE_SCRYPT_SALT_SEPARATOR not configured (${hashParamsPath})`);
  }
  if (!Number.isFinite(rounds) || rounds <= 0) {
    infeasible(`password hash parameter FIREBASE_SCRYPT_ROUNDS not configured or invalid (${hashParamsPath})`);
  }
  if (!Number.isFinite(memCost) || memCost <= 0) {
    infeasible(`password hash parameter FIREBASE_SCRYPT_MEM_COST not configured or invalid (${hashParamsPath})`);
  }
  const params: FirebaseScryptParams = { signerKey, saltSeparator, rounds, memCost };

  const testEmail = process.env.TEST_EMAIL?.trim().toLowerCase();
  const testPassword = process.env.TEST_PASSWORD;
  if (testEmail === undefined || testEmail === "") {
    infeasible("TEST_EMAIL (verification oracle) not configured in migrate/.env.");
  }
  if (testPassword === undefined || testPassword === "") {
    infeasible("TEST_PASSWORD (verification oracle) not configured in migrate/.env.");
  }
  const testUser = users.find((user) => (user.email ?? "").toLowerCase() === testEmail);
  if (testUser === undefined) {
    infeasible(`test account ${testEmail} not present in ${authFile} — check TEST_EMAIL.`);
  }

  const signerBytes = decodeLen(params.signerKey);
  const structural = structuralCheck(users, signerBytes);
  const structuralFailures = structural.filter((result) => !result.ok);
  const testOk =
    testUser.passwordHash !== null &&
    testUser.passwordSalt !== null &&
    verifyFirebaseScrypt(testPassword, testUser.passwordSalt, testUser.passwordHash, params);

  const lines: string[] = [];
  lines.push("# BioSCom hash-port verification report");
  lines.push("");
  lines.push(`Source: ${authFile}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Signer key: present (${signerBytes} bytes) · rounds: ${params.rounds} · mem_cost: ${params.memCost}`);
  lines.push("");
  lines.push("## Structural check (all users, redacted — uids and verdicts only)");
  lines.push("");
  lines.push("| uid | verdict | reason |");
  lines.push("| --- | --- | --- |");
  for (const result of structural) {
    lines.push(`| ${result.uid} | ${result.ok ? "PASS" : "FAIL"} | ${result.reason} |`);
  }
  lines.push("");
  lines.push("## Test-account verification (cryptographic)");
  lines.push("");
  lines.push(`Account: uid ${testUser.uid}`);
  lines.push(`Verdict: ${testOk ? "PASS" : "FAIL"}`);
  lines.push("");
  if (!testOk) {
    lines.push("## Decision: hash_port INFEASIBLE");
    lines.push("");
    lines.push("```");
    lines.push(FALLBACK_DIRECTIVE);
    lines.push("```");
  } else if (structuralFailures.length > 0) {
    lines.push(
      `## Decision: hash_port FEASIBLE with ${structuralFailures.length} structural anomal${structuralFailures.length === 1 ? "y" : "ies"} (triage before cutover)`,
    );
  } else {
    lines.push("## Decision: hash_port FEASIBLE");
  }
  lines.push("");
  mkdirSync(reportsDir, { recursive: true });
  const reportFile = join(reportsDir, "hash-report.md");
  writeFileSync(reportFile, `${lines.join("\n")}\n`);

  console.log(`Report written to ${reportFile}`);
  console.log(`Structural: ${structural.length - structuralFailures.length}/${structural.length} pass`);
  console.log(`Test account (uid ${testUser.uid}): ${testOk ? "PASS" : "FAIL"}`);
  if (!testOk) {
    console.error(FALLBACK_DIRECTIVE);
    process.exit(3);
  }
  if (structuralFailures.length > 0) {
    for (const failure of structuralFailures) {
      console.error(`  structural FAIL: ${failure.uid} — ${failure.reason}`);
    }
    process.exit(4);
  }
  process.exit(0);
}

main();
