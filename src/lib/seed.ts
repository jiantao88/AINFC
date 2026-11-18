import fs from "node:fs";
import path from "node:path";
import { cloudDatabase, FIXTURES_DIR, hosted } from "./config";
import { one, run, tx } from "./db";
import { newId, sha256, tagCodeFor } from "./secret";
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
    journal?: Pick<NonNullable<Card["journal"]>, "title" | "body">;
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

/** 把测试数据包里的一个文件作为素材写入某选手名下。文件缺失时返回 null,不抛错。
 *  rel 可以是相对 docs/demo-fixtures 的路径,也可以是绝对路径(如 docs/demo-assets 下的素材) */
export async function attachFixtureFile(
  playerId: string,
  kind: "photo" | "route" | "score_image",
  rel: string,
): Promise<string | null> {
  const file = path.isAbsolute(rel) ? rel : fixturePath(rel);
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  const relative = path.relative(FIXTURES_DIR, file);
  const bundled = hosted || !!cloudDatabase();
  const id = bundled ? sha256(JSON.stringify([playerId, kind, relative])).slice(0, 24) : newId();
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
  const relPath = bundled ? `fixture:${relative}` : await saveMedia(playerId, id, ext, buf);
  await run(
    "INSERT OR IGNORE INTO materials (id, player_id, kind, filename, mime, size, path, meta, created_at, hidden) VALUES (?,?,?,?,?,?,?,?,?,0)",
    id, playerId, kind, path.basename(rel), mime, buf.length, relPath, meta, now,
  );
  return id;
}

export async function seedIfEmpty() {
  if (await one("SELECT 1 FROM players LIMIT 1")) return;
  await seedAll();
}

/** 按 players.json 重建三名选手;事件和标签一并重置 */
export async function seedAll() {
  const event = loadFixtureEvent();
  await tx(async () => {
    await run("INSERT OR REPLACE INTO events (id, json) VALUES (?, ?)", event.id, JSON.stringify(event));
    for (const p of loadFixturePlayers()) await seedPlayer(p, event);
  });
}

async function seedPlayer(p: FixturePlayer, event: EventConfig) {
  await run("INSERT OR REPLACE INTO players (id, event_id, name, bib, status, claimed_at) VALUES (?,?,?,?,?,?)",
    p.id,
    p.eventId,
    p.name,
    p.bib,
    p.status,
    p.ownerId ? Date.now() : null,
  );
  for (const kind of ["medal", "bib"] as const) {
    await run("INSERT OR REPLACE INTO tags (code, player_id, kind) VALUES (?,?,?)", tagCodeFor(p.id, kind), p.id, kind);
  }

  const { savedCard } = p;
  if (p.status !== "saved" || !savedCard || !p.score) return;

  const photos: { file: string; id: string }[] = [];
  for (const file of new Set(p.materials.photos)) {
    const id = await attachFixtureFile(p.id, "photo", file);
    if (id) photos.push({ file, id });
  }
  const routeId = p.materials.route ? await attachFixtureFile(p.id, "route", p.materials.route) : null;
  if (p.materials.scoreImage) await attachFixtureFile(p.id, "score_image", p.materials.scoreImage);

  const group = event.groups.find((g) => g.id === p.score!.groupId);
  const score: Score = {
    elapsedTime: p.score.elapsedTime,
    groupId: p.score.groupId,
    groupName: group?.name ?? p.score.groupName,
    groupRank: p.score.groupRank,
    source: "demo_seed",
    confirmedAt: Date.now(),
  };
  await run("INSERT OR REPLACE INTO scores (player_id, json) VALUES (?, ?)", p.id, JSON.stringify(score));

  let route: Card["route"] = null;
  if (routeId) {
    const row = await one<{ meta: string | null }>("SELECT meta FROM materials WHERE id=?", routeId);
    const meta = row?.meta ? JSON.parse(row.meta) : null;
    if (meta?.points) route = { kind: "reference", points: meta.points };
  }

  const card: Card = {
    version: 1,
    title: savedCard.title,
    text: savedCard.text,
    textSource: "fixture",
    ...(savedCard.journal ? { journal: { ...savedCard.journal, source: "fixture" } } : {}),
    event: { name: event.name, date: event.date, isPlaceholder: event.isPlaceholder },
    player: { name: p.name, bib: p.bib },
    score: { elapsedTime: score.elapsedTime, groupName: score.groupName, groupRank: score.groupRank, source: score.source },
    route,
    coverMaterialId: photos.find((photo) => photo.file === savedCard.cover)?.id ?? photos[0]?.id ?? null,
    photoIds: photos.map((photo) => photo.id),
    generatedAt: Date.now(),
  };
  await run("INSERT OR REPLACE INTO saved_cards (player_id, json, saved_at) VALUES (?,?,?)", p.id, JSON.stringify(card), Date.now());
}
