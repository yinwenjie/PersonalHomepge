# Phase 1.13 产品化体验收口实施记录

## Summary

Phase 1.13 聚焦正式主域名前的产品化体验收口，目标是补齐设置页扩展、多语言、首页标题、搜索引擎识别、主题风格 v2 和主域名准备。Phase 1.13.0 已完成设置页信息架构 v2。

## Phase 1.13.0：设置页信息架构 v2

已完成：

- 新增统一 `SettingsSection` 折叠外壳，账号、首页空间、主题风格、Banner/背景、通用设置、数据恢复中心和高级操作都进入一级折叠栏目。
- 新增本机设置页布局偏好 `homepage:settings-layout:v1`，只保存 `expandedSectionIds`，不写入 `HomeDocumentV2`，不进入账号同步、快照或数据包。
- 新增 `LocalSettingsLayoutRepository` 和 `useSettingsLayoutPreferences`，JSON 损坏、localStorage 不可用或写入失败时安全降级为全部收起。
- 设置页 header 展示栏目标题、英文/状态短标、状态摘要和风险 tone；同步暂停/冲突、账号错误和恢复中心消息在折叠状态下仍可见。
- 账号托管同步暂停/冲突处理插槽继续放在账号栏当前首页区域，不回退到离线同步码栏。
- 数据恢复中心的本地历史和云端历史从卡片列表改为下拉版本选择，选中版本后仍可查看摘要、完整预览和恢复。
- 现有顶层 panel 支持 embedded 模式，避免折叠外壳里再嵌套完整设置卡片。

数据与架构边界：

- 不新增 Supabase migration。
- 不修改 `HomeDocumentV2` schema。
- 不新增产品埋点事件。
- 不改变本地快照、云端历史、同步保护、危险写入保护或恢复确认逻辑。

关键文件：

- `src/components/settings-section.tsx`
- `src/domain/settings-layout.ts`
- `src/infrastructure/settings-layout-repository.ts`
- `src/hooks/use-settings-layout-preferences.ts`
- `src/components/settings-dashboard.tsx`
- `src/components/data-recovery-center-panel.tsx`

已验证：

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`

## 后续任务

下一步进入 Phase 1.13.1 多语言支持 v1。该阶段应复用 Phase 1.13.0 的设置页折叠结构，把语言配置放入通用设置，并继续保持语言偏好不进入首页文档。
