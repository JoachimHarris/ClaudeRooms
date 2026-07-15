import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Tokens are 256-bit random values. Only their SHA-256 hash is ever stored;
// the raw value is returned exactly once to the caller who minted it.

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenHashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
