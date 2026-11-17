import type { Card } from "@/lib/types";

export const CARD_W = 1080;
export const CARD_H = 1620;

const FONT_SERIF = `"Songti SC","Noto Serif SC",Georgia,serif`;
const FONT_SANS = `-apple-system,"PingFang SC","Noto Sans SC","Helvetica Neue",sans-serif`;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text.replace(/\r/g, "")) {
    if (ch === "\n") {
      lines.push(cur);
      cur = "";
      continue;
    }
    if (ctx.measureText(cur + ch).width > maxWidth) {
      lines.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawRoute(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  x: number,
  y: number,
  w: number,
  h: number,
  dashed: boolean,
) {
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const spanX = Math.max((maxLon - minLon) * Math.cos(midLat), 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const pad = 22;
  const s = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const ox = x + (w - spanX * s) / 2;
  const oy = y + (h - spanY * s) / 2;
  const px = (lon: number) => ox + (lon - minLon) * Math.cos(midLat) * s;
  const py = (lat: number) => oy + (maxLat - lat) * s;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#b4552d";
  if (dashed) ctx.setLineDash([14, 12]);
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(px(p[1]), py(p[0])) : ctx.moveTo(px(p[1]), py(p[0]))));
  ctx.stroke();
  ctx.setLineDash([]);
  const a = points[0];
  const b = points[points.length - 1];
  for (const [p, c] of [[a, "#2d5039"], [b, "#b4552d"]] as const) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(px(p[1]), py(p[0]), 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(px(p[1]), py(p[0]), 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export interface CardAssets {
  cover: HTMLImageElement | null;
  routeShot: HTMLImageElement | null;
}

/** 卡片绘制:预览和导出共用。姓名、号码、成绩全部取自 card 里的确认值 */
export function drawCard(canvas: HTMLCanvasElement, card: Card, assets: CardAssets) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d")!;
  const W = CARD_W;
  const M = 64;

  ctx.fillStyle = "#f4efe3";
  ctx.fillRect(0, 0, W, CARD_H);

  // 封面
  const coverH = 640;
  ctx.save();
  roundRect(ctx, 0, 0, W, coverH, 0);
  ctx.clip();
  if (assets.cover) drawCover(ctx, assets.cover, 0, 0, W, coverH);
  else {
    const g = ctx.createLinearGradient(0, 0, W, coverH);
    g.addColorStop(0, "#3d6a4a");
    g.addColorStop(1, "#1f3a29");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, coverH);
  }
  const fade = ctx.createLinearGradient(0, coverH * 0.4, 0, coverH);
  fade.addColorStop(0, "rgba(20,38,26,0)");
  fade.addColorStop(1, "rgba(20,38,26,0.82)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, coverH);
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 62px ${FONT_SERIF}`;
  ctx.fillText(card.title, M, coverH - 96, W - M * 2);
  ctx.font = `30px ${FONT_SANS}`;
  ctx.globalAlpha = 0.92;
  ctx.fillText(`${card.event.name}  ·  ${card.event.date}`, M, coverH - 44, W - M * 2);
  ctx.globalAlpha = 1;

  // 选手信息
  let y = coverH + 78;
  ctx.fillStyle = "#23352a";
  ctx.font = `700 54px ${FONT_SERIF}`;
  ctx.fillText(card.player.name, M, y);
  const nameW = ctx.measureText(card.player.name).width;
  ctx.font = `600 34px ${FONT_SANS}`;
  ctx.fillStyle = "#5a6b5f";
  ctx.fillText(card.player.bib, M + nameW + 24, y);

  // 成绩
  y += 44;
  if (card.score) {
    roundRect(ctx, M, y, W - M * 2, 156, 22);
    ctx.fillStyle = "#fffdf7";
    ctx.fill();
    ctx.strokeStyle = "#d6cdb6";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#5a6b5f";
    ctx.font = `26px ${FONT_SANS}`;
    ctx.fillText("完赛用时", M + 32, y + 48);
    ctx.fillStyle = "#1f3a29";
    ctx.font = `700 70px ${FONT_SANS}`;
    ctx.fillText(card.score.elapsedTime, M + 32, y + 120);
    ctx.fillStyle = "#5a6b5f";
    ctx.font = `26px ${FONT_SANS}`;
    ctx.textAlign = "right";
    ctx.fillText(card.score.groupName, W - M - 32, y + 48);
    if (card.score.groupRank != null) {
      ctx.fillStyle = "#b4552d";
      ctx.font = `700 46px ${FONT_SANS}`;
      ctx.fillText(`组别第 ${card.score.groupRank} 名`, W - M - 32, y + 118);
    }
    ctx.textAlign = "left";
    y += 156 + 36;
  } else {
    y += 8;
  }

  // 路线
  const routeH = 300;
  if (card.route) {
    roundRect(ctx, M, y, W - M * 2, routeH, 22);
    ctx.fillStyle = "#ebe4d2";
    ctx.fill();
    ctx.save();
    roundRect(ctx, M, y, W - M * 2, routeH, 22);
    ctx.clip();
    if (card.route.kind === "screenshot" && assets.routeShot) {
      drawCover(ctx, assets.routeShot, M, y, W - M * 2, routeH);
    } else if (card.route.kind !== "screenshot") {
      drawRoute(ctx, card.route.points, M, y, W - M * 2, routeH, card.route.kind === "reference");
    }
    ctx.restore();
    const label =
      card.route.kind === "reference"
        ? "赛事参考路线 · 非实际行走记录"
        : card.route.kind === "screenshot"
          ? "用户上传的轨迹截图"
          : `个人轨迹 · ${card.route.stats.distanceKm} 公里${card.route.stats.ascentM != null ? ` · 爬升约 ${card.route.stats.ascentM} 米` : ""}`;
    ctx.font = `24px ${FONT_SANS}`;
    const tw = ctx.measureText(label).width + 28;
    roundRect(ctx, M + 16, y + 16, tw, 40, 20);
    ctx.fillStyle = "rgba(255,253,247,0.92)";
    ctx.fill();
    ctx.fillStyle = card.route.kind === "reference" ? "#9a6a12" : "#2d5039";
    ctx.fillText(label, M + 30, y + 44);
    y += routeH + 40;
  }

  // 回忆文案
  ctx.fillStyle = "#23352a";
  ctx.font = `32px ${FONT_SERIF}`;
  const lines = wrap(ctx, card.text, W - M * 2);
  const maxLines = Math.max(2, Math.floor((CARD_H - 150 - y) / 50));
  lines.slice(0, maxLines).forEach((ln, i, arr) => {
    const t = i === arr.length - 1 && lines.length > maxLines ? ln.slice(0, -1) + "…" : ln;
    ctx.fillText(t, M, y + 36 + i * 50);
  });

  // 页脚:如实标注
  ctx.fillStyle = "#5a6b5f";
  ctx.font = `22px ${FONT_SANS}`;
  const foot = [
    "成绩为用户自行确认,非官方认证",
    card.event.isPlaceholder ? "虚构演示赛事 · 仅限内部测试" : "",
  ].filter(Boolean).join("  ·  ");
  ctx.fillText(foot, M, CARD_H - 56);
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("导出失败"))), "image/png"),
  );
}
