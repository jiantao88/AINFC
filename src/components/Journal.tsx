"use client";

import { useMemo } from "react";
import { splitJournal } from "@/lib/journal-blocks";
import type { Card } from "@/lib/types";

const SOURCE: Record<string, string> = {
  llm: "AI 根据你写的话、照片和确认过的信息撰写,已通过事实校验",
  template: "固定模板:没有可用的大模型结果,只陈述确认过的信息和你写的话",
  user: "你已修改这篇游记",
};

const SERIF = '"Songti SC","Noto Serif SC",Georgia,serif';

/** 图文游记:照片按正文里的 [图N] 穿插在段落之间;没有标记时均匀穿插 */
export function JournalView({ card, pid }: { card: Card; pid: string }) {
  const j = card.journal;
  const layout = useMemo(() => (j ? splitJournal(j.body, card.photoIds.length) : null), [j, card.photoIds.length]);
  if (!j || !layout) return null;

  const src = (i: number) => `/api/p/${pid}/materials/${card.photoIds[i]}`;

  return (
    <article className="card" aria-labelledby="h-journal" data-testid="journal" style={{ padding: "22px 18px" }}>
      <h2 id="h-journal" style={{ fontSize: 24, lineHeight: 1.4, fontFamily: SERIF, margin: "0 0 6px" }} data-testid="journal-title">
        {j.title}
      </h2>
      <p className="note" data-testid="journal-source" style={{ margin: "0 0 18px" }}>
        {card.event.name} · {card.event.date} · {SOURCE[j.source]}
      </p>

      <div style={{ fontFamily: SERIF, fontSize: 17, lineHeight: 1.95 }}>
        {layout.blocks.map((b, i) =>
          b.type === "text" ? (
            <p key={i} style={{ margin: "0 0 16px", textIndent: "2em" }}>
              {b.text}
            </p>
          ) : (
            <figure key={i} style={{ margin: "22px -4px" }} data-testid="journal-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(b.index)} alt="" loading="lazy" style={{ width: "100%", display: "block", borderRadius: 10, background: "var(--paper-2)" }} />
            </figure>
          ),
        )}
      </div>

      {card.moment && (
        <p className="note" style={{ borderTop: "1px dashed var(--line)", paddingTop: 8, marginTop: 18 }}>
          情绪与细节取自你写的:「{card.moment.slice(0, 40)}{card.moment.length > 40 ? "…" : ""}」
        </p>
      )}
    </article>
  );
}
