import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { pathToFileURL } from "node:url";
import { createClient, type Client, type Transaction } from "@libsql/client";
import { cloudDatabase, dataDir, hosted, readOnlyDemo } from "./config";
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
CREATE TABLE IF NOT EXISTS moments (
  player_id TEXT PRIMARY KEY, text TEXT NOT NULL, drafted_by_ai INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS readings (
  material_id TEXT PRIMARY KEY, player_id TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS faults (player_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (player_id, kind));
`;

interface Connection {
  client: Client;
  remote: boolean;
  ready: Promise<void>;
  tail: Promise<void>;
}

const transaction = new AsyncLocalStorage<Transaction>();
let connection: (Connection & { url: string }) | undefined;

function database(): Connection {
  const remote = !readOnlyDemo() ? cloudDatabase() : null;
  const url = remote?.url ?? (hosted ? "file::memory:" : pathToFileURL(path.join(dataDir(), "ainfc.db")).href);
  if (connection?.url === url) return connection;
  if (!remote && !hosted) fs.mkdirSync(dataDir(), { recursive: true });
  const client = createClient({ url, authToken: remote?.authToken, concurrency: remote ? 16 : 1 });
  const ready = initialize(client, !!remote).catch((error) => {
    if (connection?.client === client) connection = undefined;
    client.close();
    throw error;
  });
  connection = { url, client, remote: !!remote, ready, tail: Promise.resolve() };
  return connection;
}

async function initialize(client: Client, remote: boolean) {
  if (!remote) await client.executeMultiple("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  await client.executeMultiple(SCHEMA);
  // 远程函数冷启动时其他实例可能还在跑任务，不能按本机重启处理。
  if (!remote) {
    await inTransaction(client, async () => {
      await run(
        "UPDATE jobs SET status='failed', error='服务重启,任务中断。素材已保留,请重试', updated_at=? WHERE status IN ('queued','running')",
        Date.now(),
      );
      await run(
        "UPDATE players SET status = CASE WHEN EXISTS (SELECT 1 FROM saved_cards WHERE saved_cards.player_id = players.id) THEN 'saved' ELSE 'draft' END WHERE status='generating'",
      );
    });
  }
  if (!await client.execute("SELECT 1 FROM players LIMIT 1").then((r) => r.rows.length)) {
    await inTransaction(client, seedIfEmpty);
  }
}

async function withConnection<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const conn = database();
  await conn.ready;
  if (conn.remote) return fn(conn.client);
  // 本地单连接需要将普通查询排在打开的事务之后。
  const previous = conn.tail;
  let release!: () => void;
  conn.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await fn(conn.client);
  } finally {
    release();
  }
}

export function run(sql: string, ...args: Param[]) {
  const active = transaction.getStore();
  return active ? active.execute({ sql, args }) : withConnection((client) => client.execute({ sql, args }));
}

export async function all<T>(sql: string, ...params: Param[]): Promise<T[]> {
  return (await run(sql, ...params)).rows as T[];
}

export async function one<T>(sql: string, ...params: Param[]): Promise<T | undefined> {
  return (await all<T>(sql, ...params))[0];
}

async function inTransaction<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  const writer = await client.transaction("write");
  try {
    const result = await transaction.run(writer, fn);
    await writer.commit();
    return result;
  } finally {
    writer.close();
  }
}

export function tx<T>(fn: () => Promise<T>): Promise<T> {
  return transaction.getStore() ? fn() : withConnection((client) => inTransaction(client, fn));
}
