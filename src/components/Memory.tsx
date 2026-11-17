"use client";

import type { State } from "@/lib/types";
import { CardView } from "./CardView";
import { JournalView } from "./Journal";

/** 已保存:回忆页。导出图片、继续补充。补充素材后重新生成的是新草稿,旧版保留到确认 */
export function Memory({ state, onSupplement }: { state: State; onSupplement: () => void }) {
  const saved = state.saved!;
  // 有游记时照片已经排在游记里;没有游记的旧数据才单独展示照片
  const photos = saved.card.journal ? [] : state.materials.photos.filter((p) => saved.card.photoIds.includes(p.id));

  return (
    <div className="pad">
      <section className="card">
        <div className="row between">
          <h2>我的赛事回忆</h2>
          <span className="tag ok" data-testid="saved-tag">已保存</span>
        </div>
        <p className="note" style={{ margin: "4px 0 0" }}>
          保存于 {new Date(saved.savedAt).toLocaleString("zh-CN")} · 仅你本人可见,保存不代表公开发布
        </p>
      </section>

      <CardView card={saved.card} pid={state.player.id} showExport />

      <JournalView card={saved.card} pid={state.player.id} />


      {photos.length > 1 && (
        <section className="card">
          <h2>相关照片</h2>
          <div className="thumbs">
            {photos.map((p) => (
              <div className="thumb" key={p.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.url && <img src={p.url} alt={p.name} />}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>继续补充</h2>
        <p className="muted" style={{ margin: "2px 0 8px" }}>
          补充照片、轨迹或成绩后重新生成。新版本是草稿,你确认之前,现在这张卡片不会被替换。
        </p>
        <button className="btn" onClick={onSupplement} data-testid="supplement">补充素材并重新生成</button>
      </section>
    </div>
  );
}
