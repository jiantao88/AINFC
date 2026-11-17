import { all, db, one, run, tx, type JobRow, type MaterialRow, type PlayerRow } from "./db";
import { mediaExists, removeMedia } from "./media";
import { claimCodeFor, tagCodeFor } from "./secret";
import { llmConfig, LIMITS } from "./config";
import type {
  Card,
  EventConfig,
  JobView,
  MaterialView,
  OcrResult,
  RouteMeta,
  Score,
  State,
  Status,
} from "./types";

export function getPlayer(id: string): PlayerRow | undefined {
  db();
  return one<PlayerRow>("SELECT * FROM players WHERE id=?", id);
}

export function playerByTag(code: string): PlayerRow | undefined {
  db();
  const tag = one<{ player_id: string }>("SELECT player_id FROM tags WHERE code=?", code);
  return tag ? getPlayer(tag.player_id) : undefined;
}

export function getEvent(id: string): EventConfig {
  db();
  const row = one<{ json: string }>("SELECT json FROM events WHERE id=?", id);
  if (!row) throw new Error(`赛事不存在: ${id}`);
  return JSON.parse(row.json);
}

export function setStatus(playerId: string, status: Status) {
  run("UPDATE players SET status=? WHERE id=?", status, playerId);
}

const json = <T>(v: string | undefined | null): T | null => (v ? (JSON.parse(v) as T) : null);

export function listMaterials(playerId: string, kind?: string): MaterialRow[] {
  db();
  return kind
    ? all<MaterialRow>("SELECT * FROM materials WHERE player_id=? AND kind=? AND hidden=0 ORDER BY created_at", playerId, kind)
    : all<MaterialRow>("SELECT * FROM materials WHERE player_id=? AND hidden=0 ORDER BY created_at", playerId);
}

export function getMaterial(playerId: string, id: string): MaterialRow | undefined {
  db();
  return one<MaterialRow>("SELECT * FROM materials WHERE id=? AND player_id=?", id, playerId);
}

export function getScore(playerId: string): Score | null {
  db();
  return json<Score>(one<{ json: string }>("SELECT json FROM scores WHERE player_id=?", playerId)?.json);
}

export function getOcr(playerId: string): OcrResult | null {
  db();
  return json<OcrResult>(one<{ json: string }>("SELECT json FROM ocr WHERE player_id=?", playerId)?.json);
}

export function getPreview(playerId: string): Card | null {
  db();
  return json<Card>(one<{ json: string }>("SELECT json FROM previews WHERE player_id=?", playerId)?.json);
}

export function getSaved(playerId: string): { card: Card; savedAt: number } | null {
  db();
  const row = one<{ json: string; saved_at: number }>("SELECT json, saved_at FROM saved_cards WHERE player_id=?", playerId);
  return row ? { card: JSON.parse(row.json), savedAt: row.saved_at } : null;
}

export function latestJob(playerId: string): JobRow | undefined {
  db();
  return one<JobRow>("SELECT * FROM jobs WHERE player_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", playerId);
}

const mat = (m: MaterialRow, playerId: string): MaterialView => ({
  id: m.id,
  name: m.filename,
  size: m.size,
  url: m.path && mediaExists(m.path) ? `/api/p/${playerId}/materials/${m.id}` : null,
});

export function buildState(playerId: string): State | null {
  const p = getPlayer(playerId);
  if (!p) return null;
  const ev = getEvent(p.event_id);
  const photos = listMaterials(playerId, "photo").map((m) => mat(m, playerId));
  const routeRow = listMaterials(playerId, "route").at(-1);
  const scoreImg = listMaterials(playerId, "score_image").at(-1);
  const job = latestJob(playerId);
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
    score: getScore(playerId),
    ocr: getOcr(playerId),
    ocrEnabled: !!llmConfig().key,
    job: jobView,
    preview: getPreview(playerId),
    saved: getSaved(playerId),
  };
}

/** 用户能看到的材料是否足够生成:至少一张照片(产品文档:建议照片至少一张) */
export function canGenerate(playerId: string): { ok: boolean; reason?: string } {
  if (listMaterials(playerId, "photo").length === 0) return { ok: false, reason: "请至少上传一张照片" };
  const p = getPlayer(playerId);
  if (!p) return { ok: false, reason: "选手不存在" };
  if (p.status === "unclaimed") return { ok: false, reason: "请先认领" };
  if (p.status === "generating") return { ok: false, reason: "正在生成中" };
  return { ok: true };
}

/** 素材变动后,状态回落:没素材回 claimed_empty,有素材的草稿保持草稿。已保存的状态不被素材变动改动 */
export function reconcileAfterMaterialChange(playerId: string) {
  const p = getPlayer(playerId);
  if (!p) return;
  if (p.status === "saved" || p.status === "generating" || p.status === "unclaimed") return;
  const hasAny =
    listMaterials(playerId).length > 0 || !!getScore(playerId);
  const next: Status = p.status === "pending_confirmation" ? "pending_confirmation" : hasAny ? "draft" : "claimed_empty";
  if (next !== p.status) setStatus(playerId, next);
}

export function removeMaterial(playerId: string, id: string): boolean {
  const m = getMaterial(playerId, id);
  if (!m) return false;
  const savedUses = getSaved(playerId)?.card;
  const usedBySaved =
    !!savedUses &&
    (savedUses.coverMaterialId === id ||
      savedUses.photoIds.includes(id) ||
      (savedUses.route?.kind === "screenshot" && savedUses.route.materialId === id));
  tx(() => {
    if (usedBySaved) {
      // 已保存的卡片还在引用这份素材:只对新的收集页隐藏,文件保留,直到新版本确认保存
      run("UPDATE materials SET hidden=1 WHERE id=?", id);
    } else {
      run("DELETE FROM materials WHERE id=?", id);
    }
  });
  if (!usedBySaved) removeMedia(m.path);
  reconcileAfterMaterialChange(playerId);
  return true;
}

export function playerPublicView(playerId: string) {
  const p = getPlayer(playerId);
  if (!p) return null;
  const ev = getEvent(p.event_id);
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
