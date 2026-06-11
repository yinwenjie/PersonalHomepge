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
- `implementation/phase-1/Phase1_6_Implement.md`：Phase 1.6，账号托管同步与 Beta 打磨；包含账号托管同步基础、账号托管空间创建和后续补漏计划。

## Tech Stack

- Frontend framework：Next.js 16 App Router。
- Language：TypeScript 6。
- UI runtime：React 19。
- Styling：原生 CSS，集中在 `app/globals.css`，不使用 Tailwind 或外部 UI 框架。
- Drag and drop：`@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`。
- Persistence：浏览器 `localStorage` 保存本地首页文档、同步码绑定状态和最近一次恢复默认前备份。
- Cloud sync：Supabase JavaScript SDK 调用 Postgres RPC。
- Client-side encryption：浏览器 Web Crypto 对首页文档加密后上传；Supabase 不保存首页明文或 encryption key。
- Database：Supabase Postgres，核心表包括 `sync_spaces`、`profiles`、`account_preferences` 和 `home_spaces`，配合 RLS、权限收敛和 `security definer` RPC。
- Deployment：Next.js static export 输出到 `out/`，通过 GitHub Actions 部署到 GitHub Pages。
- CI checks：`npm run lint`、`npm run typecheck`、`npm run build`。

## Guides

- `guides/GitHubPagesDeploy.md`：GitHub Pages 部署说明。
- `guides/SyncCodeUserGuide.md`：同步码使用指南。
- `guides/SupabaseMigrationChecklist.md`：Supabase SQL 手动迁移执行清单。

## Backlog

- `backlog/SyncAutoRequestOptimization.md`：同步请求优化备忘。
- `backlog/AccountHomeSyncBacklog.md`：账号系统、首页空间、同步码管理和未来会员权益 backlog。
- `backlog/AccountManagedSyncBacklog.md`：账号托管同步、空白设备恢复、同步码认领/迁移和未来密码保护空间 backlog。
- `backlog/CodeOptimizationBacklog.md`：代码 review 发现的优化点，含 useSupabaseAuth 多订阅、SyncPanel 架构、round-trip 验证冗余等。
