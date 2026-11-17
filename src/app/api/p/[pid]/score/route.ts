import { guarded, err, json } from "@/lib/api";
import { run } from "@/lib/db";
import { getEvent, getOcr, getPlayer, getScore, reconcileAfterMaterialChange } from "@/lib/players";
import type { Score } from "@/lib/types";

export const dynamic = "force-dynamic";

const TIME_RE = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;

/** 保存用户核对后的成绩。这是用户自己确认的值,不标为官方认证 */
export const PUT = guarded(async (req, pid) => {
  const player = getPlayer(pid)!;
  if (player.status === "generating") return err(409, "正在生成中,暂时不能修改成绩");
  const ev = getEvent(player.event_id);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(400, "请求内容无法读取");
  }

  const t = typeof body.elapsedTime === "string" ? body.elapsedTime.trim() : "";
  const m = TIME_RE.exec(t);
  if (!m) return err(400, "用时格式应为 时:分:秒,例如 01:42:36", { field: "elapsedTime" });
  const [h, mm, ss] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (h * 3600 + mm * 60 + ss === 0) return err(400, "用时不能为 0", { field: "elapsedTime" });
  const elapsedTime = `${String(h).padStart(2, "0")}:${m[2]}:${m[3]}`;

  const group = ev.groups.find((g) => g.id === body.groupId);
  if (!group) return err(400, "请选择本赛事的组别", { field: "groupId" });

  let groupRank: number | null = null;
  if (body.groupRank !== null && body.groupRank !== undefined && body.groupRank !== "") {
    const r = Number(body.groupRank);
    if (!Number.isInteger(r) || r < 1 || r > 99999) return err(400, "排名应为正整数,没有排名请留空", { field: "groupRank" });
    groupRank = r;
  }

  const ocr = getOcr(pid);
  const prev = getScore(pid);
  let source: Score["source"] = "user_manual";
  if (ocr && !ocr.error && ocr.elapsedTime) {
    source = ocr.elapsedTime === elapsedTime && ocr.groupRank === groupRank ? "user_confirmed_ocr" : "user_edited";
  }
  const score: Score = { elapsedTime, groupId: group.id, groupName: group.name, groupRank, source, confirmedAt: Date.now() };
  run("INSERT OR REPLACE INTO scores (player_id, json) VALUES (?, ?)", pid, JSON.stringify(score));
  // 待确认的预览里的成绩是旧值时,预览作废,要求用新成绩重新生成
  const changed =
    !prev || prev.elapsedTime !== score.elapsedTime || prev.groupId !== score.groupId || prev.groupRank !== score.groupRank;
  if (changed && player.status === "pending_confirmation") {
    run("DELETE FROM previews WHERE player_id=?", pid);
    run("UPDATE players SET status='draft' WHERE id=?", pid);
  }
  reconcileAfterMaterialChange(pid);
  return json({ ok: true, score });
});

export const DELETE = guarded((_req, pid) => {
  const player = getPlayer(pid)!;
  if (player.status === "generating") return err(409, "正在生成中,暂时不能修改成绩");
  run("DELETE FROM scores WHERE player_id=?", pid);
  reconcileAfterMaterialChange(pid);
  return json({ ok: true });
});
