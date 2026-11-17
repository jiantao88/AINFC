import { describe, expect, it } from "vitest";
import { checkText, type Facts } from "@/lib/text";

const ref: Facts = {
  eventName: "西山越野记忆体验赛(虚构演示)",
  eventDate: "2026-11-15",
  group: "体验组(演示)",
  elapsedTime: "01:42:36",
  groupRank: 12,
  distanceKm: null, // 参考路线:距离不作为选手事实
  ascentM: null,
  photoCount: 3,
  routeKind: "reference",
};

describe("参考路线不能被写成选手完成情况", () => {
  it.each([
    "2026-11-15 参加了西山越野记忆体验赛,完成了参考路线,用时 01:42:36,组别第 12 名,留下 3 张照片。",
    "2026-11-15 参加了西山越野记忆体验赛,跑完了这条路线,用时 01:42:36,组别第 12 名,留下 3 张照片。",
    "2026-11-15 参加了西山越野记忆体验赛,走过香植线,用时 01:42:36,组别第 12 名,留下 3 张照片。",
    "2026-11-15 参加了西山越野记忆体验赛,途经山脊,用时 01:42:36,组别第 12 名,留下 3 张照片。",
  ])("拦截: %s", (t) => {
    expect(checkText(t, ref).ok).toBe(false);
  });
  it("允许如实陈述路线是参考", () => {
    const t = "2026-11-15 参加了西山越野记忆体验赛,用时 01:42:36,组别第 12 名;卡片附赛事参考路线,留下 3 张照片。";
    expect(checkText(t, ref).ok).toBe(true);
  });
});

describe("时间转写成中文也要核对", () => {
  it.each([
    ["历时1小时42分36秒", true],
    ["用时一小时四十二分", true],
    ["用时2小时08分19秒", false],
    ["用时三小时", false],
    ["耗时 1 小时 42 分", true],
  ])("%s → 通过=%s", (frag, ok) => {
    const t = `2026-11-15 参加了西山越野记忆体验赛,${frag},组别第 12 名,留下 3 张照片。`;
    expect(checkText(t, ref).ok).toBe(ok);
  });
  it("中文数字的名次、张数也要核对", () => {
    expect(checkText("2026-11-15 参加了西山越野记忆体验赛,用时 01:42:36,组别第十二名,留下三张照片。", ref).ok).toBe(true);
    expect(checkText("2026-11-15 参加了西山越野记忆体验赛,用时 01:42:36,组别第五名,留下三张照片。", ref).ok).toBe(false);
    expect(checkText("2026-11-15 参加了西山越野记忆体验赛,用时 01:42:36,组别第十二名,留下九张照片。", ref).ok).toBe(false);
  });
});
