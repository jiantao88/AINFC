import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, hosted } from "./config";

const g = globalThis as unknown as { __ainfcSecret?: string };

/** 服务端密钥:用于派生认领码与标签码。优先读环境变量,否则在 data/ 下生成并持久化 */
export function secret(): string {
  if (g.__ainfcSecret) return g.__ainfcSecret;
  let value = process.env.AINFC_SECRET;
  if (!value && hosted) throw new Error("AINFC_SECRET is required on Vercel");
  if (!value) {
    const file = path.join(dataDir(), "secret.key");
    fs.mkdirSync(dataDir(), { recursive: true });
    if (fs.existsSync(file)) value = fs.readFileSync(file, "utf8").trim();
    if (!value) {
      value = crypto.randomBytes(32).toString("hex");
      fs.writeFileSync(file, value, { mode: 0o600 });
    }
  }
  g.__ainfcSecret = value;
  return value;
}

const CLAIM_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const TAG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function derive(label: string, length: number, alphabet: string): string {
  const digest = crypto.createHmac("sha256", secret()).update(label).digest();
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[digest[i] % alphabet.length];
  return out;
}

/** 认领码独立于公开的号码和标签网址 */
export const claimCodeFor = (playerId: string) => derive(`claim:${playerId}`, 6, CLAIM_ALPHABET);
export const tagCodeFor = (playerId: string, kind: "medal" | "bib") =>
  derive(`tag:${kind}:${playerId}`, 10, TAG_ALPHABET);

export const normalizeClaimCode = (input: string) => input.toUpperCase().replace(/[\s-]/g, "");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString("base64url");
