import { claim, cookieOptions, COOKIE_NAME, isSecureRequest } from "@/lib/auth";
import { err, json } from "@/lib/api";
import { getPlayer, playerByTag } from "@/lib/players";

export const dynamic = "force-dynamic";

/** 凭 NFC 网址里的标签码定位选手,凭独立认领码认领。标签码本身不能换取任何私人内容 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(400, "请求内容无法读取");
  }
  const tag = typeof body.tag === "string" ? body.tag.slice(0, 40) : "";
  const code = typeof body.code === "string" ? body.code : "";
  const player = playerByTag(tag);
  if (!player || !getPlayer(player.id)) return err(404, "标签无效");
  if (!code.trim()) return err(400, "请输入认领码");

  const r = claim(player.id, code);
  if (!r.ok) {
    if (r.reason === "locked") return err(429, `尝试次数过多,请 ${r.retryAfterSec} 秒后再试`, { code: "locked", retryAfterSec: r.retryAfterSec });
    if (r.reason === "wrong_code") return err(401, `认领码不正确,还可尝试 ${r.left} 次`, { code: "wrong_code", left: r.left });
    return err(404, "标签无效");
  }
  const res = json({ ok: true, playerId: player.id });
  const c = cookieOptions(isSecureRequest(req));
  res.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(r.token)}; Path=${c.path}; Max-Age=${c.maxAge}; HttpOnly; SameSite=Lax${c.secure ? "; Secure" : ""}`,
  );
  return res;
}
