# Cloudflare Pages 主站部署说明

## Summary

本文档对应 Phase 1.14.3，用于创建 Cloudflare Pages 主站部署链路。当前目标是先获得一个可回归的 Cloudflare Pages preview，不立即切 DNS，不绑定正式主域名 `mylinker.net`，不关闭 GitHub Pages legacy。

本项目仍保持 Next.js static export，Cloudflare Pages 只负责构建并托管 `out/` 静态产物。

## 前置条件

- GitHub `production` 分支已经包含最新可部署代码。
- `npm run typecheck`、`npm run lint`、`npm run build`、`npm run verify:export` 本地通过。
- Supabase 前端公开变量已准备好：
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- 不准备也不需要任何 Supabase service role、管理员密钥或第三方私密 API key。

## 创建 Cloudflare Pages Project

在 Cloudflare Dashboard 中操作：

1. 进入 `Workers & Pages`。
2. 选择 `Create application`。
3. 选择 `Pages`。
4. 选择 `Connect to Git`。
5. 授权并选择 GitHub 仓库 `yinwenjie/PersonalHomepge`。
6. Project name 建议使用产品名或仓库名，例如 `personal-homepage`。
7. Production branch 选择 `production`。

构建配置：

| 字段 | 值 |
|---|---|
| Framework preset | None 或 Next.js，最终以自定义命令为准 |
| Build command | `npm run typecheck && npm run lint && npm run build && npm run verify:export` |
| Build output directory | `out` |
| Root directory | 留空或 `/` |
| Node.js version | `22` |

## 环境变量

Production 和 Preview 都配置同一组公开前端变量：

```text
NODE_VERSION=22
NEXT_PUBLIC_BASE_PATH=/
NEXT_PUBLIC_SUPABASE_URL=<current-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<current-supabase-anon-key>
```

说明：

- `NEXT_PUBLIC_BASE_PATH=/` 用于显式声明 Cloudflare Pages 使用根路径构建。
- `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 是公开前端配置，不是服务端密钥。
- 不要配置 `PAGES_BASE_PATH=/PersonalHomepge`。
- 不要配置 Supabase service role。
- 如果后续要追踪版本，可追加 `NEXT_PUBLIC_APP_VERSION=<commit-sha-or-release>`，但不是本阶段必需项。

## 首次部署验证

Cloudflare Pages 首次部署完成后记录：

```text
Cloudflare Pages project: personalhomepge
Production branch: production
Latest deployment URL: https://personalhomepge.pages.dev/
Preview URL: https://personalhomepge.pages.dev/
Deployment commit: 待从 Cloudflare Pages 部署详情确认
Created at: 待从 Cloudflare Pages 部署详情确认
```

在 preview URL 上验证：

1. 首页可打开，静态资源无 404。
2. `/edit/` 可打开。
3. 浏览器控制台没有资源路径错误。
4. 搜索栏、设置页、主题、组件和数据恢复中心能正常渲染。
5. 本地打开页面时是新的 origin，旧 GitHub Pages 的 localStorage 数据不会自动出现，这是预期行为。

当前验证结果：

- `https://personalhomepge.pages.dev/` 可访问。
- `https://personalhomepge.pages.dev/edit/` 可访问。
- 首页内容可通过账号托管链路拉取并显示。

## Supabase Redirect URLs 回填

拿到稳定 Cloudflare Pages preview host 后，回到 `SupabaseDomainMigrationChecklist.md`，补充：

```text
https://personalhomepge.pages.dev/
https://personalhomepge.pages.dev/edit/
```

如果 preview URL 每次部署都会变化，优先寻找 Cloudflare Pages 提供的稳定 preview alias。只有在确认 Supabase Auth 支持并接受风险后，才考虑 wildcard。

本阶段仍不切换 Supabase `Site URL`。`Site URL` 的正式切换放到主域名切流前。

当前状态：

- `https://personalhomepge.pages.dev/` 已加入 Supabase Auth Redirect URLs。
- `https://personalhomepge.pages.dev/edit/` 已加入 Supabase Auth Redirect URLs。
- Supabase `Site URL` 未修改。

## Preview 手动回归

Auth：

- 在 preview 首页发起 Magic Link，确认回到 preview 首页。
- 在 preview `/edit/` 发起 Magic Link，确认回到 preview `/edit/`。
- 登录后刷新页面，session 仍可读取。
- 登出后重新登录成功。

账号与同步：

- 已登录账号托管空间可恢复。
- 普通同步码空间可绑定、拉取和处理冲突。
- 数据恢复中心可打开，本地历史和云端历史可预览。

Storage：

- 登录用户上传 Banner 图片。
- 上传背景图片。
- 刷新后 signed URL 图片仍显示。
- 另一个已登录浏览器恢复账号托管空间后，图片能重新显示。

当前手动回归结果：

- Magic Link preview 首页和 `/edit/` 回跳通过。
- 账号托管首页内容拉取和显示通过。
- Storage Banner/背景图片显示、刷新和跨浏览器恢复通过。

观测：

- 产品埋点和错误监控无新增配置要求。
- 如需排查新旧 host 流量，优先使用 Cloudflare Pages deployment、Cloudflare analytics 和 GitHub Pages 侧统计。

## 不做事项

- 不绑定正式主域名。
- 不修改 DNS。
- 不关闭 GitHub Pages。
- 不把 GitHub Pages legacy 降级为迁移提示页。
- 不修改 Supabase `Site URL`。
- 不新增 Supabase migration。
- 不新增前端运行时代码。

## 下一阶段衔接

- Phase 1.14.4：在主站 preview 可用后，配置 Cloudflare 安全基线，详见 `docs/guides/CloudflareSecurityBaseline.md`。
- Phase 1.14.5：准备 GitHub Pages 旧站迁移提示。
- Phase 1.14.7：正式切流、完整回归和回滚演练。
