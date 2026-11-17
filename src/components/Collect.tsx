"use client";

import { useRef, useState } from "react";
import type { State } from "@/lib/types";
import { api, fmtSize, post } from "./client";

type Item = { key: string; name: string; status: "uploading" | "error"; error?: string; file: File; kind: "photo" | "route" | "score_image" };

/** 单文件上传,失败只影响这一个,可单项重试 */
function useUploader(pid: string, onDone: () => void) {
  const [items, setItems] = useState<Item[]>([]);

  async function send(item: Item) {
    const form = new FormData();
    form.set("kind", item.kind);
    form.set("file", item.file);
    const r = await api(`/api/p/${pid}/materials`, { method: "POST", body: form });
    if (r.ok) {
      setItems((xs) => xs.filter((x) => x.key !== item.key));
      onDone();
    } else {
      setItems((xs) => xs.map((x) => (x.key === item.key ? { ...x, status: "error", error: r.data.error ?? "上传失败" } : x)));
    }
  }

  function add(kind: Item["kind"], files: FileList | File[]) {
    const list: Item[] = Array.from(files).map((file) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      status: "uploading",
      file,
      kind,
    }));
    setItems((xs) => [...xs, ...list]);
    list.forEach((it) => void send(it));
  }

  function retry(key: string) {
    const it = items.find((x) => x.key === key);
    if (!it) return;
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, status: "uploading", error: undefined } : x)));
    void send(it);
  }
  const dismiss = (key: string) => setItems((xs) => xs.filter((x) => x.key !== key));
  return { items, add, retry, dismiss };
}

function PendingList({
  kind,
  items,
  retry,
  dismiss,
}: {
  kind: Item["kind"];
  items: Item[];
  retry: (k: string) => void;
  dismiss: (k: string) => void;
}) {
  // 三个区块共用一个上传队列,每个区块只显示自己类型的上传项
  items = items.filter((i) => i.kind === kind);
  if (!items.length) return null;
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }} aria-live="polite">
      {items.map((it) => (
        <li key={it.key} className="row between" style={{ padding: "6px 0", borderBottom: "1px dashed var(--line)" }} data-testid="pending-item">
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
          {it.status === "uploading" ? (
            <span className="note">上传中…</span>
          ) : (
            <span className="row" style={{ gap: 6 }}>
              <span className="err" style={{ margin: 0 }} data-testid="upload-error">{it.error}</span>
              <button className="btn small" onClick={() => retry(it.key)}>重试</button>
              <button className="btn small" onClick={() => dismiss(it.key)} aria-label="忽略">✕</button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Collect({ state, refresh }: { state: State; refresh: () => Promise<unknown> }) {
  const pid = state.player.id;
  const up = useUploader(pid, refresh);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [genErr, setGenErr] = useState<string | null>(null);
  const photoIn = useRef<HTMLInputElement>(null);

  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  const photos = state.materials.photos;
  const route = state.materials.route;
  const failedJob = state.job?.status === "failed" ? state.job : null;

  async function remove(id: string) {
    const r = await api(`/api/p/${pid}/materials/${id}`, { method: "DELETE" });
    if (!r.ok) say(r.data.error ?? "移除失败");
    await refresh();
  }

  async function useReference() {
    setBusy("ref");
    const r = await post(`/api/p/${pid}/route-ref`, {});
    setBusy(null);
    if (!r.ok) say(r.data.error ?? "使用参考路线失败");
    await refresh();
  }

  async function generate() {
    setBusy("gen");
    setGenErr(null);
    const r = await post(`/api/p/${pid}/flow`, { action: "generate" });
    setBusy(null);
    if (!r.ok) {
      setGenErr(r.data.error ?? "无法开始生成");
      return;
    }
    await refresh();
  }

  const canGen = photos.length > 0 && up.items.every((i) => i.status !== "uploading");

  return (
    <div className="pad">
      {toast && <div className="toast" role="status">{toast}</div>}

      {failedJob && (
        <div className="card" style={{ borderColor: "var(--bad)" }} data-testid="job-failed">
          <h2 style={{ color: "var(--bad)" }}>上一次生成失败</h2>
          <p className="muted" style={{ margin: "4px 0 0" }}>{failedJob.error ?? "未知原因"}。你的素材都还在,可以直接重试。</p>
        </div>
      )}

      <section className="card" aria-labelledby="h-photo">
        <div className="row between">
          <h2 id="h-photo">赛事照片</h2>
          <span className="tag">{photos.length}/{state.event.maxPhotos}</span>
        </div>
        <p className="muted" style={{ margin: "2px 0 0" }}>至少 1 张。第一张默认作封面,之后可更换。</p>
        <label className="drop" style={{ marginTop: 10 }}>
          <input
            ref={photoIn}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            data-testid="photo-input"
            onChange={(e) => {
              if (e.target.files?.length) up.add("photo", e.target.files);
              e.target.value = "";
            }}
          />
          <strong>＋ 添加照片</strong>
          <span className="note">PNG / JPG / WebP,单张不超过 {fmtSize(state.event.imageMaxBytes)}</span>
        </label>
        <PendingList kind="photo" {...up} />
        {photos.length > 0 && (
          <div className="thumbs" data-testid="photo-list">
            {photos.map((p) => (
              <div className="thumb" key={p.id}>
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={p.name} />
                ) : (
                  <span className="note" style={{ padding: 6 }}>文件丢失</span>
                )}
                <button onClick={() => remove(p.id)} aria-label={`移除 ${p.name}`}>✕</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="h-route">
        <h2 id="h-route">轨迹</h2>
        <p className="muted" style={{ margin: "2px 0 8px" }}>优先上传 GPX。没有个人轨迹也可以使用赛事参考路线。</p>
        {route ? (
          <div data-testid="route-info">
            <div className="row between">
              <span>
                <span className={`tag ${route.meta.kind === "reference" ? "warn" : "ok"}`}>
                  {route.meta.kind === "reference" ? "赛事参考路线 · 非实际行走记录" : route.meta.kind === "screenshot" ? "轨迹截图" : "个人轨迹"}
                </span>{" "}
                <span className="note">{route.name}</span>
              </span>
              <button className="btn small danger" onClick={() => remove(route.id)}>移除</button>
            </div>
            {route.meta.stats && (
              <p className="note" style={{ margin: "6px 0 0" }}>
                {route.meta.stats.distanceKm} 公里
                {route.meta.kind === "personal" && route.meta.stats.ascentM != null ? ` · 累计爬升约 ${route.meta.stats.ascentM} 米` : ""}
                {route.meta.kind === "personal" && route.meta.stats.durationSec == null ? " · 文件无时间信息,不显示用时" : ""}
              </p>
            )}
          </div>
        ) : (
          <div className="row">
            <label className="btn" style={{ cursor: "pointer" }}>
              <input
                type="file"
                accept=".gpx,application/gpx+xml,text/xml,application/xml,image/png,image/jpeg"
                style={{ display: "none" }}
                data-testid="route-input"
                onChange={(e) => {
                  if (e.target.files?.length) up.add("route", e.target.files);
                  e.target.value = "";
                }}
              />
              导入轨迹 (GPX / 截图)
            </label>
            {state.event.referenceRouteAvailable && (
              <button className="btn" onClick={useReference} disabled={busy === "ref"} data-testid="use-reference">
                使用参考路线
              </button>
            )}
          </div>
        )}
        <PendingList kind="route" {...up} />
      </section>

      <MomentSection state={state} refresh={refresh} say={say} />

      <ScoreSection state={state} refresh={refresh} up={up} say={say} />

      <div className="sticky">
        <div className="inner">
          {genErr && <p className="err" role="alert" data-testid="gen-error">{genErr}</p>}
          <button className="btn primary block" disabled={!canGen || busy === "gen"} onClick={generate} data-testid="generate">
            {busy === "gen" ? "提交中…" : failedJob ? "重试生成" : "生成赛事回忆卡片"}
          </button>
          {!photos.length && <p className="note" style={{ margin: "6px 0 0", textAlign: "center" }}>上传至少 1 张照片后可生成。轨迹或成绩缺失会生成简版卡片。</p>}
        </div>
      </div>
    </div>
  );
}

function ScoreSection({
  state,
  refresh,
  up,
  say,
}: {
  state: State;
  refresh: () => Promise<unknown>;
  up: ReturnType<typeof useUploader>;
  say: (m: string) => void;
}) {
  const pid = state.player.id;
  const s = state.score;
  const img = state.materials.scoreImage;
  const ocr = state.ocr;
  const [time, setTime] = useState(s?.elapsedTime ?? "");
  const [group, setGroup] = useState(s?.groupId ?? state.event.groups[0]?.id ?? "");
  const [rank, setRank] = useState(s?.groupRank != null ? String(s.groupRank) : "");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [recognizing, setRecognizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefillNote, setPrefillNote] = useState<string | null>(null);

  async function recognize() {
    setRecognizing(true);
    setPrefillNote(null);
    const r = await post(`/api/p/${pid}/ocr`, {});
    setRecognizing(false);
    await refresh();
    const o = (r.data as { ocr?: State["ocr"] }).ocr;
    if (!r.ok || !o || o.error) {
      say(o?.error ?? r.data.error ?? "识别失败,请手动填写");
      return;
    }
    if (o.elapsedTime) setTime(o.elapsedTime);
    const g = state.event.groups.find((x) => o.group && (x.name === o.group || x.name.replace(/[()（）]/g, "") === o.group.replace(/[()（）]/g, "")));
    if (g) setGroup(g.id);
    setRank(o.groupRank != null ? String(o.groupRank) : "");
    setPrefillNote(
      `已预填识别结果${o.confidence ? `(置信度 ${o.confidence})` : ""}。请对照截图核对后再保存${o.groupRank == null ? ";截图里没有排名,已留空" : ""}。`,
    );
  }

  async function save() {
    setSaving(true);
    setFieldErr({});
    const r = await api(`/api/p/${pid}/score`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elapsedTime: time, groupId: group, groupRank: rank === "" ? null : rank }),
    });
    setSaving(false);
    if (!r.ok) {
      const f = (r.data as { field?: string }).field;
      setFieldErr({ [f ?? "_"]: r.data.error ?? "保存失败" });
      return;
    }
    say("成绩已确认保存");
    await refresh();
  }

  async function clear() {
    await api(`/api/p/${pid}/score`, { method: "DELETE" });
    setTime("");
    setRank("");
    await refresh();
  }

  return (
    <section className="card" aria-labelledby="h-score">
      <div className="row between">
        <h2 id="h-score">成绩</h2>
        {s ? <span className="tag ok" data-testid="score-confirmed">已确认</span> : <span className="tag">未填写</span>}
      </div>
      <p className="muted" style={{ margin: "2px 0 8px" }}>上传成绩截图后识别,或直接手填。你确认的数值不会被标为官方认证。</p>

      <div className="row">
        <label className="btn small" style={{ cursor: "pointer" }}>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            data-testid="score-input"
            onChange={(e) => {
              if (e.target.files?.length) up.add("score_image", e.target.files);
              e.target.value = "";
            }}
          />
          {img ? "更换成绩截图" : "上传成绩截图"}
        </label>
        {img && state.ocrEnabled && (
          <button className="btn small primary" onClick={recognize} disabled={recognizing} data-testid="recognize">
            {recognizing ? "识别中…约 20 秒" : "识别成绩"}
          </button>
        )}
      </div>
      <PendingList kind="score_image" {...up} />

      {img?.url && (
        <details style={{ marginTop: 10 }} open={!s}>
          <summary className="note">查看成绩截图,用来核对</summary>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt="成绩截图" style={{ width: "100%", borderRadius: 10, marginTop: 8 }} />
        </details>
      )}
      {ocr?.error && <p className="err" role="alert" data-testid="ocr-error">{ocr.error}</p>}
      {prefillNote && <p className="note" role="status" data-testid="ocr-note" style={{ color: "var(--warn)" }}>{prefillNote}</p>}

      <label className="field">
        <span>完赛用时(时:分:秒)</span>
        <input
          className={`input ${fieldErr.elapsedTime ? "invalid" : ""}`}
          value={time}
          onChange={(e) => setTime(e.target.value)}
          placeholder="01:42:36"
          inputMode="numeric"
          data-testid="score-time"
        />
        {fieldErr.elapsedTime && <p className="err" data-testid="score-error">{fieldErr.elapsedTime}</p>}
      </label>
      <label className="field">
        <span>组别</span>
        <select className="input" value={group} onChange={(e) => setGroup(e.target.value)} data-testid="score-group">
          {state.event.groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>组别排名(没有请留空)</span>
        <input
          className={`input ${fieldErr.groupRank ? "invalid" : ""}`}
          value={rank}
          onChange={(e) => setRank(e.target.value)}
          inputMode="numeric"
          placeholder="留空表示没有排名"
          data-testid="score-rank"
        />
        {fieldErr.groupRank && <p className="err">{fieldErr.groupRank}</p>}
      </label>
      {fieldErr._ && <p className="err">{fieldErr._}</p>}
      <div className="row">
        <button className="btn primary" onClick={save} disabled={saving || !time.trim()} data-testid="score-save">
          {saving ? "保存中…" : "确认并保存成绩"}
        </button>
        {s && <button className="btn" onClick={clear}>清除成绩</button>}
      </div>
    </section>
  );
}

function MomentSection({ state, refresh, say }: { state: State; refresh: () => Promise<unknown>; say: (m: string) => void }) {
  const pid = state.player.id;
  const saved = state.moment;
  const [text, setText] = useState(saved?.text ?? "");
  const [ai, setAi] = useState(saved?.draftedByAi ?? false);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dirty = text.trim() !== (saved?.text ?? "") || ai !== (saved?.draftedByAi ?? false);
  const hasPhoto = state.materials.photos.length > 0;

  async function draft() {
    setDrafting(true);
    setErr(null);
    setNote(null);
    const r = await post(`/api/p/${pid}/moment`, {});
    setDrafting(false);
    if (!r.ok) {
      setErr(r.data.error ?? "起草失败,请自己写");
      return;
    }
    const d = r.data as { text: string; basedOn: number };
    setText(d.text);
    setAi(true);
    setNote(`AI 根据 ${d.basedOn} 张照片里看得见的内容起草了这段话。它不知道你真实的感受,请改成你自己的话,再点保存。`);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    const r = await api(`/api/p/${pid}/moment`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, draftedByAi: ai }),
    });
    setSaving(false);
    if (!r.ok) {
      setErr(r.data.error ?? "保存失败");
      return;
    }
    say(text.trim() ? "已保存这一刻" : "已清除");
    await refresh();
  }

  return (
    <section className="card" aria-labelledby="h-moment">
      <div className="row between">
        <h2 id="h-moment">写下这一刻</h2>
        {saved ? (
          <span className={`tag ${saved.draftedByAi ? "warn" : "ok"}`} data-testid="moment-tag">{saved.draftedByAi ? "AI 草稿" : "已保存"}</span>
        ) : (
          <span className="tag">选填</span>
        )}
      </div>
      <p className="muted" style={{ margin: "2px 0 8px" }}>
        冲线的心情、赛道上的小故事、补给站的片段。游记的情绪和细节就来自你写的这段话,写得越具体,游记越像你。
      </p>
      <textarea
        className="input"
        value={text}
        maxLength={600}
        placeholder="例如:上坡的时候腿很沉,可是回头看到山下的城市亮起来,突然觉得很值……"
        onChange={(e) => {
          setText(e.target.value);
          setAi(false);
          setNote(null);
        }}
        aria-label="这一刻"
        data-testid="moment-text"
      />
      <div className="row between" style={{ marginTop: 4 }}>
        <span className="note">{text.length}/600</span>
        {ai && <span className="tag warn" data-testid="moment-ai-flag">内容来自 AI 草稿</span>}
      </div>
      {note && <p className="note" style={{ color: "var(--warn)" }} role="status" data-testid="moment-note">{note}</p>}
      {err && <p className="err" role="alert" data-testid="moment-error">{err}</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small primary" onClick={save} disabled={saving || !dirty} data-testid="moment-save">
          {saving ? "保存中…" : "保存"}
        </button>
        {state.visionEnabled && (
          <button className="btn small" onClick={draft} disabled={drafting || !hasPhoto} data-testid="moment-draft" title={hasPhoto ? "" : "先上传照片"}>
            {drafting ? "AI 正在看照片…约 30 秒" : "AI 帮我起草"}
          </button>
        )}
      </div>
      {!hasPhoto && state.visionEnabled && <p className="note" style={{ margin: "6px 0 0" }}>先上传照片,AI 才能看着照片帮你起草。</p>}
    </section>
  );
}
