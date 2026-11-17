import fs from "node:fs";
import { db } from "@/lib/db";
import { guarded, err, json } from "@/lib/api";
import { downsample, parseGpx } from "@/lib/gpx";
import { saveMedia } from "@/lib/media";
import { getEvent, getPlayer, listMaterials, reconcileAfterMaterialChange, removeMaterial } from "@/lib/players";
import { fixturePath } from "@/lib/seed";
import { newId } from "@/lib/secret";

export const dynamic = "force-dynamic";

/** 没有个人轨迹时,主动使用赛事参考路线。它不是选手的实际行走记录 */
export const POST = guarded(async (_req, pid) => {
  const player = getPlayer(pid)!;
  if (player.status === "generating") return err(409, "正在生成中,暂时不能修改素材");
  const ev = getEvent(player.event_id);
  if (!ev.referenceRoute) return err(404, "本赛事没有提供参考路线");

  const file = fixturePath(ev.referenceRoute.file);
  if (!fs.existsSync(file)) return err(404, "参考路线文件不存在");
  const buf = fs.readFileSync(file);
  const parsed = parseGpx(buf);
  if (!parsed.ok) return err(500, "参考路线无法解析");

  for (const m of listMaterials(pid, "route")) removeMaterial(pid, m.id);
  const id = newId();
  const rel = saveMedia(pid, id, "gpx", buf);
  // 参考路线不计算选手的用时、配速或爬升
  const meta = {
    kind: "reference",
    points: downsample(parsed.points),
    stats: { distanceKm: parsed.stats.distanceKm, ascentM: null, durationSec: null, pointCount: parsed.stats.pointCount },
  };
  db()
    .prepare(
      "INSERT INTO materials (id, player_id, kind, filename, mime, size, path, meta, created_at, hidden) VALUES (?,?,?,?,?,?,?,?,?,0)",
    )
    .run(id, pid, "route", "赛事参考路线.gpx", "application/gpx+xml", buf.length, rel, JSON.stringify(meta), Date.now());
  reconcileAfterMaterialChange(pid);
  return json({ ok: true, id });
});
