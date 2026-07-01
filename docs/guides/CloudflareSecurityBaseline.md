# Cloudflare 安全基线操作手册

## Summary

本文档对应 Phase 1.14.4，用于在正式主域名切流前建立低成本、低误伤的 Cloudflare 安全基线。

本阶段不修改首页业务逻辑，不新增 Supabase migration，不改变 `HomeDocumentV2`，不切正式主域名。仓库侧只新增 Cloudflare Pages 静态安全响应头；Cloudflare Dashboard 侧由账号持有人手动开启 DNS、TLS、WAF、DDoS、账号安全等配置。

## 已由仓库配置完成

### Cloudflare Pages 响应头

新增 `public/_headers`：

```text
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()
```

作用：

- `X-Content-Type-Options: nosniff`：减少浏览器 MIME sniffing 风险。
- `X-Frame-Options: DENY`：禁止站点被第三方 iframe 嵌入，降低 clickjacking 风险。
- `Referrer-Policy: strict-origin-when-cross-origin`：跨站请求只发送 origin，减少完整路径泄露。
- `Permissions-Policy`：禁用当前产品不需要的摄像头、麦克风、定位、支付、USB、串口和蓝牙能力。

本阶段不启用强制 CSP。原因是当前产品依赖 Supabase API、Supabase Storage signed URL，并允许外链 Banner/背景图片；强 CSP 容易误伤登录、同步和图片显示。后续如需 CSP，应先使用 `Content-Security-Policy-Report-Only` 观察。

`npm run verify:export` 会检查 `out/_headers` 是否存在，并验证上述必需安全头，避免后续部署遗漏该配置。

验证：

```powershell
npm run build
npm run verify:export
Test-Path out\_headers
Get-Content out\_headers
```

部署到 Cloudflare Pages 后验证：

```powershell
(Invoke-WebRequest -Uri "https://personalhomepge.pages.dev/" -Method Head -UseBasicParsing).Headers
```

应能看到 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 和 `Permissions-Policy`。

## 需要在 Cloudflare Dashboard 手动完成

以下操作需要 Cloudflare 账号权限，Codex 无法代为点击。建议按顺序执行；每完成一组后先打开 preview 或正式主域名做一次快速回归。

### 1. 确认 Pages Project

路径：

1. 登录 Cloudflare Dashboard。
2. 进入 `Workers & Pages`。
3. 打开 Pages project：`personalhomepge`。
4. 进入 `Deployments`。

检查：

- 最新 deployment 由 `production` 分支触发。
- Build command 是 `npm run typecheck && npm run lint && npm run build && npm run verify:export`。
- Output directory 是 `out`。
- Environment variables 中只有公开前端变量：
  - `NODE_VERSION=22`
  - `NEXT_PUBLIC_BASE_PATH=/`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

不要添加：

- Supabase service role。
- 管理员密钥。
- 第三方私密 API key。
- `.env.local` 内容。

### 2. Custom Domains 预检查

正式绑定主域名前先确认策略：

- canonical host 使用 apex domain：`https://mylinker.net/`。
- `www.mylinker.net` 后续跳转到 apex。
- GitHub Pages legacy 地址暂时保留，不在本阶段关闭。

路径：

1. 进入 `Workers & Pages`。
2. 打开 Pages project：`personalhomepge`。
3. 进入 `Custom domains`。
4. 如果还未正式切流，本阶段只记录入口位置，不急着绑定。

正式绑定时：

1. 点击 `Set up a custom domain`。
2. 输入 apex domain：`mylinker.net`。
3. 按提示确认 DNS record。
4. 等待证书状态变为 active。
5. 再添加 `www.mylinker.net`。
6. 后续在 Cloudflare redirect 规则中让 `www` 跳转到 apex。

### 2.1 `www` 跳转到 apex

路径：

1. 选择域名 `mylinker.net`。
2. 打开 `Rules` -> `Redirect Rules`。
3. 点击 `Create rule`。

建议规则：

Rule name：

```text
Redirect www to apex
```

If incoming requests match：

```text
Hostname equals www.mylinker.net
```

Then：

```text
Dynamic redirect
Expression: concat("https://mylinker.net", http.request.uri.path)
Status code: 301
Preserve query string: On
```

说明：

- 正式切流前不急着启用该规则；等 `mylinker.net` 和 `www.mylinker.net` 都能正常访问后再开启。
- 开启后回归 `https://www.mylinker.net/` 和 `https://www.mylinker.net/edit/`，确认跳转到 apex。

### 3. DNS 代理状态

路径：

1. 进入 Cloudflare Dashboard。
2. 选择你的域名。
3. 打开 `DNS` -> `Records`。

检查或设置：

- apex domain 指向 Cloudflare Pages custom domain。
- `www` 指向 Cloudflare Pages custom domain 或按 Cloudflare 提示配置。
- Web 访问相关记录使用 `Proxied` 橙云。
- 非 Web 验证记录、邮件记录、第三方验证记录按服务要求保留 `DNS only`。

注意：

- `Proxied` 才会经过 Cloudflare 的 HTTP 安全和缓存链路。
- `DNS only` 只做 DNS 解析，不经过 Cloudflare WAF/HTTPS 边缘策略。

验证：

```powershell
Resolve-DnsName mylinker.net
Resolve-DnsName www.mylinker.net
```

### 4. SSL/TLS 模式

路径：

1. 选择你的域名。
2. 打开 `SSL/TLS` -> `Overview`。
3. 选择 `Full (strict)`。

目标：

- 浏览器到 Cloudflare 使用 HTTPS。
- Cloudflare 到 Pages/origin 也使用受验证的 HTTPS。

不要选择：

- `Flexible`。它会让 Cloudflare 到 origin 之间不是完整 HTTPS 语义，容易造成安全和回调判断问题。

验证：

```powershell
(Invoke-WebRequest -Uri "https://mylinker.net/" -Method Head -UseBasicParsing).StatusCode
```

### 5. Always Use HTTPS

路径：

1. 选择你的域名。
2. 打开 `SSL/TLS` -> `Edge Certificates`。
3. 找到 `Always Use HTTPS`。
4. 切换为 `On`。

验证：

```powershell
Invoke-WebRequest -Uri "http://mylinker.net/" -MaximumRedirection 0 -UseBasicParsing
```

预期：

- 返回 301 或 308。
- `Location` 指向 `https://mylinker.net/`。

### 6. HSTS 保守策略

路径：

1. 选择你的域名。
2. 打开 `SSL/TLS` -> `Edge Certificates`。
3. 找到 `HTTP Strict Transport Security (HSTS)`。

建议：

- 本阶段可以先不启用 HSTS。
- 如果要启用，先使用短 `max-age`。
- 不开启 preload。
- 不开启 includeSubDomains，除非确认所有子域名都稳定支持 HTTPS。

原因：

- HSTS 会被浏览器缓存；配置过激会增加 DNS/Auth/回滚时的恢复成本。

### 7. DNSSEC

路径：

1. 选择你的域名。
2. 打开 `DNS` -> `Settings`。
3. 找到 `DNSSEC`。

如果域名在 Cloudflare Registrar：

1. 点击启用 DNSSEC。
2. 等待状态变为 active。

如果域名不在 Cloudflare Registrar：

1. Cloudflare 会提供 DS record。
2. 到域名注册商控制台添加 DS record。
3. 回到 Cloudflare 等待状态确认。

验证：

- Cloudflare Dashboard 中 DNSSEC 状态为 active。
- DNS 检查工具能看到 DS/DNSKEY 生效。

### 8. WAF Managed Rules

路径：

1. 选择你的域名。
2. 打开 `Security` -> `WAF`。
3. 进入 `Managed rules`。
4. 启用可用的 Cloudflare Managed Ruleset。

建议：

- 先使用默认 action 和默认 sensitivity。
- 如果出现误伤，再按事件日志逐条调整。
- 本项目是静态前端，不应一次性打开过激规则。

回归：

- 打开首页。
- 打开 `/edit/`。
- 回归 Magic Link。
- 回归账号托管恢复。
- 回归 Banner/背景图片。

### 9. Custom WAF Rules

路径：

1. 选择你的域名。
2. 打开 `Security` -> `WAF`。
3. 进入 `Custom rules`。
4. 点击 `Create rule`。

建议规则 1：阻断明显扫描路径。

Rule name：

```text
Block common scanner paths
```

Expression：

```text
(http.request.uri.path contains "/.git") or
(http.request.uri.path eq "/.env") or
(http.request.uri.path eq "/wp-login.php") or
(http.request.uri.path eq "/xmlrpc.php") or
(http.request.uri.path contains "/phpmyadmin")
```

Action：

```text
Block
```

注意：

- 不要阻断 `/_next/*`、`/edit/*`、Supabase 域名或 Storage 域名。
- 不要把普通用户路径写入规则。

### 10. Rate Limiting

路径：

1. 选择你的域名。
2. 打开 `Security` -> `WAF`。
3. 进入 `Rate limiting rules`。

建议：

- 本阶段可以先不启用。
- 如果开启，只设置非常保守的全站阈值，例如对单 IP 超高频请求做 challenge，而不是直接 block。
- 当前同步和账号 API 在 Supabase，不经过 Cloudflare Pages 域名，Cloudflare rate limiting 不能替代 Supabase RLS/RPC 保护。

### 11. Bot Fight Mode

路径：

1. 选择你的域名。
2. 打开 `Security` -> `Bots`。

建议：

- 本阶段暂不强依赖 Bot Fight Mode。
- 如果开启后出现 Magic Link、Storage 图片或客户端请求异常，应立即关闭并回归。

### 12. 账号 2FA 与成员权限

Cloudflare 账号：

1. 点击右上角用户头像。
2. 进入 `My Profile`。
3. 打开 `Authentication`。
4. 启用 Two-Factor Authentication。
5. 优先添加 security key。
6. 保存 backup codes。

成员权限：

1. 进入 `Manage Account`。
2. 打开 `Members`。
3. 移除不再需要的成员。
4. 对仍需协作的成员使用最小权限。

同样需要检查：

- GitHub 账号 2FA。
- Supabase 账号 2FA。
- GitHub repository secrets。
- Cloudflare Pages environment variables。

## 操作后的回归清单

每完成 DNS/TLS/WAF/Headers 中任一组变更后，至少执行：

```powershell
Invoke-WebRequest -Uri "https://personalhomepge.pages.dev/" -Method Head -UseBasicParsing
Invoke-WebRequest -Uri "https://personalhomepge.pages.dev/edit/" -Method Head -UseBasicParsing
```

绑定正式主域名后执行：

```powershell
Invoke-WebRequest -Uri "https://mylinker.net/" -Method Head -UseBasicParsing
Invoke-WebRequest -Uri "https://mylinker.net/edit/" -Method Head -UseBasicParsing
Invoke-WebRequest -Uri "https://www.mylinker.net/" -MaximumRedirection 0 -UseBasicParsing
```

手动回归：

- 首页可打开，静态资源无 404。
- `/edit/` 可打开。
- Magic Link 从当前 host 发起后回到当前 host。
- 账号托管空间可恢复。
- 普通同步码可绑定和拉取。
- Banner/背景图片刷新后仍显示。
- 数据恢复中心可打开，本地/云端历史可预览。
- 浏览器控制台没有 CORS、CSP、Storage、Auth 相关错误。

安全头验证：

```powershell
$headers = (Invoke-WebRequest -Uri "https://personalhomepge.pages.dev/" -Method Head -UseBasicParsing).Headers
$headers["X-Content-Type-Options"]
$headers["X-Frame-Options"]
$headers["Referrer-Policy"]
$headers["Permissions-Policy"]
```

## 回滚方案

如果安全头造成异常：

1. 回滚或删除 `public/_headers`。
2. 重新部署 Cloudflare Pages。
3. 回归首页、登录、同步和 Storage。

如果 WAF Managed Rules 造成异常：

1. 进入 `Security` -> `WAF` -> `Events`。
2. 找到被拦截请求。
3. 暂停对应 managed rule 或降低 sensitivity。
4. 不要直接关闭全部安全能力，除非确认是全局误伤。

如果 Custom WAF Rule 造成异常：

1. 进入 `Security` -> `WAF` -> `Custom rules`。
2. 暂停新增规则。
3. 回归受影响路径。

如果 DNS/TLS 造成异常：

1. 不改 Supabase 数据。
2. 暂停正式切流。
3. 恢复切流前 DNS/TLS 配置。
4. 继续保留 GitHub Pages legacy 作为 fallback。

## 本阶段不做事项

- 不修改 `HomeDocumentV2`。
- 不新增 Supabase migration。
- 不引入 Cloudflare Worker。
- 不强制 CSP。
- 不切正式主域名。
- 不关闭 GitHub Pages legacy。
- 不把 GitHub Pages 降级为迁移提示页。
- 不把 service role 或管理员密钥放入 Cloudflare Pages environment variables。
