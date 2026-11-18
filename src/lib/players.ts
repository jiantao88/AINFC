import { all, one, run, tx, type JobRow, type MaterialRow, type PlayerRow } from "./db";
import { mediaExists, removeMedia } from "./media";
import { claimCodeFor, tagCodeFor } from "./secret";
import { cloudMedia, llmConfig, LIMITS } from "./config";
import type {
  Card,
  EventConfig,
  JobView,
  MaterialView,
  OcrResult,
  PhotoReading,
  RouteMeta,
  Score,
  State,
  Status,
} from "./types";

export async function getPlayer(id: string): Promise<PlayerRow | undefined> {
  return one<PlayerRow>("SELECT * FROM players WHERE id=?", id);
}

export async function playerByTag(code: string): Promise<PlayerRow | undefined> {
  const tag = await one<{ player_id: string }>("SELECT player_id FROM tags WHERE code=?", code);
  return tag ? getPlayer(tag.player_id) : undefined;
}

export async function getEvent(id: string): Promise<EventConfig> {
  const row = await one<{ json: string }>("SELECT json FROM events WHERE id=?", id);
  if (!row) throw new Error(`赛事不存在: ${id}`);
  return JSON.parse(row.json);
}

export async function setStatus(playerId: string, status: Status) {
  await run("UPDATE players SET status=? WHERE id=?", status, playerId);
}

const json = <T>(v: string | undefined | null): T | null => (v ? (JSON.parse(v) as T) : null);

export async function listMaterials(playerId: string, kind?: string): Promise<MaterialRow[]> {
  return kind
    ? all<MaterialRow>("SELECT * FROM materials WHERE player_id=? AND kind=? AND hidden=0 ORDER BY created_at", playerId, kind)
    : all<MaterialRow>("SELECT * FROM materials WHERE player_id=? AND hidden=0 ORDER BY created_at", playerId);
}

export async function getMaterial(playerId: string, id: string): Promise<MaterialRow | undefined> {
  return one<MaterialRow>("SELECT * FROM materials WHERE id=? AND player_id=?", id, playerId);
}

export async function getScore(playerId: string): Promise<Score | null> {
  return json<Score>((await one<{ json: string }>("SELECT json FROM scores WHERE player_id=?", playerId))?.json);
}

export async function getMoment(playerId: string): Promise<{ text: string; draftedByAi: boolean } | null> {
  const row = await one<{ text: string; drafted_by_ai: number }>("SELECT text, drafted_by_ai FROM moments WHERE player_id=?", playerId);
  return row ? { text: row.text, draftedByAi: !!row.drafted_by_ai } : null;
}

export async function getReading(materialId: string): Promise<PhotoReading | null> {
  return json<PhotoReading>((await one<{ json: string }>("SELECT json FROM readings WHERE material_id=?", materialId))?.json);
}

export async function getOcr(playerId: string): Promise<OcrResult | null> {
  return json<OcrResult>((await one<{ json: string }>("SELECT json FROM ocr WHERE player_id=?", playerId))?.json);
}

export async function getPreview(playerId: string): Promise<Card | null> {
  return json<Card>((await one<{ json: string }>("SELECT json FROM previews WHERE player_id=?", playerId))?.json);
}

export async function getSaved(playerId: string): Promise<{ card: Card; savedAt: number } | null> {
  const row = await one<{ json: string; saved_at: number }>("SELECT json, saved_at FROM saved_cards WHERE player_id=?", playerId);
  return row ? { card: JSON.parse(row.json), savedAt: row.saved_at } : null;
}

export async function latestJob(playerId: string): Promise<JobRow | undefined> {
  return one<JobRow>("SELECT * FROM jobs WHERE player_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", playerId);
}

const JOB_STALE_MS = 310_000;

export async function recoverExpiredJob(playerId: string) {
  return tx(async () => {
    const cutoff = Date.now() - JOB_STALE_MS;
    const expired = await run(
      "UPDATE jobs SET status='failed', error='生成超时，素材已保留，请重试', updated_at=? WHERE player_id=? AND status IN ('queued','running') AND updated_at<?",
      Date.now(), playerId, cutoff,
    );
    if (!expired.rowsAffected) return false;
    await run(
      "UPDATE players SET status=CASE WHEN EXISTS (SELECT 1 FROM saved_cards WHERE player_id=?) THEN 'saved' ELSE 'draft' END WHERE id=? AND status='generating'",
      playerId, playerId,
    );
    return true;
  });
}

const mat = (m: MaterialRow, playerId: string): MaterialView => ({
  id: m.id,
  name: m.filename,
  size: m.size,
  url: m.path && mediaExists(m.path) ? `/api/p/${playerId}/materials/${m.id}` : null,
});

export async function buildState(playerId: string): Promise<State | null> {
  const p = await getPlayer(playerId);
  if (!p) return null;
  const [ev, materials, job, score, moment, ocr, preview, saved] = await Promise.all([
    getEvent(p.event_id), listMaterials(playerId), latestJob(playerId), getScore(playerId),
    getMoment(playerId), getOcr(playerId), getPreview(playerId), getSaved(playerId),
  ]);
  if (p.status === "generating" && job && job.updated_at < Date.now() - JOB_STALE_MS && await recoverExpiredJob(playerId)) {
    return buildState(playerId);
  }
  const photos = materials.filter((m) => m.kind === "photo").map((m) => mat(m, playerId));
  const routeRow = materials.findLast((m) => m.kind === "route");
  const scoreImg = materials.findLast((m) => m.kind === "score_image");
  const jobView: JobView | null = job
    ? { id: job.id, status: job.status, steps: JSON.parse(job.steps), error: job.error }
    : null;

  return {
    player: { id: p.id, name: p.name, bib: p.bib, status: p.status },
    event: {
      id: ev.id,
      name: ev.name,
      date: ev.date,
      isPlaceholder: ev.isPlaceholder,
      groups: ev.groups,
      heroUrl: "/api/event-hero",
      imageMaxBytes: LIMITS.imageMaxBytes,
      directUpload: cloudMedia(),
      maxPhotos: LIMITS.maxPhotos,
      referenceRouteAvailable: !!ev.referenceRoute,
    },
    materials: {
      photos,
      route: routeRow
        ? { ...mat(routeRow, playerId), meta: (json<RouteMeta>(routeRow.meta) ?? { kind: "personal" }) as RouteMeta }
        : null,
      scoreImage: scoreImg ? mat(scoreImg, playerId) : null,
    },
    score,
    moment,
    visionEnabled: !!llmConfig().key,
    ocr,
    ocrEnabled: !!llmConfig().key,
    job: jobView,
    preview,
    saved,
  };
}

/** 用户能看到的材料是否足够生成:至少一张照片(产品文档:建议照片至少一张) */
export async function canGenerate(playerId: string): Promise<{ ok: boolean; reason?: string }> {
  if ((await listMaterials(playerId, "photo")).length === 0) return { ok: false, reason: "请至少上传一张照片" };
  const p = await getPlayer(playerId);
  if (!p) return { ok: false, reason: "选手不存在" };
  if (p.status === "unclaimed") return { ok: false, reason: "请先认领" };
  if (p.status === "generating") return { ok: false, reason: "正在生成中" };
  return { ok: true };
}

/** 素材变动后,状态回落:没素材回 claimed_empty,有素材的草稿保持草稿。已保存的状态不被素材变动改动 */
export async function reconcileAfterMaterialChange(playerId: string) {
  const p = await getPlayer(playerId);
  if (!p) return;
  if (p.status === "saved" || p.status === "generating" || p.status === "unclaimed") return;
  const hasAny = (await listMaterials(playerId)).length > 0 || !!(await getScore(playerId)) || !!(await getMoment(playerId));
  const next: Status = p.status === "pending_confirmation" ? "pending_confirmation" : hasAny ? "draft" : "claimed_empty";
  if (next !== p.status) await setStatus(playerId, next);
}

export async function removeMaterialRow(playerId: string, m: MaterialRow): Promise<string | null> {
  const savedUses = (await getSaved(playerId))?.card;
  const usedBySaved =
    !!savedUses &&
    (savedUses.coverMaterialId === m.id ||
      savedUses.photoIds.includes(m.id) ||
      (savedUses.route?.kind === "screenshot" && savedUses.route.materialId === m.id));
  if (usedBySaved) {
    await run("UPDATE materials SET hidden=1 WHERE id=?", m.id);
    return null;
  }
  await run("DELETE FROM materials WHERE id=?", m.id);
  await run("DELETE FROM readings WHERE material_id=?", m.id);
  return m.path;
}

export async function removeMaterial(playerId: string, id: string): Promise<boolean> {
  const result = await tx(async () => {
    const material = await getMaterial(playerId, id);
    if (!material) return null;
    const path = await removeMaterialRow(playerId, material);
    await reconcileAfterMaterialChange(playerId);
    return { path };
  });
  if (!result) return false;
  await removeMedia(result.path);
  return true;
}

export async function playerPublicView(playerId: string) {
  const p = await getPlayer(playerId);
  if (!p) return null;
  const ev = await getEvent(p.event_id);
  return {
    eventName: ev.name,
    eventDate: ev.date,
    isPlaceholder: ev.isPlaceholder,
    heroUrl: "/api/event-hero",
    // 公开页只露出号码的存在,不露出姓名和任何私人内容
    bib: p.bib,
    claimed: p.status !== "unclaimed",
  };
}

export const demoCodes = (playerId: string) => ({
  claimCode: claimCodeFor(playerId),
  medalTag: tagCodeFor(playerId, "medal"),
  bibTag: tagCodeFor(playerId, "bib"),
});
