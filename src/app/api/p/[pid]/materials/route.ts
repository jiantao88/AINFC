import { db, run } from "@/lib/db";
import { guarded, err, json } from "@/lib/api";
import { LIMITS } from "@/lib/config";
import { downsample, parseGpx } from "@/lib/gpx";
import { cleanName, saveMedia, sniffImage } from "@/lib/media";
import { getPlayer, listMaterials, reconcileAfterMaterialChange, removeMaterial } from "@/lib/players";
import { faultFor } from "@/lib/agent";
import { newId } from "@/lib/secret";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 单个素材上传。失败只影响这一个文件,已上传的其他素材不受影响 */
export const POST = guarded(async (req, pid) => {
  const player = getPlayer(pid)!;
  if (player.status === "generating") return err(409, "正在生成中,暂时不能修改素材");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err(400, "上传内容无法读取");
  }
  const kind = form.get("kind");
  const file = form.get("file");
  if (kind !== "photo" && kind !== "route" && kind !== "score_image") return err(400, "未知的素材类型");
  if (!(file instanceof File)) return err(400, "缺少文件");
  if (file.size === 0) return err(400, "文件是空的");

  if (faultFor(pid, "upload_fail")) return err(500, "演示注入:上传失败,请重试");

  const max = kind === "route" ? LIMITS.gpxMaxBytes : LIMITS.imageMaxBytes;
  if (file.size > max) {
    const mb = (n: number) => `${Math.round((n / 1048576) * 10) / 10} MB`;
    return err(413, `文件太大(${mb(file.size)}),上限 ${mb(max)}。其他素材不受影响`, { code: "too_large" });
  }
  if (kind === "photo" && listMaterials(pid, "photo").length >= LIMITS.maxPhotos) {
    return err(400, `照片最多 ${LIMITS.maxPhotos} 张`, { code: "too_many" });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const id = newId();
  const now = Date.now();
  const name = cleanName(file.name);
  const d = db();

  if (kind === "route") {
    const img = sniffImage(buf);
    if (img) {
      // 轨迹截图:只作展示,不做精确轨迹还原
      const rel = saveMedia(pid, id, img.ext, buf);
      replaceRoute(pid);
      d.prepare(
        "INSERT INTO materials (id, player_id, kind, filename, mime, size, path, meta, created_at, hidden) VALUES (?,?,?,?,?,?,?,?,?,0)",
      ).run(id, pid, "route", name, img.mime, buf.length, rel, JSON.stringify({ kind: "screenshot" }), now);
      reconcileAfterMaterialChange(pid);
      return json({ ok: true, id, note: "已作为轨迹截图展示,不会还原精确轨迹" });
    }
    const parsed = parseGpx(buf);
    if (!parsed.ok) return err(422, parsed.message, { code: parsed.code });
    const rel = saveMedia(pid, id, "gpx", buf);
    replaceRoute(pid);
    const meta = { kind: "personal", points: downsample(parsed.points), stats: parsed.stats };
    d.prepare(
      "INSERT INTO materials (id, player_id, kind, filename, mime, size, path, meta, created_at, hidden) VALUES (?,?,?,?,?,?,?,?,?,0)",
    ).run(id, pid, "route", name, "application/gpx+xml", buf.length, rel, JSON.stringify(meta), now);
    reconcileAfterMaterialChange(pid);
    return json({
      ok: true,
      id,
      note: parsed.stats.durationSec == null ? "轨迹已解析,文件没有时间信息,不显示用时" : "轨迹已解析",
    });
  }

  const img = sniffImage(buf);
  if (!img) return err(415, "只支持 PNG、JPG、WebP 图片", { code: "bad_type" });
  const rel = saveMedia(pid, id, img.ext, buf);
  if (kind === "score_image") replaceScoreImage(pid);
  d.prepare(
    "INSERT INTO materials (id, player_id, kind, filename, mime, size, path, meta, created_at, hidden) VALUES (?,?,?,?,?,?,?,?,?,0)",
  ).run(id, pid, kind, name, img.mime, buf.length, rel, null, now);
  reconcileAfterMaterialChange(pid);
  return json({ ok: true, id });
});

function replaceRoute(pid: string) {
  for (const m of listMaterials(pid, "route")) removeMaterial(pid, m.id);
}

function replaceScoreImage(pid: string) {
  for (const m of listMaterials(pid, "score_image")) removeMaterial(pid, m.id);
  run("DELETE FROM ocr WHERE player_id=?", pid);
}

