import { buildState } from "@/lib/players";
import { guarded, err, json } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = guarded(async (_req, pid) => {
  const state = await buildState(pid);
  return state ? json(state) : err(404, "not found");
});
