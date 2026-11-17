import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { downsample, parseGpx } from "@/lib/gpx";

const F = path.join(process.cwd(), "docs", "demo-fixtures");
const read = (rel: string) => fs.readFileSync(path.join(F, rel));
// docs/ 不随公开仓库分发;没有测试数据时跳过依赖它的用例
const hasFixtures = fs.existsSync(path.join(F, "routes", "xiangzhi-reference-demo.gpx"));
const ORIGINAL = path.join(process.cwd(), "docs", "gpx-samples", "beijing-xiangzhi-wgs84.gpx");

describe.skipIf(!hasFixtures)("parseGpx · 测试数据包", () => {
  it("参考路线:489 个点,有距离,没有时长和爬升", () => {
    const r = parseGpx(read("routes/xiangzhi-reference-demo.gpx"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.pointCount).toBe(489);
    expect(r.stats.distanceKm).toBeGreaterThan(9.5);
    expect(r.stats.distanceKm).toBeLessThan(10.5);
    expect(r.stats.durationSec).toBeNull();
    expect(r.stats.ascentM).toBeNull();
  });

  it("无时间戳:接受路线,不计算时长,有海拔时给爬升", () => {
    const r = parseGpx(read("errors/no-timestamps.gpx"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.durationSec).toBeNull();
    expect(r.stats.ascentM).not.toBeNull();
  });

  it.skipIf(!fs.existsSync(ORIGINAL))("原始轨迹(含时间)的爬升经平滑,不会被噪声放大到 1282 m", () => {
    const r = parseGpx(fs.readFileSync(ORIGINAL));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.durationSec).toBeGreaterThan(4 * 3600);
    expect(r.stats.ascentM!).toBeLessThan(1282);
    expect(r.stats.ascentM!).toBeGreaterThan(300);
  });

  it.each([
    ["errors/broken-xml.gpx", "not_xml"],
    ["errors/no-track-points.gpx", "no_points"],
    ["errors/not-gpx.txt", "not_xml"],
    ["errors/disguised-not-gpx.gpx", "not_gpx"],
  ])("%s 被拒绝(%s)", (file, code) => {
    const r = parseGpx(read(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });
});

describe("parseGpx · 边界", () => {
  const wrap = (pts: string) =>
    `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${pts}</trkseg></trk></gpx>`;

  it("根元素合法 XML 但不是 gpx", () => {
    const r = parseGpx("<kml><Document/></kml>");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_gpx");
  });

  it("坐标越界被拒绝", () => {
    const r = parseGpx(wrap('<trkpt lat="95" lon="116"/>'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("bad_coordinates");
  });

  it("坐标不是数字被拒绝", () => {
    const r = parseGpx(wrap('<trkpt lat="abc" lon="116"/>'));
    expect(r.ok).toBe(false);
  });

  it("只有 1 个轨迹点:接受,距离为 0", () => {
    const r = parseGpx(wrap('<trkpt lat="40" lon="116"/>'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stats.distanceKm).toBe(0);
  });

  it("时间倒序:不报时长", () => {
    const r = parseGpx(
      wrap(
        '<trkpt lat="40" lon="116"><time>2026-01-01T10:00:00Z</time></trkpt><trkpt lat="40.001" lon="116"><time>2026-01-01T09:00:00Z</time></trkpt>',
      ),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stats.durationSec).toBeNull();
  });

  it("部分点缺海拔:不报爬升", () => {
    const r = parseGpx(wrap('<trkpt lat="40" lon="116"><ele>10</ele></trkpt><trkpt lat="40.001" lon="116"/>'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stats.ascentM).toBeNull();
  });

  it("带 DOCTYPE/ENTITY 的文件被拒绝(实体膨胀)", () => {
    const r = parseGpx('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><gpx><trk/></gpx>');
    expect(r.ok).toBe(false);
  });

  it("downsample 保留首尾并限制数量", () => {
    const pts: [number, number][] = Array.from({ length: 1000 }, (_, i) => [40 + i / 1e4, 116]);
    const out = downsample(pts, 100);
    expect(out).toHaveLength(100);
    expect(out[0]).toEqual(pts[0]);
    expect(out[99]).toEqual(pts[999]);
  });
});
