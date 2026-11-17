export type Status =
  | "unclaimed"
  | "claimed_empty"
  | "draft"
  | "generating"
  | "pending_confirmation"
  | "saved";

export type MaterialKind = "photo" | "route" | "score_image";

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

export interface Card {
  version: 1;
  title: string;
  text: string;
  textSource: "llm" | "template" | "user" | "fixture";
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
    maxPhotos: number;
    referenceRouteAvailable: boolean;
  };
  materials: {
    photos: MaterialView[];
    route: (MaterialView & { meta: RouteMeta }) | null;
    scoreImage: MaterialView | null;
  };
  score: Score | null;
  ocr: OcrResult | null;
  ocrEnabled: boolean;
  job: JobView | null;
  preview: Card | null;
  saved: { card: Card; savedAt: number } | null;
}
