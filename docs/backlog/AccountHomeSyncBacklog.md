# 账号首页同步 Backlog

## Summary

Supabase Auth + 账号首页同步整体顺延到 Phase 1.5。Phase 1.4 只处理前端展示页和 UI 交互优化，不新增账号系统、不改数据库结构、不改变同步码协议。

账号首页同步是后续从“可同步工具”进入“SaaS 账号体系”的关键阶段。它不应和 Phase 1.4 的前端编辑体验改版混在一起实现，否则会同时引入 UI、Auth、RLS、数据覆盖和同步冲突风险。

## Scope

Phase 1.5 需要覆盖：

- Supabase Auth 配置：
  - 允许浏览器持久 session。
  - 支持 token 自动刷新。
  - 支持 GitHub Pages 静态部署下的登录回调。
- 账号首页数据：
  - 新增 `homepage_documents` 表。
  - 每个用户先维护一份首页文档。
  - 数据归属绑定 `auth.uid()`。
- RLS 安全：
  - 登录用户只能读写自己的首页文档。
  - 不在前端暴露 service role key。
  - 数据库权限和 RPC 权限需要单独验收。
- 前端同步：
  - 新增账号首页 repository。
  - 登录后可拉取账号首页。
  - 本地修改可上传到账号首页。
  - 账号同步和同步码同步必须互斥，避免两套云同步同时写同一份本地文档。
- 登录后数据选择：
  - 上传当前本地首页到账号。
  - 使用账号云端首页覆盖本地。
  - 从同步码导入当前首页到账号。
  - 暂不启用账号同步。

## Recommended Breakdown

### Phase 1.5.1：Auth UI 骨架

- 顶部增加登录入口和账号状态区域。
- 编辑模式中增加账号同步占位区域。
- 只展示状态，不接真实账号首页同步。

### Phase 1.5.2：Supabase Auth 基础登录

- 调整 Supabase browser client 的 Auth session 配置。
- 实现登录、退出和刷新后保持登录。
- 验证 GitHub Pages 部署环境下登录回调可用。
- 不写账号首页数据。

### Phase 1.5.3：账号首页表与 RLS

- 新增 `homepage_documents` migration。
- 启用 RLS。
- 增加用户只能读写自己首页的 policy。
- 单独验证跨用户无法读取或写入。

### Phase 1.5.4：手动导入与覆盖

- 登录后检测账号是否已有首页。
- 提供手动选择：
  - 上传本地首页到账号。
  - 使用账号首页覆盖本地。
  - 暂不处理。
- 所有覆盖动作必须二次确认。

### Phase 1.5.5：账号自动同步

- 页面启动后拉取账号首页。
- 本地修改后 debounce 上传账号首页。
- 使用 revision 和 `updatedAt` 检测变化。
- 远端和本地都有修改时进入 conflict，不静默覆盖。

## Risk Notes

- 最大风险是登录后误覆盖用户本地首页。
- RLS 配置错误可能导致用户数据越权访问。
- 同步码和账号同步不能同时自动运行。
- Supabase Auth session 配置变化可能影响现有同步码 RPC，需要回归测试。
- GitHub Pages 是静态部署，需要提前验证 Auth redirect URL、base path 和 callback 行为。

## Recommended Position

先完成 Phase 1.4 的前端编辑体验改版，再进入 Phase 1.5。账号系统涉及数据安全和用户资产，不宜和明显 UI 改版混合上线。
