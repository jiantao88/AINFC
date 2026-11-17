"use client";

import { useState } from "react";
import type { State } from "@/lib/types";
import { post } from "./client";

const ICON = { pending: "", running: "", done: "✓", failed: "✕" } as const;

/** 任务状态:只显示后端真实写入的步骤,不显示虚构进度 */
export function JobStatus({ state, refresh }: { state: State; refresh: () => Promise<unknown> }) {
  const job = state.job;
  const [busy, setBusy] = useState(false);
  if (!job) return null;
  const running = state.player.status === "generating";

  async function retry() {
    setBusy(true);
    await post(`/api/p/${state.player.id}/flow`, { action: "generate" });
    setBusy(false);
    await refresh();
  }

  return (
    <div className="pad">
      <section className="card" aria-live="polite" data-testid="job-status">
        <h2>{running ? "Agent 正在整理你的素材" : job.status === "failed" ? "生成失败" : "整理完成"}</h2>
        <ul className="steps">
          {job.steps.map((s) => (
            <li key={s.key} data-step={s.key} data-status={s.status}>
              <span className={`dot ${s.status}`} aria-hidden>{ICON[s.status]}</span>
              <span>
                <strong>{s.label}</strong>
                {s.detail && <span className="note" style={{ display: "block" }}>{s.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
        {running && <p className="note">页面可以保持打开,也可以稍后再触碰回来。生成不会因为你离开而中断。</p>}
        {job.status === "failed" && (
          <>
            <p className="err" data-testid="job-error">{job.error}</p>
            <p className="note">素材都保留着。</p>
            <button className="btn primary" onClick={retry} disabled={busy} data-testid="retry">重试生成</button>
          </>
        )}
      </section>
    </div>
  );
}
