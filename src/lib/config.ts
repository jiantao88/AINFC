import path from "node:path";

export const ROOT = process.cwd();
/** 每次调用都读环境变量,测试可以把数据目录指向临时目录 */
export const dataDir = () => process.env.AINFC_DATA_DIR ?? path.join(ROOT, "data");
export const FIXTURES_DIR = path.join(ROOT, "docs", "demo-fixtures");

export const demoMode = () => process.env.DEMO_MODE === "1";

export const LIMITS = {
  /** 与 docs/demo-fixtures/event.json 的测试阈值一致,正式阈值待产品确认 */
  imageMaxBytes: 20 * 1024 * 1024,
  gpxMaxBytes: 5 * 1024 * 1024,
  maxPhotos: 9,
  claimMaxFails: 5,
  claimLockMs: 60_000,
  sessionMaxAgeSec: 30 * 24 * 3600,
} as const;

export const llmConfig = () => ({
  key: process.env.LLM_API_KEY ?? "",
  baseUrl: (process.env.LLM_BASE_URL ?? "https://api.openai-next.com/v1").replace(/\/+$/, ""),
  model: process.env.LLM_MODEL ?? "gpt-4.1-mini",
  visionModel: process.env.LLM_VISION_MODEL ?? process.env.LLM_MODEL ?? "gpt-4.1-mini",
});
