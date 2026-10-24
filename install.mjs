#!/usr/bin/env node
/**
 * install.mjs — 把本仓库接进本机 DeepSeek Harness 的 profile。
 *
 * 目标：任何一台 Mac（已装官方 DeepSeek Harness）上，git clone 之后
 *   node install.mjs
 * 一条命令完成接入；全程不联网、不拉远程包，用的就是这份 clone。
 *
 * 做的事：
 *   1. 找 $DSH_HOME（默认 ~/.dsh）下所有 profiles/<name>/package.json
 *   2. dependencies["dsh-purge"] = link:<本仓库绝对路径>（--copy 时写 file:<路径>）
 *   3. 确保 dsh.profile.bundles 里有 "dsh-purge"
 *   4. node_modules/dsh-purge 落成指向本仓库的符号链接（旧的实体目录先备份）
 *
 * 常用：
 *   node install.mjs                 # 所有 profile
 *   node install.mjs --profile desktop
 *   node install.mjs --check         # 只报告，不写
 *   node install.mjs --copy          # 复制一份进 profile，不依赖仓库路径
 *   node install.mjs --uninstall     # 撤掉依赖、bundles 条目与 node_modules 链接
 *   node install.mjs --dsh-home /path/to/.dsh
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const REPO_DIR = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(REPO_DIR, "package.json"), "utf8"));
const NAME = PKG.name || "dsh-purge";
const VERSION = PKG.version || "";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const hit = argv.find((a) => a.startsWith(`${flag}=`));
  if (hit) return hit.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
};

const CHECK = has("--check");
const COPY = has("--copy");
const UNINSTALL = has("--uninstall");
const WANT_PROFILE = valueOf("--profile");
const DSH_HOME = path.resolve(valueOf("--dsh-home") || process.env.DSH_HOME || path.join(os.homedir(), ".dsh"));

const log = (msg = "") => console.log(msg);

function fail(msg) {
  console.error(`\n[install] ${msg}`);
  process.exit(1);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function profilesUnder(home) {
  const root = path.join(home, "profiles");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, dir: path.join(root, d.name) }))
    .filter((p) => fs.existsSync(path.join(p.dir, "package.json")));
}

function backupExisting(target, home) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(home, ".dsh-purge-backup", `${stamp}-${path.basename(target)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(target, dest);
  return dest;
}

function linkTarget() {
  // 绝对路径：/tmp、外接盘、符号链接过的 HOME 都不会把相对路径算歪
  return REPO_DIR;
}

function specFor() {
  return `${COPY ? "file" : "link"}:${REPO_DIR}`;
}

function ensureBundle(pkg) {
  pkg.dsh = pkg.dsh && typeof pkg.dsh === "object" ? pkg.dsh : {};
  pkg.dsh.profile = pkg.dsh.profile && typeof pkg.dsh.profile === "object" ? pkg.dsh.profile : {};
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
  if (bundles.includes(NAME)) return false;
  // 放在官方 web-app 之后、其它本地插件之前，保持加载顺序
  const anchor = bundles.findIndex((b) => String(b).startsWith("@deepseek-ai/dsh-web-app"));
  if (anchor >= 0) bundles.splice(anchor + 1, 0, NAME);
  else bundles.push(NAME);
  pkg.dsh.profile.bundles = bundles;
  return true;
}

function dropBundle(pkg) {
  const bundles = pkg?.dsh?.profile?.bundles;
  if (!Array.isArray(bundles)) return false;
  const next = bundles.filter((b) => b !== NAME);
  if (next.length === bundles.length) return false;
  pkg.dsh.profile.bundles = next;
  return true;
}

function installInto(profile) {
  const pkgPath = path.join(profile.dir, "package.json");
  const pkg = readJson(pkgPath);
  if (!pkg) {
    log(`  [skip] ${profile.name}: package.json 解析失败`);
    return false;
  }
  const nm = path.join(profile.dir, "node_modules");
  const target = path.join(nm, NAME);

  const depKeys = ["dependencies", "devDependencies", "optionalDependencies"];
  const spec = specFor();
  let depChanged = false;
  for (const key of depKeys) {
    if (pkg[key] && Object.prototype.hasOwnProperty.call(pkg[key], NAME)) {
      if (pkg[key][NAME] !== spec) {
        pkg[key][NAME] = spec;
        depChanged = true;
      }
    }
  }
  if (!pkg.dependencies || !Object.prototype.hasOwnProperty.call(pkg.dependencies, NAME)) {
    pkg.dependencies = pkg.dependencies || {};
    // 其它 depKeys 里已有同名的先摘掉，避免同一包出现两次
    for (const key of depKeys.slice(1)) {
      if (pkg[key] && Object.prototype.hasOwnProperty.call(pkg[key], NAME)) delete pkg[key][NAME];
    }
    pkg.dependencies[NAME] = spec;
    depChanged = true;
  }
  const bundleChanged = ensureBundle(pkg);

  if (CHECK) {
    const linked = isSymlink(target);
    const live = linked ? fs.existsSync(target) : fs.existsSync(path.join(target, "package.json"));
    log(`  [check] ${profile.name}: 依赖=${pkg.dependencies[NAME]} bundles=${pkg.dsh.profile.bundles.includes(NAME)} symlink=${linked} 可用=${live}`);
    return true;
  }

  fs.mkdirSync(nm, { recursive: true });
  if (fs.existsSync(target) || isDanglingLink(target)) {
    const stat = isDanglingLink(target) ? null : fs.lstatSync(target);
    if (stat && stat.isSymbolicLink()) {
      const current = fs.readlinkSync(target);
      if (COPY) {
        fs.unlinkSync(target);
        copyDir(REPO_DIR, target);
      } else if (current !== linkTarget()) {
        fs.unlinkSync(target);
        fs.symlinkSync(linkTarget(), target);
      }
    } else {
      const backup = backupExisting(target, DSH_HOME);
      log(`  [backup] 旧 ${NAME} 目录 → ${backup}`);
      if (COPY) copyDir(REPO_DIR, target);
      else fs.symlinkSync(linkTarget(), target);
    }
  } else if (COPY) {
    copyDir(REPO_DIR, target);
  } else {
    fs.symlinkSync(linkTarget(), target);
  }

  if (depChanged || bundleChanged) writeJson(pkgPath, pkg);
  log(`  [ok] ${profile.name}: ${NAME}@${VERSION} → ${fs.lstatSync(target).isSymbolicLink() ? `symlink ${fs.readlinkSync(target)}` : "已复制"}`);
  return true;
}

function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function isDanglingLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink() && !fs.existsSync(p);
  } catch {
    return false;
  }
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: false,
    filter: (s) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(path.relative(src, s)) || s === src,
  });
}

function uninstallFrom(profile) {
  const pkgPath = path.join(profile.dir, "package.json");
  const pkg = readJson(pkgPath);
  if (!pkg) return false;
  let changed = false;
  for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (pkg[key] && Object.prototype.hasOwnProperty.call(pkg[key], NAME)) {
      delete pkg[key][NAME];
      changed = true;
    }
  }
  if (dropBundle(pkg)) changed = true;
  if (changed && !CHECK) writeJson(pkgPath, pkg);

  const target = path.join(profile.dir, "node_modules", NAME);
  if (fs.existsSync(target) || isDanglingLink(target)) {
    if (!CHECK) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) fs.unlinkSync(target);
      else {
        const backup = backupExisting(target, DSH_HOME);
        log(`  [backup] ${NAME} → ${backup}`);
      }
    }
    log(`  [ok] ${profile.name}: 已移除依赖、bundles 条目与 node_modules/${NAME}`);
  } else {
    log(`  [ok] ${profile.name}: 已移除依赖与 bundles 条目`);
  }
  return true;
}

// ---------------------------------------------------------------- main
log(`dsh-purge ${VERSION} — ${REPO_DIR}`);
log(`DSH_HOME: ${DSH_HOME}`);

if (!fs.existsSync(DSH_HOME)) {
  fail(`找不到 ${DSH_HOME}。先启动一次官方 DeepSeek Harness（它会生成 profiles/），或用 --dsh-home 指定。`);
}

let profiles = profilesUnder(DSH_HOME);
if (WANT_PROFILE) {
  const want = WANT_PROFILE.split(",").map((s) => s.trim()).filter(Boolean);
  profiles = profiles.filter((p) => want.includes(p.name));
}
if (!profiles.length) {
  fail(`没有可用 profile${WANT_PROFILE ? `（--profile ${WANT_PROFILE} 未命中）` : ""}。先启动一次官方 DeepSeek Harness 生成 profiles/。`);
}

log("");
log(UNINSTALL ? "卸载 / uninstall" : CHECK ? "检查 / check" : "安装 / install");
let touched = 0;
for (const p of profiles) {
  touched += (UNINSTALL ? uninstallFrom(p) : installInto(p)) ? 1 : 0;
}

log("");
if (CHECK) {
  log(`共 ${profiles.length} 个 profile，检查完成。`);
} else if (UNINSTALL) {
  log(`共 ${profiles.length} 个 profile，移除 ${touched} 个。重启 DSH 后不再加载 ${NAME}。`);
} else {
  log(`共 ${profiles.length} 个 profile，接入 ${touched} 个。`);
  log("下一步：完全退出并重启 DeepSeek Harness（不是刷新页面），插件随宿主启动加载。");
  if (!COPY) log(`注意：接入用的是 link，仓库目录不要删/不要移动；要搬家就重新跑一次本脚本，或改用 --copy。`);
}
