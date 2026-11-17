import { all, db, one, run, tx } from "./db";
import { downsample, parseGpx } from "./gpx";
import { newId } from "./secret";
import { getEvent, getPlayer, getPreview, getSaved, getScore, listMaterials, setStatus } from "./players";
import { factsFromCard, writeText } from "./text";
import { mediaExists, readMedia, removeMedia } from "./media";
import type { Card, CardRoute, RouteMeta, Step } from "./types";

const STEP_DEFS: { key: string; label: string }[] = [
  { key: "read", label: "读取素材" },
  { key: "organize", label: "整理信息" },
  { key: "write", label: "撰写回忆文案" },
  { key: "card", label: "生成卡片" },
];

const g = globalThis as unknown as { __ainfcRunning?: Set<string> };
const running = () => (g.__ainfcRunning ??= new Set());

export function faultFor(playerId: string, kind: string): boolean {
  return !!one("SELECT 1 FROM faults WHERE player_id=? AND kind=?", playerId, kind);
}

function saveSteps(jobId: string, steps: Step[], extra: { status?: string; error?: string | null } = {}) {
  const sets = ["steps=?", "updated_at=?"];
  const params: (string | number | null)[] = [JSON.stringify(steps), Date.now()];
  if (extra.status) {
    sets.push("status=?");
    params.push(extra.status);
  }
  if (extra.error !== undefined) {
    sets.push("error=?");
    params.push(extra.error);
  }
  run(`UPDATE jobs SET ${sets.join(", ")} WHERE id=?`, ...params, jobId);
}

/** 创建任务并在后台运行。同一选手同时只能有一个任务 */
export function startGeneration(playerId: string): { ok: true; jobId: string } | { ok: false; reason: string } {
  db();
  const p = getPlayer(playerId);
  if (!p) return { ok: false, reason: "选手不存在" };
  if (p.status === "unclaimed") return { ok: false, reason: "请先认领" };
  if (running().has(playerId) || p.status === "generating") return { ok: false, reason: "正在生成中" };
  if (listMaterials(playerId, "photo").length === 0) return { ok: false, reason: "请至少上传一张照片" };

  const jobId = newId();
  const steps: Step[] = STEP_DEFS.map((s) => ({ ...s, status: "pending" }));
  tx(() => {
    run(
      "INSERT INTO jobs (id, player_id, status, steps, error, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      jobId,
      playerId,
      "queued",
      JSON.stringify(steps),
      null,
      Date.now(),
      Date.now(),
    );
    setStatus(playerId, "generating");
  });
  running().add(playerId);
  void runJob(jobId, playerId).finally(() => running().delete(playerId));
  return { ok: true, jobId };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runJob(jobId: string, playerId: string) {
  const steps: Step[] = STEP_DEFS.map((s) => ({ ...s, status: "pending" }));
  const mark = (i: number, status: Step["status"], detail?: string) => {
    steps[i] = { ...steps[i], status, ...(detail ? { detail } : {}) };
    saveSteps(jobId, steps);
  };
  const delay = Number(process.env.AGENT_STEP_DELAY_MS ?? 0);
  let failedAt = -1;
  try {
    saveSteps(jobId, steps, { status: "running" });

    // 1 读取素材
    failedAt = 0;
    mark(0, "running");
    if (faultFor(playerId, "generate_fail")) throw new Error("演示注入:生成失败");
    if (delay) await sleep(delay);
    const photos = listMaterials(playerId, "photo").filter((m) => m.path && mediaExists(m.path));
    if (photos.length === 0) throw new Error("没有可用的照片文件,请重新上传");
    const routeRow = listMaterials(playerId, "route").at(-1);
    const scoreImg = listMaterials(playerId, "score_image").at(-1);
    mark(0, "done", `${photos.length} 张照片${routeRow ? "、1 条轨迹" : ""}${scoreImg ? "、1 张成绩截图" : ""}`);

    // 2 整理信息:只取用户确认过的成绩;轨迹按来源区分
    failedAt = 1;
    mark(1, "running");
    if (delay) await sleep(delay);
    const p = getPlayer(playerId)!;
    const ev = getEvent(p.event_id);
    const score = getScore(playerId);

    let route: CardRoute | null = null;
    if (routeRow) {
      if (routeRow.mime && routeRow.mime.startsWith("image/")) {
        route = { kind: "screenshot", materialId: routeRow.id };
      } else {
        const meta: RouteMeta | null = routeRow.meta ? JSON.parse(routeRow.meta) : null;
        let points = meta?.points;
        let stats = meta?.stats;
        if ((!points || !stats) && routeRow.path) {
          const buf = readMedia(routeRow.path);
          const parsed = buf ? parseGpx(buf) : null;
          if (parsed?.ok) {
            points = downsample(parsed.points);
            stats = parsed.stats;
          }
        }
        if (points && points.length > 1) {
          route =
            meta?.kind === "reference" || !stats
              ? { kind: "reference", points }
              : { kind: "personal", points, stats };
        }
      }
    }
    const cover = photos[0];
    const cardBase: Omit<Card, "title" | "text" | "textSource"> = {
      version: 1,
      event: { name: ev.name, date: ev.date, isPlaceholder: ev.isPlaceholder },
      player: { name: p.name, bib: p.bib },
      score: score
        ? { elapsedTime: score.elapsedTime, groupName: score.groupName, groupRank: score.groupRank, source: score.source }
        : null,
      route,
      coverMaterialId: cover.id,
      photoIds: photos.map((m) => m.id),
      generatedAt: Date.now(),
    };
    const parts = [
      score ? `成绩 ${score.elapsedTime}${score.groupRank != null ? `(第 ${score.groupRank} 名)` : "(无排名)"}` : "无成绩",
      route ? (route.kind === "personal" ? "个人轨迹" : route.kind === "reference" ? "参考路线" : "轨迹截图") : "无轨迹",
    ];
    mark(1, "done", parts.join(" · "));

    // 3 文案
    failedAt = 2;
    mark(2, "running");
    if (delay) await sleep(delay);
    const text = await writeText(factsFromCard(cardBase), { forceError: faultFor(playerId, "llm_fail") });
    mark(2, "done", text.source === "llm" ? "模型撰写,已通过事实校验" : (text.note ?? "固定模板文案"));

    // 4 卡片:姓名、号码、成绩由固定模板绘制,不经过模型
    failedAt = 3;
    mark(3, "running");
    if (delay) await sleep(delay);
    const card: Card = {
      ...cardBase,
      title: `${p.name}的赛后记忆`,
      text: text.text,
      textSource: text.source,
    };
    tx(() => {
      run(
        "INSERT OR REPLACE INTO previews (player_id, json, job_id, updated_at) VALUES (?,?,?,?)",
        playerId,
        JSON.stringify(card),
        jobId,
        Date.now(),
      );
      setStatus(playerId, "pending_confirmation");
    });
    mark(3, "done");
    saveSteps(jobId, steps, { status: "succeeded", error: null });
  } catch (e) {
    const message = e instanceof Error ? e.message : "生成失败";
    if (failedAt >= 0 && steps[failedAt]) steps[failedAt] = { ...steps[failedAt], status: "failed", detail: message };
    saveSteps(jobId, steps, { status: "failed", error: message });
    // 素材保留。已有保存版本的选手回到 saved(旧版继续显示,可重试);否则回到草稿
    setStatus(playerId, getSaved(playerId) ? "saved" : "draft");
  }
}

export function currentRunning(playerId: string) {
  return running().has(playerId);
}

export function allJobs(playerId: string) {
  return all("SELECT id,status,created_at FROM jobs WHERE player_id=? ORDER BY created_at", playerId);
}

/** 确认保存:把预览写成正式版本。旧版在此刻才被替换 */
export function confirmSave(playerId: string): { ok: true } | { ok: false; reason: string } {
  const preview = getPreview(playerId);
  const p = getPlayer(playerId);
  if (!p || !preview) return { ok: false, reason: "没有待确认的卡片" };
  if (p.status !== "pending_confirmation") return { ok: false, reason: "当前状态不能保存" };
  const orphans: (string | null)[] = [];
  tx(() => {
    run("INSERT OR REPLACE INTO saved_cards (player_id, json, saved_at) VALUES (?,?,?)", playerId, JSON.stringify(preview), Date.now());
    run("DELETE FROM previews WHERE player_id=?", playerId);
    setStatus(playerId, "saved");
    // 被隐藏、且新版本不再引用的旧素材,此时才清理
    const keep = new Set([preview.coverMaterialId, ...preview.photoIds, preview.route?.kind === "screenshot" ? preview.route.materialId : null]);
    const hidden = all<{ id: string; path: string | null }>("SELECT id, path FROM materials WHERE player_id=? AND hidden=1", playerId);
    for (const h of hidden) {
      if (keep.has(h.id)) continue;
      run("DELETE FROM materials WHERE id=?", h.id);
      orphans.push(h.path);
    }
  });
  for (const rel of orphans) removeMedia(rel);
  return { ok: true };
}
