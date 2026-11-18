import { notFound } from "next/navigation";
import { sessionPlayerIds } from "@/lib/auth";
import { playerByTag, playerPublicView } from "@/lib/players";
import { Claim } from "@/components/Claim";
import { Journey } from "@/components/Journey";
import { readOnlyDemo } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function TagPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const player = playerByTag(code);
  if (!player) notFound();

  const owned = (await sessionPlayerIds()).includes(player.id);
  if (owned) return <Journey pid={player.id} readOnly={readOnlyDemo()} />;

  // 没有凭证:只显示公开信息(赛事主视觉、赛事名、号码是否已被认领),不显示姓名、成绩、照片
  const pub = playerPublicView(player.id)!;
  return <Claim tag={code} pub={pub} />;
}
