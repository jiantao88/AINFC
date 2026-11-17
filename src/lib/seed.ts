import fs from "node:fs";
import path from "node:path";
import { FIXTURES_DIR } from "./config";
import { db } from "./db";
import { newId, tagCodeFor } from "./secret";
import { saveMedia, sniffImage } from "./media";
import { downsample, parseGpx } from "./gpx";
import type { Card, EventConfig, Score } from "./types";

interface FixturePlayer {
  id: string;
  name: string;
  bib: string;
  eventId: string;
  status: string;
  ownerId: string | null;
  materials: { photos: string[]; route: string | null; scoreImage: string | null };
  score: Score | null;
  savedCard: {
    title: string;
    text: string;
    cover: string;
    score: { elapsedTime: string; groupName: string; groupRank: number | null; source: string };
    routeKind: string;
  } | null;
}

export const fixturePath = (rel: string) => path.join(FIXTURES_DIR, rel);

export function loadFixtureEvent(): EventConfig {
  return JSON.parse(fs.readFileSync(fixturePath("event.json"), "utf8"));
}

export function loadFixturePlayers(): FixturePlayer[] {
  return JSON.parse(fs.readFileSync(fixturePath("players.json"), "utf8"));
}

/** 把测试数据包里的一个文件作为素材写入某选手名下。文件缺失时返回 null,不抛错 */
export function attachFixtureFile(
  playerId: string,
  kind: "photo" | "route" | "score_image",
  rel: string,
): string | null {
  const file = fixturePath(rel);
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  const id = newId();
  const now = Date.now();
  let ext = "bin";
  let mime: string | null = null;
  let meta: string | null = null;
  if (kind === "route") {
    const parsed = parseGpx(buf);
    ext = "gpx";
    mime = "application/gpx+xml";
    if (parsed.ok) {
      meta = JSON.stringify({ kind: "reference", points: downsample(parsed.points), stats: parsed.stats });
    }
  } else {
    const img = sniffImage(buf);
    if (!img) return null;
    ext = img.ext;
    mime = img.mime;
  }
  const relPath = saveMedia(playerId, id, ext, buf);
  db()
    .prepare(
      "INSERT INTO materials (id, player_id, kind, filename, mime, size, path, meta, created_at, hidden) VALUES (?,?,?,?,?,?,?,?,?,0)",
    )
    .run(id, playerId, kind, path.basename(rel), mime, buf.length, relPath, meta, now);
  return id;
}

export function seedIfEmpty() {
  const d = db();
  const n = (d.prepare("SELECT COUNT(*) c FROM players").get() as { c: number }).c;
  if (n > 0) return;
  seedAll();
}

/** 按 players.json 重建三名选手;事件和标签一并重置 */
export function seedAll() {
  const d = db();
  const event = loadFixtureEvent();
  d.prepare("INSERT OR REPLACE INTO events (id, json) VALUES (?, ?)").run(event.id, JSON.stringify(event));

  for (const p of loadFixturePlayers()) {
    seedPlayer(p, event);
  }
}

function seedPlayer(p: FixturePlayer, event: EventConfig) {
  const d = db();
  d.prepare("INSERT OR REPLACE INTO players (id, event_id, name, bib, status, claimed_at) VALUES (?,?,?,?,?,?)").run(
    p.id,
    p.eventId,
    p.name,
    p.bib,
    p.status,
    p.ownerId ? Date.now() : null,
  );
  for (const kind of ["medal", "bib"] as const) {
    d.prepare("INSERT OR REPLACE INTO tags (code, player_id, kind) VALUES (?,?,?)").run(tagCodeFor(p.id, kind), p.id, kind);
  }

  if (p.status !== "saved" || !p.savedCard || !p.score) return;

  const photoId = p.materials.photos[0] ? attachFixtureFile(p.id, "photo", p.materials.photos[0]) : null;
  const routeId = p.materials.route ? attachFixtureFile(p.id, "route", p.materials.route) : null;
  if (p.materials.scoreImage) attachFixtureFile(p.id, "score_image", p.materials.scoreImage);

  const group = event.groups.find((g) => g.id === p.score!.groupId);
  const score: Score = {
    elapsedTime: p.score.elapsedTime,
    groupId: p.score.groupId,
    groupName: group?.name ?? p.score.groupName,
    groupRank: p.score.groupRank,
    source: "demo_seed",
    confirmedAt: Date.now(),
  };
  d.prepare("INSERT OR REPLACE INTO scores (player_id, json) VALUES (?, ?)").run(p.id, JSON.stringify(score));

  let route: Card["route"] = null;
  if (routeId) {
    const row = d.prepare("SELECT meta FROM materials WHERE id=?").get(routeId) as { meta: string | null };
    const meta = row.meta ? JSON.parse(row.meta) : null;
    if (meta?.points) route = { kind: "reference", points: meta.points };
  }

  const card: Card = {
    version: 1,
    title: p.savedCard.title,
    text: p.savedCard.text,
    textSource: "fixture",
    event: { name: event.name, date: event.date, isPlaceholder: event.isPlaceholder },
    player: { name: p.name, bib: p.bib },
    score: { elapsedTime: score.elapsedTime, groupName: score.groupName, groupRank: score.groupRank, source: score.source },
    route,
    coverMaterialId: photoId,
    photoIds: photoId ? [photoId] : [],
    generatedAt: Date.now(),
  };
  d.prepare("INSERT OR REPLACE INTO saved_cards (player_id, json, saved_at) VALUES (?,?,?)").run(p.id, JSON.stringify(card), Date.now());
}
