/**
 * patch-inject.mjs — 往 prompt-inject.md 里插入一段并走插件的保存接口。
 *
 * 为什么不能直接写文件：dsh-purge 用 override-state.json 记 hash，
 * `customized:false` 时启动会把文件"刷新"回默认内容——手改的东西下次启动就没了。
 * 必须调 saveOverrideContent()，它同时写文件、更新 hash、把 customized 置真。
 *
 * 用法：
 *   node patch-inject.mjs --home ~/.dsh --marker ZERO-CONFIRMATION --block-file ./block.md
 *   node patch-inject.mjs --home ~/.dsh --check        # 只报告是否已插入
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const argv = process.argv.slice(2);
const valOf = (f) => {
  const i = argv.indexOf("--" + f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
};
const HOME = path.resolve(valOf("home") || process.env.DSH_HOME || path.join(os.homedir(), ".dsh"));
const MARKER = valOf("marker") || "ZERO-CONFIRMATION";
const BLOCK_FILE = valOf("block-file");
const CHECK = argv.includes("--check");

const PLUGIN = path.join(HOME, "profiles", "desktop", "node_modules", "dsh-purge", "lib", "core.js");
if (!fs.existsSync(PLUGIN)) { console.error("找不到插件: " + PLUGIN); process.exit(1); }
const core = await import("file://" + PLUGIN);

const file = path.join(HOME, "prompt-inject.md");
if (!fs.existsSync(file)) { console.error("没有 " + file); process.exit(1); }
const current = fs.readFileSync(file, "utf8");
const has = current.includes(MARKER);

if (CHECK) {
  console.log(JSON.stringify({ file, hasMarker: has, bytes: Buffer.byteLength(current) }, null, 1));
  process.exit(has ? 0 : 1);
}

if (has) { console.log("[skip] 已存在 " + MARKER); process.exit(0); }
if (!BLOCK_FILE || !fs.existsSync(BLOCK_FILE)) { console.error("需要 --block-file"); process.exit(1); }
const block = fs.readFileSync(BLOCK_FILE, "utf8");

/* 插在 Workflow 之前；找不到就放在文件头部第二行之后（保留 <|im_start|>system 信封）。 */
const anchor = "**Workflow**";
let next;
if (current.includes(anchor)) {
  next = current.replace(anchor, block.trimEnd() + "\n\n" + anchor);
} else {
  const lines = current.split("\n");
  lines.splice(Math.min(2, lines.length), 0, block.trimEnd(), "");
  next = lines.join("\n");
}

const saved = await core.saveOverrideContent(HOME, next);
console.log("[ok] 写入 " + saved.path);
console.log("     customized = " + saved.customized);
console.log("     bytes      = " + Buffer.byteLength(next));
