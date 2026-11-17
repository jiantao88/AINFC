import { describe, expect, it } from "vitest";
import { checkText, templateText, writeText, type Facts } from "@/lib/text";

const base: Facts = {
  eventName: "西山越野记忆体验赛(虚构演示)",
  eventDate: "2026-11-15",
  group: "体验组(演示)",
  elapsedTime: "01:42:36",
  groupRank: 12,
  distanceKm: 9.95,
  ascentM: 380,
  photoCount: 3,
  routeKind: "personal",
};
const noScore: Facts = { ...base, elapsedTime: null, groupRank: null, group: null };
const noRoute: Facts = { ...base, distanceKm: null, ascentM: null, routeKind: null };

describe("templateText:只陈述事实,缺失字段不出现", () => {
  it("全字段", () => {
    const t = templateText(base);
    expect(t).toContain("01:42:36");
    expect(t).toContain("第 12 名");
    expect(t).toContain("9.95 公里");
    expect(t).toContain("3 张照片");
    expect(checkText(t, base).ok).toBe(true);
  });
  it("无成绩无轨迹:不出现用时、名次、距离", () => {
    const f = { ...noScore, distanceKm: null, ascentM: null, routeKind: null };
    const t = templateText(f);
    expect(t).not.toMatch(/用时|名|公里|爬升/);
    expect(checkText(t, f).ok).toBe(true);
  });
  it("有成绩无排名:不编造名次", () => {
    const f = { ...base, groupRank: null };
    expect(templateText(f)).not.toMatch(/第.*名/);
  });
});

describe("checkText:产品文档的禁止项", () => {
  it.each([
    ["伤病", "他在下坡时扭伤了脚踝,仍然完成了比赛,留下了三张照片和一段九点九五公里的轨迹。"],
    ["天气", "那天下着小雨,山路泥泞,他完成了比赛,用时 01:42:36,留下了三张照片作纪念。"],
    ["心理", "他咬牙坚持跑完全程,内心无比激动,用时 01:42:36,组别第 12 名,留下三张照片。"],
    ["沿途事件", "途中他遇到了同伴一起前行,最终用时 01:42:36 完赛,在组别里排第 12 名。"],
    ["官方认证", "这是官方认证成绩:用时 01:42:36,组别第 12 名,轨迹 9.95 公里,留下 3 张照片。"],
    ["配速", "全程平均配速稳定,用时 01:42:36,组别第 12 名,轨迹 9.95 公里,留下 3 张照片。"],
  ])("拒绝 %s", (_n, text) => {
    expect(checkText(text, base).ok).toBe(false);
  });

  it("拒绝事实里没有的数字", () => {
    const r = checkText("2026-11-15 完赛,用时 01:42:36,组别第 5 名,留下了 3 张照片作为纪念。", base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join()).toContain("5");
  });
  it("没有排名却提名次", () => {
    const f = { ...base, groupRank: null };
    const r = checkText("2026-11-15 完赛,用时 01:42:36,排名靠前,轨迹 9.95 公里,留下 3 张照片。", f);
    expect(r.ok).toBe(false);
  });
  it("没有成绩却提用时", () => {
    expect(checkText("2026-11-15 完赛,用时很短,留下了 3 张照片和一段轨迹,作为纪念。", noScore).ok).toBe(false);
  });
  it("没有个人轨迹却提公里", () => {
    expect(checkText("2026-11-15 完赛,用时 01:42:36,跑了很多公里,组别第 12 名,留下 3 张照片。", noRoute).ok).toBe(false);
  });
  it("太短或太长", () => {
    expect(checkText("完赛了。", base).ok).toBe(false);
    expect(checkText("完".repeat(200), base).ok).toBe(false);
  });
  it("赛事名里含禁用字不误杀", () => {
    const f = { ...base, eventName: "雪山越野赛" };
    expect(checkText("2026-11-15 参加雪山越野赛,用时 01:42:36,组别第 12 名,留下了 3 张照片。", f).ok).toBe(true);
  });
});

describe("writeText:模型输出不合格时的回退", () => {
  const withKey = <T>(fn: () => Promise<T>) => {
    const old = process.env.LLM_API_KEY;
    process.env.LLM_API_KEY = "test-key";
    return fn().finally(() => {
      if (old === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = old;
    });
  };
  const reply = (content: string, status = 200) =>
    (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })) as unknown as typeof fetch;

  it("没配 key:直接用模板", async () => {
    const old = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    const r = await writeText(base);
    if (old !== undefined) process.env.LLM_API_KEY = old;
    expect(r.source).toBe("template");
  });
  it("模型给出合格文案:采用", async () => {
    const ok = "2026-11-15,参加了西山越野记忆体验赛(虚构演示),用时 01:42:36,组别第 12 名,留下了 3 张照片。";
    const r = await withKey(() => writeText(base, { fetchImpl: reply(ok) }));
    expect(r.source).toBe("llm");
    expect(r.text).toBe(ok);
  });
  it("模型编造伤病:两次都不合格后回退到模板", async () => {
    const bad = "他在下坡时扭伤了脚踝,仍然咬牙坚持完成比赛,用时 01:42:36,留下了 3 张照片作为纪念。";
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: bad } }] }));
    }) as unknown as typeof fetch;
    const r = await withKey(() => writeText(base, { fetchImpl: f }));
    expect(calls).toBe(2);
    expect(r.source).toBe("template");
    expect(r.note).toContain("未通过校验");
  });
  it("网关返回错误:回退到模板,不抛错", async () => {
    const r = await withKey(() => writeText(base, { fetchImpl: reply("x", 500) }));
    expect(r.source).toBe("template");
  });
  it("网络异常:回退到模板", async () => {
    const f = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const r = await withKey(() => writeText(base, { fetchImpl: f }));
    expect(r.source).toBe("template");
  });
});

describe("checkText:误杀回归", () => {
  it("'累计爬升' 不是疲劳表述", () => {
    const f: Facts = { ...base };
    expect(checkText("2026-11-15 完赛,用时 01:42:36,组别第 12 名,轨迹 9.95 公里,累计爬升约 380 米,留下 3 张照片。", f).ok).toBe(true);
  });
  it.each(["他跑得很累", "太累了", "累得说不出话"])("仍拦截疲劳表述:%s", (s) => {
    expect(checkText(`2026-11-15 完赛,用时 01:42:36,组别第 12 名,${s},留下了 3 张照片。`, base).ok).toBe(false);
  });
});
