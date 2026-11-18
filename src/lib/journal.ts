import { llmConfig } from "./config";
import { normalizeJournalBody, stripMarkers } from "./journal-blocks";
import { checkText, type Facts } from "./text";
import type { PhotoReading } from "./types";
import { readingText } from "./vision";

export interface JournalInput {
  facts: Facts;
  /** 选手自己写的话。游记里的感受、细节、人物都应以它为主要来源 */
  moment: string;
  /**
   * 与 card.photoIds 一一对应、顺序一致(第 i 项对应 [图 i+1])。
   * 没有识别结果的照片用 null 占位,保证序号不错位
   */
  photos: (PhotoReading | null)[];
}

export interface Journal {
  title: string;
  body: string;
  source: "llm" | "template";
  note?: string;
}

/** 校验时的上限,比提示词里的 850 字宽松一些,避免模型多写几个字就整篇作废 */
const MAX = 1100;

function systemPrompt(hasMoment: boolean, photoCount: number) {
  const length = photoCount <= 2 ? "180 到 380" : "550 到 850";
  const paragraphs = Math.max(3, photoCount + 1);
  return `你是一位写越野跑游记的作者,把一位选手的这次比赛写成一篇像公众号散文那样、有图有文的第一人称游记。读的人是这位选手本人和他的朋友。

素材共三类,只能从中取材:
1. 「事实」:赛事名、日期、组别、用时、排名、轨迹里程、累计爬升。
2. 「选手自己写的话」${hasMoment ? "" : "(这次没有写)"}:这是情绪和故事的主要来源。
3. 「照片」:每张有编号(图1、图2……)和肉眼可见的场景、人物、装备、氛围。

文风:
- 第一人称"我"。${hasMoment ? "围绕选手自己写的话展开,把他的感受写足。" : "没有选手自己的话,只写照片里看得见的氛围,情绪要克制。"}
- 从一个具体的画面或动作起笔,不要从"今天""这次"起笔,不要先交代赛事全名。
- 像说话一样写:短句和长句交错,少用成语和排比,不堆形容词。一个画面写清楚,比三个比喻有用。
- 结尾落在一个画面或一个动作上,不要总结升华,不要喊口号。
- 禁用这些词和句式:旅程、洗礼、难忘、美好回忆、不是终点而是、更是、见证、绽放、独特的体验。
- 用时、排名、里程、爬升这些数字,只在行文需要时自然带出一两处,不要罗列成一串。数字必须与「事实」完全一致,原样引用,不得取整。素材里没有的数字不要出现。
- 组别名只在确实有用时才提,不要硬塞进句子。

事实边界:
- 情绪必须有依据:来自选手自己的话,或照片里看得见的表情、动作、光线。没有依据的不写。
- 不得编造伤病、天气、沿途遇到的具体的人和事、补给站里发生的事,除非选手自己写了或照片里看得见。
- 照片识别里没有的感官(气味、声音、温度)不写。
- 不要写配速,不要说"官方认证",不要与他人比较名次。事实里为 null 的内容一律不提。

篇幅和结构:
- 正文约 ${length} 个汉字。共有 ${photoCount} 张照片,正文分成约 ${paragraphs} 段,段与段之间空一行。不用列表、小标题、表情。
- 每段把一个有素材依据的动作、画面或感受写清楚。素材少时写短些,避免重复和补造细节。
- 每张照片都必须引用一次:写到某张照片里的内容时,在这一段后面另起一行,单独写 [图N](N 是照片编号),前后各空一行。图要分散在全文里,一段后面只放一张,不要把几张图连在一起,也不要全放在结尾。
- 第一段之前不要放图。图的内容要和它前面那一段对得上。
- 没有识别结果的照片也要引用:把它放在前后段落自然衔接的位置,这一段只写前后的衔接,不要描述它的内容。
- [图N] 只是位置标记,不算正文,不要在正文里解释或描述它。

输出 JSON:{"title":"游记标题(8 到 16 字,像文章标题,不要带赛事全名)","body":"正文"}`;
}

function userPrompt(input: JournalInput, hint: string) {
  const photos = input.photos.length
    ? input.photos
        .map((p, i) =>
          p
            ? `图${i + 1}:场景:${p.scene};人物:${p.people};装备:${p.gear};氛围:${p.mood}`
            : `图${i + 1}:(没有识别结果,可以放在段落之间,但不要描述它的内容)`,
        )
        .join("\n")
    : "(没有照片)";
  return `事实:\n${JSON.stringify(input.facts, null, 2)}\n\n选手自己写的话:\n${input.moment.trim() || "(没有)"}\n\n照片:\n${photos}${hint}`;
}

/** 固定模板:没有模型或校验不过时使用。只陈述事实,不写情绪 */
export function templateJournal(input: JournalInput): Journal {
  const f = input.facts;
  const lines = [`${f.eventDate},我参加了${f.eventName}${f.group ? `(${f.group})` : ""}。`];
  if (f.elapsedTime) lines.push(`完赛用时 ${f.elapsedTime}${f.groupRank != null ? `,组别第 ${f.groupRank} 名` : ""}。`);
  if (f.distanceKm != null) lines.push(`轨迹记录 ${f.distanceKm} 公里${f.ascentM != null ? `,累计爬升约 ${f.ascentM} 米` : ""}。`);
  const body = [lines.join("")];
  if (input.moment.trim()) body.push(input.moment.trim());
  return { title: "这一天的记录", body: body.join("\n\n"), source: "template" };
}

export interface WriteOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  forceError?: boolean;
}

export async function writeJournal(input: JournalInput, opts: WriteOptions = {}): Promise<Journal> {
  const cfg = llmConfig();
  const fallback = (note: string): Journal => ({ ...templateJournal(input), note });
  if (!cfg.key) return fallback("未配置大模型,使用固定模板游记");
  if (opts.forceError) return fallback("模型调用失败(演示注入),使用固定模板游记");

  const sources = [input.moment, ...input.photos.filter((p): p is PhotoReading => !!p).map(readingText)].join("。");
  const doFetch = opts.fetchImpl ?? fetch;
  let lastReasons: string[] = [];
  const min = input.photos.length <= 2 ? 120 : 300;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (opts.signal?.aborted) return fallback("模型调用超时,使用固定模板游记");
    try {
      const hint = lastReasons.length ? `\n\n上一版不合格:${lastReasons.join(";")}。请严格按规则重写。` : "";
      const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.7,
          max_tokens: 2400,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt(!!input.moment.trim(), input.photos.length) },
            { role: "user", content: userPrompt(input, hint) },
          ],
        }),
        signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      });
      if (!res.ok) return fallback(`模型返回 ${res.status},使用固定模板游记`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = data.choices?.[0]?.message?.content ?? "";
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) {
        lastReasons = ["输出不是 JSON"];
        continue;
      }
      const o = JSON.parse(m[0]) as { title?: unknown; body?: unknown };
      const title = typeof o.title === "string" ? o.title.trim().slice(0, 30) : "";
      const rawBody = typeof o.body === "string" ? o.body.trim() : "";
      // 占位符只是位置标记:校验时剥掉(避免 [图2] 的 2 被当成正文数字),存储时保留并整理
      const body = normalizeJournalBody(rawBody, input.photos.length);
      const check = checkText(`${title}\n${stripMarkers(body)}`, input.facts, { min, max: MAX, sources });
      if (check.ok && title) return { title, body, source: "llm" };
      lastReasons = check.ok ? ["缺少标题"] : check.reasons;
    } catch (e) {
      console.error("writeJournal 失败:", e instanceof Error ? `${e.name}: ${e.message}` : e);
      if (attempt < 2) continue;
      return fallback(`模型调用失败(${e instanceof Error ? e.name : "error"}),使用固定模板游记`);
    }
  }
  return fallback(`游记三次未通过事实校验(${lastReasons.join("、")}),使用固定模板游记`);
}

/** 「AI 帮我起草」:根据照片识别写一段第一人称的"这一刻",只是草稿,由用户核对修改 */
export async function draftMoment(
  facts: Facts,
  photos: (PhotoReading | null)[],
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const cfg = llmConfig();
  if (!cfg.key) return { ok: false, error: "未配置大模型,请自己写下这一刻" };
  const read = photos.filter((p): p is PhotoReading => !!p);
  if (read.length === 0) return { ok: false, error: "没有可用的照片识别,请自己写下这一刻" };
  const doFetch = opts.fetchImpl ?? fetch;
  const list = read.map((p, i) => `照片${i + 1}:场景:${p.scene};人物:${p.people};装备:${p.gear};氛围:${p.mood}`).join("\n");
  try {
    const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.8,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content: `你帮一位越野跑选手起草"这一刻"的一小段话,选手会在此基础上修改。
- 第一人称,60 到 120 个汉字,一段话,口语化,有情绪、有画面。
- 只能依据"照片识别"里看得见的内容(场景、光线、动作、表情、装备)和"事实"。情绪要有照片依据。
- 不得编造伤病、天气、遇到的具体的人和事、补给站的事,不得出现照片和事实里没有的数字。
- 只输出这段话。`,
          },
          { role: "user", content: `事实:\n${JSON.stringify(facts, null, 2)}\n\n照片识别:\n${list}` },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { ok: false, error: `模型返回 ${res.status},请自己写下这一刻` };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (data.choices?.[0]?.message?.content ?? "").trim().replace(/^["“]|["”]$/g, "");
    if (text.length < 20) return { ok: false, error: "起草失败,请重试或自己写" };
    return { ok: true, text: text.slice(0, 300) };
  } catch {
    return { ok: false, error: "起草失败,请重试或自己写" };
  }
}
