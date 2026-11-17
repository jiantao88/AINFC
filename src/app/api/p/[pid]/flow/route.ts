import { guarded, err, json } from "@/lib/api";
import { confirmSave, startGeneration } from "@/lib/agent";
import { run } from "@/lib/db";
import { getPlayer, getPreview, getSaved, setStatus } from "@/lib/players";
import { checkText, factsFromCard } from "@/lib/text";
import type { Card } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * action: generate | save | edit | discard
 * 生成只产生草稿预览;保存后才替换已保存版本
 */
export const POST = guarded(async (req, pid) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(400, "请求内容无法读取");
  }
  const action = body.action;
  const player = getPlayer(pid)!;

  if (action === "generate") {
    const r = startGeneration(pid);
    return r.ok ? json({ ok: true, jobId: r.jobId }, 202) : err(409, r.reason);
  }

  if (action === "save") {
    const r = confirmSave(pid);
    return r.ok ? json({ ok: true }) : err(409, r.reason);
  }

  if (action === "discard") {
    // 放弃待确认的新版本;已保存的旧版本保持不变
    if (player.status !== "pending_confirmation") return err(409, "没有待确认的卡片");
    run("DELETE FROM previews WHERE player_id=?", pid);
    setStatus(pid, getSaved(pid) ? "saved" : "draft");
    return json({ ok: true });
  }

  if (action === "edit") {
    const preview = getPreview(pid);
    if (!preview || player.status !== "pending_confirmation") return err(409, "没有可编辑的卡片");
    const next: Card = { ...preview };

    if (typeof body.title === "string") {
      const t = body.title.trim();
      if (!t || t.length > 40) return err(400, "标题长度应为 1 到 40 字", { field: "title" });
      next.title = t;
    }
    if (typeof body.text === "string") {
      const t = body.text.trim();
      if (t.length > 300) return err(400, "文案不超过 300 字", { field: "text" });
      next.text = t;
      next.textSource = "user";
    }
    if (typeof body.coverMaterialId === "string") {
      if (!next.photoIds.includes(body.coverMaterialId)) return err(400, "封面必须是已上传的照片", { field: "coverMaterialId" });
      next.coverMaterialId = body.coverMaterialId;
    }
    if (body.score && typeof body.score === "object") {
      // 成绩字段由用户改:按新值重新渲染,来源标为用户编辑
      const s = body.score as Record<string, unknown>;
      const cur = next.score;
      if (!cur) return err(400, "这张卡片没有成绩,请回到收集页填写后重新生成");
      const time = typeof s.elapsedTime === "string" ? s.elapsedTime.trim() : cur.elapsedTime;
      if (!/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(time)) return err(400, "用时格式应为 时:分:秒", { field: "elapsedTime" });
      let rank = cur.groupRank;
      if ("groupRank" in s) {
        if (s.groupRank === null || s.groupRank === "") rank = null;
        else {
          const r = Number(s.groupRank);
          if (!Number.isInteger(r) || r < 1 || r > 99999) return err(400, "排名应为正整数,没有排名请留空", { field: "groupRank" });
          rank = r;
        }
      }
      const [h, m, sec] = time.split(":");
      next.score = { ...cur, elapsedTime: `${h.padStart(2, "0")}:${m}:${sec}`, groupRank: rank, source: "user_edited" };
    }

    // 用户自己写的文案不做事实校验(他可以写任何自己的话);但提示与成绩不一致
    let warning: string | null = null;
    if (next.textSource === "user") {
      const c = checkText(next.text || "占位文案占位文案占位文案占位文案", factsFromCard(next));
      if (!c.ok && next.text) warning = `文案里有与确认数据不一致的内容:${c.reasons.filter((r) => r.includes("数字") || r.includes("没有")).join("、") || "请核对"}`;
    }
    run("INSERT OR REPLACE INTO previews (player_id, json, job_id, updated_at) VALUES (?, ?, (SELECT job_id FROM previews WHERE player_id=?), ?)", pid, JSON.stringify(next), pid, Date.now());
    return json({ ok: true, preview: next, warning });
  }

  return err(400, "未知操作");
});
