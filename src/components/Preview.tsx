"use client";

import { useState } from "react";
import type { Card, State } from "@/lib/types";
import { CardView } from "./CardView";
import { JournalView } from "./Journal";
import { post } from "./client";

export function Preview({ state, refresh }: { state: State; refresh: () => Promise<unknown> }) {
  const pid = state.player.id;
  const card = state.preview!;
  const hasSaved = !!state.saved;
  const [title, setTitle] = useState(card.title);
  const [text, setText] = useState(card.text);
  const [time, setTime] = useState(card.score?.elapsedTime ?? "");
  const [rank, setRank] = useState(card.score?.groupRank != null ? String(card.score.groupRank) : "");
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<Card>(card);
  const [jTitle, setJTitle] = useState(card.journal?.title ?? "");
  const [jBody, setJBody] = useState(card.journal?.body ?? "");

  async function edit(body: Record<string, unknown>, okText: string) {
    setBusy("edit");
    setMsg(null);
    const r = await post(`/api/p/${pid}/flow`, { action: "edit", ...body });
    setBusy(null);
    if (!r.ok) {
      setMsg({ kind: "err", text: r.data.error ?? "保存修改失败" });
      return false;
    }
    const d = r.data as { preview?: Card; warning?: string | null };
    if (d.preview) {
      setDraft(d.preview);
      setVersion((v) => v + 1);
    }
    setMsg(d.warning ? { kind: "warn", text: d.warning } : { kind: "ok", text: okText });
    return true;
  }

  async function save() {
    setBusy("save");
    const r = await post(`/api/p/${pid}/flow`, { action: "save" });
    setBusy(null);
    if (!r.ok) {
      setMsg({ kind: "err", text: r.data.error ?? "保存失败,请重试" });
      return;
    }
    await refresh();
  }

  async function discard() {
    await post(`/api/p/${pid}/flow`, { action: "discard" });
    await refresh();
  }

  return (
    <div className="pad">
      <section className="card" aria-labelledby="h-prev">
        <div className="row between">
          <h2 id="h-prev">预览与编辑</h2>
          <span className="tag warn">待确认 · 尚未保存</span>
        </div>
        {hasSaved && <p className="note" style={{ margin: "4px 0 0" }} data-testid="old-kept">已保存的旧版本仍然保留,确认保存后才会被这一版替换。</p>}
      </section>

      <CardView card={draft} pid={pid} version={version} />

      <JournalView card={draft} pid={pid} />

      {draft.journal && (
        <section className="card">
          <h2>修改游记</h2>
          <p className="note">想改的地方直接改。单独一行的 [图1]、[图2] 是照片的位置,可以剪切移动或删除。保存后这篇游记标为“你已修改”。</p>
          <label className="field">
            <span>游记标题</span>
            <input className="input" value={jTitle} onChange={(e) => setJTitle(e.target.value)} maxLength={40} data-testid="edit-journal-title" />
          </label>
          <label className="field">
            <span>游记正文(段落之间空一行)</span>
            <textarea className="input" style={{ minHeight: 220 }} value={jBody} onChange={(e) => setJBody(e.target.value)} maxLength={1500} data-testid="edit-journal-body" />
          </label>
          <button className="btn" disabled={busy !== null} onClick={() => edit({ journal: { title: jTitle, body: jBody } }, "游记已更新")} data-testid="apply-journal">
            应用游记修改
          </button>
        </section>
      )}

      <section className="card">
        <h2>卡片上的短文案</h2>
        <p className="note" data-testid="text-source">
          {draft.textSource === "llm" && "由模型根据你确认的信息撰写,已通过事实校验。"}
          {draft.textSource === "template" && "使用固定模板文案(只陈述你确认的事实)。"}
          {draft.textSource === "user" && "你已修改这段文案。"}
        </p>
        <label className="field">
          <span>标题</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} data-testid="edit-title" />
        </label>
        <label className="field">
          <span>文案</span>
          <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} data-testid="edit-text" />
        </label>
        <button className="btn" disabled={busy !== null} onClick={() => edit({ title, text }, "文案已更新")} data-testid="apply-text">
          应用文案修改
        </button>
      </section>

      {draft.score && (
        <section className="card">
          <h2>成绩字段</h2>
          <p className="note">改动后卡片按新值重新渲染,来源标为“用户编辑”。</p>
          <label className="field">
            <span>完赛用时</span>
            <input className="input" value={time} onChange={(e) => setTime(e.target.value)} data-testid="edit-time" />
          </label>
          <label className="field">
            <span>组别排名(留空为无排名)</span>
            <input className="input" value={rank} onChange={(e) => setRank(e.target.value)} inputMode="numeric" data-testid="edit-rank" />
          </label>
          <button className="btn" disabled={busy !== null} onClick={() => edit({ score: { elapsedTime: time, groupRank: rank === "" ? null : rank } }, "成绩已更新,卡片已重绘")} data-testid="apply-score">
            应用成绩修改
          </button>
        </section>
      )}

      {draft.photoIds.length > 1 && (
        <section className="card">
          <h2>封面</h2>
          <div className="thumbs">
            {draft.photoIds.map((id) => (
              <button
                key={id}
                className={`thumb ${draft.coverMaterialId === id ? "cover" : ""}`}
                style={{ padding: 0, cursor: "pointer" }}
                onClick={() => edit({ coverMaterialId: id }, "封面已更换")}
                aria-label="设为封面"
                aria-pressed={draft.coverMaterialId === id}
                data-testid="cover-option"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/p/${pid}/materials/${id}`} alt="" />
              </button>
            ))}
          </div>
        </section>
      )}

      {msg && (
        <p className={msg.kind === "err" ? "err" : "note"} style={msg.kind === "warn" ? { color: "var(--warn)" } : undefined} role="status" data-testid="edit-msg">
          {msg.text}
        </p>
      )}

      <div className="sticky">
        <div className="inner row" style={{ flexWrap: "nowrap" }}>
          <button className="btn" onClick={discard} disabled={busy !== null}>放弃这一版</button>
          <button className="btn primary" style={{ flex: 1 }} onClick={save} disabled={busy !== null} data-testid="save">
            {busy === "save" ? "保存中…" : "确认并保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
