import { llmConfig } from "./config";
import { all, db, one, run, tx } from "./db";
import { downsample, parseGpx } from "./gpx";
import { newId } from "./secret";
import { getEvent, getMoment, getPlayer, getPreview, getReading, getSaved, getScore, listMaterials, setStatus } from "./players";
import { factsFromCard, writeText } from "./text";
import { writeJournal } from "./journal";
import { mapLimit } from "./pool";
import { readPhoto } from "./vision";
import type { PhotoReading } from "./types";
import { mediaExists, readMedia, removeMedia } from "./media";
import type { Card, CardRoute, RouteMeta, Step } from "./types";

const STEP_DEFS: { key: string; label: string }[] = [
  { key: "read", label: "读取素材" },
  { key: "look", label: "识别照片" },
  { key: "organize", label: "整理信息" },
  { key: "write", label: "撰写游记与文案" },
  { key: "card", label: "生成卡片" },
];

const VISION_CONCURRENCY = 3;

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

    // 2 识别照片:每张只识别一次(结果缓存);单张失败不阻断,游记照常生成
    failedAt = 1;
    mark(1, "running");
    if (faultFor(playerId, "vision_fail")) {
      mark(1, "done", "照片识别失败(演示注入),游记只依据你写的话和已确认的信息");
    } else {
      // 每次模型调用要十几秒,串行识别 6 张要一分多钟;最多 3 路并发(并发数过高可能被中转服务限流)
      const targets = photos.slice(0, 6);
      const outcomes = await mapLimit(targets, VISION_CONCURRENCY, async (ph) => {
        const cached = getReading(ph.id);
        if (cached) return { reading: cached as PhotoReading | null, fresh: false };
        const buf = ph.path ? readMedia(ph.path) : null;
        const r = buf ? await readPhoto(buf) : { ok: false as const, error: "照片文件丢失" };
        if (!r.ok) return { reading: null, fresh: false };
        run("INSERT OR REPLACE INTO readings (material_id, player_id, json, created_at) VALUES (?,?,?,?)", ph.id, playerId, JSON.stringify(r.reading), Date.now());
        return { reading: r.reading as PhotoReading | null, fresh: true };
      });
      const recognized = outcomes.filter((o) => o.reading).length;
      const fresh = outcomes.filter((o) => o.fresh).length;
      const failed = outcomes.length - recognized;
      const note = `${recognized}/${targets.length} 张已识别${fresh ? `(新识别 ${fresh} 张)` : "(沿用已有结果)"}${failed ? `,${failed} 张失败已跳过` : ""}`;
      mark(1, "done", llmConfig().key ? note : "未配置大模型,跳过照片识别");
    }

    // 3 整理信息:只取用户确认过的成绩;轨迹按来源区分
    failedAt = 2;
    mark(2, "running");
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
    mark(2, "done", parts.join(" · "));

    // 4 游记 + 卡片短文案
    failedAt = 3;
    mark(3, "running");
    if (delay) await sleep(delay);
    const facts = factsFromCard(cardBase);
    const momentRow = getMoment(playerId);
    const moment = momentRow?.text.trim() ?? "";
    // 与 card.photoIds 顺序一一对应,没识别出来的用 null 占位,[图N] 的序号才不会错位
    const readings = photos.map((ph) => getReading(ph.id));
    const forceError = faultFor(playerId, "llm_fail");
    const [text, journal] = await Promise.all([
      writeText(facts, { forceError }),
      writeJournal({ facts, moment, photos: readings }, { forceError }),
    ]);
    mark(
      3,
      "done",
      journal.source === "llm"
        ? `游记已生成并通过事实校验${moment ? "(依据你写的话和照片)" : "(没有你写的话,只依据照片和事实)"}`
        : (journal.note ?? "固定模板游记"),
    );

    // 5 卡片:姓名、号码、成绩由固定模板绘制,不经过模型
    failedAt = 4;
    mark(4, "running");
    if (delay) await sleep(delay);
    const card: Card = {
      ...cardBase,
      title: `${p.name}的赛后记忆`,
      text: text.text,
      textSource: text.source,
      journal: { title: journal.title, body: journal.body, source: journal.source },
      moment: moment || null,
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
    mark(4, "done");
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
