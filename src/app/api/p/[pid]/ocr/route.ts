import { run } from "@/lib/db";
import { guarded, err, json } from "@/lib/api";
import { faultFor } from "@/lib/agent";
import { readMedia } from "@/lib/media";
import { recognizeScore } from "@/lib/ocr";
import { getPlayer, listMaterials } from "@/lib/players";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 识别成绩截图,结果仅作预填;用户核对并保存前不算成绩 */
export const POST = guarded(async (_req, pid) => {
  const player = (await getPlayer(pid))!;
  if (player.status === "generating") return err(409, "正在生成中");
  const img = (await listMaterials(pid, "score_image")).at(-1);
  if (!img || !img.path) return err(400, "请先上传成绩截图");
  const buf = await readMedia(img.path);
  if (!buf) return err(400, "成绩截图文件丢失,请重新上传");

  const result = await faultFor(pid, "ocr_fail")
    ? {
        name: null,
        bib: null,
        group: null,
        elapsedTime: null,
        groupRank: null,
        confidence: null,
        at: Date.now(),
        error: "演示注入:识别失败,请重试或手动填写成绩",
      }
    : await recognizeScore(buf, img.mime ?? "image/png");
  await run("INSERT OR REPLACE INTO ocr (player_id, json) VALUES (?, ?)", pid, JSON.stringify(result));
  return json({ ok: !result.error, ocr: result });
});
