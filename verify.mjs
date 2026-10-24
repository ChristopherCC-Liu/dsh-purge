#!/usr/bin/env node
/**
 * verify.mjs — 一条命令判断 dsh-purge 在这台机器上到底加载了没有。
 *
 * 背景：插件加载失败时宿主不会打印任何东西（cordis 的 logger 只进 GUI），
 * 所以没法靠日志判断。这里直接问运行时：
 *   1. 插件目录里是哪个版本
 *   2. 宿主进程监听了哪个端口
 *   3. 插件的 /dsh-purge/status 路由是否注册（404 = 没加载，200 = 已加载）
 *   4. 状态目录最近有没有被写过（插件活着就会写）
 *   5. applied.json 的版本与插件版本是否一致
 *
 * 用法：
 *   node verify.mjs                 # 检查本机
 *   node verify.mjs --profile web   # 指定 profile（默认 desktop）
 *   node verify.mjs --dsh-home DIR  # 指定 DSH_HOME
 *
 * 退出码：0 = 全部通过，1 = 有问题（输出里看哪一条 FAIL）
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import http from "node:http";

const argv = process.argv.slice(2);
const valOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
};
const DSH_HOME = path.resolve(valOf("--dsh-home") || process.env.DSH_HOME || path.join(os.homedir(), ".dsh"));
const PROFILE = valOf("--profile") || "desktop";

const PKG_DIR = path.join(DSH_HOME, "profiles", PROFILE, "node_modules", "dsh-purge");
const STATE_DIR = path.join(DSH_HOME, "dsh-purge");

let failed = 0;
const ok = (msg, detail = "") => console.log(`  ✓ ${msg}${detail ? "  " + detail : ""}`);
const bad = (msg, detail = "") => { failed += 1; console.log(`  ✗ ${msg}${detail ? "  " + detail : ""}`); };
const info = (msg) => console.log(`    ${msg}`);

console.log("dsh-purge verify");
console.log(`DSH_HOME : ${DSH_HOME}`);
console.log(`profile  : ${PROFILE}`);
console.log("");

// 1) 插件目录与版本
let pluginVersion = "";
if (!fs.existsSync(path.join(PKG_DIR, "package.json"))) {
  bad("插件目录不存在", PKG_DIR);
} else {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));
  pluginVersion = pkg.version || "";
  ok("插件目录", `${PKG_DIR}  v${pluginVersion}`);
  const hasBundle = pkg.dsh?.bundle?.patch;
  if (hasBundle) ok("bundle 声明", hasBundle);
  else bad("package.json 缺 dsh.bundle.patch");
}

// 2) profile 是否把它列进 bundles
const profilePkgPath = path.join(DSH_HOME, "profiles", PROFILE, "package.json");
let inBundles = false;
if (fs.existsSync(profilePkgPath)) {
  const profilePkg = JSON.parse(fs.readFileSync(profilePkgPath, "utf8"));
  inBundles = (profilePkg.dsh?.profile?.bundles || []).includes("dsh-purge");
  const dep = profilePkg.dependencies?.["dsh-purge"];
  if (inBundles) ok("profile bundles 含 dsh-purge", String(dep || ""));
  else bad("profile bundles 里没有 dsh-purge");
} else {
  bad("profile package.json 不存在");
}

// 3) 找宿主监听端口
function listeningPorts() {
  const out = [];
  try {
    const text = execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" });
    for (const line of text.split("\n")) {
      if (!/DeepSeek|dsh/i.test(line)) continue;
      const m = line.match(/:(\d+)\s+\(LISTEN\)/);
      if (m) out.push(Number(m[1]));
    }
  } catch { /* lsof 不可用 */ }
  return [...new Set(out)];
}

const ports = listeningPorts();
if (ports.length) ok("宿主监听端口", ports.join(", "));
else bad("没找到宿主监听端口（DSH 没在跑？）");

// 4) 探测插件路由：404 = 没加载，200 = 已加载
function probe(port, p) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method: "GET", timeout: 3000 }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "" }); });
    req.end();
  });
}

let routeOk = false;
for (const port of ports) {
  const r = await probe(port, "/dsh-purge/status");
  if (r.status === 200) {
    routeOk = true;
    ok("插件路由已注册", `http://127.0.0.1:${port}/dsh-purge/status → 200`);
    try {
      const data = JSON.parse(r.body);
      if (data.ai_base) info(`ai_base: ${data.ai_base}`);
      if (data.patches) info(`补丁: ${JSON.stringify(data.patches).slice(0, 160)}`);
    } catch { /* 非 JSON 忽略 */ }
    break;
  }
  if (r.status === 404) {
    info(`端口 ${port}: /dsh-purge/status → 404（路由未注册）`);
  }
}
if (!routeOk) bad("插件路由未注册", "宿主起来了但插件没加载（看 GUI Console 的报错）");

// 5) 状态目录活动
if (fs.existsSync(STATE_DIR)) {
  const files = fs.readdirSync(STATE_DIR)
    .map((f) => ({ f, t: fs.statSync(path.join(STATE_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const newest = files[0];
  if (newest) {
    const ageMin = Math.round((Date.now() - newest.t) / 60000);
    if (ageMin <= 10) ok("状态目录最近被写过", `${newest.f} (${ageMin} 分钟前)`);
    else info(`状态目录最近一次写入: ${newest.f} (${ageMin} 分钟前)`);
  }
} else {
  bad("状态目录不存在", STATE_DIR);
}

// 6) 落地戳与插件版本
const stampPath = path.join(STATE_DIR, "applied.json");
if (fs.existsSync(stampPath)) {
  const stamp = JSON.parse(fs.readFileSync(stampPath, "utf8"));
  if (pluginVersion && stamp.version === pluginVersion) ok("落地戳与插件版本一致", stamp.version);
  else info(`落地戳 ${stamp.version} vs 插件 ${pluginVersion}（不一致时启动会尝试重贴）`);
} else {
  info("没有 applied.json（还没执行过 apply）");
}

console.log("");
console.log(failed === 0 ? "结果: PASS" : `结果: ${failed} 项 FAIL`);
process.exit(failed === 0 ? 0 : 1);
