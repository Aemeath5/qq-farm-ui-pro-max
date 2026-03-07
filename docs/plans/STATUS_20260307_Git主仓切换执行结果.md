# Git 主仓切换执行结果

日期：2026-03-07

## 已完成

- 当前根目录已接管为正式 Git 主仓。
- 当前分支：`codex/root-cutover`
- 远端跟踪：`origin/codex/root-cutover`
- 旧 `github-sync/` 目录已从根目录退役，并归档到 `archive/retired-repos/github-sync-main-20260307/`
- 旧目录保留其自身 `.git` 与本地状态，未做破坏性删除。
- `github-sync/CHANGELOG.DEVELOPMENT.md` 中未吸收到主仓的 `v4.4.0` 更新记录，已并入根目录 `CHANGELOG.DEVELOPMENT.md`
- 运行数据已统一到根目录 `data/`，`core/data` 已改为兼容软链接入口。
- 运行日志已统一到根目录 `logs/`，`scripts/service/logs` 已改为兼容软链接入口。
- 路径收敛前的原始状态已快照到 `archive/runtime-snapshots/20260307-path-unify/`

## 当前未处理

- 根目录 `nc_local_version/` 仍有一份 `root` 所有者残留目录；归档副本已存在，但原目录未清除。
- 历史文档中仍有大量 `github-sync` 路径说明，尚未统一改写。
- 历史文档中仍有少量 `core/data` 与旧日志路径说明，尚未统一改写。

## 说明

- 本文件用于记录“主仓切换 + 旧仓退役 + 路径收敛”实际执行结果，不替代完整治理计划。
- 后续如继续推进，应优先处理剩余文档口径统一和 `nc_local_version/` 的权限残留问题。
