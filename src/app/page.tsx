import Link from "next/link";
import { demoMode } from "@/lib/config";

export default function Home() {
  return (
    <main className="page pad" style={{ paddingTop: 56 }}>
      <h1>赛事记忆卡片</h1>
      <p className="muted">请触碰奖牌或号码簿上的 NFC 标签打开你的入口。</p>
      {demoMode() && (
        <p>
          <Link className="btn" href="/demo">打开演示控制台</Link>
        </p>
      )}
    </main>
  );
}
