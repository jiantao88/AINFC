import { db, run } from "@/lib/db";
import { guarded, err, json } from "@/lib/api";
import { faultFor } from "@/lib/agent";
import { draftMoment } from "@/lib/journal";
import { getPlayer, getReading, listMaterials, reconcileAfterMaterialChange } from "@/lib/players";
import { readPhoto } from "@/lib/vision";
import { readMedia } from "@/lib/media";
import { factsFromCard } from "@/lib/text";
import { getEvent, getScore } from "@/lib/players";
import type { PhotoReading } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_LEN = 600;

/** 保存选手自己写的"这一刻"。为空则清除 */
export const PUT = guarded(async (req, pid) => {
  const player = getPlayer(pid)!;
  if (player.status === "generating") return err(409, "正在生成中,暂时不能修改");
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(400, "请求内容无法读取");
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length > MAX_LEN) return err(400, `最多 ${MAX_LEN} 字`, { field: "text" });
  if (!text) {
    run("DELETE FROM moments WHERE player_id=?", pid);
  } else {
    run(
      "INSERT OR REPLACE INTO moments (player_id, text, drafted_by_ai, updated_at) VALUES (?,?,?,?)",
      pid,
      text,
      body.draftedByAi === true ? 1 : 0,
      Date.now(),
    );
  }
  reconcileAfterMaterialChange(pid);
  return json({ ok: true });
});

/** AI 一键起草:根据照片识别写一段第一人称的草稿,返回给前端放进输入框,由用户核对修改后再保存 */
export const POST = guarded(async (_req, pid) => {
  const player = getPlayer(pid)!;
  if (player.status === "generating") return err(409, "正在生成中");
  const photos = listMaterials(pid, "photo");
  if (photos.length === 0) return err(400, "请先上传至少一张照片");
  if (faultFor(pid, "vision_fail")) return err(502, "演示注入:照片识别失败,请自己写下这一刻");

  const readings: PhotoReading[] = [];
  for (const ph of photos.slice(0, 6)) {
    const cached = getReading(ph.id);
    if (cached) {
      readings.push(cached);
      continue;
    }
    const buf = ph.path ? readMedia(ph.path) : null;
    if (!buf) continue;
    const r = await readPhoto(buf);
    if (r.ok) {
      db()
        .prepare("INSERT OR REPLACE INTO readings (material_id, player_id, json, created_at) VALUES (?,?,?,?)")
        .run(ph.id, pid, JSON.stringify(r.reading), Date.now());
      readings.push(r.reading);
    }
  }
  if (readings.length === 0) return err(502, "照片识别失败,请自己写下这一刻");

  const ev = getEvent(player.event_id);
  const score = getScore(pid);
  const facts = factsFromCard({
    event: { name: ev.name, date: ev.date, isPlaceholder: ev.isPlaceholder },
    score: score ? { elapsedTime: score.elapsedTime, groupName: score.groupName, groupRank: score.groupRank, source: score.source } : null,
    route: null,
    photoIds: photos.map((p) => p.id),
  });
  const d = await draftMoment(facts, readings);
  if (!d.ok) return err(502, d.error);
  return json({ ok: true, text: d.text, basedOn: readings.length });
});
