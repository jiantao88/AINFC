import fs from "node:fs";
import path from "node:path";
import { del, get, put } from "@vercel/blob";
import { cloudMedia, dataDir, FIXTURES_DIR } from "./config";

export function sniffImage(buf: Buffer): { mime: string; ext: string } | null {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(png)) return { mime: "image/png", ext: "png" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return { mime: "image/webp", ext: "webp" };
  return null;
}

const mediaRoot = () => path.join(dataDir(), "media");

/** 只接受 saveMedia 返回的相对路径,防止路径穿越 */
export function mediaPath(rel: string): string {
  const bundled = rel.startsWith("fixture:");
  const root = bundled ? FIXTURES_DIR : mediaRoot();
  const abs = path.resolve(root, bundled ? rel.slice("fixture:".length) : rel);
  if (!abs.startsWith(root + path.sep)) throw new Error("非法媒体路径");
  return abs;
}

/** 相对路径用字符串拼接而非 path.join,避免打包器把它当成对整个项目的动态文件访问 */
export async function saveMedia(playerId: string, id: string, ext: string, buf: Buffer): Promise<string> {
  const rel = `${playerId}/${id}.${ext}`;
  if (cloudMedia()) {
    await put(rel, buf, { access: "private", addRandomSuffix: false, cacheControlMaxAge: 60 });
    return `blob:${rel}`;
  }
  const abs = mediaPath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return rel;
}

function readLocalMedia(rel: string): Buffer | null {
  try {
    return fs.readFileSync(mediaPath(rel));
  } catch {
    return null;
  }
}

export async function readMedia(rel: string): Promise<Buffer | null> {
  if (!rel.startsWith("blob:")) return readLocalMedia(rel);
  const result = await get(rel.slice(5), { access: "private" });
  if (result?.statusCode !== 200) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

export async function mediaBody(rel: string): Promise<BodyInit | null> {
  if (rel.startsWith("blob:")) {
    const result = await get(rel.slice(5), { access: "private" });
    return result?.statusCode === 200 ? result.stream : null;
  }
  const buf = readLocalMedia(rel);
  return buf ? new Uint8Array(buf) : null;
}

export const mediaExists = (rel: string) => rel.startsWith("blob:") || fs.existsSync(mediaPath(rel));

export async function removeMedia(rel: string | null) {
  if (!rel || rel.startsWith("fixture:")) return;
  try {
    if (rel.startsWith("blob:")) await del(rel.slice(5));
    else fs.rmSync(mediaPath(rel), { force: true });
  } catch (error) {
    console.error("删除素材文件失败", error instanceof Error ? error.name : "unknown");
  }
}

/** 展示用文件名:去掉路径和控制字符,限制长度 */
export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || "未命名";
}
