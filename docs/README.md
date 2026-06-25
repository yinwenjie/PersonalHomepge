# 文档目录索引

## Strategy

- `strategy/memory.md`：产品长期规划、商业判断和发展路径。

## Planning

- `planning/Phase1Plan.md`：0-3 个月 MVP 产品设计与实施路线。

## Implementation

- `implementation/phase-1/Phase1_1_Implement.md`：Phase 1.1，本地可编辑首页。
- `implementation/phase-1/Phase1_2_Implement.md`：Phase 1.2，统一数据结构与 Next.js 迁移。
- `implementation/phase-1/Phase1_3_Implement.md`：Phase 1.3，同步码跨设备同步；包含 Phase 1.3.1 之后的后续实施记录。
- `implementation/phase-1/Phase1_4_Implement.md`：Phase 1.4，前端展示页与编辑交互优化。
- `implementation/phase-1/Phase1_5_Implement.md`：Phase 1.5，账号登录与首页空间管理；包含完整实施记录、账号模型、数据库安全计划和 Phase 1.6 衔接。
- `implementation/phase-1/Phase1_6_Implement.md`：Phase 1.6，账号托管同步与 Beta 打磨；包含账号托管同步基础、账号托管空间创建、恢复默认同步保护、空白设备账号恢复、同步码迁移为账号托管、首页空间 CRUD、同步码入口降级、管理边界补强、全局偏好编辑、Beta 状态统一、数据导出、模板库 v1，以及浏览器收藏/标签导入移入 Phase 1.9 的阶段调整记录。
- `implementation/phase-1/Phase1_7_Implement.md`：Phase 1.7，组件开发；记录组件框架与 Widget Registry、组件面板增删排序、Todo List v1、日历/万年历 v1、组件布局与编辑体验和组件默认配置。
- `implementation/phase-1/Phase1_8_Implement.md`：Phase 1.8，主题与普通个性化；记录主题风格切换、空间级主题 preset、CSS token、Banner/背景图片 v1、Storage 上传、signed URL 渲染和个性化细节收口。
- `implementation/phase-1/Phase1_9_Implement.md`：Phase 1.9，页面布局与导入需求集实施计划；拆分前端页面布局和 UI/UX 优化、浏览器收藏/标签导入需求集，并记录触屏设备不能依赖 hover 的交互约束。
- `implementation/phase-1/Phase1_9_5_BookmarkImportDesign.md`：Phase 1.9.5，收藏/标签导入需求设计；记录普通网页权限边界、书签 HTML/URL 粘贴/浏览器扩展方案对比、导入草稿模型、隐私安全和 MVP 推荐路径。
- `implementation/phase-1/Phase1_9_6_BulkImportExperienceDesign.md`：Phase 1.9.6，大批量导入体验设计；记录 5 步导入向导、localStorage 草稿与撤销记录、分页预览、分组映射、批量选择、性能边界和 Phase 1.9.7 MVP 范围。
- `implementation/phase-1/Phase1_10_Implement.md`：Phase 1.10，正式推出前基础收口；记录数据包恢复、本地审计日志、本机状态、同步请求多标签协调，以及账号删除、只读分享链接、密码保护空间的高风险候选设计。
- `implementation/phase-1/Phase1_11_Implement.md`：Phase 1.11，数据保全与恢复体系；记录文档分类、本地历史版本、数据恢复中心、危险写入保护、同步误覆盖防护、账号托管云端历史版本、账号托管可恢复模型收口和 P0 回归演练。

## Tech Stack

- Frontend framework：Next.js 16 App Router。
- Language：TypeScript 6。
- UI runtime：React 19。
- Styling：原生 CSS，集中在 `app/globals.css`，不使用 Tailwind 或外部 UI 框架。
- Drag and drop：`@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`。
- Persistence：浏览器 `localStorage` 保存本地首页文档、同步码绑定状态、UI 偏好缓存、最近一次恢复默认前备份、文档保护状态和本地历史快照。
- Cloud sync：Supabase JavaScript SDK 调用 Postgres RPC。
- Asset storage：Supabase Storage private bucket `home-assets` 保存登录用户的 Banner/背景图片。
- Client-side encryption：普通同步码空间由浏览器 Web Crypto 对首页文档加密后上传；账号托管空间采用账号可信托管模型，可保存有效用户首页的明文云端历史用于恢复和审计。
- Database：Supabase Postgres，核心表包括 `sync_spaces`、`profiles`、`account_preferences`、`home_spaces`、`home_space_snapshots` 和 `home_space_audit_events`，配合 RLS、权限收敛和 `security definer` RPC。
- Deployment：Next.js static export 输出到 `out/`，通过 GitHub Actions 部署到 GitHub Pages。
- CI checks：`npm run lint`、`npm run typecheck`、`npm run build`。

## Guides

- `guides/GitHubPagesDeploy.md`：GitHub Pages 部署说明。
- `guides/SyncCodeUserGuide.md`：同步码使用指南。
- `guides/SupabaseMigrationChecklist.md`：Supabase SQL 手动迁移执行清单。
- `guides/DataPreservationP0RegressionDrill.md`：Phase 1.11.7 P0 数据保全回归与事故演练指南。

## Backlog

- `backlog/SyncAutoRequestOptimization.md`：同步请求优化备忘。
- `backlog/AccountHomeSyncBacklog.md`：账号系统、首页空间、同步码管理和未来会员权益 backlog。
- `backlog/AccountManagedSyncBacklog.md`：账号托管同步、空白设备恢复、同步码认领/迁移和未来密码保护空间 backlog。
- `backlog/AdminDashboardBacklog.md`：后台管理 dashboard 候选，记录 Phase 1.14 之后的受控后台入口、管理员审计、权限边界和延期原因。
- `backlog/EncryptedFileCacheBacklog.md`：轻量级端到端加密文件缓存组件候选，记录 Supabase Storage、密钥模型、数据表和风险边界。
- `backlog/DataPreservationBacklog.md`：Phase 1.11 数据保全与恢复体系 backlog，记录本地/云端快照、数据恢复中心、危险写入保护、同步误覆盖防护，以及后台 dashboard 延期到 Phase 1.14 的边界。
- `backlog/CodeOptimizationBacklog.md`：代码 review 发现的优化点，含 useSupabaseAuth 多订阅、SyncPanel 架构、round-trip 验证冗余等。
