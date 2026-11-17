import { describe, expect, it } from "vitest";
import { checkText, type Facts } from "@/lib/text";
import { templateJournal, writeJournal, type JournalInput } from "@/lib/journal";
import { normalizeJournalBody, splitJournal, stripMarkers } from "@/lib/journal-blocks";
import { parseReading, readPhoto } from "@/lib/vision";
import sharp from "sharp";

const facts: Facts = {
  eventName: "西山越野记忆体验赛(虚构演示)",
  eventDate: "2026-11-15",
  group: "体验组(演示)",
  elapsedTime: "01:42:36",
  groupRank: 12,
  distanceKm: 9.95,
  ascentM: 722,
  photoCount: 3,
  routeKind: "personal",
};
const photo = {
  scene: "山地林间小径,石阶覆盖落叶,秋季,阳光斜射",
  people: "3人正在向上攀登,穿着运动服装",
  gear: "号码布 DEMO 021",
  mood: "积极向上,充满活力",
  uncertain: [],
};
const moment = "上坡的时候腿很沉,但是看到山下的城市亮起来,突然觉得很值。冲线时我哭了。";
const S = [moment, photo.scene, photo.people, photo.gear, photo.mood].join("。");
const long = (extra: string) =>
  `2026-11-15,我站在西山越野记忆体验赛的起点。${extra}用时 01:42:36,组别第 12 名,轨迹 9.95 公里,累计爬升 722 米。` +
  "秋天的林子里满是落叶,石阶一层一层往上,我数着呼吸往前走。回头望去,身后是一路的光。" +
  "下坡的时候风从耳边过去,我什么也没想,只听见自己的脚步一下一下落在石头上,心里特别安静。";
/** writeJournal 的内置下限是 300 字,这里把样本补长到 300 字以上 */
const full = (extra: string) =>
  long(extra) +
  "\n\n后来路变窄了,前面的人影在树干之间时隐时现,我盯着那一抹橙色的衣角,一步一步跟上去。落叶踩上去软软的,鞋底和石头碰出轻轻的响声。" +
  "我想起出发前把号码布别在胸前的样子,手指有点抖,现在倒是稳了。转过一个弯,视野忽然开阔,山下的房子缩成小小的一片,我停了一秒,又继续往前。" +
  "\n\n再往上就是一段缓坡,我把步子放小,呼吸慢慢跟上来。身边的人不说话,只有鞋底踩过落叶的声音,一下接着一下,像是替我们数着步数。";

describe("游记事实校验:情绪可写,事实类内容要有来源", () => {
  it("允许情绪词", () => {
    const t = long("越往上越累,心里却越来越亮,我既紧张又期待。");
    expect(checkText(t, facts, { min: 80, max: 600, sources: S }).ok).toBe(true);
  });
  it("选手写了'哭' → 允许引用", () => {
    const t = long("冲线的时候我哭了。");
    expect(checkText(t, facts, { min: 80, max: 600, sources: S }).ok).toBe(true);
  });
  it("没来源的天气 → 拦截", () => {
    const t = long("那天下着小雨,山路很滑。");
    const r = checkText(t, facts, { min: 80, max: 600, sources: S });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join()).toContain("天气");
  });
  it("没来源的伤病 → 拦截", () => {
    const r = checkText(long("下坡时我扭伤了脚踝。"), facts, { min: 80, max: 600, sources: S });
    expect(r.ok).toBe(false);
  });
  it("没来源的补给站故事 → 拦截", () => {
    const r = checkText(long("在补给站我遇到了一位老朋友。"), facts, { min: 80, max: 600, sources: S });
    expect(r.ok).toBe(false);
  });
  it("选手自己写了雨 → 允许", () => {
    const t = long("正如我写的,那天下着小雨。");
    expect(checkText(t, facts, { min: 80, max: 600, sources: S + "。小雨一直下" }).ok).toBe(true);
  });
  it("数字仍必须与事实一致", () => {
    const r = checkText(long("我用了约 10 公里。").replace("9.95", "10"), facts, { min: 80, max: 600, sources: S });
    expect(r.ok).toBe(false);
  });
  it("选手写的数字可以被引用", () => {
    const t = long("我在第 5 个山头停了一下。");
    expect(checkText(t, facts, { min: 80, max: 600, sources: S }).ok).toBe(false);
    expect(checkText(t, facts, { min: 80, max: 600, sources: S + "。第 5 个山头" }).ok).toBe(true);
  });
  it("仍不允许配速和官方认证", () => {
    expect(checkText(long("我的配速很稳。"), facts, { min: 80, max: 600, sources: S }).ok).toBe(false);
    expect(checkText(long("这是官方认证成绩。"), facts, { min: 80, max: 600, sources: S }).ok).toBe(false);
  });
});

describe("writeJournal", () => {
  const input: JournalInput = { facts, moment, photos: [photo] };
  const withKey = async <T,>(fn: () => Promise<T>) => {
    const old = process.env.LLM_API_KEY;
    process.env.LLM_API_KEY = "test";
    try {
      return await fn();
    } finally {
      if (old === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = old;
    }
  };
  const reply = (obj: unknown) =>
    (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }))) as unknown as typeof fetch;

  it("没配 key → 模板游记,包含选手自己的话", async () => {
    const old = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    const j = await writeJournal(input);
    if (old !== undefined) process.env.LLM_API_KEY = old;
    expect(j.source).toBe("template");
    expect(j.body).toContain("很值");
  });
  it("模型给出合格游记 → 采用", async () => {
    const body = full("上坡的时候腿很沉,可看到山下的城市亮起来,我突然觉得很值。冲线时我哭了。");
    const j = await withKey(() => writeJournal(input, { fetchImpl: reply({ title: "山风里的一天", body }) }));
    expect(j.source).toBe("llm");
    expect(j.title).toBe("山风里的一天");
  });
  it("三次都编造天气 → 回退到模板并说明原因", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "雨中", body: full("那天下着大雨,我浑身湿透。") }) } }] }));
    }) as unknown as typeof fetch;
    const j = await withKey(() => writeJournal(input, { fetchImpl: f }));
    expect(calls).toBe(3);
    expect(j.source).toBe("template");
    expect(j.note).toContain("天气");
  });
  it("模型返回非 JSON → 重试", async () => {
    let calls = 0;
    const body = full("我哭了。");
    const f = (async () => {
      calls++;
      const content = calls === 1 ? "不是 JSON" : JSON.stringify({ title: "这一天", body });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    }) as unknown as typeof fetch;
    const j = await withKey(() => writeJournal(input, { fetchImpl: f }));
    expect(calls).toBe(2);
    expect(j.source).toBe("llm");
  });
  it("模板游记不包含情绪词以外的编造,且没有'这一刻'时只有事实", () => {
    const t = templateJournal({ facts, moment: "", photos: [] });
    expect(t.body).toContain("01:42:36");
    expect(checkText(t.body, facts, { min: 20, max: 600, sources: "" }).ok).toBe(true);
  });
  it("带 [图N] 占位符的游记:占位符不影响数字校验,并被整理成独占一行", async () => {
    const body = `${full("我哭了。")}\n[图1]\n\n后来我又回头看了一眼。[图 2] [图9]`;
    const j = await withKey(() => writeJournal({ ...input, photos: [photo, null] }, { fetchImpl: reply({ title: "山风里的一天", body }) }));
    expect(j.source).toBe("llm");
    expect(j.body).toContain("\n\n[图1]\n\n");
    expect(j.body).toContain("\n\n[图2]");
    expect(j.body).not.toContain("[图9]");
  });
  it("正文太短(不足 300 字)→ 不采用,重试后回退模板", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "这一天", body: long("我哭了。") }) } }] }));
    }) as unknown as typeof fetch;
    const j = await withKey(() => writeJournal(input, { fetchImpl: f }));
    expect(calls).toBe(3);
    expect(j.source).toBe("template");
    expect(j.note).toContain("过短");
  });
  it("没有识别结果的照片不会让后面的照片序号错位", async () => {
    let prompt = "";
    const f = (async (_url: string, init: RequestInit) => {
      prompt = String(JSON.parse(String(init.body)).messages[1].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "这一天", body: full("我哭了。") }) } }] }));
    }) as unknown as typeof fetch;
    await withKey(() => writeJournal({ ...input, photos: [null, photo] }, { fetchImpl: f }));
    expect(prompt).toContain("图1:(没有识别结果");
    expect(prompt).toContain("图2:场景:山地林间小径");
  });
});

describe("journal-blocks", () => {
  const text = (s: string) => ({ type: "text", text: s });
  const photoAt = (index: number) => ({ type: "photo", index });
  const types = (l: { blocks: { type: string }[] }) => l.blocks.map((b) => b.type).join(",");

  it("占位符独占一行,照片出现在对应位置;漏引的补进没有配图的段落后面", () => {
    const l = splitJournal("第一段。\n\n[图2]\n\n第二段。\n\n第三段。", 3);
    // 图2 在第一段后;漏引的图1、图3 补进还没有配图的第二、三段后面
    expect(l.blocks).toEqual([text("第一段。"), photoAt(1), text("第二段。"), photoAt(0), text("第三段。"), photoAt(2)]);
  });
  it("越界、重复、全角括号", () => {
    const l = splitJournal("甲。\n[图1]\n乙。\n【图1】\n丙。[图7]", 2);
    expect(l.blocks).toEqual([text("甲。"), photoAt(0), text("乙。"), photoAt(1), text("丙。")]);
  });
  it("没有占位符:照片均匀穿插在段落之后", () => {
    const l = splitJournal("一。\n\n二。\n\n三。", 2);
    expect(types(l)).toBe("text,photo,text,photo,text");
  });
  it("照片比段落多:叠在配图最少的段落后面,不会堆在文末", () => {
    const l = splitJournal("甲。\n\n乙。", 5);
    expect(l.blocks.filter((b) => b.type === "photo")).toHaveLength(5);
    expect(l.blocks.at(-1)?.type).toBe("photo");
    // 两段各分到 2 到 3 张,而不是 1 + 4
    const first = types(l).split("text")[1].split(",").filter(Boolean).length;
    expect(first).toBeGreaterThanOrEqual(2);
  });
  it("模型把图全挤在结尾:引用位置照旧保留,不擅自移动", () => {
    const l = splitJournal("甲。\n\n乙。\n\n[图1]\n[图2]\n[图3]", 3);
    expect(types(l)).toBe("text,text,photo,photo,photo");
  });
  it("没有照片、没有正文", () => {
    expect(splitJournal("一。\n\n二。", 0)).toEqual({ blocks: [text("一。"), text("二。")] });
    expect(splitJournal("", 3)).toEqual({ blocks: [photoAt(0), photoAt(1), photoAt(2)] });
  });
  it("normalizeJournalBody 丢弃开头的图、越界和重复", () => {
    expect(normalizeJournalBody("[图1]\n甲。[图1][图1][图5]\n乙。", 2)).toBe("甲。\n\n[图1]\n\n乙。");
  });
  it("stripMarkers", () => {
    expect(stripMarkers("甲[图1]乙【图 12 】丙")).toBe("甲乙丙");
  });
});

describe("parseReading", () => {
  it("解析正常 JSON", () => {
    const r = parseReading('{"scene":"林间","people":"3人","gear":"号码布","mood":"愉快","uncertain":["看不清"]}');
    expect(r?.scene).toBe("林间");
    expect(r?.uncertain).toEqual(["看不清"]);
  });
  it("缺少 scene 和 people → null", () => {
    expect(parseReading('{"mood":"x"}')).toBeNull();
  });
  it("非 JSON → null", () => {
    expect(parseReading("没有 json")).toBeNull();
  });
});

describe("readPhoto 重试", () => {
  const ok = JSON.stringify({ choices: [{ message: { content: '{"scene":"林间小径","people":"2人","gear":"","mood":"平静","uncertain":[]}' } }] });
  const png = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).png().toBuffer();
  const withKey = async <T,>(fn: () => Promise<T>) => {
    const old = process.env.LLM_API_KEY;
    process.env.LLM_API_KEY = "test";
    try {
      return await fn();
    } finally {
      if (old === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = old;
    }
  };
  const seq = (steps: (Response | Error)[]) => {
    let calls = 0;
    const f = (async () => {
      const s = steps[Math.min(calls++, steps.length - 1)];
      if (s instanceof Error) throw s;
      return s;
    }) as unknown as typeof fetch;
    return { f, calls: () => calls };
  };

  it("网络错误(fetch failed)→ 重试后成功", async () => {
    const s = seq([new TypeError("fetch failed"), new Response(ok)]);
    const r = await withKey(async () => readPhoto(await png(), { fetchImpl: s.f, retryDelayMs: 1 }));
    expect(r.ok).toBe(true);
    expect(s.calls()).toBe(2);
  });
  it("429 / 5xx → 重试", async () => {
    const s = seq([new Response("", { status: 429 }), new Response("", { status: 502 }), new Response(ok)]);
    const r = await withKey(async () => readPhoto(await png(), { fetchImpl: s.f, retryDelayMs: 1 }));
    expect(r.ok).toBe(true);
    expect(s.calls()).toBe(3);
  });
  it("401 等其他 4xx → 不重试", async () => {
    const s = seq([new Response("", { status: 401 })]);
    const r = await withKey(async () => readPhoto(await png(), { fetchImpl: s.f, retryDelayMs: 1 }));
    expect(r).toEqual({ ok: false, error: "识别服务返回 401" });
    expect(s.calls()).toBe(1);
  });
  it("三次都失败 → 返回失败,不再继续", async () => {
    const s = seq([new TypeError("fetch failed")]);
    const r = await withKey(async () => readPhoto(await png(), { fetchImpl: s.f, retryDelayMs: 1 }));
    expect(r.ok).toBe(false);
    expect(s.calls()).toBe(3);
  });
});
