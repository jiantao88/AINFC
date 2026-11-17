import { describe, expect, it } from "vitest";
import { mapLimit } from "@/lib/pool";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapLimit", () => {
  it("结果顺序与输入一致,即使完成顺序不同", async () => {
    const out = await mapLimit([30, 5, 15], 3, async (ms, i) => {
      await sleep(ms);
      return i;
    });
    expect(out).toEqual([0, 1, 2]);
  });

  it("同时运行的任务数不超过上限,且确实并发", async () => {
    let running = 0;
    let peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6], 3, async () => {
      running++;
      peak = Math.max(peak, running);
      await sleep(10);
      running--;
    });
    expect(peak).toBe(3);
  });

  it("并发确实缩短总耗时", async () => {
    const t = Date.now();
    await mapLimit([1, 2, 3], 3, () => sleep(60));
    expect(Date.now() - t).toBeLessThan(150);
  });

  it("空数组、上限大于数量", async () => {
    expect(await mapLimit([], 3, async () => 1)).toEqual([]);
    expect(await mapLimit([1, 2], 10, async (x) => x * 2)).toEqual([2, 4]);
  });

  it("某个任务抛错:整体 reject,且不再启动后面的任务", async () => {
    const started: number[] = [];
    await expect(
      mapLimit([0, 1, 2, 3, 4], 1, async (x) => {
        started.push(x);
        if (x === 1) throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(started).toEqual([0, 1]);
  });
});
