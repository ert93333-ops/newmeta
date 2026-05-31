import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "@/lib/security/token-crypto";

describe("token crypto", () => {
  it("encrypts and decrypts without exposing the original token", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptToken("secret-access-token", key);
    expect(encrypted.encryptedAccessToken).not.toContain("secret-access-token");
    expect(decryptToken(encrypted, key)).toBe("secret-access-token");
  });
});
