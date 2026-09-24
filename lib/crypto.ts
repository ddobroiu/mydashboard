import crypto from "crypto";

// Cheile API ale clientilor stau criptate in baza de date.
// ENCRYPTION_KEY = 32 de bytes in hex:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
function key() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error("ENCRYPTION_KEY trebuie sa fie 64 de caractere hex");
  return Buffer.from(hex, "hex");
}

export function encryptJson(data: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptJson<T>(payload: string): T {
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}
