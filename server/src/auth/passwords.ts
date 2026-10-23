import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { verifyFirebaseScrypt, type FirebaseScryptParams } from "@bioscom/shared";

let dummyHash: string | null = null;

export async function hashPasswordArgon2(password: string): Promise<string> {
  return argonHash(password);
}

export async function verifyPasswordArgon2(hash: string, password: string): Promise<boolean> {
  return argonVerify(hash, password);
}

export async function verifyPasswordDummy(password: string): Promise<void> {
  if (dummyHash === null) {
    dummyHash = await argonHash("bioscom-dummy-password");
  }
  await argonVerify(dummyHash, password);
}

export function verifyPasswordFirebaseScrypt(
  password: string,
  salt: string,
  expectedHash: string,
  params: FirebaseScryptParams | null,
): boolean {
  if (params === null) {
    return false;
  }
  return verifyFirebaseScrypt(password, salt, expectedHash, params);
}
