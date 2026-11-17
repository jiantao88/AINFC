import { llmConfig } from "./config";
import type { OcrResult } from "./types";

const PROMPT = `这是一张越野赛事成绩单截图。只提取图中明确出现的字段,返回 JSON:
{"name":字符串或null,"bib":字符串或null,"group":字符串或null,"elapsedTime":"HH:MM:SS"或null,"groupRank":整数或null,"confidence":"high|medium|low"}
规则:图中没有出现的字段必须为 null,不要猜测或编造;看不清也返回 null。只返回 JSON。`;

const TIME_RE = /^\d{1,2}:[0-5]\d:[0-5]\d$/;

export function normalizeTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!TIME_RE.test(s)) return null;
  const [h, m, sec] = s.split(":");
  return `${h.padStart(2, "0")}:${m}:${sec}`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : null;
}

export function parseOcrJson(text: string): Omit<OcrResult, "at"> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const rank = typeof o.groupRank === "number" && Number.isInteger(o.groupRank) && o.groupRank > 0 ? o.groupRank : null;
  const conf = o.confidence === "high" || o.confidence === "medium" || o.confidence === "low" ? o.confidence : null;
  return {
    name: str(o.name),
    bib: str(o.bib),
    group: str(o.group),
    elapsedTime: normalizeTime(o.elapsedTime),
    groupRank: rank,
    confidence: conf,
  };
}

/** 识别成绩截图。结果只作预填,用户核对确认前不当作成绩 */
export async function recognizeScore(
  image: Buffer,
  mime: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<OcrResult> {
  const cfg = llmConfig();
  const at = Date.now();
  const fail = (error: string): OcrResult => ({
    name: null,
    bib: null,
    group: null,
    elapsedTime: null,
    groupRank: null,
    confidence: null,
    at,
    error,
  });
  if (!cfg.key) return fail("未配置大模型,请手动填写成绩");
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.visionModel,
        temperature: 0,
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: `data:${mime};base64,${image.toString("base64")}` } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return fail(`识别服务返回 ${res.status},请手动填写成绩`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = parseOcrJson(body.choices?.[0]?.message?.content ?? "");
    if (!parsed) return fail("识别结果无法解析,请手动填写成绩");
    return { ...parsed, at };
  } catch (e) {
    const name = e instanceof Error ? e.name : "error";
    return fail(name === "TimeoutError" ? "识别超时,请重试或手动填写成绩" : "识别失败,请重试或手动填写成绩");
  }
}
