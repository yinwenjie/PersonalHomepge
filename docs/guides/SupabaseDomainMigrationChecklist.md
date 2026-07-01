# Supabase 域名迁移检查清单

## Summary

本文档对应 Phase 1.14.2，用于在主域名切流前准备 Supabase Auth、Storage 和回调 URL 的配置与回归步骤。

本阶段只做准备和记录，不立即修改 Supabase Dashboard，不切 DNS，不改变生产登录回调。Magic Link 继续使用“从哪个来源发起登录，就回到哪个来源”的策略。

Phase 1.14.3 已按计划补充 Cloudflare Pages preview Redirect URLs。Phase 1.14.7 切流阶段需要将 Supabase `Site URL` 切换为 `https://mylinker.net/`，并继续保留旧站、localhost、preview 和主域名的 Redirect URLs。

## Auth 回调策略

当前前端仍使用 `signInWithOtp` 的 `emailRedirectTo`，并由浏览器当前地址生成回调地址：

- 保留当前 origin。
- 保留当前 path。
- 去掉 query。
- 去掉 hash。

示例：

| 发起登录地址 | Magic Link 回跳地址 |
|---|---|
| `http://localhost:3000/` | `http://localhost:3000/` |
| `http://localhost:3000/edit/?from=test#debug` | `http://localhost:3000/edit/` |
| `https://yinwenjie.github.io/PersonalHomepge/` | `https://yinwenjie.github.io/PersonalHomepge/` |
| `https://mylinker.net/` | `https://mylinker.net/` |
| `https://mylinker.net/edit/` | `https://mylinker.net/edit/` |
| `https://www.mylinker.net/` | `https://www.mylinker.net/` |
| `https://www.mylinker.net/edit/` | `https://www.mylinker.net/edit/` |

本阶段不新增 `/auth/callback`，不强制跳转主域名，也不引入 `NEXT_PUBLIC_SITE_ORIGIN`。

## Supabase Dashboard 准备项

执行任何配置变更前，先记录当前值：

- 当前 `Site URL`。
- 当前全部 `Redirect URLs`。
- 当前 Supabase project ref。
- 当前 `NEXT_PUBLIC_SUPABASE_URL`。
- 当前 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 来源位置，仅记录变量名和位置，不复制完整 key 到文档。

主域名正式切流前计划配置：

- `Site URL`：切换为 `https://mylinker.net/`。
- `Redirect URLs`：迁移窗口同时保留 localhost、GitHub Pages legacy、正式主域名和 Cloudflare Pages preview。

## Redirect URLs 清单

迁移窗口至少准备：

```text
http://localhost:3000/
http://localhost:3000/edit/
https://yinwenjie.github.io/PersonalHomepge/
https://yinwenjie.github.io/PersonalHomepge/edit/
https://mylinker.net/
https://mylinker.net/edit/
https://www.mylinker.net/
https://www.mylinker.net/edit/
```

说明：`mylinker.net` 是 canonical host；`www.mylinker.net` 后续会跳转到 apex。迁移窗口中仍建议把 `www` 首页和设置页加入 Redirect URLs，避免用户从 `www` 发起 Magic Link 时被 Supabase 拒绝。

Phase 1.14.3 创建 Cloudflare Pages project 后补充：

```text
https://personalhomepge.pages.dev/
https://personalhomepge.pages.dev/edit/
```

当前状态：以上两个 Cloudflare Pages preview URL 已添加到 Supabase Auth Redirect URLs。

如果 Cloudflare Pages preview host 每次部署变化，优先使用稳定 preview alias；如果必须使用 wildcard，先确认 Supabase Auth 对该模式的支持和风险，再执行。

Cloudflare Pages 创建和 preview 验证步骤见 `docs/guides/CloudflarePagesDeploy.md`。

## Storage 回归清单

本阶段不新增 Supabase migration，继续复用：

- private bucket：`home-assets`
- migration：`supabase/migrations/012_home_assets_storage.sql`
- verify：`supabase/checks/013_home_assets_storage_verify.sql`

主域名或 preview 可访问后按以下步骤回归：

1. 登录账号。
2. 在 Banner/背景设置中上传 Banner 图片。
3. 上传背景图片。
4. 刷新页面，确认 signed URL 仍能显示图片。
5. 打开另一个已登录浏览器或无痕窗口，恢复账号托管空间，确认图片引用可重新生成 signed URL。
6. 清除 Banner/背景图片，确认页面不再引用旧 Storage path。
7. 如果上传失败，优先检查 `home-assets` bucket 是否存在、RLS policy 是否执行、用户是否登录、文件是否超过 5MB 或类型不支持。

## 观测与隐私边界

本阶段不新增 analytics 或 error monitoring 的 host/origin 字段，不新增 Supabase migration。

上线观察时：

- 埋点和错误监控继续使用现有 `page_path`。
- 新旧域名流量优先通过 Cloudflare、GitHub Pages 和浏览器地址区分。
- 不采集完整 URL、邮箱、同步码、access token、refresh token、Storage image URL、首页文档或账号托管凭证。

## 手动回归场景

Auth：

- localhost 首页发起 Magic Link，确认登录后回到 localhost 首页。
- localhost 设置页发起 Magic Link，确认登录后回到 localhost 设置页。
- GitHub Pages legacy 首页发起 Magic Link，确认登录后回到 `/PersonalHomepge/`。
- GitHub Pages legacy 设置页发起 Magic Link，确认登录后回到 `/PersonalHomepge/edit/`。
- 后续主域名和 Cloudflare preview 可访问后，重复以上首页和设置页登录场景。
- 登录后刷新页面，session 仍可读取。
- 登出后重新登录成功。

Phase 1.14.3 preview 回归结果：

- Cloudflare Pages preview 首页和 `/edit/` 可访问。
- Preview 首页和 `/edit/` 的 Magic Link 回跳通过。
- 登录后首页内容可通过账号托管链路拉取并显示。

账号数据：

- 已登录账号托管空间可恢复。
- 普通同步码空间仍可绑定和拉取。
- 数据恢复中心可打开，本地历史和云端历史不受 host 变化影响。

Storage：

- 上传、刷新显示、跨浏览器恢复显示、清除都通过。

Phase 1.14.3 preview 下，Banner/背景图片显示、刷新和跨浏览器恢复已通过。

## 回滚记录模板

配置变更前填写：

```text
Supabase project ref:
Previous Site URL:
Previous Redirect URLs:
New Site URL:
New Redirect URLs:
Changed at:
Changed by:
Rollback owner:
```

如果 Magic Link 回跳异常：

1. 恢复旧 `Site URL`。
2. 保留新主域名 Redirect URL 一段时间，避免已发出的 Magic Link 立即失效。
3. 重新测试旧站、localhost 和新主域名登录。
4. 记录异常发起地址、异常回跳地址和发生时间。

## Phase Handoff

- Phase 1.14.3 已创建 Cloudflare Pages project，并已补充 preview host 到 Redirect URLs。
- Phase 1.14.7 正式切流时，执行完整 Auth、Storage、账号恢复、同步和观测回归。
- Phase 1.14.5 暂缓期间，GitHub Pages legacy 保留完整应用，不降级为迁移提示页。
