# Phase 1.13 产品化体验收口实施记录

## Summary

Phase 1.13 聚焦正式主域名前的产品化体验收口，目标是补齐设置页扩展、首页标题、搜索引擎识别和主题风格 v2。主域名准备已独立为 Phase 1.14，集中处理 Cloudflare Pages 主站迁移、GitHub Pages 旧站角色、根路径构建、Supabase 回调、安全基线和回滚演练；多语言支持顺延为 Phase 1.15。Phase 1.13.0 已完成设置页信息架构 v2，Phase 1.13.1 已完成产品身份收口，Phase 1.13.2 已完成主题风格 v2。

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

## Phase 1.13.1：产品身份收口

已完成：

- `HomeDocumentV2` 新增 `documentTitle`，默认值为 `Home`，旧文档会通过 normalize 自动补齐。
- 首页标题改为可编辑：单击标题文字进入编辑，回车或失焦后弹出确认对话框，确认后写回当前首页文档。
- 浏览器 `document.title` 跟随当前首页标题。
- 模板、快照摘要、云端历史、数据包恢复预览都包含标题。
- 搜索引擎 registry 扩展为稳定定义，首页搜索栏左侧显示当前搜索引擎标识。
- 修复旧浏览器同步漂移场景：同 revision 但内容指纹不同且本地无待上传修改时，会重新应用云端文档，避免新字段被旧前端剥离后无法恢复。

## Phase 1.13.2：主题风格 v2

已完成：

- `theme-preset.ts` 从配色 preset 扩展为 appearance preset，新增字体、密度、边框、阴影、按钮、搜索栏、网站标签、Widget Shell 和背景处理 token。
- `HomeThemeStyleBridge` 继续通过 root CSS 变量应用主题，并新增 `data-appearance-preset`，供少量风格化 CSS hook 使用。
- 主题选择面板展示 curated v2 preset：Classic、Focus、Dense、Soft、Glass、Editorial、Terminal、Minimal Mono、Millennium。
- 旧版 `slate`、`mint`、`indigo`、`sunrise` 继续兼容读取；若当前空间仍使用旧 preset，设置页会显示旧版项，用户可主动切换到 v2。
- 新模板默认风格通过 accent 映射到 v2 preset，不自动改写用户已有首页。
- Millennium 作为低成本 preset 落地：蓝色下划线链接、灰色立体按钮、无圆角硬边框、紧凑目录式网站标签和门户站式 Widget 头部。
- 新增 `docs/design/theme-v2-demo.html` 作为独立视觉参考，不接入业务路由。

数据与架构边界：

- 不新增 Supabase migration。
- 不新增 `HomeDocumentV2` 字段，继续复用 `theme.presetId` 保存空间级主题风格。
- 不改变本地快照、云端历史、同步保护和危险写入保护逻辑；主题仍作为完整首页文档的一部分同步。

关键文件：

- `src/domain/theme-preset.ts`
- `src/components/home-theme-style-bridge.tsx`
- `src/components/theme-preset-panel.tsx`
- `app/globals.css`
- `docs/design/theme-v2-demo.html`

## 后续任务

Phase 1.13 已完成。下一步进入 Phase 1.14 主域名准备。多语言支持顺延到 Phase 1.15，并继续保持语言偏好不进入首页文档。
