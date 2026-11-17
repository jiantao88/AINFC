import { cookies } from "next/headers";
import { LIMITS, demoMode } from "./config";
import { all, db, one, run, tx, type PlayerRow } from "./db";
import { claimCodeFor, newId, normalizeClaimCode, safeEqual, sha256 } from "./secret";

const COOKIE = "ainfc_session";

export type ClaimResult =
  | { ok: true; token: string }
  | { ok: false; reason: "wrong_code" | "locked" | "already_claimed" | "not_found"; retryAfterSec?: number; left?: number };

/** 认领:凭独立认领码,不凭公开的号码或标签网址。失败次数过多会短暂锁定 */
export function claim(playerId: string, codeInput: string): ClaimResult {
  db();
  const player = one<PlayerRow>("SELECT * FROM players WHERE id=?", playerId);
  if (!player) return { ok: false, reason: "not_found" };

  const now = Date.now();
  const attempts = one<{ fails: number; locked_until: number }>("SELECT * FROM claim_attempts WHERE player_id=?", playerId);
  if (attempts && attempts.locked_until > now) {
    return { ok: false, reason: "locked", retryAfterSec: Math.ceil((attempts.locked_until - now) / 1000) };
  }

  const expected = claimCodeFor(playerId);
  const given = normalizeClaimCode(codeInput.slice(0, 32));
  if (!safeEqual(given, expected)) {
    const fails = (attempts?.fails ?? 0) + 1;
    const lock = fails >= LIMITS.claimMaxFails;
    run(
      "INSERT INTO claim_attempts (player_id, fails, locked_until) VALUES (?,?,?) ON CONFLICT(player_id) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until",
      playerId,
      lock ? 0 : fails,
      lock ? now + LIMITS.claimLockMs : 0,
    );
    if (lock) return { ok: false, reason: "locked", retryAfterSec: Math.ceil(LIMITS.claimLockMs / 1000) };
    return { ok: false, reason: "wrong_code", left: LIMITS.claimMaxFails - fails };
  }

  run("DELETE FROM claim_attempts WHERE player_id=?", playerId);
  const token = createSession(playerId);
  if (player.status === "unclaimed") {
    run("UPDATE players SET status='claimed_empty', claimed_at=? WHERE id=?", now, playerId);
  }
  return { ok: true, token };
}

export function createSession(playerId: string): string {
  const token = newId(32);
  const now = Date.now();
  run(
    "INSERT INTO sessions (token_hash, player_id, created_at, expires_at) VALUES (?,?,?,?)",
    sha256(token),
    playerId,
    now,
    now + LIMITS.sessionMaxAgeSec * 1000,
  );
  return token;
}

export const COOKIE_NAME = COOKIE;

export function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: LIMITS.sessionMaxAgeSec,
  };
}

/** 读取当前请求的会话,返回其对应的选手 id;无效或过期返回 null */
export async function sessionPlayerIds(): Promise<string[]> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return [];
  return playerIdsForToken(token);
}

export function playerIdsForToken(token: string): string[] {
  db();
  const rows = all<{ player_id: string }>(
    "SELECT player_id FROM sessions WHERE token_hash=? AND expires_at>?",
    sha256(token),
    Date.now(),
  );
  return rows.map((r) => r.player_id);
}

/** 从 Request 里读 Cookie 头(Route Handler 里用),不依赖 next/headers */
export function tokenFromRequest(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function authorize(req: Request, playerId: string): boolean {
  const token = tokenFromRequest(req);
  if (!token) return false;
  return playerIdsForToken(token).includes(playerId);
}

export function clearSessionsFor(playerId: string) {
  run("DELETE FROM sessions WHERE player_id=?", playerId);
}

export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto === "https";
  return new URL(req.url).protocol === "https:";
}

/** 演示接口只在 DEMO_MODE=1 时开放 */
export function demoGuard(): Response | null {
  return demoMode() ? null : new Response("not found", { status: 404 });
}

export { tx };
