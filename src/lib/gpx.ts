import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { RouteStats } from "./types";

export type GpxResult =
  | { ok: true; points: [number, number][]; stats: RouteStats }
  | { ok: false; code: "not_xml" | "not_gpx" | "no_points" | "bad_coordinates"; message: string };

const MAX_POINTS = 50_000;

function toArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const p1 = (a[0] * Math.PI) / 180;
  const p2 = (b[0] * Math.PI) / 180;
  const dphi = p2 - p1;
  const dl = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 滑动平均,压制海拔噪声,避免把噪声累加成虚高的爬升 */
function smooth(values: number[], radius = 3): number[] {
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      sum += values[j];
      n++;
    }
    return sum / n;
  });
}

export function parseGpx(input: Buffer | string): GpxResult {
  const text = typeof input === "string" ? input : input.toString("utf8");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false, // 不展开实体,防止实体膨胀
    allowBooleanAttributes: true,
  });

  // 先用严格校验器挡住不完整 XML(fast-xml-parser 解析器本身对残缺文档很宽容)
  if (XMLValidator.validate(text) !== true) {
    return { ok: false, code: "not_xml", message: "文件不是有效的 XML,无法解析轨迹" };
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    return { ok: false, code: "not_xml", message: "不支持带 DOCTYPE/ENTITY 的文件" };
  }

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, code: "not_xml", message: "文件不是有效的 XML,无法解析轨迹" };
  }

  const gpx = doc.gpx as Record<string, unknown> | undefined;
  if (!gpx || typeof gpx !== "object") {
    return { ok: false, code: "not_gpx", message: "这不是 GPX 文件(根元素不是 gpx)" };
  }

  type Pt = { "@_lat"?: string; "@_lon"?: string; ele?: string; time?: string };
  const pts: Pt[] = [];
  for (const trk of toArray(gpx.trk as Record<string, unknown> | Record<string, unknown>[])) {
    for (const seg of toArray(trk.trkseg as Record<string, unknown> | Record<string, unknown>[])) {
      if (seg && typeof seg === "object") pts.push(...toArray(seg.trkpt as Pt | Pt[]));
    }
  }
  if (pts.length === 0) {
    return { ok: false, code: "no_points", message: "GPX 里没有可用的轨迹点" };
  }
  if (pts.length > MAX_POINTS) {
    return { ok: false, code: "bad_coordinates", message: `轨迹点过多(超过 ${MAX_POINTS})` };
  }

  const coords: [number, number][] = [];
  const eles: (number | null)[] = [];
  const times: (number | null)[] = [];
  for (const p of pts) {
    const lat = Number(p["@_lat"]);
    const lon = Number(p["@_lon"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { ok: false, code: "bad_coordinates", message: "轨迹点坐标无效或超出范围" };
    }
    coords.push([lat, lon]);
    const ele = p.ele === undefined ? NaN : Number(p.ele);
    eles.push(Number.isFinite(ele) ? ele : null);
    const t = p.time === undefined ? NaN : Date.parse(p.time);
    times.push(Number.isFinite(t) ? t : null);
  }

  let dist = 0;
  for (let i = 1; i < coords.length; i++) dist += haversine(coords[i - 1], coords[i]);

  // 海拔:每个点都要有,否则不报爬升
  let ascentM: number | null = null;
  if (eles.every((e) => e !== null)) {
    const sm = smooth(eles as number[]);
    let up = 0;
    for (let i = 1; i < sm.length; i++) if (sm[i] > sm[i - 1]) up += sm[i] - sm[i - 1];
    ascentM = Math.round(up);
  }

  // 时长:每个点都要有时间且单调不减,否则不报时长
  let durationSec: number | null = null;
  if (times.every((t) => t !== null)) {
    const ts = times as number[];
    const monotonic = ts.every((t, i) => i === 0 || t >= ts[i - 1]);
    if (monotonic && ts[ts.length - 1] > ts[0]) durationSec = Math.round((ts[ts.length - 1] - ts[0]) / 1000);
  }

  return {
    ok: true,
    points: coords,
    stats: {
      distanceKm: Math.round(dist / 10) / 100,
      ascentM,
      durationSec,
      pointCount: coords.length,
    },
  };
}

/** 抽稀到最多 n 个点,用于卡片绘制和预览;保留首尾 */
export function downsample(points: [number, number][], n = 240): [number, number][] {
  if (points.length <= n) return points;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push(points[Math.round((i * (points.length - 1)) / (n - 1))]);
  return out;
}
