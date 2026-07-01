# Phase 1.14 主域名准备实施记录

## Summary

Phase 1.14 聚焦正式主域名上线前后的部署、回调、安全和回滚体系。目标是把主站从当前 GitHub Pages 项目路径迁移到 Cloudflare Pages + `mylinker.net`，同时保留 GitHub Pages 作为 legacy 迁移提示和短期 fallback，避免因 origin 变化、`basePath` 变化或 Auth redirect 配置变化造成用户数据误判丢失。

正式主域名已确定为 `mylinker.net`，canonical host 使用 `https://mylinker.net/`；`https://www.mylinker.net/` 作为别名，后续跳转到 apex。

本阶段不改变首页业务数据结构；所有迁移动作必须遵守 Phase 1.11 确立的数据保全 P0 原则。

## Phase 1.14.0：主域名迁移方案与回滚预案

已完成：

- 新增 `docs/guides/MainDomainMigrationRunbook.md`，固化主域名迁移执行方案和回滚预案。
- 明确主站迁移目标为 Cloudflare Pages，GitHub Pages 转为 legacy 迁移提示和短期回退入口。
- 明确 canonical host 使用 `https://mylinker.net/`，`https://www.mylinker.net/` 跳转到 apex。
- 明确新主站使用根路径 `/`，旧 GitHub Pages 继续保留 `/PersonalHomepge/` 项目路径。
- 明确 localStorage origin 隔离风险：旧站本地数据不会自动出现在新主域名。
- 明确用户数据迁移策略：账号托管用户登录恢复，同步码用户重新绑定，纯本地用户旧站导出后新站导入。
- 形成 CI/CD、Supabase Auth、Cloudflare Pages、安全基线、切流、观察和回滚 checklist。
- 明确本阶段只产出方案，不执行 DNS、Supabase 或生产部署配置变更。

关键文档：

- `docs/guides/MainDomainMigrationRunbook.md`
- `docs/planning/Phase1Plan.md`

数据与架构边界：

- 不新增 Supabase migration。
- 不修改 `HomeDocumentV2`。
- 不修改前端业务代码。
- 不改变当前 GitHub Pages workflow。
- 不执行 DNS、Cloudflare Pages、Supabase Auth 或 Storage 的线上配置变更。

## Phase 1.14.1：根路径构建与部署目标配置

已完成：

- `next.config.mjs` 新增 `NEXT_PUBLIC_BASE_PATH` 规范化逻辑。
- 根路径构建规则收口为空字符串：`NEXT_PUBLIC_BASE_PATH` 未设置、空字符串或 `/` 都会输出根路径 `/`。
- legacy 构建规则收口为项目路径：例如 `/PersonalHomepge/` 会规范化为 `/PersonalHomepge`。
- 非空且不以 `/` 开头、包含重复斜杠的 base path 会直接阻止构建，避免产出错误静态资源路径。
- 保留 GitHub Pages workflow 基于仓库名推导项目路径的能力。
- 新增 `scripts/verify-static-export.mjs`，直接读取 `out/` 验证 `index.html`、`_next` 目录和导出 HTML 中的 `_next` 资源前缀。
- `package.json` 新增 `npm run verify:export`。
- `.github/workflows/deploy-pages.yml` 在构建后执行静态导出验证，并打印当前部署 base path。

验证目标：

- 正式主域名根路径构建：`NEXT_PUBLIC_BASE_PATH` 为空时，导出 HTML 中 `_next` 资源应以 `/_next/` 开头。
- GitHub Pages legacy 构建：`NEXT_PUBLIC_BASE_PATH=/PersonalHomepge` 时，导出 HTML 中 `_next` 资源应以 `/PersonalHomepge/_next/` 开头。

数据与架构边界：

- 不新增 Supabase migration。
- 不修改 `HomeDocumentV2`。
- 不修改 Supabase Auth、Storage 或 DNS 配置。
- 不引入服务端 runtime，继续保持 Next.js static export。

关键文件：

- `next.config.mjs`
- `scripts/verify-static-export.mjs`
- `package.json`
- `.github/workflows/deploy-pages.yml`
- `docs/guides/GitHubPagesDeploy.md`
- `docs/guides/MainDomainMigrationRunbook.md`

## Phase 1.14.2：Supabase Auth、Storage 与回调 URL 迁移准备

已完成：

- 保持现有 Magic Link 回调策略：`emailRedirectTo` 继续由当前浏览器地址生成，保留当前 origin/path，并去掉 query/hash。
- 确认本阶段不新增 `/auth/callback`，不强制跳转正式主域名，不引入 `NEXT_PUBLIC_SITE_ORIGIN`。
- 新增 `docs/guides/SupabaseDomainMigrationChecklist.md`，记录 Supabase Dashboard 配置准备项、Redirect URLs、Storage 回归、观测边界和回滚记录模板。
- 明确迁移窗口 Redirect URLs 至少覆盖 localhost、GitHub Pages legacy、正式主域名首页和设置页；Cloudflare Pages preview URL 在 Phase 1.14.3 创建项目后补充。
- Supabase `Site URL` 本阶段只记录计划切换为正式主域名，不立即执行。
- Storage 不新增 migration，继续复用 `home-assets` private bucket、012 migration 和 013 verify 脚本。
- 埋点和错误监控不新增 host/origin 字段，不新增 Supabase migration；新旧域名区分先依赖 Cloudflare/GitHub 侧统计和现有 `page_path`。

数据与架构边界：

- 不新增 Supabase migration。
- 不修改 `HomeDocumentV2`。
- 不修改 Supabase Dashboard、DNS、Cloudflare Pages 或 GitHub Pages 线上配置。
- 不新增前端密钥，不暴露 service role。
- 不修改当前登录运行时代码。

关键文档：

- `docs/guides/SupabaseDomainMigrationChecklist.md`
- `docs/guides/MainDomainMigrationRunbook.md`
- `docs/planning/Phase1Plan.md`

## Phase 1.14.3：Cloudflare Pages 主站部署

已完成：

- 新增 `docs/guides/CloudflarePagesDeploy.md`，记录 Cloudflare Pages project 创建步骤、构建配置、环境变量、preview 验证和 Supabase Redirect URLs 回填。
- 明确 Cloudflare Pages production branch 使用 `production`。
- 明确 build command 使用 `npm run typecheck && npm run lint && npm run build && npm run verify:export`。
- 明确 output directory 使用 `out`，继续保持 Next.js static export。
- 明确 Cloudflare Pages 构建显式配置 `NEXT_PUBLIC_BASE_PATH=/`，避免误用 GitHub Pages legacy 路径。
- 明确 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 是公开前端变量；不配置 service role 或管理员密钥。
- 明确本阶段先获得 Cloudflare Pages preview，不绑定正式主域名、不切 DNS、不关闭 GitHub Pages legacy。
- Cloudflare Pages preview 已生成：`https://personalhomepge.pages.dev/`。
- 已将 preview 首页和 `/edit/` URL 补入 Supabase Redirect URLs 清单。
- 已在 Supabase Auth Redirect URLs 中添加 `https://personalhomepge.pages.dev/` 和 `https://personalhomepge.pages.dev/edit/`，但未修改 `Site URL`。

手动回归已完成：

- 打开 `https://personalhomepge.pages.dev/`，确认首页加载和静态资源无 404。
- 打开 `https://personalhomepge.pages.dev/edit/`，确认设置页加载正常。
- Magic Link 在 preview 首页和 `/edit/` 发起后可回到发起登录的当前来源。
- 账号托管首页内容可在 preview 拉取并显示。
- Storage Banner/背景图片在 preview 下可显示，刷新和跨浏览器恢复流程通过。

数据与架构边界：

- 不新增 Supabase migration。
- 不修改 `HomeDocumentV2`。
- 不修改前端运行时代码。
- 除添加 Cloudflare Pages preview Redirect URLs 外，不修改 Supabase `Site URL`。
- 不修改 DNS、GitHub Pages 线上角色或正式主域名绑定。

## Phase 1.14.4：Cloudflare 安全基线

仓库侧已完成：

- 新增 `public/_headers`，为 Cloudflare Pages 静态导出产物设置低误伤安全响应头：
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` 禁用 camera、microphone、geolocation、payment、usb、serial、bluetooth。
- `scripts/verify-static-export.mjs` 增加 `out/_headers` 和必需安全头校验，防止后续构建遗漏 Cloudflare Pages 安全头配置。
- 暂不启用强制 CSP，避免误伤 Supabase Auth、Supabase Storage signed URL、外链 Banner/背景图和同步流程。
- 新增 `docs/guides/CloudflareSecurityBaseline.md`，记录 Cloudflare Dashboard 手动配置步骤、验证命令和回滚方案。
- 明确 Dashboard 侧由账号持有人手动完成 DNS proxy、custom domain、TLS、Always Use HTTPS、DNSSEC、WAF、DDoS、2FA 和成员权限检查。

待手动执行：

- Cloudflare Pages project 环境变量复查，确认只包含公开前端变量，不包含 service role 或管理员密钥。
- DNS 记录使用 Proxied，正式主域名绑定到 Cloudflare Pages。
- SSL/TLS 使用 `Full (strict)`，开启 Always Use HTTPS。
- DNSSEC 根据 registrar 状态启用并确认 active。
- WAF Managed Rules 使用默认配置启用；Custom WAF Rule 只阻断明显扫描路径。
- HSTS、Rate limiting 和 Bot Fight Mode 保守处理，避免在切流前扩大误伤面。
- Cloudflare、GitHub 和 Supabase 管理账号开启 2FA，保存 backup codes。

数据与架构边界：

- 不新增 Supabase migration。
- 不修改 `HomeDocumentV2`。
- 不修改业务运行时代码。
- 不引入 Cloudflare Worker。
- 不切正式主域名。
- 不关闭 GitHub Pages legacy。
- 不修改 Supabase Auth `Site URL`。

## 后续任务

## Phase 1.14.7：正式切流、回归和回滚演练

已完成仓库侧准备：

- 新增 `docs/guides/MainDomainCutoverRunbook.md`，记录主域名正式切流步骤、当前命令级基线、Supabase Site URL 手动切换、`www` redirect、回归矩阵和回滚演练。
- 明确 Phase 1.14.5 和 Phase 1.14.6 暂缓：GitHub Pages legacy 继续保留完整应用作为 fallback，不做迁移提示页；闭源开发与仓库安全收口不进入本阶段。
- 明确 CloudflareSecurityBaseline.md 的 Step 8 之后全部暂缓，切流前不新增 WAF、Custom Rule、Rate limiting 或 Bot Fight Mode 风险。

当前命令级基线：

- `https://mylinker.net/` 返回 200。
- `https://mylinker.net/edit/` 返回 200。
- `https://www.mylinker.net/` 返回 200，当前尚未跳转到 apex。
- `https://personalhomepge.pages.dev/` 返回 200。
- `https://yinwenjie.github.io/PersonalHomepge/` 返回 200。
- `https://yinwenjie.github.io/PersonalHomepge/edit/` 返回 200。
- 主域名安全头已生效：`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`。
- 当前 HSTS 为 `max-age=15552000`。

待手动执行：

- 在 Supabase Dashboard 中确认或切换 `Site URL` 为 `https://mylinker.net/`。
- 保留 localhost、GitHub Pages legacy、Cloudflare Pages preview、`mylinker.net` 和 `www.mylinker.net` 的精确 Redirect URLs。
- 如果 `www.mylinker.net` 已稳定访问，可在 Cloudflare Redirect Rules 中开启 `www -> apex`，否则保持 `www` 服务完整应用。
- 完成主域名 Magic Link、账号托管恢复、同步码、Storage 图片和数据恢复中心手动回归。
- 观察至少 24 小时无 P0 数据保全、Auth、Storage 或同步异常后，再标记 Phase 1.14.7 完成。

## 后续任务

下一步完成 Supabase Site URL 切流、主域名手动回归和 24 小时观察。

重点是确认 `mylinker.net` 正式主入口不会影响 Auth、账号恢复、同步码、Storage 图片、数据恢复中心和 P0 数据保全能力。

Phase 1.14 后续仍需完成：

- Phase 1.14.7：完成手动回归和观察后收口。
