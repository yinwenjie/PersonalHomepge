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

### Phase 1.11.2：数据恢复中心 v1

新增设置页一级“数据恢复中心”，位置固定在“账号偏好”之后、“高级操作”之前。

已支持：

- 展示当前浏览器 `homepage:local-snapshots:v1` 中的本地历史版本列表。
- 每个版本显示来源、创建时间、分组数、网站数、组件数、主题、Banner/背景状态、原 revision 和原更新时间。
- 每个版本可打开只读完整预览，完整列出分组、网站和组件，并展示主题、图片和同步状态摘要。
- 恢复历史版本前会再次保存当前有效用户首页快照，来源为 `before-local-snapshot-restore`。
- 恢复时更新 `updatedAt` 和 revision，避免历史 revision 回退。
- 已绑定同步空间时恢复后保留当前绑定并暂停自动同步，不会静默覆盖云端；未绑定时恢复为本地首页。
- 新增 `LOCAL_HOME_SNAPSHOTS_UPDATED_EVENT`，快照创建、清空或恢复后恢复中心会刷新列表。

本地审计事件：

- `local_snapshot.restored`。
- `local_snapshot.restore_failed`。

关键文件：

- `src/components/data-recovery-center-panel.tsx`
- `src/hooks/use-home-document-controller.ts`
- `src/infrastructure/local-home-snapshot-repository.ts`

### Phase 1.11.3：危险写入保护

新增统一危险覆盖保护入口 `protectBeforeDangerousOverwrite(source)`。

已支持：

- 覆盖当前本地首页前先判断当前文档分类。
- 当前首页为有效用户数据时，必须成功生成本地快照或命中重复快照，才允许继续覆盖。
- 当前首页为系统默认页、空白页或未编辑模板页时，记录跳过审计并允许继续。
- 快照保存失败、localStorage 不可用或快照仓储未就绪时，阻止覆盖并写入 danger 级本地审计。
- 不引入普通编辑节流快照；revision 之间没有快照仍属预期。

新增覆盖前快照来源：

- `before-bookmark-import`
- `before-bookmark-import-undo`
- `before-template-apply`
- `before-template-home-space-switch`
- `before-sync-code-bind`
- `before-home-space-activate`
- `before-managed-home-space-restore`
- `before-cloud-pull`
- `before-conflict-cloud-resolve`

新增纳入保护的入口：

- 书签/URL 导入确认写入前、撤销最近一次导入前。
- 首页欢迎区应用模板或空白模板前。
- 从模板创建账号托管空间并切换当前浏览器前。
- 输入同步码绑定并拉取云端覆盖本地前。
- 首页空间激活、账号托管空间恢复并覆盖本地前。
- 手动拉取云端、暂停状态拉取云端、冲突选择云端版本、启动/自动拉取实际覆盖本地前。

关键文件：

- `src/hooks/use-home-document-controller.ts`
- `src/components/bookmark-import-panel.tsx`
- `src/components/sync-panel.tsx`
- `src/components/home-spaces-panel.tsx`

### Phase 1.11.4：同步误覆盖防护

在本地覆盖保护之外，补齐同步上传方向的误覆盖防护。

已支持：

- 新增快照来源 `before-cloud-overwrite`，用于保存即将被本地上传覆盖的当前云端版本。
- `useHomeDocumentController` 新增对任意 `HomeDocumentV2` 的保护入口，可保存从云端拉取到的完整文档。
- 系统默认页、空白页和未编辑模板页不会自动上传；检测到系统态待自动上传时会暂停同步并写入 warning 审计。
- 手动上传本地首页或冲突中选择“本地覆盖云端”前，会先弹出强确认。
- 强确认后先拉取当前云端版本，并保存到本机数据恢复中心；保存失败、拉取失败或用户取消时不会覆盖云端。
- 手动拉取云端覆盖本地、冲突中选择云端版本前补充明确确认；启动和自动拉取仍不弹窗，但有本地待上传修改时继续进入冲突。
- 暂停同步文案从“恢复默认后同步已暂停”收口为通用“同步已暂停”，覆盖恢复默认、恢复历史版本、数据包恢复和系统态阻断等来源。

新增本地审计事件：

- `sync.auto_push_skipped_system_document`
- `sync.cloud_overwrite_cancelled`
- `sync.cloud_overwrite_protection_failed`

关键文件：

- `src/components/sync-panel.tsx`
- `src/hooks/use-home-document-controller.ts`
- `src/infrastructure/local-home-snapshot-repository.ts`

### Phase 1.11.5：云端历史版本 v1

为账号托管空间新增云端历史版本能力；普通同步码空间继续保持当前密文同步边界，不保存可预览的明文云端历史。

已支持：

- 新增 Supabase migration `supabase/migrations/013_cloud_home_snapshots.sql`。
- 新增 `home_space_snapshots` 表，只保存账号托管空间的 `user-data` 快照，包含完整 `document_json`、摘要、内容指纹、来源、设备 id、操作 id 和云端 revision。
- 新增 `home_space_audit_events` 表，记录账号托管空间创建、迁移、普通上传、强制覆盖、基线快照和云端历史恢复到本机等关键事件。
- 每个账号托管首页空间最多保留最近 50 个云端快照；重复内容指纹会跳过新增快照，但仍写入上传审计。
- 新增账号托管专用 RPC：
  - `create_account_managed_home_space_v2(...)`
  - `migrate_sync_code_home_space_to_account_managed_v2(...)`
  - `push_account_managed_sync_space(...)`
  - `force_push_account_managed_sync_space(...)`
- 账号托管空间成功创建、迁移、普通上传和强制覆盖时，在同一事务中保存云端快照和审计事件；有效用户首页快照保存失败时，账号托管上传整体失败。
- 系统默认页、空白页和未编辑模板页允许用户强确认后上传，但不会写入云端历史快照，只写 warning 审计。
- 前端新增 `CloudHomeSnapshotRepository`，封装云端历史列表、机会性基线快照和恢复到本机审计。
- `SyncCodeRepository` 在 `binding.accessMode === "account-managed"` 时切换到账号托管专用 RPC；普通同步码仍走既有 `push_sync_space` / `force_push_sync_space`。
- 数据恢复中心新增“云端历史版本”区，仅在已登录且当前首页空间为 `account-managed` 时显示。
- 云端历史支持完整只读预览，并可恢复到当前本机首页；恢复前先保护当前有效本地首页，恢复后将当前同步绑定置为 `paused`，不会自动覆盖云端。
- 新增检查脚本 `supabase/checks/014_cloud_home_snapshots_verify.sql`，用于验证表、RLS、grants、RPC 权限、旧同步码 RPC 兼容和约束。

新增审计事件：

- 云端：`account_managed.created`
- 云端：`account_managed.migrated`
- 云端：`sync.account_managed_push`
- 云端：`sync.account_managed_push_conflict`
- 云端：`sync.account_managed_force_push`
- 云端：`cloud_snapshot.baseline_created`
- 云端：`cloud_snapshot.restored_to_local`
- 本地：`cloud_snapshot.restored_to_local`
- 本地：`cloud_snapshot.restore_failed`

关键文件：

- `supabase/migrations/013_cloud_home_snapshots.sql`
- `supabase/checks/014_cloud_home_snapshots_verify.sql`
- `src/infrastructure/cloud-home-snapshot-repository.ts`
- `src/infrastructure/sync-code-repository.ts`
- `src/infrastructure/account-repository.ts`
- `src/components/data-recovery-center-panel.tsx`
- `src/hooks/use-home-document-controller.ts`

### Phase 1.11.6：账号托管可恢复模型收口

本阶段不重写同步架构，不新增 Supabase migration。目标是把 Phase 1.11.5 后的账号托管产品、安全和恢复模型收口为一致 v1：

- 账号托管空间定位为“账号可信托管、可恢复、可审计”。
- 普通同步码空间继续保持用户持有完整同步码、云端默认只保存密文的边界。
- 高隐私需求继续放入未来 `password-protected` 或更强隐私模式，不混入账号托管默认路径。
- 当前阶段继续保留前端通过本人 RLS 读取 `home_space_credentials` 的空白设备恢复链路；“前端完全不接触 managed secret”的服务端托管模型留到后续后台/服务端阶段。

已支持：

- 设置页账号当前首页、首页空间创建/恢复/迁移/移除确认、离线同步码与恢复、数据恢复中心和数据包导出提示统一使用同一套边界术语。
- 迁移为账号托管时明确提示账号会保存恢复凭证，账号托管云端历史可用于恢复、完整预览和审计；旧同步码本阶段仍不自动废弃。
- 账号托管空间不再暗示严格端到端加密；普通同步码空间才强调用户持有完整同步码和云端密文边界。
- 数据包导出诊断阶段标记更新为 `1.11.6`，并明确不包含 `StoredSyncBinding.accessToken`、`StoredSyncBinding.encryptionKey`、`home_space_credentials.access_token`、`home_space_credentials.encryption_key`、登录 session 或云端历史 `home_space_snapshots.document_json`。
- 新增只读 Supabase 检查脚本 `supabase/checks/015_account_managed_recovery_model_verify.sql`，验证账号托管恢复表 RLS、anon/PUBLIC 表权限、authenticated grant、账号托管 v2 RPC 权限、旧同步码 RPC 兼容和可选 A/B RLS 隔离。

关键文件：

- `src/components/account-panel.tsx`
- `src/components/home-spaces-panel.tsx`
- `src/components/sync-panel.tsx`
- `src/components/data-recovery-center-panel.tsx`
- `src/components/settings-dashboard.tsx`
- `src/domain/data-export.ts`
- `supabase/checks/015_account_managed_recovery_model_verify.sql`
- `docs/guides/SyncCodeUserGuide.md`
- `docs/backlog/DataPreservationBacklog.md`
- `docs/backlog/AccountManagedSyncBacklog.md`

## 尚未落地

- Phase 1.11.7 P0 回归测试与事故演练。
- Phase 1.11.5 v1 暂不为普通同步码空间保存可预览云端历史；同步码空间继续只保存密文、revision 和元数据。
- Phase 1.11.6 仍保留当前账号托管凭证恢复链路；“前端完全不接触 managed secret”的服务端托管模型需后续单独设计。
- 原 Phase 1.11.7 Supabase 后台管理 dashboard 已延期到 Phase 1.14，在商业化正式域名上线后再做；设计方案已保存到 `docs/backlog/AdminDashboardBacklog.md`。

## 验证记录

已通过：

- `npm run typecheck`
- `npm run lint`
- `npm run build`

人工验证：

- 设置页可显示当前首页数据分类。
- 关键覆盖入口会对有效用户首页生成本地历史版本。
- 默认页、空白页和未编辑模板页不会生成有效快照。
- 数据恢复中心可展示、预览并恢复本地历史版本；已绑定同步空间时恢复后暂停自动同步。
- 书签导入、模板应用、空间切换、同步码绑定和云端拉取覆盖本地前会先尝试保存本地快照；快照失败时取消覆盖。
- 系统态首页不会自动上传；手动覆盖云端前会先保护当前云端版本。
- 账号托管空间成功上传有效用户首页后会保存云端历史快照；数据恢复中心可读取、预览并恢复云端历史到本机。
- 普通同步码空间不显示云端历史版本，不保存明文 `document_json`。
- 设置页和用户指南已统一账号托管、普通同步码和高隐私模式边界。
- 数据包导出不包含完整同步码、账号托管恢复凭证、登录 session 或云端历史 `document_json`。
