import { createCipheriv, scryptSync, timingSafeEqual } from "node:crypto";

export interface FirebaseScryptParams {
  signerKey: string;
  saltSeparator: string;
  rounds: number;
  memCost: number;
}

function decodeBase64(encoded: string): Buffer {
  return Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function firebaseScryptHash(password: string, salt: string, params: FirebaseScryptParams): Buffer {
  const salted = Buffer.concat([decodeBase64(salt), decodeBase64(params.saltSeparator)]);
  const derived = scryptSync(Buffer.from(password, "utf8"), salted, 64, {
    N: 2 ** params.memCost,
    r: params.rounds,
    p: 1,
    maxmem: 128 * 1024 * 1024,
  });
  const cipher = createCipheriv("aes-256-ctr", derived.subarray(0, 32), Buffer.alloc(16, 0));
  return Buffer.concat([cipher.update(decodeBase64(params.signerKey)), cipher.final()]);
}

export function verifyFirebaseScrypt(
  password: string,
  salt: string,
  expectedHash: string,
  params: FirebaseScryptParams,
): boolean {
  const computed = firebaseScryptHash(password, salt, params);
  const expected = decodeBase64(expectedHash);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}
