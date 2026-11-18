import QRCode from "qrcode";
import { all } from "@/lib/db";
import { demoGuard } from "@/lib/auth";
import { json } from "@/lib/api";
import { readOnlyDemo } from "@/lib/config";
import { demoCodes } from "@/lib/players";
import type { PlayerRow } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ConsoleRow extends PlayerRow {
  photos: number;
  route: number;
  score: number;
  saved: number;
  faults: string | null;
}

/** 演示控制台数据:每名选手的标签网址、二维码、认领码、当前状态。仅 DEMO_MODE=1 */
export async function GET(req: Request) {
  const blocked = demoGuard();
  if (blocked) return blocked;
  // 二维码要给手机扫:用访问者实际使用的主机名(如局域网 IP),不能用服务绑定的 0.0.0.0
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;
  const players = await all<ConsoleRow>(`
    SELECT p.*,
      (SELECT COUNT(*) FROM materials m WHERE m.player_id=p.id AND m.kind='photo' AND m.hidden=0) AS photos,
      EXISTS (SELECT 1 FROM materials m WHERE m.player_id=p.id AND m.kind='route' AND m.hidden=0) AS route,
      EXISTS (SELECT 1 FROM scores s WHERE s.player_id=p.id) AS score,
      EXISTS (SELECT 1 FROM saved_cards s WHERE s.player_id=p.id) AS saved,
      (SELECT group_concat(f.kind) FROM faults f WHERE f.player_id=p.id) AS faults
    FROM players p ORDER BY p.bib
  `);
  const rows = await Promise.all(
    players.map(async (p) => {
      const codes = demoCodes(p.id);
      const medalUrl = `${origin}/t/${codes.medalTag}`;
      const bibUrl = `${origin}/t/${codes.bibTag}`;
      return {
        id: p.id,
        name: p.name,
        bib: p.bib,
        status: p.status,
        claimCode: codes.claimCode,
        medalUrl,
        bibUrl,
        medalQr: await QRCode.toDataURL(medalUrl, { margin: 1, width: 160 }),
        bibQr: await QRCode.toDataURL(bibUrl, { margin: 1, width: 160 }),
        faults: p.faults?.split(",") ?? [],
        counts: {
          photos: p.photos,
          route: !!p.route,
          score: !!p.score,
          saved: !!p.saved,
        },
      };
    }),
  );
  return json({ origin, players: rows, readOnly: readOnlyDemo() });
}

