import { NextResponse, type NextRequest } from "next/server";
import { demoMode, hosted, readOnlyDemo } from "@/lib/config";
import { safeEqual } from "@/lib/secret";

export function proxy(req: NextRequest) {
  if (!hosted || !demoMode() || readOnlyDemo()) return NextResponse.next();

  // 可写控制台会展示认领码，并能修改所有演示选手。
  const password = process.env.AINFC_DEMO_PASSWORD;
  const expected = password ? `Basic ${Buffer.from(`demo:${password}`).toString("base64")}` : "";
  if (!expected || !safeEqual(req.headers.get("authorization") ?? "", expected)) {
    return new NextResponse("请输入演示控制台账号和密码。", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="AINFC demo", charset="UTF-8"',
        "Cache-Control": "private, no-store",
      },
    });
  }

  const site = req.headers.get("sec-fetch-site");
  if (req.method === "POST" && site && site !== "same-origin") {
    return new NextResponse("请从控制台发起操作。", { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/demo", "/api/demo/:path*"] };
