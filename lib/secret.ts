import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Encrypts secrets (the FBR token) before they are written to the database.
// Key: FBR_ENC_KEY env var (64 hex chars) if set, otherwise a random key
// created once in data/.secret-key. Anyone who can read BOTH the database and
// that key file can decrypt, so keep backups of the two apart in production.

const KEY_FILE = path.join(process.cwd(), "data", ".secret-key");

function key(): Buffer {
  const fromEnv = process.env.FBR_ENC_KEY;
  if (fromEnv) {
    if (!/^[0-9a-fA-F]{64}$/.test(fromEnv)) throw new Error("FBR_ENC_KEY must be 64 hex characters.");
    return Buffer.from(fromEnv, "hex");
  }
  if (fs.existsSync(KEY_FILE)) return Buffer.from(fs.readFileSync(KEY_FILE, "utf8").trim(), "hex");
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  const k = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, k.toString("hex"), { mode: 0o600 });
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(blob: string): string {
  const raw = Buffer.from(blob, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
