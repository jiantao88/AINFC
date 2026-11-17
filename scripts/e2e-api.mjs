// 端到端 API 测试:针对正在运行的服务(默认 http://localhost:3100,DEMO_MODE=1)
// 用法: node scripts/e2e-api.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3100";
const FIX = path.join(process.cwd(), "docs", "demo-fixtures");
let pass = 0;
const failures = [];

function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
}

const jar = new Map(); // 每个"手机"一个 cookie 罐
function client(label) {
  const cookies = new Map();
  jar.set(label, cookies);
  return async (url, init = {}) => {
    const headers = { ...(init.headers ?? {}) };
    if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + url, { ...init, headers, redirect: "manual" });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [kv] = sc.split(";");
      const i = kv.indexOf("=");
      cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const type = res.headers.get("content-type") ?? "";
    const body = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body, headers: res.headers };
  };
}
const json = (b) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const put = (b) => ({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

async function upload(c, pid, kind, file, name) {
  const buf = typeof file === "string" ? fs.readFileSync(file) : file;
  const fd = new FormData();
  fd.set("kind", kind);
  fd.set("file", new Blob([buf]), name ?? (typeof file === "string" ? path.basename(file) : "x"));
  return c(`/api/p/${pid}/materials`, { method: "POST", body: fd });
}

const anon = client("anon");
const phoneA = client("A");
const phoneB = client("B");

async function main() {
  console.log("准备:重置全部数据");
  let r = await anon("/api/demo/action", json({ action: "reset_all" }));
  check("重置成功", r.status === 200, JSON.stringify(r.body));
  const demo = (await anon("/api/demo/state")).body.players;
  const P = Object.fromEntries(demo.map((p) => [p.id, p]));
  const tagOf = (p) => p.medalUrl.split("/t/")[1];
  const lin = P["demo-001"], chen = P["demo-002"], xu = P["demo-003"];

  console.log("\n[1] 未授权访问不能看到私人内容");
  for (const pid of ["demo-001", "demo-002", "demo-003"]) {
    r = await anon(`/api/p/${pid}/state`);
    check(`无凭证读取 ${pid} 状态 → 404`, r.status === 404);
  }
  r = await anon(`/api/p/demo-003/materials/whatever`);
  check("无凭证读取照片 → 404", r.status === 404);
  r = await anon("/api/p/nope/state");
  check("不存在的选手与无权限响应一致(404)", r.status === 404);
  const page = await anon(`/t/${tagOf(xu)}`);
  const html = page.body.toString("utf8");
  check("已保存选手的公开页 200", page.status === 200);
  check("公开页不含姓名", !html.includes(xu.name), "泄露了姓名 " + xu.name);
  check("公开页不含成绩", !html.includes("01:56:48"));
  check("公开页不含认领码", !html.includes(xu.claimCode));
  r = await anon("/t/doesnotexist");
  check("无效标签 → 404", r.status === 404);

  console.log("\n[2] 认领:码错误、锁定、成功");
  r = await anon("/api/claim", json({ tag: tagOf(lin), code: "AAAAAA" }));
  check("错误认领码 → 401 且提示剩余次数", r.status === 401 && r.body.left === 4, JSON.stringify(r.body));
  r = await anon("/api/claim", json({ tag: tagOf(lin), code: "" }));
  check("空认领码 → 400", r.status === 400);
  r = await anon("/api/claim", json({ tag: "bad", code: lin.claimCode }));
  check("无效标签认领 → 404", r.status === 404);
  r = await anon("/api/claim", json({ tag: tagOf(lin), code: lin.bib }));
  check("用公开号码当认领码 → 拒绝", r.status === 401);
  r = await anon("/api/claim", json({ tag: tagOf(chen), code: lin.claimCode }));
  check("用别人的认领码 → 拒绝", r.status === 401);
  for (let i = 0; i < 4; i++) r = await anon("/api/claim", json({ tag: tagOf(lin), code: "ZZZZZZ" }));
  check("连续错误后锁定 → 429", r.status === 429, JSON.stringify(r.body));
  r = await anon("/api/claim", json({ tag: tagOf(lin), code: lin.claimCode }));
  check("锁定期间即使码正确也拒绝", r.status === 429);
  // 锁定会拖慢后面的测试:重置后换一部手机继续
  await anon("/api/demo/action", json({ action: "reset_all" }));

  console.log("\n[3] 认领成功后的权限边界");
  r = await phoneA("/api/claim", json({ tag: tagOf(lin), code: lin.claimCode.toLowerCase() }));
  check("小写认领码也可认领(不区分大小写)", r.status === 200, JSON.stringify(r.body));
  check("响应设置了 HttpOnly Cookie", /HttpOnly/i.test((r.headers.getSetCookie?.() ?? []).join(";")));
  r = await phoneA("/api/p/demo-001/state");
  check("本人读取自己的状态", r.status === 200 && r.body.player.status === "claimed_empty");
  r = await phoneA("/api/p/demo-003/state");
  check("本人不能读他人的状态", r.status === 404);
  r = await phoneA("/api/p/demo-002/state");
  check("本人不能读另一人的状态", r.status === 404);
  r = await phoneB("/api/p/demo-001/state");
  check("另一部手机没有 Cookie 读不到", r.status === 404);
  r = await phoneB("/api/p/demo-001/flow", json({ action: "generate" }));
  check("没有凭证不能触发生成", r.status === 404);

  console.log("\n[4] 素材上传与校验");
  const hero = path.join(FIX, "assets/02-山脊奔跑.png");
  r = await upload(phoneA, "demo-001", "photo", hero);
  check("上传 PNG 照片", r.status === 200, JSON.stringify(r.body));
  const photoId = r.body.id;
  r = await phoneA("/api/p/demo-001/state");
  check("状态变为 draft", r.body.player.status === "draft", r.body.player.status);
  check("照片可经鉴权接口读回", (await phoneA(`/api/p/demo-001/materials/${photoId}`)).status === 200);
  check("别人读不到这张照片", (await phoneB(`/api/p/demo-001/materials/${photoId}`)).status === 404);
  check("另一选手的会话读不到这张照片", (await anon(`/api/p/demo-001/materials/${photoId}`)).status === 404);

  r = await upload(phoneA, "demo-001", "photo", Buffer.from("<html>not an image</html>"), "fake.png");
  check("伪装成 PNG 的文本被拒绝 → 415", r.status === 415, JSON.stringify(r.body));
  r = await upload(phoneA, "demo-001", "photo", Buffer.alloc(0), "empty.png");
  check("空文件被拒绝 → 400", r.status === 400);
  const big = path.join(FIX, "errors/oversized-27mb.png");
  if (fs.existsSync(big)) {
    r = await upload(phoneA, "demo-001", "photo", big);
    check("27 MiB 大图被拒绝 → 413 且说明上限", r.status === 413 && /上限/.test(r.body.error), JSON.stringify(r.body));
    r = await phoneA("/api/p/demo-001/state");
    check("大图被拒后,已传的照片仍在", r.body.materials.photos.length === 1);
  } else console.log("  - 跳过大图测试(oversized-27mb.png 不在本机)");

  console.log("\n[5] GPX:正常与异常文件");
  r = await upload(phoneA, "demo-001", "route", path.join(FIX, "errors/broken-xml.gpx"));
  check("坏 XML → 422", r.status === 422 && r.body.code === "not_xml", JSON.stringify(r.body));
  r = await upload(phoneA, "demo-001", "route", path.join(FIX, "errors/no-track-points.gpx"));
  check("无轨迹点 → 422", r.status === 422 && r.body.code === "no_points");
  r = await upload(phoneA, "demo-001", "route", path.join(FIX, "errors/disguised-not-gpx.gpx"));
  check("伪装 GPX → 422", r.status === 422);
  r = await upload(phoneA, "demo-001", "route", path.join(FIX, "errors/not-gpx.txt"));
  check("非 GPX 文本 → 422", r.status === 422);
  r = await phoneA("/api/p/demo-001/state");
  check("所有异常 GPX 都没有入库", r.body.materials.route === null);
  r = await upload(phoneA, "demo-001", "route", path.join(FIX, "errors/no-timestamps.gpx"));
  check("无时间戳 GPX 被接受", r.status === 200, JSON.stringify(r.body));
  check("提示没有用时信息", /无时间|不显示用时/.test(r.body.note ?? ""));
  r = await phoneA("/api/p/demo-001/state");
  check("路线为个人轨迹,时长为空", r.body.materials.route?.meta.kind === "personal" && r.body.materials.route.meta.stats.durationSec == null);
  r = await phoneA("/api/p/demo-001/route-ref", json({}));
  check("改用参考路线,替换了个人轨迹", r.status === 200);
  r = await phoneA("/api/p/demo-001/state");
  check("参考路线标为 reference,无爬升无时长", r.body.materials.route.meta.kind === "reference" && r.body.materials.route.meta.stats.ascentM == null && r.body.materials.route.meta.stats.durationSec == null, JSON.stringify(r.body.materials.route?.meta.stats));

  console.log("\n[6] 成绩:校验与手填");
  r = await phoneA("/api/p/demo-001/score", put({ elapsedTime: "abc", groupId: "demo-open" }));
  check("非法用时 → 400", r.status === 400 && r.body.field === "elapsedTime");
  r = await phoneA("/api/p/demo-001/score", put({ elapsedTime: "00:00:00", groupId: "demo-open" }));
  check("0 用时 → 400", r.status === 400);
  r = await phoneA("/api/p/demo-001/score", put({ elapsedTime: "01:42:36", groupId: "不存在的组" }));
  check("未知组别 → 400", r.status === 400 && r.body.field === "groupId");
  r = await phoneA("/api/p/demo-001/score", put({ elapsedTime: "01:42:36", groupId: "demo-open", groupRank: -3 }));
  check("负数排名 → 400", r.status === 400);
  r = await phoneA("/api/p/demo-001/score", put({ elapsedTime: "01:42:36", groupId: "demo-open", groupRank: 1.5 }));
  check("小数排名 → 400", r.status === 400);
  r = await phoneA("/api/p/demo-001/score", put({ elapsedTime: "1:42:36", groupId: "demo-open", groupRank: "12" }));
  check("合法成绩保存,用时规整为 01:42:36", r.status === 200 && r.body.score.elapsedTime === "01:42:36" && r.body.score.groupRank === 12, JSON.stringify(r.body));
  check("手填来源 = user_manual,不是官方", r.body.score.source === "user_manual");

  console.log("\n[7] 成绩截图识别(真实调用大模型)");
  r = await upload(phoneA, "demo-001", "score_image", path.join(FIX, "scores/01.png"));
  check("上传成绩截图", r.status === 200);
  r = await phoneA("/api/p/demo-001/ocr", json({}));
  check("识别返回结果", r.status === 200 && r.body.ocr, JSON.stringify(r.body).slice(0, 200));
  if (r.body.ok) {
    check("识别用时 = 01:42:36", r.body.ocr.elapsedTime === "01:42:36", r.body.ocr.elapsedTime);
    check("识别排名 = 12", r.body.ocr.groupRank === 12);
  } else console.log("  - 识别服务不可用:", r.body.ocr?.error);

  console.log("\n[8] 生成 → 预览 → 编辑 → 保存");
  r = await phoneA("/api/p/demo-001/flow", json({ action: "generate" }));
  check("开始生成 → 202", r.status === 202, JSON.stringify(r.body));
  r = await phoneA("/api/p/demo-001/flow", json({ action: "generate" }));
  check("生成中重复触发 → 409", r.status === 409);
  r = await upload(phoneA, "demo-001", "photo", hero);
  check("生成中不能改素材 → 409", r.status === 409);
  let st;
  for (let i = 0; i < 120; i++) {
    await new Promise((x) => setTimeout(x, 1000));
    st = (await phoneA("/api/p/demo-001/state")).body;
    if (st.player.status !== "generating") break;
  }
  check("生成结束进入待确认", st.player.status === "pending_confirmation", `${st.player.status} ${JSON.stringify(st.job)}`);
  check("任务步骤全部 done", st.job.steps.every((s) => s.status === "done"), JSON.stringify(st.job.steps.map((s) => s.status)));
  const card = st.preview;
  check("卡片姓名、号码与选手一致", card.player.name === "林小野" && card.player.bib === "DEMO 021");
  check("卡片成绩 = 用户确认值", card.score.elapsedTime === "01:42:36" && card.score.groupRank === 12);
  check("卡片成绩不标官方", card.score.source !== "official");
  check("路线标为参考路线", card.route.kind === "reference");
  check("文案已生成且校验过", card.text.length >= 20, card.text);
  console.log("    文案(" + card.textSource + "):" + card.text);
  check("此时尚未保存", st.saved === null);

  r = await phoneA("/api/p/demo-001/flow", json({ action: "edit", score: { elapsedTime: "01:40:00", groupRank: null } }));
  check("编辑成绩 → 来源标为用户编辑,排名清空", r.status === 200 && r.body.preview.score.source === "user_edited" && r.body.preview.score.groupRank === null, JSON.stringify(r.body).slice(0, 200));
  r = await phoneA("/api/p/demo-001/flow", json({ action: "edit", score: { elapsedTime: "bad" } }));
  check("编辑成绩格式错误 → 400", r.status === 400);
  r = await phoneA("/api/p/demo-001/flow", json({ action: "edit", title: "我的西山", text: "我自己写的一段话" }));
  check("编辑标题和文案", r.status === 200 && r.body.preview.title === "我的西山" && r.body.preview.textSource === "user");
  r = await phoneA("/api/p/demo-001/flow", json({ action: "edit", coverMaterialId: "not-a-photo" }));
  check("封面必须是已上传照片 → 400", r.status === 400);
  r = await phoneA("/api/p/demo-001/flow", json({ action: "save" }));
  check("确认保存", r.status === 200);
  st = (await phoneA("/api/p/demo-001/state")).body;
  check("状态 = saved", st.player.status === "saved");
  check("保存的是编辑后的值", st.saved.card.title === "我的西山" && st.saved.card.score.elapsedTime === "01:40:00");
  check("预览已清除", st.preview === null);
  r = await phoneA("/api/p/demo-001/flow", json({ action: "save" }));
  check("重复保存 → 409", r.status === 409);

  console.log("\n[9] 再次触碰:回到同一份记忆");
  const again = client("A-again");
  r = await again(`/t/${tagOf(lin)}`);
  check("无 Cookie 再次触碰只看到认领页", !r.body.toString().includes("我的西山"));
  r = await again("/api/claim", json({ tag: lin.bibUrl.split("/t/")[1], code: lin.claimCode }));
  check("用号码簿标签 + 认领码也能回到同一份记忆", r.status === 200);
  r = await again("/api/p/demo-001/state");
  check("号码簿与奖牌指向同一份记忆", r.body.saved?.card.title === "我的西山");

  console.log("\n[10] 补充素材重新生成:旧版保留,确认前不替换");
  r = await phoneA("/api/p/demo-001/flow", json({ action: "generate" }));
  check("已保存后可重新生成", r.status === 202, JSON.stringify(r.body));
  for (let i = 0; i < 120; i++) {
    await new Promise((x) => setTimeout(x, 1000));
    st = (await phoneA("/api/p/demo-001/state")).body;
    if (st.player.status !== "generating") break;
  }
  check("新版本进入待确认", st.player.status === "pending_confirmation");
  check("旧版本仍保留(标题仍是编辑后的)", st.saved?.card.title === "我的西山");
  check("新预览是重新生成的版本", st.preview.title !== "我的西山");
  r = await phoneA("/api/p/demo-001/flow", json({ action: "discard" }));
  st = (await phoneA("/api/p/demo-001/state")).body;
  check("放弃新版本 → 回到 saved,旧版不变", r.status === 200 && st.player.status === "saved" && st.saved.card.title === "我的西山");

  console.log("\n[10b] 已保存的选手重新生成失败:回到已保存,旧版仍可见,可重试");
  await anon("/api/demo/action", json({ action: "set_fault", playerId: "demo-001", kind: "generate_fail", on: true }));
  r = await phoneA("/api/p/demo-001/flow", json({ action: "generate" }));
  check("开始重新生成", r.status === 202);
  for (let i = 0; i < 30; i++) {
    await new Promise((x) => setTimeout(x, 700));
    st = (await phoneA("/api/p/demo-001/state")).body;
    if (st.player.status !== "generating") break;
  }
  check("失败后状态回到 saved(不是 draft)", st.player.status === "saved", st.player.status);
  check("旧版本仍在", st.saved?.card.title === "我的西山");
  check("失败原因可见", st.job.status === "failed" && !!st.job.error);
  await anon("/api/demo/action", json({ action: "set_fault", playerId: "demo-001", kind: "generate_fail", on: false }));

  console.log("\n[11] 失败恢复:注入失败后素材保留、可重试");
  await anon("/api/demo/action", json({ action: "set_fault", playerId: "demo-002", kind: "generate_fail", on: true }));
  r = await phoneB("/api/claim", json({ tag: tagOf(chen), code: chen.claimCode }));
  check("陈逐风认领", r.status === 200);
  await upload(phoneB, "demo-002", "photo", hero);
  r = await phoneB("/api/p/demo-002/flow", json({ action: "generate" }));
  check("开始生成", r.status === 202);
  for (let i = 0; i < 30; i++) {
    await new Promise((x) => setTimeout(x, 700));
    st = (await phoneB("/api/p/demo-002/state")).body;
    if (st.player.status !== "generating") break;
  }
  check("生成失败后状态回到草稿", st.player.status === "draft", st.player.status);
  check("失败原因可见", st.job.status === "failed" && !!st.job.error, JSON.stringify(st.job));
  check("失败后照片仍保留", st.materials.photos.length === 1);
  await anon("/api/demo/action", json({ action: "set_fault", playerId: "demo-002", kind: "generate_fail", on: false }));
  r = await phoneB("/api/p/demo-002/flow", json({ action: "generate" }));
  check("关闭故障后重试成功", r.status === 202);
  for (let i = 0; i < 120; i++) {
    await new Promise((x) => setTimeout(x, 1000));
    st = (await phoneB("/api/p/demo-002/state")).body;
    if (st.player.status !== "generating") break;
  }
  check("重试后进入待确认", st.player.status === "pending_confirmation");
  check("无成绩、无轨迹时生成简版卡片,不填造假值", st.preview.score === null && st.preview.route === null);
  check("简版文案不含用时、公里、名次", !/用时|公里|第\s*\d+\s*名/.test(st.preview.text), st.preview.text);

  console.log("\n[12] 上传失败可单项重试");
  await anon("/api/demo/action", json({ action: "set_fault", playerId: "demo-002", kind: "upload_fail", on: true }));
  await phoneB("/api/p/demo-002/flow", json({ action: "discard" }));
  r = await upload(phoneB, "demo-002", "photo", hero);
  check("注入上传失败 → 500 且有说明", r.status === 500 && !!r.body.error);
  await anon("/api/demo/action", json({ action: "set_fault", playerId: "demo-002", kind: "upload_fail", on: false }));
  r = await upload(phoneB, "demo-002", "photo", hero);
  check("关闭故障后重试上传成功", r.status === 200);

  console.log("\n[13] 演示接口只在 DEMO_MODE 下开放");
  r = await anon("/api/demo/state");
  check("DEMO_MODE=1 时控制台接口可用", r.status === 200);

  console.log(`\n结果:${pass} 通过,${failures.length} 失败`);
  if (failures.length) {
    console.log("失败项:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("测试脚本异常:", e);
  process.exit(2);
});
