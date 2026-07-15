import { describe, expect, it } from "vitest";
import { generateToken, hashToken, tokenHashesEqual } from "../src/tokens.js";

describe("tokens", () => {
  it("generates unique, url-safe tokens with 256 bits of entropy", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const token = generateToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });

  it("hashes deterministically and compares in constant time", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(hashToken(generateToken()));
    expect(tokenHashesEqual(hashToken(token), hashToken(token))).toBe(true);
    expect(tokenHashesEqual(hashToken(token), hashToken("other"))).toBe(false);
  });
});
