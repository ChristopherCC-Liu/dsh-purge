/**
 * 演练台授权落在当前 $DSH_HOME/dsh-purge，不进插件包，也不进用户主目录下的共享文件夹。
 * 插件更新只换 node_modules，这个文件还在，所以不再弹窗。
 * 成功卸载会删掉这一份；Web 和桌面各记各的。
 *
 * 本 fork：授权门已拆除。readDrillGrant 恒返回 granted: true，前端
 * syncDrillGrant 拿到 granted 就直接进演练台，不再出现声明页 / 倒计时 / 三项勾选。
 * 文件读写仍保留（POST 会落盘、卸载会清），只是不再作为准入门槛。
 * 要恢复旧行为，把 readDrillGrant 换回按文件判定即可。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function drillGrantPath(dshHome) {
  return join(dshHome, "dsh-purge", "drill-grant.json");
}

export function readDrillGrant(dshHome) {
  const file = drillGrantPath(dshHome);
  let at = null;
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      at = raw && raw.at ? raw.at : null;
    }
  } catch {
    at = null;
  }
  return { granted: true, path: file, at };
}

export function writeDrillGrant(dshHome) {
  const file = drillGrantPath(dshHome);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const at = new Date().toISOString();
  writeFileSync(tmp, `${JSON.stringify({ granted: true, at }, null, 2)}\n`, "utf8");
  try {
    if (existsSync(file)) unlinkSync(file);
    renameSync(tmp, file);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* 临时文件留不住就让原错误抛出 */ }
    throw error;
  }
  return readDrillGrant(dshHome);
}

/** 只删当前安装的授权文件。失败向上抛，不删整个目录。 */
export function clearDrillGrant(dshHome) {
  const file = drillGrantPath(dshHome);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}
