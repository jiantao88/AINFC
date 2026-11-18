import { guarded, err, json } from "@/lib/api";
import { getMaterial, removeMaterial, getPlayer } from "@/lib/players";
import { mediaBody } from "@/lib/media";

export const dynamic = "force-dynamic";

/** 素材文件只通过带鉴权的接口读取,不放在公开目录 */
export const GET = guarded(async (_req, pid, ctx) => {
  const { mid } = await ctx.params;
  const m = await getMaterial(pid, mid);
  if (!m || !m.path) return err(404, "not found");
  const body = await mediaBody(m.path);
  if (!body) return err(404, "not found");
  const type = m.mime && /^image\//.test(m.mime) ? m.mime : "application/octet-stream";
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
});

export const DELETE = guarded(async (_req, pid, ctx) => {
  const { mid } = await ctx.params;
  const player = (await getPlayer(pid))!;
  if (player.status === "generating") return err(409, "正在生成中,暂时不能修改素材");
  return await removeMaterial(pid, mid) ? json({ ok: true }) : err(404, "not found");
});
