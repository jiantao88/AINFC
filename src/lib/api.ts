import { authorize } from "./auth";
import { getPlayer } from "./players";
import { readOnlyDemo } from "./config";

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export const err = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  json({ error: message, ...extra }, status);

type Ctx = { params: Promise<{ pid: string } & Record<string, string>> };

/**
 * 包装需要登录的选手接口:未登录、凭证不属于该选手、选手不存在,一律返回同样的 404,
 * 不区分原因,避免通过响应差异探测哪些号码存在
 */
export function guarded(
  handler: (req: Request, pid: string, ctx: Ctx) => Promise<Response> | Response,
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    const { pid } = await ctx.params;
    try {
      if (!(await authorize(req, pid)) || !(await getPlayer(pid))) return err(404, "not found");
      if (readOnlyDemo() && req.method !== "GET") return err(503, "当前线上演示仅供浏览");
      return await handler(req, pid, ctx);
    } catch (e) {
      console.error("api error", req.method, new URL(req.url).pathname, e instanceof Error ? e.message : e);
      return err(500, "服务器出错了,请重试");
    }
  };
}
