#!/usr/bin/env node
/**
 * 把一个靶标的得分报告导出成可移动的交付包：`<outDir>/<靶标>-红队成果复现报告.md` + `<outDir>/shots/`。
 *
 * 面板下载的 markdown 里，证据截图走绝对路径，发给别人会碎图。
 * 这里把 shots/ 一并拷到输出目录，markdown 用相对路径。
 *
 * 跑法：
 *   node scripts/export-engagement-report.mjs
 *   node scripts/export-engagement-report.mjs --out ~/交付/靶标名
 *   node scripts/export-engagement-report.mjs --engagement <id>
 */
import { mkdirSync, writeFileSync, cpSync, rmSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { RedteamStore } from "../lib/redteam/store-core.js";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf("--" + name);
  return i === -1 || argv[i + 1] === undefined ? fallback : argv[i + 1];
};

const root = process.env.REDTEAM_HOME || join(process.env.DSH_HOME || join(homedir(), ".dsh"), "redteam");
const store = new RedteamStore(root);
const id = argOf("engagement", store.activeEngagementId());
if (!id) {
  console.error("没有可用靶标：先用面板创建，或用 --engagement <id> 指定");
  process.exit(1);
}
const outDir = resolve(argOf("out", process.cwd()));
mkdirSync(outDir, { recursive: true });

/* 证据目录一并搬走：截图给"看到了什么"，runs/ 给"怎么拿到的"（命令回显、原始响应、日志）。
   只拷 shots 的话，委托方拿到的报告会指向一堆不存在的证据文件。 */
for (const sub of ["shots", "runs"]) {
  const src = join(root, "engagements", id, sub);
  const dst = join(outDir, sub);
  if (!existsSync(src)) continue;
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
}

const rep = store.scoreReport(id, { shotRef: "relative" });
/* 把证据文件引用里的绝对前缀改成相对路径，和拷过去的 runs/ 对齐。 */
const fixRefs = (md) => String(md).split(join(root, "engagements", id) + "/").join("");
const name = String(rep.target || id).replace(/[/\\:*?"<>|]/g, "_");
const outFile = join(outDir, name + "-红队成果复现报告.md");
writeFileSync(outFile, fixRefs(rep.markdown), "utf8");
store.close();

const imgs = (rep.markdown.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
console.log("✓ 报告：" + outFile);
const copied = ["shots", "runs"].filter((sub) => existsSync(join(outDir, sub)));
console.log("  合计 " + rep.summary.points + " 分 · " + rep.items.length + " 条正文 · 嵌入截图 " + imgs + " 张"
  + (copied.length ? "（已附带 " + copied.map((sub) => sub + "/ " + readdirSync(join(outDir, sub)).length + " 个文件").join("、") + "）" : ""));
