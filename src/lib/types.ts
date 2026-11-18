export type Status =
  | "unclaimed"
  | "claimed_empty"
  | "draft"
  | "generating"
  | "pending_confirmation"
  | "saved";

export type MaterialKind = "photo" | "route" | "score_image";
export const INLINE_UPLOAD_MAX = 4 * 1024 * 1024;

export interface EventGroup {
  id: string;
  name: string;
}

export interface EventConfig {
  id: string;
  name: string;
  date: string;
  isPlaceholder: boolean;
  groups: EventGroup[];
  heroImage?: string;
  referenceRoute?: { file: string; notice?: string };
}

export interface Score {
  elapsedTime: string;
  groupId: string;
  groupName: string;
  groupRank: number | null;
  /** 用户确认的值,不是官方认证成绩 */
  source: "user_manual" | "user_confirmed_ocr" | "user_edited" | "demo_seed";
  confirmedAt: number;
}

export interface OcrResult {
  name: string | null;
  bib: string | null;
  group: string | null;
  elapsedTime: string | null;
  groupRank: number | null;
  confidence: "high" | "medium" | "low" | null;
  at: number;
  error?: string;
}

export interface RouteStats {
  distanceKm: number;
  ascentM: number | null;
  durationSec: number | null;
  pointCount: number;
}

export interface RouteMeta {
  kind: "personal" | "reference" | "screenshot";
  points?: [number, number][];
  stats?: RouteStats;
}

export type CardRoute =
  | { kind: "personal"; points: [number, number][]; stats: RouteStats }
  | { kind: "reference"; points: [number, number][] }
  | { kind: "screenshot"; materialId: string };

export interface PhotoReading {
  scene: string;
  people: string;
  gear: string;
  mood: string;
  uncertain: string[];
}

export interface JournalView {
  title: string;
  body: string;
  /** llm: 模型根据"这一刻"和照片写;template: 固定模板;user: 用户改过;fixture: 演示样例 */
  source: "llm" | "template" | "user" | "fixture";
}

export interface Card {
  version: 1;
  title: string;
  text: string;
  textSource: "llm" | "template" | "user" | "fixture";
  /** 游记:有情绪的长文。老数据没有这个字段 */
  journal?: JournalView | null;
  /** 选手自己写的"这一刻",生成时的快照 */
  moment?: string | null;
  event: { name: string; date: string; isPlaceholder: boolean };
  player: { name: string; bib: string };
  score: Pick<Score, "elapsedTime" | "groupName" | "groupRank" | "source"> | null;
  route: CardRoute | null;
  coverMaterialId: string | null;
  photoIds: string[];
  generatedAt: number;
}

export interface Step {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  detail?: string;
}

export interface JobView {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  steps: Step[];
  error: string | null;
}

export interface MaterialView {
  id: string;
  name: string;
  size: number;
  url: string | null;
}

export interface State {
  player: { id: string; name: string; bib: string; status: Status };
  event: {
    id: string;
    name: string;
    date: string;
    isPlaceholder: boolean;
    groups: EventGroup[];
    heroUrl: string;
    imageMaxBytes: number;
    directUpload?: boolean;
    maxPhotos: number;
    referenceRouteAvailable: boolean;
  };
  materials: {
    photos: MaterialView[];
    route: (MaterialView & { meta: RouteMeta }) | null;
    scoreImage: MaterialView | null;
  };
  score: Score | null;
  /** 选手写的"这一刻";draftedByAi 表示内容来自 AI 草稿且还没被用户改过 */
  moment: { text: string; draftedByAi: boolean } | null;
  /** 照片识别是否可用(需要配置大模型) */
  visionEnabled: boolean;
  ocr: OcrResult | null;
  ocrEnabled: boolean;
  job: JobView | null;
  preview: Card | null;
  saved: { card: Card; savedAt: number } | null;
}
