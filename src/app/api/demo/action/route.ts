import path from "node:path";
import { demoGuard, clearSessionsFor } from "@/lib/auth";
import { err, json } from "@/lib/api";
import { startGeneration } from "@/lib/agent";
import { all, one, run, tx } from "@/lib/db";
import { DEMO_PHOTOS_DIR, readOnlyDemo } from "@/lib/config";
import { removeMedia } from "@/lib/media";
import { getEvent, getPlayer, getPreview, listMaterials, setStatus } from "@/lib/players";
import { attachFixtureFile, seedAll } from "@/lib/seed";
import type { Score } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FAULTS = ["upload_fail", "ocr_fail", "vision_fail", "llm_fail", "generate_fail"];

async function wipePlayerData(pid: string) {
  const media = await all<{ path: string | null }>("SELECT path FROM materials WHERE player_id=?", pid);
  for (const table of ["materials", "scores", "ocr", "jobs", "previews", "saved_cards", "faults", "claim_attempts", "moments", "readings"]) {
    await run(`DELETE FROM ${table} WHERE player_id=?`, pid);
  }
  await clearSessionsFor(pid);
  return media.map((m) => m.path);
}

async function resetAll() {
  const media = await tx(async () => {
    const paths: (string | null)[] = [];
    for (const p of await all<{ id: string }>("SELECT id FROM players")) paths.push(...await wipePlayerData(p.id));
    await run("DELETE FROM tags");
    await run("DELETE FROM players");
    await seedAll();
    return paths;
  });
  await Promise.all(media.map(removeMedia));
}

/** 给选手补齐一套演示素材(照片、参考路线、成绩),模拟"已上传、已核对" */
async function fillMaterials(pid: string) {
  const p = await getPlayer(pid);
  if (!p) return;
  const ev = await getEvent(p.event_id);
  if ((await listMaterials(pid, "photo")).length === 0) {
    for (const f of ["02-山脊奔跑.png", "01-林间爬坡.png", "03-完赛合影.png"]) {
      await attachFixtureFile(pid, "photo", path.join(/* turbopackIgnore: true */ DEMO_PHOTOS_DIR, f));
    }
  }
  await run(
    "INSERT OR IGNORE INTO moments (player_id, text, drafted_by_ai, updated_at) VALUES (?,?,?,?)",
    pid,
    "上坡的时候腿很沉,可回头看到山下的城市亮起来,突然觉得这一路很值。最后和朋友们一起举起奖牌的时候,我笑得停不下来。",
    0,
    Date.now(),
  );
  if (ev.referenceRoute && (await listMaterials(pid, "route")).length === 0) {
    const id = await attachFixtureFile(pid, "route", ev.referenceRoute.file);
    const row = id ? await one<{ meta: string | null }>("SELECT meta FROM materials WHERE id=?", id) : null;
    if (row?.meta) {
      const meta = JSON.parse(row.meta);
      meta.stats = { ...meta.stats, ascentM: null, durationSec: null };
      await run("UPDATE materials SET meta=? WHERE id=?", JSON.stringify(meta), id);
    }
  }
  const group = ev.groups[0];
  const score: Score = {
    elapsedTime: "01:42:36", groupId: group.id, groupName: group.name, groupRank: 12,
    source: "demo_seed", confirmedAt: Date.now(),
  };
  await run("INSERT OR IGNORE INTO scores (player_id, json) VALUES (?, ?)", pid, JSON.stringify(score));
}

export async function POST(req: Request) {
  const blocked = demoGuard();
  if (blocked) return blocked;
  if (readOnlyDemo()) return err(503, "当前线上演示仅供浏览");
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(400, "请求内容无法读取");
  }
  const action = body?.action;

  if (action === "reset_all") {
    await resetAll();
    return json({ ok: true });
  }

  const pid = typeof body?.playerId === "string" ? body.playerId : "";
  if (!await getPlayer(pid)) return err(404, "选手不存在");

  if (action === "set_fault") {
    const kind = body.kind as string;
    if (!FAULTS.includes(kind)) return err(400, "未知故障类型");
    if (body.on) await run("INSERT OR IGNORE INTO faults (player_id, kind) VALUES (?,?)", pid, kind);
    else await run("DELETE FROM faults WHERE player_id=? AND kind=?", pid, kind);
    return json({ ok: true });
  }

  if (action === "make_state") {
    const target = body.state;
    if (target !== "draft" && target !== "pending_confirmation" && target !== "generating") return err(400, "未知状态");
    const prepared = await tx(async () => {
      const player = await getPlayer(pid);
      if (!player || player.status === "generating") return false;
      if (player.status === "unclaimed") {
        await run("UPDATE players SET status='claimed_empty', claimed_at=? WHERE id=?", Date.now(), pid);
      }
      await fillMaterials(pid);
      if (target === "draft") {
        await run("DELETE FROM previews WHERE player_id=?", pid);
        await setStatus(pid, "draft");
      }
      return true;
    });
    if (!prepared) return err(409, "正在生成中");
    if (target === "draft") return json({ ok: true });

    const result = await startGeneration(pid, { wait: target === "pending_confirmation", delayMs: target === "generating" ? 4000 : 0 });
    if (!result.ok) return err(409, result.reason);
    return target === "pending_confirmation" ? json({ ok: true, hasPreview: !!(await getPreview(pid)) }) : json(result);
  }

  if (action === "reset_player") {
    const media = await tx(async () => {
      const paths = await wipePlayerData(pid);
      await run("UPDATE players SET status='unclaimed', claimed_at=NULL WHERE id=?", pid);
      return paths;
    });
    await Promise.all(media.map(removeMedia));
    return json({ ok: true, keptSaved: false });
  }

  return err(400, "未知操作");
}
