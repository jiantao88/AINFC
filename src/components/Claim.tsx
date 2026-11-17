"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Pub {
  eventName: string;
  eventDate: string;
  isPlaceholder: boolean;
  heroUrl: string;
  bib: string;
  claimed: boolean;
}

export function Hero({ title, sub, heroUrl }: { title: string; sub: string; heroUrl: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="hero">
      {!broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={heroUrl} alt="" onError={() => setBroken(true)} />
      )}
      <div className="hero-text">
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
    </div>
  );
}

export function Claim({ tag, pub }: { tag: string; pub: Pub }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "认领失败,请重试");
        return;
      }
      router.refresh();
    } catch {
      setError("网络出错了,请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <Hero title="留住你的完赛时刻" sub={`${pub.eventName} · ${pub.eventDate}`} heroUrl={pub.heroUrl} />
      <div className="sheet pad">
        {pub.isPlaceholder && <span className="tag warn">虚构演示赛事 · 仅限内部测试</span>}
        <div className="card">
          <div className="row between">
            <h2>参赛号码 {pub.bib}</h2>
            <span className={`tag ${pub.claimed ? "ok" : ""}`}>{pub.claimed ? "已认领" : "未认领"}</span>
          </div>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            {pub.claimed
              ? "这份记忆已被认领。如果是你本人,请输入认领码回到这份记忆。"
              : "输入随号码簿发放的认领码,认领这份赛事记忆。号码和网址不能用来查看私人内容。"}
          </p>
          <form onSubmit={submit} style={{ marginTop: 12 }}>
            <label className="field">
              <span>认领码</span>
              <input
                className={`input ${error ? "invalid" : ""}`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                inputMode="text"
                maxLength={12}
                placeholder="6 位认领码"
                aria-label="认领码"
                aria-invalid={!!error}
                data-testid="claim-code"
              />
            </label>
            {error && (
              <p className="err" role="alert" data-testid="claim-error">
                {error}
              </p>
            )}
            <button className="btn primary block" disabled={busy || !code.trim()} data-testid="claim-submit">
              {busy ? "验证中…" : pub.claimed ? "验证并进入" : "认领这份记忆"}
            </button>
          </form>
        </div>
        <p className="note">没有 App 要下载。认领后在本手机浏览器里保持登录。</p>
      </div>
    </main>
  );
}
