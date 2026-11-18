"use client";

import { useCallback, useEffect, useState } from "react";
import { api, post } from "@/components/client";

interface Row {
  id: string;
  name: string;
  bib: string;
  status: string;
  claimCode: string;
  medalUrl: string;
  bibUrl: string;
  medalQr: string;
  bibQr: string;
  faults: string[];
  counts: { photos: number; route: boolean; score: boolean; saved: boolean };
}

const FAULT_LABEL: Record<string, string> = {
  upload_fail: "上传失败",
  ocr_fail: "成绩识别失败",
  vision_fail: "照片识别失败",
  llm_fail: "文案模型失败",
  generate_fail: "生成失败",
};

export default function DemoConsole() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [origin, setOrigin] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [off, setOff] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ origin: string; players: Row[]; readOnly: boolean }>("/api/demo/state", { cache: "no-store" });
    if (r.status === 404) return setOff(true);
    if (r.ok) {
      setRows((r.data as { players: Row[] }).players);
      setOrigin((r.data as { origin: string }).origin);
      setReadOnly((r.data as { readOnly: boolean }).readOnly);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  async function act(key: string, body: Record<string, unknown>, label: string) {
    setBusy(key);
    setMsg(null);
    const r = await post("/api/demo/action", body);
    setBusy(null);
    setMsg(r.ok ? `${label}:完成` : `${label}:${r.data.error ?? "失败"}`);
    await load();
  }

  if (off)
    return (
      <main className="page pad" style={{ paddingTop: 40 }}>
        <h2>演示控制台未开启</h2>
        <p className="muted">需要在 .env.local 里设置 DEMO_MODE=1 后重启服务。</p>
      </main>
    );

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "24px 18px 80px" }}>
      <h1>演示控制台</h1>
      <p className="muted">
        当前地址 <code>{origin}</code>。用二维码或下面的链接代替 NFC。
      </p>
      <p className="note">所有赛事、选手、成绩均为虚构。认领码独立于号码和网址,正式使用时随号码簿发放。</p>
      {readOnly && <p className="note">线上演示仅供浏览。打开 DEMO 023 并输入认领码，即可查看已保存的卡片和图文游记。</p>}

      {rows && !readOnly && <div className="row" style={{ margin: "12px 0" }}>
        <button className="btn danger" disabled={busy !== null} data-testid="reset-all"
          onClick={() => confirm("重置所有选手、素材和登录状态,回到初始数据?") && act("reset", { action: "reset_all" }, "重置全部")}>
          重置全部数据
        </button>
        {msg && <span role="status" className="note" data-testid="demo-msg">{msg}</span>}
      </div>}

      {!rows && <p className="muted">加载中…</p>}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
        {rows?.map((p) => (
          <section className="card" key={p.id} data-testid={`player-${p.id}`}>
            <div className="row between">
              <h2>{p.name} · {p.bib}</h2>
              <span className="tag" data-testid="demo-status">{p.status}</span>
            </div>
            <p className="note" style={{ margin: "4px 0" }}>
              照片 {p.counts.photos} · 轨迹 {p.counts.route ? "有" : "无"} · 成绩 {p.counts.score ? "有" : "无"} · 已保存 {p.counts.saved ? "是" : "否"}
            </p>
            <p style={{ margin: "6px 0" }}>
              认领码 <strong data-testid="claim-code-value" style={{ fontSize: 22, letterSpacing: 3 }}>{p.claimCode}</strong>
            </p>
            <div className="row" style={{ alignItems: "flex-start" }}>
              {[["奖牌", p.medalUrl, p.medalQr], ["号码簿", p.bibUrl, p.bibQr]].map(([label, url, qr]) => (
                <div key={label} style={{ width: 130 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt={`${label}二维码`} width={130} height={130} />
                  <a href={url} className="note" data-testid={label === "奖牌" ? "medal-link" : "bib-link"}>{label}入口</a>
                </div>
              ))}
            </div>

            {!readOnly && <>
            <h3 style={{ fontSize: 15, margin: "12px 0 6px" }}>一键造状态</h3>
            <div className="row">
              {([["draft", "草稿"], ["generating", "生成中"], ["pending_confirmation", "待确认"]] as const).map(([s, l]) => (
                <button key={s} className="btn small" disabled={busy !== null} data-testid={`make-${s}`}
                  onClick={() => act(`${p.id}-${s}`, { action: "make_state", playerId: p.id, state: s }, l)}>
                  {busy === `${p.id}-${s}` ? "处理中…" : l}
                </button>
              ))}
              <button className="btn small danger" disabled={busy !== null} data-testid="reset-player"
                onClick={() => act(`${p.id}-reset`, { action: "reset_player", playerId: p.id }, "重置该选手")}>
                重置该选手
              </button>
            </div>

            <h3 style={{ fontSize: 15, margin: "12px 0 6px" }}>注入失败(用于测试恢复)</h3>
            <div className="row">
              {Object.entries(FAULT_LABEL).map(([k, l]) => {
                const on = p.faults.includes(k);
                return (
                  <button key={k} className={`btn small ${on ? "primary" : ""}`} aria-pressed={on} data-testid={`fault-${k}`}
                    onClick={() => act(`${p.id}-f-${k}`, { action: "set_fault", playerId: p.id, kind: k, on: !on }, `${l}${on ? "关闭" : "开启"}`)}>
                    {l}{on ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
            </>}
          </section>
        ))}
      </div>
    </main>
  );
}
