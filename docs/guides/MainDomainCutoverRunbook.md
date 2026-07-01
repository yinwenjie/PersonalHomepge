# 主域名正式切流与回滚演练

## Summary

本文档对应 Phase 1.14.7，用于把 `mylinker.net` 正式确认为主站入口，并完成 Auth、同步、Storage、数据恢复和回滚路径的 P0 回归。

Phase 1.14.5 和 Phase 1.14.6 暂不执行：GitHub Pages legacy 继续保留完整应用作为 fallback，不做迁移提示页；闭源开发与仓库安全收口不进入本阶段。CloudflareSecurityBaseline.md 的 Step 8 之后全部暂缓，切流前不新增 WAF、Custom Rule、Rate limiting 或 Bot Fight Mode 风险。

## 当前基线

记录时间：2026-07-01。

代码与部署：

- 当前 commit：`c752472 chore: add cloudflare security baseline`。
- GitHub Pages legacy：继续部署完整应用，路径为 `https://yinwenjie.github.io/PersonalHomepge/`。
- Cloudflare Pages preview：`https://personalhomepge.pages.dev/`。
- 正式主域名：`https://mylinker.net/`。
- `www` 别名：`https://www.mylinker.net/`。

命令验证结果：

| URL | 当前状态 | 说明 |
|---|---:|---|
| `https://mylinker.net/` | 200 | 主域名首页可访问 |
| `https://mylinker.net/edit/` | 200 | 主域名设置页可访问 |
| `https://www.mylinker.net/` | 200 | 当前仍服务完整应用，尚未跳转到 apex |
| `https://personalhomepge.pages.dev/` | 200 | Cloudflare Pages fallback 可访问 |
| `https://yinwenjie.github.io/PersonalHomepge/` | 200 | GitHub Pages legacy 可访问 |
| `https://yinwenjie.github.io/PersonalHomepge/edit/` | 200 | GitHub Pages legacy 设置页可访问 |

安全头：

- `X-Content-Type-Options: nosniff` 已生效。
- `X-Frame-Options: DENY` 已生效。
- `Referrer-Policy: strict-origin-when-cross-origin` 已生效。
- `Permissions-Policy` 已生效。
- 当前 HSTS：`Strict-Transport-Security: max-age=15552000`。

Supabase 状态：

- Redirect URLs 已由用户补充主域名相关精确 URL。
- `Site URL` 是否已切到 `https://mylinker.net/` 需要在 Supabase Dashboard 中人工确认。

## 切流执行步骤

### 1. 冻结发布输入

执行前确认：

- `master` 与 `origin/master` 同步。
- `production` 分支指向当前待切流 commit。
- Cloudflare Pages production deployment 成功。
- GitHub Pages production workflow 成功。

命令：

```powershell
git status --short --branch
git log -1 --oneline
```

### 2. Supabase Auth 切流

在 Supabase Dashboard 中操作：

1. 打开项目。
2. 进入 `Authentication` -> `URL Configuration`。
3. 记录旧 `Site URL` 和全部 `Redirect URLs`。
4. 将 `Site URL` 设置为：

```text
https://mylinker.net/
```

5. 确认 `Redirect URLs` 至少保留：

```text
http://localhost:3000/
http://localhost:3000/edit/
https://yinwenjie.github.io/PersonalHomepge/
https://yinwenjie.github.io/PersonalHomepge/edit/
https://personalhomepge.pages.dev/
https://personalhomepge.pages.dev/edit/
https://mylinker.net/
https://mylinker.net/edit/
https://www.mylinker.net/
https://www.mylinker.net/edit/
```

6. 保存后立即执行 Magic Link 回归。

### 3. Cloudflare canonical 收口

`mylinker.net` 是 canonical 主站。`www.mylinker.net` 稳定访问后，可以开启 `www -> apex` redirect。

在 Cloudflare Dashboard 中操作：

1. 选择域名 `mylinker.net`。
2. 打开 `Rules` -> `Redirect Rules`。
3. 创建或启用规则：`Redirect www to apex`。
4. 条件：`Hostname equals www.mylinker.net`。
5. 动作：`Dynamic redirect`，表达式为：

```text
concat("https://mylinker.net", http.request.uri.path)
```

6. 状态码：`301`。
7. Preserve query string：`On`。

如果开启后 Auth 或页面访问异常，暂停该 redirect rule，并继续允许 `www.mylinker.net` 服务完整应用。

### 4. 暂缓安全规则扩展

本阶段不执行 CloudflareSecurityBaseline.md 的 Step 8 之后：

- 不启用 WAF Managed Rules。
- 不新增 Custom WAF Rule。
- 不启用 Rate limiting。
- 不启用 Bot Fight Mode。

这些动作在主域名 Auth、Storage、同步和数据恢复完成 24 小时观察后再推进。

## 回归清单

### 命令验证

```powershell
curl.exe -I --ssl-no-revoke https://mylinker.net/
curl.exe -I --ssl-no-revoke https://mylinker.net/edit/
curl.exe -I --ssl-no-revoke https://www.mylinker.net/
curl.exe -I --ssl-no-revoke https://personalhomepge.pages.dev/
curl.exe -I --ssl-no-revoke https://yinwenjie.github.io/PersonalHomepge/
```

若已开启 `www -> apex` redirect，`https://www.mylinker.net/` 应返回 301 并指向 `https://mylinker.net/`。

### 手动回归

- `https://mylinker.net/` 首页加载正常。
- `https://mylinker.net/edit/` 设置页加载正常。
- 从主域名首页发起 Magic Link，回到 `https://mylinker.net/`。
- 从主域名 `/edit/` 发起 Magic Link，回到 `https://mylinker.net/edit/`。
- 登录后刷新页面，session 保持。
- 登出后重新登录成功。
- 账号托管空间可恢复，首页内容完整显示。
- 普通同步码空间可绑定、拉取和处理冲突。
- 数据恢复中心本地历史和云端历史可打开并预览。
- Banner/背景图片上传、刷新显示和跨浏览器恢复显示均通过。
- 没有首页清空、云端误覆盖或系统态自动上传。
- GitHub Pages legacy 仍保持完整应用可访问。

### 观察指标

切流后至少观察 24 小时：

- 主域名首页和设置页加载成功率。
- Magic Link 登录成功率。
- 账号托管空间恢复成功率。
- 同步码绑定和冲突处理。
- Storage 图片显示。
- 数据恢复中心可用性。
- `client_error_events` 新增错误类型。
- Cloudflare 4xx/5xx。

## 回滚演练

### Auth 回滚

适用：Magic Link 或账号恢复跳转异常。

1. 在 Supabase Dashboard 恢复旧 `Site URL`。
2. 保留 `mylinker.net` Redirect URLs，避免已发出的 Magic Link 立即失效。
3. 复测主域名、Pages preview 和 GitHub Pages legacy 登录。
4. 记录异常发起地址、异常回跳地址和发生时间。

### 前端部署回滚

适用：主域名前端异常，但 DNS/Auth 仍可用。

1. 在 Cloudflare Pages 回滚到上一成功 deployment。
2. 验证主域名首页、`/edit/`、登录、同步和 Storage 图片。
3. 若仍异常，引导用户临时使用 GitHub Pages legacy。

### DNS 或证书回滚

适用：主域名 HTTPS、DNS 或 `www` redirect 异常。

1. 暂停 `www -> apex` redirect rule。
2. 保留 `personalhomepge.pages.dev` 和 GitHub Pages legacy。
3. 等待 DNS/证书恢复后再重新测试。

### 用户数据支持路径

适用：用户反馈“新站数据为空”。

1. 确认用户是否换了域名和浏览器。
2. 账号托管用户：登录账号并恢复当前首页空间。
3. 同步码用户：输入完整同步码重新绑定。
4. 纯本地用户：回 GitHub Pages legacy 导出数据包，再到主域名导入。
5. 如果旧站也看不到数据，检查 localStorage、数据恢复中心和导出备份。

## 完成标准

- Supabase `Site URL` 已切到 `https://mylinker.net/`。
- Redirect URLs 未丢失 localhost、GitHub Pages legacy、Cloudflare Pages preview、`mylinker.net` 和 `www.mylinker.net`。
- 主域名 Auth、账号恢复、同步码、Storage、数据恢复中心全部通过。
- GitHub Pages legacy 保留完整应用作为 fallback。
- 已记录回滚步骤，并至少完成命令级验证。
- 观察至少 24 小时无 P0 数据保全、Auth、Storage 或同步异常。
