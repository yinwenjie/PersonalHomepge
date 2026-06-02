# Phase 1.2 实施计划：统一数据结构与 Next.js 迁移

## Summary

将当前单文件 `homepage.html` 迁移为根目录 Next.js + TypeScript App Router 项目，目标仍是前端本地可用，不接真实 Supabase、不做登录同步。Next.js 使用 static export，继续适配 GitHub Pages 静态托管；`homepage.html` 现有 33 个默认网站迁入统一 `HomeDocument` schema，本地编辑数据通过迁移层兼容读取旧 `homepage:data:v1`。

## Key Decisions

- 迁移范围：只做前端迁移，Supabase/登录/支付不实现，只预留类型和 adapter 接口。
- 仓库布局：根目录替换为 Next.js 工程；现有静态文件作为迁移参考，不再作为长期主入口。
- 部署目标：GitHub Pages 静态部署，使用 `next.config` 的 static export 输出。
- UI 方向：以当前极简首页为基础，吸收 `next-migration-dummy.html` 的账号状态、组件区、主题/Banner 的信息架构，但不引入真实账户。
- 数据策略：统一使用 `HomeDocument`，旧 localStorage 数据能自动迁移，迁移后主 key 升级为 `homepage:document:v2`。

## Implementation Changes

- 新建 Next.js 基础工程：
  - 添加 `package.json`、`next.config.*`、`tsconfig.json`、`app/layout.tsx`、`app/page.tsx`、全局样式。
  - 使用 TypeScript，不引入 Tailwind，不接外部 UI 框架，保持当前轻量 CSS 风格。
  - 配置 static export；图片、favicon、外链图标逻辑不依赖服务端运行时。
- 建立统一数据结构：
  - 定义 `HomeDocumentV2`、`HomeGroup`、`HomeSite`、`HomeWidget`、`HomeTheme`、`HomeSyncMeta`。
  - 默认数据从当前 `homepage.html` 的 33 个网站迁入 `DEFAULT_HOME_DOCUMENT_V2`。
  - `widgets` 初始包含空数组；组件 registry 先注册 `calendar.month`、`todo.list` 占位类型。
  - `syncMeta` 只保留 `mode: "local"`、`status: "local-only"`、`provider: null`。
- 拆分前端模块：
  - 首页渲染组件：搜索区、分组列表、网站链接、favicon/mark fallback、空状态。
  - 编辑组件：查看/编辑切换，分组和网站的增删改、上移下移、导入导出、恢复默认。
  - 数据层：`loadHomeDocument()`、`saveHomeDocument()`、`migrateV1ToV2()`、`validateHomeDocument()`、`normalizeHomeDocument()`。
  - 未来 adapter：`LocalHomeRepository` 为唯一实际实现；`CloudHomeRepository` 只留接口，不连接 Supabase。
- 保持现有行为：
  - DuckDuckGo 搜索不变。
  - 外链默认新标签打开，使用 `rel="noopener noreferrer"`。
  - URL 只允许 `http://` 和 `https://`。
  - 用户输入由 React 文本渲染，不使用 `dangerouslySetInnerHTML`。
  - 本地已有 `homepage:data:v1` 时自动迁移并保存为 v2；迁移失败则回退默认数据。

## Test Plan

- 数据迁移：
  - 无 localStorage 时显示默认 33 个网站。
  - 有旧 `homepage:data:v1` 时自动迁移为 v2，刷新后仍保留。
  - 坏 JSON、版本不兼容、非法 URL 不导致页面白屏。
- 首页行为：
  - 搜索过滤支持分组名、网站名、mark、keywords。
  - 回车使用 DuckDuckGo 搜索。
  - favicon 加载失败时显示 mark。
  - 所有外链新标签打开。
- 编辑行为：
  - 新增、编辑、删除、排序分组和网站后刷新仍保留。
  - 导出 JSON 后可重新导入恢复。
  - 恢复默认后显示 33 个默认网站。
- 构建部署：
  - `npm run lint`、`npm run typecheck`、`npm run build` 通过。
  - static export 产物可本地预览。
  - 桌面和手机宽度下布局不重叠、不撑破。
- 安全回归：
  - 输入 `<script>alert(1)</script>` 只作为文本显示。
  - `javascript:`、`data:`、空 URL 保存失败。
  - 不出现 Supabase service role、支付密钥、同步 secret 等服务端敏感概念。

## Assumptions

- 本阶段不接 Supabase Auth、RLS、数据库和 Storage；这些进入后续同步/登录阶段。
- 本阶段不实现会员支付，只在类型中预留未来 `billing`/`plan` 字段。
- GitHub Pages 发布仍需避免直接把开发分支当生产；Next static export 完成后再单独规划发布分支或 Actions。
- 旧 `homepage.html` 可以在迁移期间保留为参考文件；正式切换前不要删除，避免丢失已验证逻辑。
