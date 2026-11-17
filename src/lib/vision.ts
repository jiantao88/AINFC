import { createHash } from "node:crypto";
import sharp from "sharp";
import { llmConfig } from "./config";
import { readMedia } from "./media";
import type { PhotoReading } from "./types";

export type { PhotoReading };

const PROMPT = `这是一张越野跑赛事照片。请只描述画面里肉眼可见的内容,返回 JSON:
{"scene":"场景(地形、植被、光线、季节线索)","people":"人物数量和可见的动作、穿着、表情","gear":"可见的装备或物品(号码布、奖牌等,能读出文字请原样写出)","mood":"画面传达的整体氛围,仅依据可见的表情、光线、动作","uncertain":["看不清或无法确定的内容"]}
规则:不要推断照片之外的事(天气预报、姓名、名次、人物关系、心理活动);看不清就写进 uncertain。`;

/** 缩到长边 1024 的 JPEG:体积从约 3MB 降到约 200KB,识别质量够用,耗时和费用明显更低 */
export async function shrink(buf: Buffer): Promise<Buffer> {
  return sharp(buf).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}

function str(v: unknown, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function parseReading(text: string): PhotoReading | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const r: PhotoReading = {
      scene: str(o.scene),
      people: str(o.people),
      gear: str(o.gear),
      mood: str(o.mood),
      uncertain: Array.isArray(o.uncertain) ? o.uncertain.map((x) => str(x, 80)).filter(Boolean).slice(0, 6) : [],
    };
    return r.scene || r.people ? r : null;
  } catch {
    return null;
  }
}

export async function readPhoto(
  buf: Buffer,
  opts: { fetchImpl?: typeof fetch; retryDelayMs?: number } = {},
): Promise<{ ok: true; reading: PhotoReading } | { ok: false; error: string }> {
  const cfg = llmConfig();
  if (!cfg.key) return { ok: false, error: "未配置大模型" };
  const doFetch = opts.fetchImpl ?? fetch;
  const delay = opts.retryDelayMs ?? 800;
  let small: Buffer;
  try {
    small = await shrink(buf);
  } catch {
    return { ok: false, error: "照片无法读取" };
  }
  const payload = JSON.stringify({
    model: cfg.visionModel,
    temperature: 0.2,
    max_tokens: 700,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${small.toString("base64")}` } },
        ],
      },
    ],
  });

  // 中转服务偶发网络错误、限流(429)或 5xx:最多尝试 3 次。其他 4xx 重试没有意义
  let error = "识别失败";
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, delay * (attempt - 1)));
    try {
      const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        error = `识别服务返回 ${res.status}`;
        console.error(`readPhoto 第 ${attempt} 次失败:HTTP ${res.status}`);
        if (res.status === 429 || res.status >= 500) continue;
        return { ok: false, error };
      }
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const reading = parseReading(body.choices?.[0]?.message?.content ?? "");
      if (reading) return { ok: true, reading };
      error = "识别结果无法解析";
      console.error(`readPhoto 第 ${attempt} 次失败:结果无法解析`);
    } catch (e) {
      const cause = e instanceof Error ? (e.cause as { code?: string; message?: string } | undefined) : undefined;
      error = e instanceof Error && e.name === "TimeoutError" ? "识别超时" : "识别失败";
      console.error(`readPhoto 第 ${attempt} 次失败:`, e instanceof Error ? `${e.name}: ${e.message}` : e, cause?.code ?? cause?.message ?? "");
    }
  }
  return { ok: false, error };
}

export const photoHash = (buf: Buffer) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

/** 读取已入库的照片并识别。读不到文件时返回错误而不是抛出 */
export async function readStoredPhoto(rel: string | null) {
  const buf = rel ? readMedia(rel) : null;
  if (!buf) return { ok: false as const, error: "照片文件丢失" };
  return readPhoto(buf);
}

/** 把照片识别结果合成一段文字,供游记引用和事实校验使用 */
export function readingText(r: PhotoReading): string {
  return [r.scene, r.people, r.gear, r.mood].filter(Boolean).join("。");
}
