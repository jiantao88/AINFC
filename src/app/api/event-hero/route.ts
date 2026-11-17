import fs from "node:fs";
import { loadFixtureEvent, fixturePath } from "@/lib/seed";

export const dynamic = "force-dynamic";

/** 赛事主视觉是公开的(任何人触碰标签都会看到)。文件缺失时返回 404,页面用渐变占位 */
export async function GET() {
  const hero = loadFixtureEvent().heroImage;
  if (!hero) return new Response("not found", { status: 404 });
  const file = fixturePath(hero);
  if (!fs.existsSync(file)) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" },
  });
}
