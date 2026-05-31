import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedToken {
  encryptedAccessToken: string;
  tokenIv: string;
  tokenAuthTag: string;
  tokenKid: string;
}

export function encryptToken(token: string, base64Key: string, tokenKid = "primary"): EncryptedToken {
  const key = decodeKey(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedAccessToken: encrypted.toString("base64"),
    tokenIv: iv.toString("base64"),
    tokenAuthTag: authTag.toString("base64"),
    tokenKid
  };
}

export function decryptToken(payload: EncryptedToken, base64Key: string): string {
  const key = decodeKey(base64Key);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.tokenIv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tokenAuthTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.encryptedAccessToken, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function decodeKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key.");
  }
  return key;
}
