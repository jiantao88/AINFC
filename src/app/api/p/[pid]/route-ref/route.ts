import fs from "node:fs";
import { guarded, err, json } from "@/lib/api";
import { downsample, parseGpx } from "@/lib/gpx";
import { saveMedia } from "@/lib/media";
import { getEvent, getPlayer } from "@/lib/players";
import { fixturePath } from "@/lib/seed";
import { newId } from "@/lib/secret";
import { registerMaterial } from "@/lib/upload";

export const dynamic = "force-dynamic";

/** 没有个人轨迹时,主动使用赛事参考路线。它不是选手的实际行走记录 */
export const POST = guarded(async (_req, pid) => {
  const player = await getPlayer(pid);
  if (!player) return err(404, "not found");
  if (player.status === "generating") return err(409, "正在生成中,暂时不能修改素材");
  const ev = await getEvent(player.event_id);
  if (!ev.referenceRoute) return err(404, "本赛事没有提供参考路线");

  const file = fixturePath(ev.referenceRoute.file);
  if (!fs.existsSync(file)) return err(404, "参考路线文件不存在");
  const buf = fs.readFileSync(file);
  const parsed = parseGpx(buf);
  if (!parsed.ok) return err(500, "参考路线无法解析");

  const id = newId();
  const path = await saveMedia(pid, id, "gpx", buf);
  const meta = {
    kind: "reference",
    points: downsample(parsed.points),
    stats: { distanceKm: parsed.stats.distanceKm, ascentM: null, durationSec: null, pointCount: parsed.stats.pointCount },
  };
  const result = await registerMaterial(pid, {
    id, kind: "route", name: "赛事参考路线.gpx", mime: "application/gpx+xml", size: buf.length, path, meta: JSON.stringify(meta),
  });
  if (result.status !== 200) return err(result.status, result.error);
  return json({ ok: true, id });
});
