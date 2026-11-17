import { llmConfig } from "./config";
import type { Card } from "./types";

/** 供 LLM 使用的事实。只含用户确认过的字段,不含姓名号码以外的个人信息 */
export interface Facts {
  eventName: string;
  eventDate: string;
  group: string | null;
  elapsedTime: string | null;
  groupRank: number | null;
  distanceKm: number | null;
  ascentM: number | null;
  photoCount: number;
  routeKind: "personal" | "reference" | "screenshot" | null;
}

export function factsFromCard(card: Pick<Card, "event" | "score" | "route" | "photoIds">): Facts {
  const r = card.route;
  const stats = r?.kind === "personal" ? r.stats : null;
  return {
    eventName: card.event.name,
    eventDate: card.event.date,
    group: card.score?.groupName ?? null,
    elapsedTime: card.score?.elapsedTime ?? null,
    groupRank: card.score?.groupRank ?? null,
    // 参考路线不是选手实际行走记录,距离和爬升不作为选手事实交给文案
    distanceKm: stats?.distanceKm ?? null,
    ascentM: stats?.ascentM ?? null,
    photoCount: card.photoIds.length,
    routeKind: r?.kind ?? null,
  };
}

/** 无需模型的固定文案,只陈述事实。模型不可用或校验不过时使用 */
export function templateText(f: Facts): string {
  const parts = [`${f.eventDate},参加了${f.eventName}`];
  if (f.group) parts[0] += `(${f.group})`;
  parts[0] += "。";
  if (f.elapsedTime) {
    let s = `完赛用时 ${f.elapsedTime}`;
    if (f.groupRank != null) s += `,组别第 ${f.groupRank} 名`;
    parts.push(s + "。");
  }
  if (f.distanceKm != null) {
    let s = `轨迹记录 ${f.distanceKm} 公里`;
    if (f.ascentM != null) s += `,累计爬升约 ${f.ascentM} 米`;
    parts.push(s + "。");
  }
  if (f.photoCount > 0) parts.push(`留下了 ${f.photoCount} 张照片。`);
  return parts.join("");
}

/**
 * 不得编造的事实类内容。心情、感受不在此列(游记允许写情绪)。
 * 这些词只有在选手自己写的话或照片识别结果里出现过,才允许出现在文案里。
 */
const FORBIDDEN: { re: RegExp; why: string; grounded: boolean }[] = [
  { re: /受伤|扭伤|拉伤|抽筋|摔倒|摔了|跌倒|崴|磨破|水泡|疼|痛|伤痛/g, why: "伤病", grounded: true },
  { re: /天气|下雨|雨|雪|晴|阴天|大风|高温|寒冷|炎热|冷风|烈日|雾|气温/g, why: "天气", grounded: true },
  { re: /遇到|碰到|偶遇|迷路|补给站|休息了|停下|家人|欢呼|加油声|观众/g, why: "沿途事件或人物", grounded: true },
  { re: /官方认证|官方成绩|破纪录|第一名|冠军|夺冠|PB|个人最好/g, why: "未经确认的成绩表述", grounded: false },
  { re: /配速|每公里|km\/h|公里每小时/g, why: "配速", grounded: false },
];

const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 把 "十二""四十二""三""一百零五" 这类 1~999 的中文数字转成阿拉伯数字,其余原样保留 */
function cnToArabic(text: string): string {
  return text.replace(/[零〇一二两三四五六七八九十百]+/g, (m) => {
    if (m === "十" || /^[零〇]+$/.test(m)) return m === "十" ? "10" : "0";
    let total = 0;
    let cur = 0;
    let seenUnit = false;
    for (const ch of m) {
      if (ch === "百") {
        total += (cur || 1) * 100;
        cur = 0;
        seenUnit = true;
      } else if (ch === "十") {
        total += (cur || 1) * 10;
        cur = 0;
        seenUnit = true;
      } else if (ch in CN_DIGIT) cur = cur * (seenUnit ? 1 : 10) + CN_DIGIT[ch];
      else return m;
    }
    return String(total + cur);
  });
}

export type TextCheck = { ok: true } | { ok: false; reasons: string[] };

export interface CheckOptions {
  min?: number;
  max?: number;
  /** 选手自己写的话 + 照片识别结果。其中出现过的内容,允许被引用 */
  sources?: string;
}

export function checkText(text: string, f: Facts, opts: CheckOptions = {}): TextCheck {
  const reasons: string[] = [];
  const t = text.trim();
  const sources = opts.sources ?? "";
  if (t.length < (opts.min ?? 20)) reasons.push("文案过短");
  if (t.length > (opts.max ?? 160)) reasons.push("文案过长");

  // 允许原样引用确认过的事实里的字(如赛事名里含"雪")
  const stripped = t.split(f.eventName).join("");
  for (const { re, why, grounded } of FORBIDDEN) {
    const hits = [...stripped.matchAll(re)].map((m) => m[0]);
    const bad = grounded ? hits.filter((h) => !sources.includes(h)) : hits;
    if (bad.length) reasons.push(`含${why}类内容:${[...new Set(bad)].join("、")}`);
  }

  // 文案里出现的每个数字必须来自事实。先把中文数字和"X小时Y分Z秒"统一成阿拉伯数字再核对
  const allowed = new Set<string>();
  const addNums = (v: string | number | null) => {
    if (v == null) return;
    for (const m of String(v).match(/\d+(?:\.\d+)?/g) ?? []) {
      allowed.add(m);
      allowed.add(String(Number(m)));
    }
  };
  addNums(f.eventDate);
  addNums(f.elapsedTime);
  addNums(f.groupRank);
  addNums(f.distanceKm);
  addNums(f.ascentM);
  addNums(f.photoCount);
  addNums(f.eventName);
  addNums(f.group);
  addNums(sources || null);
  const normalized = cnToArabic(t);
  const seen = normalized.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const n of seen) {
    if (!allowed.has(n) && !allowed.has(String(Number(n)))) reasons.push(`出现未提供的数字 ${n}`);
  }

  // 时长表述("X小时Y分Z秒")必须和确认的用时一致,不能只靠数字白名单(3 可能碰巧是照片张数)
  const dur = /(\d+)\s*小时(?:\s*(\d+)\s*分(?:钟)?)?(?:\s*(\d+)\s*秒)?|(\d+)\s*分(?:钟)?(?:\s*(\d+)\s*秒)?/g;
  for (const m of normalized.matchAll(dur)) {
    const h = Number(m[1] ?? 0);
    const mi = Number(m[1] != null ? (m[2] ?? 0) : (m[4] ?? 0));
    const sec = Number(m[1] != null ? (m[3] ?? 0) : (m[5] ?? 0));
    if (f.elapsedTime == null) {
      reasons.push("没有成绩却提到时长");
      break;
    }
    const [eh, em, es] = f.elapsedTime.split(":").map(Number);
    const given = h * 3600 + mi * 60 + sec;
    const real = eh * 3600 + em * 60 + es;
    // 只写到分钟(不写秒)时允许四舍五入以内的误差;写到秒必须精确
    const hasSec = m[1] != null ? m[3] != null : m[5] != null;
    const ok = hasSec ? given === real : Math.abs(given - real) < 60 || (m[1] != null && m[2] == null && Math.abs(given - real) < 3600);
    if (!ok) reasons.push(`时长表述 ${m[0].trim()} 与确认的用时 ${f.elapsedTime} 不一致`);
  }

  // 参考路线不是选手的实际行走记录,不能写成选手完成、跑过、经过
  if (f.routeKind !== "personal") {
    if (/(完成|跑完|走完|走过|跑过|穿越|翻越|途经|经过|抵达|登顶|征服|挑战了?).{0,6}(路线|赛道|香植线|香山|植物园)/.test(t)) {
      reasons.push("把参考路线写成了选手的实际经历");
    }
  }

  // 没有排名/成绩时,不能出现名次或用时的表述
  if (f.groupRank == null && /第\s*\d+\s*名|名次|排名/.test(t)) reasons.push("没有排名却提到名次");
  if (f.elapsedTime == null && /用时|完赛时间|成绩/.test(t)) reasons.push("没有成绩却提到用时");
  if (f.distanceKm == null && /公里|千米|爬升/.test(t)) reasons.push("没有个人轨迹却提到距离或爬升");

  return reasons.length ? { ok: false, reasons: [...new Set(reasons)] } : { ok: true };
}

function systemPrompt() {
  return `你为越野赛事完赛卡片写一段简短的回忆文案。
只能使用"事实"里给出的内容。严格遵守:
- 40 到 100 个汉字,一段话,不用列表、标题或表情。
- 只陈述事实,语气平实克制。
- 不得补写或暗示:伤病、天气、心情感受、沿途遇到的人和事、同伴、补给、配速、与他人比较。
- 数字必须与事实完全一致,原样引用,不得取整、四舍五入或用"约、近、大概"改写(9.95 公里就写 9.95 公里,不能写 10 公里)。
- 不得出现事实里没有的数字、名次、用时。事实里为 null 的内容一律不提。
- 不要说"官方认证"。
只输出文案本身。`;
}

export interface TextOutcome {
  text: string;
  source: "llm" | "template";
  note?: string;
}

/** 生成文案:最多请求模型两次,仍不通过则使用固定模板 */
export async function writeText(
  f: Facts,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal; forceError?: boolean } = {},
): Promise<TextOutcome> {
  const cfg = llmConfig();
  const fallback = (note: string): TextOutcome => ({ text: templateText(f), source: "template", note });
  if (!cfg.key) return fallback("未配置大模型,使用固定模板文案");
  if (opts.forceError) return fallback("模型调用失败(演示注入),使用固定模板文案");

  const doFetch = opts.fetchImpl ?? fetch;
  let lastReasons: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const hint = lastReasons.length ? `\n上一版不合格:${lastReasons.join(";")}。请重写。` : "";
      const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.4,
          max_tokens: 300,
          messages: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: `事实:\n${JSON.stringify(f, null, 2)}${hint}` },
          ],
        }),
        signal: opts.signal ?? AbortSignal.timeout(60_000),
      });
      if (!res.ok) return fallback(`模型返回 ${res.status},使用固定模板文案`);
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = (body.choices?.[0]?.message?.content ?? "").trim().replace(/^["“]|["”]$/g, "");
      const check = checkText(text, f);
      if (check.ok) return { text, source: "llm" };
      lastReasons = check.reasons;
    } catch (e) {
      // 记录真实原因(含底层网络错误码),界面只显示简短说明
      const cause = e instanceof Error ? (e.cause as { code?: string; message?: string } | undefined) : undefined;
      console.error("writeText 失败:", e instanceof Error ? `${e.name}: ${e.message}` : e, cause?.code ?? cause?.message ?? "");
      if (attempt === 0) continue; // 偶发的网络错误再试一次
      return fallback(`模型调用失败(${e instanceof Error ? e.name : "error"}),使用固定模板文案`);
    }
  }
  return fallback(`模型文案两次未通过校验(${lastReasons.join("、")}),使用固定模板文案`);
}
