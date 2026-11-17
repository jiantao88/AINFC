import QRCode from "qrcode";
import { all, db } from "@/lib/db";
import { demoGuard } from "@/lib/auth";
import { json } from "@/lib/api";
import { buildState, demoCodes } from "@/lib/players";
import type { PlayerRow } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 演示控制台数据:每名选手的标签网址、二维码、认领码、当前状态。仅 DEMO_MODE=1 */
export async function GET(req: Request) {
  const blocked = demoGuard();
  if (blocked) return blocked;
  db();
  // 二维码要给手机扫:用访问者实际使用的主机名(如局域网 IP),不能用服务绑定的 0.0.0.0
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;
  const players = all<PlayerRow>("SELECT * FROM players ORDER BY bib");
  const rows = await Promise.all(
    players.map(async (p) => {
      const codes = demoCodes(p.id);
      const medalUrl = `${origin}/t/${codes.medalTag}`;
      const bibUrl = `${origin}/t/${codes.bibTag}`;
      const faults = all<{ kind: string }>("SELECT kind FROM faults WHERE player_id=?", p.id).map((f) => f.kind);
      const st = buildState(p.id);
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
        faults,
        counts: {
          photos: st?.materials.photos.length ?? 0,
          route: !!st?.materials.route,
          score: !!st?.score,
          saved: !!st?.saved,
        },
      };
    }),
  );
  return json({ origin, players: rows });
}

