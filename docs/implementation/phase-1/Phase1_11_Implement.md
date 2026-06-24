# Phase 1.11 Implementation Plan：数据保全与恢复体系

## 阶段定位

Phase 1.11 将“用户数据保全、防止数据丢失”提升为 P0。所有恢复、导入、同步覆盖、模板和空间切换相关能力，都必须先判断当前首页是否为有效用户数据，再决定是否快照、同步或保护。

本阶段原则：

- 默认页、空白页和未编辑模板页不视为有效用户数据。
- 用户正常编辑首页和用户编辑后的模板页统一视为有效用户首页。
- 快照、恢复和同步保护都以完整 `HomeDocumentV2` 为单位，不只处理网站列表。
- 本地保护先于云端保护落地，先降低当前浏览器误覆盖风险。

## 已落地能力

### Phase 1.11.0：数据保全基线与文档分类

新增文档分类领域模块。

已支持分类：

- `system-default`：系统默认首页。
- `system-blank`：空白首页。
- `system-template`：未编辑模板页。
- `user-data`：有效用户首页。

行为：

- 默认首页、空白首页和未编辑模板页归为系统态。
- 用户编辑后的模板页和普通编辑首页归为有效用户数据。
- 模板判断使用内容指纹，忽略随机生成的 document/group/site/widget id。
- 设置页“本机状态”展示当前“数据分类”，便于人工验证。

关键文件：

- `src/domain/home-document-protection.ts`
- `src/hooks/use-home-document-controller.ts`
- `src/components/device-status-panel.tsx`

### Phase 1.11.1：本地历史版本 v1

新增本地历史快照仓储。

已支持：

- localStorage key：`homepage:local-snapshots:v1`。
- 最多保留最近 30 个快照。
- 只保存 `user-data` 的完整 `HomeDocumentV2`。
- 系统默认页、空白页和未编辑模板页不会进入快照。
- 最新快照内容指纹相同时跳过重复保存。
- 快照包含 id、createdAt、source、documentId、revision、contentFingerprint、完整 document 和摘要。
- `homepage:document-protection:v1` 会随当前文档 load/save/reset 持久化，仅作为分类状态缓存。

已接入的覆盖前快照入口：

- 数据包恢复前：`before-data-package-restore`。
- JSON 导入前：`before-json-import`。
- 恢复默认前：`before-reset-default`。
- 恢复上一次重置前备份前：`before-reset-backup-restore`。

本地审计事件：

- `local_snapshot.created`。
- `local_snapshot.skipped_system_document`。
- `local_snapshot.failed`。

关键文件：

- `src/infrastructure/local-home-snapshot-repository.ts`
- `src/infrastructure/home-repository.ts`
- `src/hooks/use-home-document-controller.ts`

## 尚未落地

- Phase 1.11.2 数据恢复中心 v1：展示本地版本列表、完整预览和确认恢复。
- Phase 1.11.3 危险写入保护：将书签导入、模板应用、空间切换、冲突解决等更多入口统一纳入保护。
- Phase 1.11.4 同步误覆盖防护：云端拉取覆盖本地、本地上传覆盖云端前保存版本并加强确认。
- Phase 1.11.5 之后的云端历史版本、账号托管可恢复模型、Supabase 后台 dashboard 和 P0 回归演练。

## 验证记录

已通过：

- `npm run typecheck`
- `npm run lint`
- `npm run build`

人工验证：

- 设置页可显示当前首页数据分类。
- 关键覆盖入口会对有效用户首页生成本地历史版本。
- 默认页、空白页和未编辑模板页不会生成有效快照。
