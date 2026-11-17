"use client";

import { useEffect, useState } from "react";
import { Collect } from "./Collect";
import { Hero } from "./Claim";
import { usePlayerState } from "./client";
import { JobStatus } from "./JobStatus";
import { Memory } from "./Memory";
import { Preview } from "./Preview";

const STATUS_LABEL: Record<string, string> = {
  claimed_empty: "收集素材",
  draft: "草稿",
  generating: "生成中",
  pending_confirmation: "待确认",
  saved: "已保存",
};

/** 登录后的主体验。按选手状态分流:无素材 → 收集页;有草稿 → 恢复草稿;生成中 → 任务状态;待确认 → 预览页;已保存 → 回忆页 */
export function Journey({ pid }: { pid: string }) {
  const { state, refresh, lost } = usePlayerState(pid);
  const [supplementing, setSupplementing] = useState(false);
  const status = state?.player.status;
  // 开始生成后离开了 saved,"补充素材"视图就结束;之后再回到 saved 应显示回忆页
  useEffect(() => {
    if (status && status !== "saved") setSupplementing(false);
  }, [status]);

  if (lost) {
    return (
      <main className="page pad" style={{ paddingTop: 48 }}>
        <h2>登录已失效</h2>
        <p className="muted">请重新触碰并输入认领码。</p>
        <button className="btn primary" onClick={() => location.reload()}>刷新</button>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="page pad" style={{ paddingTop: 48 }} aria-busy="true">
        <p className="muted">加载中…</p>
      </main>
    );
  }

  const st = state.player.status;
  const heroSub = `${state.event.name} · ${state.event.date}`;
  const showCollect = st === "claimed_empty" || st === "draft" || (st === "saved" && supplementing);

  return (
    <main className="page" data-status={st} data-testid="journey">
      <Hero title={state.player.name} sub={`${state.player.bib} · ${heroSub}`} heroUrl={state.event.heroUrl} />
      <div className="sheet">
        <div className="pad" style={{ marginBottom: 6 }}>
          <span className="tag" data-testid="status-tag">{STATUS_LABEL[st] ?? st}</span>{" "}
          {state.event.isPlaceholder && <span className="tag warn">虚构演示赛事</span>}
        </div>

        {st === "generating" && <JobStatus state={state} refresh={refresh} />}

        {showCollect && <Collect state={state} refresh={refresh} />}
        {showCollect && supplementing && (
          <div className="pad"><button className="btn block" onClick={() => setSupplementing(false)}>返回已保存的回忆</button></div>
        )}

        {st === "pending_confirmation" && state.preview && <Preview key={state.preview.generatedAt} state={state} refresh={refresh} />}

        {st === "saved" && !supplementing && state.saved && (
          <>
            <Memory state={state} onSupplement={() => setSupplementing(true)} />
            {state.job?.status === "failed" && <JobStatus state={state} refresh={refresh} />}
          </>
        )}
      </div>
    </main>
  );
}

