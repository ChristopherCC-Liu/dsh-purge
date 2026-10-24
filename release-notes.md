# 变更记录（本分支）

## 基于 1.1.78 的自用改造

- 区域门禁默认关闭：`installRegionGate` 不再 arm，攻击/外挂判定链路原样保留，
  `net-gate.json` 或 `DSH_PURGE_REGION_GATE=1` 可恢复上游行为。
- 演练台授权门拆除：`readDrillGrant` 恒返回 granted，不再有声明页、倒计时、勾选。
- 供应链切断：更新源、安装源、前端链接全部指向本仓库，任何路径都不回连上游。
- `pinInstalledSpec` 跳过 `link:` / `file:` 依赖，本地开发副本不会被远程包覆盖。
- 移除合规声明章节与授权法律页。
- 新增 `install.mjs`：任意 Mac 上 clone 后一条命令接入本机 profile。
