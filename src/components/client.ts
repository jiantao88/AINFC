"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { State } from "@/lib/types";

export async function api<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T & { error?: string; code?: string } }> {
  try {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "网络出错了,请检查网络后重试" } as never };
  }
}

export const post = (url: string, body: unknown) =>
  api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** 拉取选手状态;生成中时每 1.5 秒轮询,其余状态不轮询 */
export function usePlayerState(pid: string) {
  const [state, setState] = useState<State | null>(null);
  const [lost, setLost] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const r = await api<State>(`/api/p/${pid}/state`, { cache: "no-store" });
    if (r.status === 404) {
      setLost(true);
      return null;
    }
    if (r.ok) {
      setState(r.data as State);
      return r.data as State;
    }
    return null;
  }, [pid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generating = state?.player.status === "generating";
  useEffect(() => {
    if (!generating) return;
    const tick = async () => {
      await refresh();
      timer.current = setTimeout(tick, 1500);
    };
    timer.current = setTimeout(tick, 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [generating, refresh]);

  return { state, refresh, lost };
}

export const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
