import fs from "node:fs";
import path from "node:path";
import { demoGuard, clearSessionsFor } from "@/lib/auth";
import { err, json } from "@/lib/api";
import { startGeneration } from "@/lib/agent";
import { all, db, run } from "@/lib/db";
import { removePlayerMedia } from "@/lib/media";
import { getEvent, getPlayer, getPreview, getSaved, listMaterials, setStatus } from "@/lib/players";
import { attachFixtureFile, fixturePath, seedAll } from "@/lib/seed";
import type { Score } from "@/lib/types";

export const dynamic = "force-dynamic";

const FAULTS = ["upload_fail", "ocr_fail", "vision_fail", "llm_fail", "generate_fail"] as const;

function wipePlayerData(pid: string) {
  for (const t of ["materials", "scores", "ocr", "jobs", "previews", "saved_cards", "faults", "claim_attempts", "moments", "readings"]) {
    run(`DELETE FROM ${t} WHERE player_id=?`, pid);
  }
  removePlayerMedia(pid);
}

function resetAll() {
  db();
  for (const p of all<{ id: string }>("SELECT id FROM players")) {
    wipePlayerData(p.id);
    clearSessionsFor(p.id);
  }
  run("DELETE FROM tags");
  run("DELETE FROM players");
  seedAll();
}

/** 给选手补齐一套演示素材(照片、参考路线、成绩),模拟"已上传、已核对" */
function fillMaterials(pid: string) {
  const p = getPlayer(pid)!;
  const ev = getEvent(p.event_id);
  if (listMaterials(pid, "photo").length === 0) {
    // 演示素材:docs/demo-assets/xiangzhi 下的三张照片(AI 合成,非实拍)。缺失时跳过
    const dir = path.join(process.cwd(), "docs", "demo-assets", "xiangzhi");
    for (const f of ["02-山脊奔跑.png", "01-林间爬坡.png", "03-完赛合影.png"]) {
      attachFixtureFile(pid, "photo", path.join(dir, f));
    }
  }
  if (!all("SELECT 1 FROM moments WHERE player_id=?", pid).length) {
    run(
      "INSERT INTO moments (player_id, text, drafted_by_ai, updated_at) VALUES (?,?,?,?)",
      pid,
      "上坡的时候腿很沉,可回头看到山下的城市亮起来,突然觉得这一路很值。最后和朋友们一起举起奖牌的时候,我笑得停不下来。",
      0,
      Date.now(),
    );
  }
  if (listMaterials(pid, "route").length === 0 && ev.referenceRoute) {
    attachFixtureFile(pid, "route", ev.referenceRoute.file);
    const row = all<{ id: string; meta: string | null }>("SELECT id, meta FROM materials WHERE player_id=? AND kind='route'", pid)[0];
    if (row?.meta) {
      const m = JSON.parse(row.meta);
      m.kind = "reference";
      m.stats = { ...m.stats, ascentM: null, durationSec: null };
      run("UPDATE materials SET meta=? WHERE id=?", JSON.stringify(m), row.id);
    }
  }
  const has = all("SELECT 1 FROM scores WHERE player_id=?", pid).length > 0;
  if (!has) {
    const g = ev.groups[0];
    const score: Score = { elapsedTime: "01:42:36", groupId: g.id, groupName: g.name, groupRank: 12, source: "demo_seed", confirmedAt: Date.now() };
    run("INSERT INTO scores (player_id, json) VALUES (?, ?)", pid, JSON.stringify(score));
  }
}

export async function POST(req: Request) {
  const blocked = demoGuard();
  if (blocked) return blocked;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(400, "bad json");
  }
  const action = body.action;
  db();

  if (action === "reset_all") {
    resetAll();
    return json({ ok: true });
  }

  const pid = typeof body.playerId === "string" ? body.playerId : "";
  const p = getPlayer(pid);
  if (!p) return err(404, "选手不存在");

  if (action === "set_fault") {
    const kind = body.kind as string;
    if (!(FAULTS as readonly string[]).includes(kind)) return err(400, "未知故障类型");
    if (body.on) run("INSERT OR IGNORE INTO faults (player_id, kind) VALUES (?,?)", pid, kind);
    else run("DELETE FROM faults WHERE player_id=? AND kind=?", pid, kind);
    return json({ ok: true });
  }

  if (action === "make_state") {
    const target = body.state as string;
    if (p.status === "unclaimed") run("UPDATE players SET status='claimed_empty', claimed_at=? WHERE id=?", Date.now(), pid);
    if (target === "draft") {
      fillMaterials(pid);
      run("DELETE FROM previews WHERE player_id=?", pid);
      setStatus(pid, "draft");
      return json({ ok: true });
    }
    if (target === "pending_confirmation") {
      fillMaterials(pid);
      const r = startGeneration(pid);
      if (!r.ok) return err(409, r.reason);
      // 真实跑一遍 Agent,等它结束,不塞假预览
      for (let i = 0; i < 400; i++) {
        await new Promise((res) => setTimeout(res, 150));
        const j = all<{ status: string }>("SELECT status FROM jobs WHERE id=?", r.jobId)[0];
        if (j && (j.status === "succeeded" || j.status === "failed")) break;
      }
      return json({ ok: true, hasPreview: !!getPreview(pid) });
    }
    if (target === "generating") {
      // 慢速真实任务,方便肉眼看到各步骤的状态变化
      fillMaterials(pid);
      process.env.AGENT_STEP_DELAY_MS = "4000";
      const r = startGeneration(pid);
      if (!r.ok) return err(409, r.reason);
      setTimeout(() => {
        delete process.env.AGENT_STEP_DELAY_MS;
      }, 20_000);
      return json({ ok: true, jobId: r.jobId, note: "约 16 秒后进入待确认" });
    }
    return err(400, "未知状态");
  }

  if (action === "reset_player") {
    wipePlayerData(pid);
    clearSessionsFor(pid);
    run("UPDATE players SET status='unclaimed', claimed_at=NULL WHERE id=?", pid);
    return json({ ok: true, keptSaved: !!getSaved(pid) });
  }

  return err(400, "未知操作");
}
