import { guarded, err, json } from "@/lib/api";
import { cloudMedia, LIMITS } from "@/lib/config";
import { downsample, parseGpx } from "@/lib/gpx";
import { cleanName, readMedia, removeMedia, saveMedia, sniffImage } from "@/lib/media";
import { getMaterial, getPlayer, listMaterials } from "@/lib/players";
import { faultFor } from "@/lib/agent";
import { newId } from "@/lib/secret";
import { pendingPath, prepareUpload, readUploadTicket, registerMaterial, uploadLimit, validMaterialKind } from "@/lib/upload";
import type { MaterialKind } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function checkedSize(kind: MaterialKind, size: unknown) {
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) return err(400, "文件是空的");
  const max = uploadLimit(kind);
  if (size > max) {
    const mb = (n: number) => `${Math.round((n / 1048576) * 10) / 10} MB`;
    return err(413, `文件太大(${mb(size)}),上限 ${mb(max)}。其他素材不受影响`, { code: "too_large" });
  }
  return null;
}

async function saveUpload(pid: string, kind: MaterialKind, name: string, buf: Buffer, id = newId()) {
  const image = sniffImage(buf);
  let mime: string;
  let extension: string;
  let meta: string | null = null;
  let note: string | undefined;
  if (kind === "route" && !image) {
    const parsed = parseGpx(buf);
    if (!parsed.ok) return err(422, parsed.message, { code: parsed.code });
    mime = "application/gpx+xml";
    extension = "gpx";
    meta = JSON.stringify({ kind: "personal", points: downsample(parsed.points), stats: parsed.stats });
    note = parsed.stats.durationSec == null ? "轨迹已解析,文件没有时间信息,不显示用时" : "轨迹已解析";
  } else {
    if (!image) return err(415, "只支持 PNG、JPG、WebP 图片", { code: "bad_type" });
    mime = image.mime;
    extension = image.ext;
    if (kind === "route") {
      meta = JSON.stringify({ kind: "screenshot" });
      note = "已作为轨迹截图展示,不会还原精确轨迹";
    }
  }

  // 每次尝试拥有自己的对象路径。重复提交同一票据只会留下已入库的对象。
  const path = await saveMedia(pid, newId(), extension, buf);
  const result = await registerMaterial(pid, { id, kind, name, mime, size: buf.length, path, meta });
  if (result.status !== 200) return err(result.status, result.error, { code: "code" in result ? result.code : undefined });
  return json({ ok: true, id, note });
}

async function handleDirectUpload(req: Request, pid: string) {
  if (!cloudMedia()) return err(404, "not found");
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(400, "上传内容无法读取");
  }
  if (body?.action === "prepare") {
    const { kind, size, name } = body;
    if (!validMaterialKind(kind) || typeof name !== "string" || typeof size !== "number") return err(400, "素材信息无效");
    const invalid = checkedSize(kind, size);
    if (invalid) return invalid;
    if (kind === "photo" && (await listMaterials(pid, "photo")).length >= LIMITS.maxPhotos) {
      return err(400, `照片最多 ${LIMITS.maxPhotos} 张`, { code: "too_many" });
    }
    return json(await prepareUpload(pid, kind, name, size));
  }
  if (body?.action === "finish") {
    const ticket = readUploadTicket(body.ticket, pid);
    if (!ticket) return err(400, "上传凭证已失效，请重新上传", { code: "upload_expired" });
    if (await getMaterial(pid, ticket.id)) return json({ ok: true, id: ticket.id });
    const staged = `blob:${pendingPath(pid, ticket.id)}`;
    const buf = await readMedia(staged);
    if (!buf || buf.length !== ticket.size) return err(400, "素材未完整上传，请重试", { code: "upload_expired" });
    const result = await saveUpload(pid, ticket.kind, ticket.name, buf, ticket.id);
    if (result.ok || result.status === 415 || result.status === 422) await removeMedia(staged);
    return result;
  }
  return err(400, "未知上传操作");
}

/** 单个素材上传。失败只影响这一个文件,已上传的其他素材不受影响 */
export const POST = guarded(async (req, pid) => {
  const player = await getPlayer(pid);
  if (!player) return err(404, "not found");
  if (player.status === "generating") return err(409, "正在生成中,暂时不能修改素材");
  if (await faultFor(pid, "upload_fail")) return err(500, "演示注入:上传失败,请重试");
  if (req.headers.get("content-type")?.startsWith("application/json")) return handleDirectUpload(req, pid);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err(400, "上传内容无法读取");
  }

  const kind = form.get("kind");
  const file = form.get("file");
  if (!validMaterialKind(kind)) return err(400, "未知的素材类型");
  if (!(file instanceof File)) return err(400, "缺少文件");
  const invalid = checkedSize(kind, file.size);
  if (invalid) return invalid;
  return saveUpload(pid, kind, cleanName(file.name), Buffer.from(await file.arrayBuffer()));
});
