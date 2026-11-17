"use client";

import { useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/types";
import { canvasToBlob, drawCard, loadImage } from "@/lib/draw-card";

export function CardView({
  card,
  pid,
  exportName,
  showExport,
  version,
}: {
  card: Card;
  pid: string;
  exportName?: string;
  showExport?: boolean;
  /** 卡片内容变化时递增,触发重绘 */
  version?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const mat = (id: string) => `/api/p/${pid}/materials/${id}`;
      let cover = null;
      let routeShot = null;
      let failed: string | null = null;
      if (card.coverMaterialId) {
        try {
          cover = await loadImage(mat(card.coverMaterialId));
        } catch {
          failed = "封面图片加载失败,已用占位底色";
        }
      }
      if (card.route?.kind === "screenshot") {
        try {
          routeShot = await loadImage(mat(card.route.materialId));
        } catch {
          failed = failed ?? "轨迹截图加载失败";
        }
      }
      if (!alive || !ref.current) return;
      drawCard(ref.current, card, { cover, routeShot });
      setLoadErr(failed);
    })();
    return () => {
      alive = false;
    };
  }, [card, pid, version]);

  async function exportPng() {
    if (!ref.current || exporting) return;
    setExporting(true);
    setMsg(null);
    try {
      const blob = await canvasToBlob(ref.current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportName ?? card.player.bib.replace(/\s+/g, "-")}-赛事记忆卡片.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMsg("已导出图片");
    } catch {
      setMsg("导出失败,请重试");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <canvas ref={ref} className="card-canvas" aria-label={`${card.player.name}的赛事回忆卡片`} data-testid="card-canvas" />
      {loadErr && <p className="err">{loadErr}</p>}
      {showExport && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={exportPng} disabled={exporting} data-testid="export">
            {exporting ? "导出中…" : "导出图片"}
          </button>
          {msg && <span className="note" role="status">{msg}</span>}
        </div>
      )}
    </div>
  );
}
