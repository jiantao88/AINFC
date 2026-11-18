import { createHmac } from "node:crypto";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { LIMITS } from "./config";
import { run, tx } from "./db";
import { cleanName, removeMedia } from "./media";
import { getMaterial, getPlayer, listMaterials, reconcileAfterMaterialChange, removeMaterialRow } from "./players";
import { newId, safeEqual, secret } from "./secret";
import type { MaterialKind } from "./types";

interface UploadTicket {
  id: string;
  pid: string;
  kind: MaterialKind;
  name: string;
  size: number;
  expires: number;
}

export function validMaterialKind(kind: unknown): kind is MaterialKind {
  return kind === "photo" || kind === "route" || kind === "score_image";
}

export function uploadLimit(kind: MaterialKind) {
  return kind === "route" ? LIMITS.gpxMaxBytes : LIMITS.imageMaxBytes;
}

const signTicket = (payload: string) => createHmac("sha256", secret()).update("upload:" + payload).digest("base64url");

export const pendingPath = (pid: string, id: string) => `pending/${pid}/${id}`;

export async function prepareUpload(pid: string, kind: MaterialKind, name: string, size: number) {
  const id = newId();
  const expires = Date.now() + 30 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ id, pid, kind, name: cleanName(name), size, expires } satisfies UploadTicket)).toString("base64url");
  const pathname = pendingPath(pid, id);
  const token = await generateClientTokenFromReadWriteToken({
    pathname,
    maximumSizeInBytes: size,
    allowedContentTypes: ["application/octet-stream"],
    validUntil: expires,
    allowOverwrite: false,
    addRandomSuffix: false,
    ttlDays: 1,
  });
  return { pathname, token, ticket: `${payload}.${signTicket(payload)}` };
}

export function readUploadTicket(ticket: unknown, pid: string): UploadTicket | null {
  if (typeof ticket !== "string" || ticket.length > 2048) return null;
  const [payload, signature, extra] = ticket.split(".");
  if (!payload || !signature || extra !== undefined || !safeEqual(signature, signTicket(payload))) return null;
  const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UploadTicket;
  return value.pid === pid && value.expires > Date.now() ? value : null;
}

interface IncomingMaterial {
  id: string;
  kind: MaterialKind;
  name: string;
  mime: string;
  size: number;
  path: string;
  meta: string | null;
}

export async function registerMaterial(pid: string, material: IncomingMaterial) {
  const result = await tx(async () => {
    const player = await getPlayer(pid);
    if (!player) return { status: 404, error: "选手不存在" } as const;
    if (await getMaterial(pid, material.id)) return { status: 200, existing: true, removed: [] } as const;
    if (player.status === "generating") return { status: 409, error: "正在生成中,暂时不能修改素材" } as const;

    const matches = await listMaterials(pid, material.kind);
    if (material.kind === "photo" && matches.length >= LIMITS.maxPhotos) {
      return { status: 400, error: `照片最多 ${LIMITS.maxPhotos} 张`, code: "too_many" } as const;
    }

    const removed: (string | null)[] = [];
    if (material.kind !== "photo") {
      for (const previous of matches) removed.push(await removeMaterialRow(pid, previous));
      if (material.kind === "score_image") await run("DELETE FROM ocr WHERE player_id=?", pid);
    }
    await run(
      "INSERT INTO materials (id, player_id, kind, filename, mime, size, path, meta, created_at, hidden) VALUES (?,?,?,?,?,?,?,?,?,0)",
      material.id, pid, material.kind, material.name, material.mime, material.size, material.path, material.meta, Date.now(),
    );
    await reconcileAfterMaterialChange(pid);
    return { status: 200, existing: false, removed } as const;
  });
  if (result.status !== 200 || result.existing) await removeMedia(material.path);
  if (result.status === 200) await Promise.all(result.removed.map(removeMedia));
  return result;
}
