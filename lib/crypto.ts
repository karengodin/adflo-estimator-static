import crypto from "crypto";

const SECRET = process.env.TAPCLICKS_CREDENTIAL_ENCRYPTION_KEY;

if (!SECRET) {
  throw new Error("Missing TAPCLICKS_CREDENTIAL_ENCRYPTION_KEY");
}

const key = crypto.createHash("sha256").update(SECRET).digest();

export function encryptText(plainText: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);

  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptText(encryptedText: string): string {
  const [ivHex, dataHex] = encryptedText.split(":");

  if (!ivHex || !dataHex) {
    throw new Error("Invalid encrypted value");
  }

  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}