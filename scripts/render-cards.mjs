#!/usr/bin/env node
/**
 * render-cards.mjs — 把 runs/ 里已抓取的响应 HTML 离线渲染成证据卡（kind='card'）。
 *
 * 为什么离线渲染而不是重新登录截屏：
 *   1. 演练约束是"静默只读、每秒 ≤2 请求、单代理串行"——重新访问会新增一串请求；
 *   2. 这些 HTML 就是当天的真实响应原文，已经躺在 runs/ 里，配合 sha256 可核对；
 *   3. 报告对 kind='card' 会自动标注 "not a live screenshot"，不会冒充实时截图。
 *
 * 用法（在目标机执行）：
 *   node render-cards.mjs --engagement "<靶标>" [--point web-app] [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { RedteamStore } from "/Users/christopher/.dsh/profiles/desktop/node_modules/dsh-purge/lib/redteam/store-core.js";

const argv = process.argv.slice(2);
const valOf = (f) => {
  const i = argv.indexOf("--" + f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : "";
};
const DRY = argv.includes("--dry-run");
const ENG = valOf("engagement");
if (!ENG) { console.error("需要 --engagement \"<靶标>\""); process.exit(1); }
const POINT = valOf("point") || "web-app";

const ROOT = process.env.REDTEAM_HOME || path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "redteam");
const ENG_DIR = path.join(ROOT, "engagements", ENG);
const RUNS = path.join(ENG_DIR, "runs");
const TMP = "/tmp/shot-render";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(CHROME)) { console.error("找不到 Chrome"); process.exit(1); }
if (!fs.existsSync(RUNS)) { console.error("没有 runs/ 目录: " + RUNS); process.exit(1); }

/* 目标系统的 HTML 引用相对 CSS，file:// 下加载不到，表格会挤成一坨。
   这里只补"能读"的最小样式，不改任何正文内容。 */
const MIN_CSS = `<style>
body{font:14px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#fff;color:#111;padding:16px}
table{border-collapse:collapse;width:100%;margin:8px 0}
td,th{border:1px solid #cfcfcf;padding:4px 8px;font-size:13px;text-align:left}
th{background:#f2f4f7;font-weight:600}
img{max-width:100%;height:auto}
a{color:#0b6bcb}
</style>`;

const htmls = fs.readdirSync(RUNS).filter((f) => /\.html?$/i.test(f)).sort();
if (htmls.length === 0) { console.error("runs/ 里没有 HTML"); process.exit(1); }

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const store = DRY ? null : new RedteamStore(ROOT);
let made = 0;

for (const f of htmls) {
  const src = path.join(RUNS, f);
  let html = fs.readFileSync(src, "utf8");
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + MIN_CSS) : MIN_CSS + html;
  const tmpHtml = path.join(TMP, f);
  fs.writeFileSync(tmpHtml, html, "utf8");

  const png = path.join(TMP, f.replace(/\.html?$/i, "") + ".png");
  const profileDir = path.join(TMP, "profile-" + made);
  try {
    execFileSync(CHROME, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
      /* 每个实例独立 profile：共用默认 profile 会撞 Chrome 单例锁，
         后启动的实例直接退出，截图既不报错也不落盘（表现为随机失败）。 */
      "--user-data-dir=" + profileDir, "--no-first-run", "--no-default-browser-check",
      /* 页面本身不长（一屏表格），高度 1400 够用；更大只是留白。
         不要加 --virtual-time-budget：它会在预算到期时直接退出，截图还没落盘就没了。 */
      /* 页面外链的 CSS/JS/图片指向 ive.gzeducms.cn，file:// 下照样会去请求，
         网络一慢就卡到超时（表现为随机几张失败）。把所有域名解析到死端口，
         请求立刻失败，渲染只靠内联内容 + 注入的最小样式。 */
      "--host-resolver-rules=MAP * 127.0.0.1:1",
      "--window-size=1440,1400", `--screenshot=${png}`, "file://" + tmpHtml,
    ], { stdio: "ignore", timeout: 60000 });
  } catch (e) {
    console.log(`  [skip] ${f}: Chrome 渲染失败`);
    continue;
  }
  if (!fs.existsSync(png) || fs.statSync(png).size === 0) {
    console.log(`  [skip] ${f}: 没有产出 PNG`);
    continue;
  }

  const bytes = fs.statSync(png).size;
  const label = f.replace(/\.html?$/i, "").replace(/^ive-/, "").replace(/-/g, " ");
  if (DRY) {
    console.log(`  [dry] ${f} → ${png} (${Math.round(bytes / 1024)} KB, label="${label}")`);
  } else {
    store.addShot(ENG, {
      path: png,
      kind: "card",
      point_code: POINT,
      target: "ive.gzeducms.cn",
      label,
      note: `离线渲染自 runs/${f}（当天响应原文，非实时截图；原文见同目录）`,
      source_ref: `runs/${f}`,
      found_by_agent: "render-cards",
    });
    console.log(`  [ok] ${f} → 证据卡 ${Math.round(bytes / 1024)} KB`);
  }
  made += 1;
}

if (store) store.close();
console.log(`\n${DRY ? "将生成" : "已生成"} ${made} 张证据卡（point=${POINT}）`);
