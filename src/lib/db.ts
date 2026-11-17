import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "./config";
import { seedIfEmpty } from "./seed";
import type { MaterialKind, Status } from "./types";

export type Param = string | number | null;

export interface PlayerRow {
  id: string;
  event_id: string;
  name: string;
  bib: string;
  status: Status;
  claimed_at: number | null;
}

export interface MaterialRow {
  id: string;
  player_id: string;
  kind: MaterialKind;
  filename: string;
  mime: string | null;
  size: number;
  path: string | null;
  meta: string | null;
  created_at: number;
  hidden: number;
}

export interface JobRow {
  id: string;
  player_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  steps: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, bib TEXT NOT NULL,
  status TEXT NOT NULL, claimed_at INTEGER);
CREATE TABLE IF NOT EXISTS tags (code TEXT PRIMARY KEY, player_id TEXT NOT NULL, kind TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS claim_attempts (
  player_id TEXT PRIMARY KEY, fails INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, kind TEXT NOT NULL, filename TEXT NOT NULL,
  mime TEXT, size INTEGER NOT NULL, path TEXT, meta TEXT, created_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_materials_player ON materials(player_id);
CREATE TABLE IF NOT EXISTS scores (player_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ocr (player_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, status TEXT NOT NULL, steps TEXT NOT NULL,
  error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS previews (
  player_id TEXT PRIMARY KEY, json TEXT NOT NULL, job_id TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS saved_cards (player_id TEXT PRIMARY KEY, json TEXT NOT NULL, saved_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS faults (player_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (player_id, kind));
`;

const g = globalThis as unknown as { __ainfcDb?: { db: DatabaseSync; dir: string } };

export function db(): DatabaseSync {
  const dir = dataDir();
  if (g.__ainfcDb && g.__ainfcDb.dir === dir) return g.__ainfcDb.db;
  closeDb();
  fs.mkdirSync(dir, { recursive: true });
  const d = new DatabaseSync(path.join(dir, "ainfc.db"));
  d.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  d.exec(SCHEMA);
  g.__ainfcDb = { db: d, dir };
  recoverStuckJobs(d);
  seedIfEmpty();
  return d;
}

export function closeDb() {
  try {
    g.__ainfcDb?.db.close();
  } catch {}
  g.__ainfcDb = undefined;
}

/** 服务重启后,仍标记为运行中的任务不可能还在跑:标记失败,选手回到草稿,素材保留 */
function recoverStuckJobs(d: DatabaseSync) {
  d.prepare(
    "UPDATE jobs SET status='failed', error='服务重启,任务中断。素材已保留,请重试', updated_at=? WHERE status IN ('queued','running')",
  ).run(Date.now());
  d.prepare(
    "UPDATE players SET status = CASE WHEN EXISTS (SELECT 1 FROM saved_cards WHERE saved_cards.player_id = players.id) THEN 'saved' ELSE 'draft' END WHERE status='generating'",
  ).run();
}

export const one = <T>(sql: string, ...p: Param[]) => db().prepare(sql).get(...p) as T | undefined;
export const all = <T>(sql: string, ...p: Param[]) => db().prepare(sql).all(...p) as T[];
export const run = (sql: string, ...p: Param[]) => db().prepare(sql).run(...p);

export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
