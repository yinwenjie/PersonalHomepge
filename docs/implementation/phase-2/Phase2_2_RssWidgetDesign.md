# Phase 2.2 RSS 组件设计

状态：设计稿，待确认。本文只定方案，不包含运行时代码、migration 或部署。

## 背景

`backlog/WidgetCandidatesBacklog.md` 把 RSS 列为“等有受控服务端后再做”的候选：静态站点不能可靠地跨域抓取 feed，文章缓存也不该写进首页文档。Phase 1.18 已经在 master 上有了 Supabase Edge Function 基座（`admin-read`，含 CORS 白名单、请求校验和 Deno 测试），RSS 是第一个面向普通用户的联网组件。

## 结论摘要

| 问题 | 决定 |
|---|---|
| 组件类型 | 新增 `rss.feed`，可以添加多个 |
| 抓取方式 | 新 Edge Function `rss-proxy`，只返回解析、清洗后的条目，不转发原始响应 |
| 谁能用 | 不登录也能用（Gerald 已确认）。靠共享缓存和按 IP 限流防滥用 |
| 首页文档里存什么 | 只存 feed 地址、显示名称和显示偏好；文章不进文档、不进同步、不进数据包 |
| 缓存 | 服务端按 feed 共享缓存 30 分钟；浏览器本机再缓存一份，用于秒开和离线 |
| 渲染 | 只显示纯文本标题、来源、时间和可选摘要；不渲染 feed 里的 HTML，不加载 feed 里的图片 |
| 失败处理 | 单个 feed 失败不影响其他 feed；有旧数据就显示旧数据并标注“更新失败” |
| 上线依赖 | migration 022（缓存表、限流表、埋点白名单）+ 部署 `rss-proxy` + 一个服务端密钥，都要 Gerald 确认后执行 |

## 1. 目标用户和场景

- 每天打开首页时顺便看几个博客、新闻站、产品更新或 GitHub release 的最新条目。
- 不做阅读器：不在首页里读全文，点击标题直接打开原文。
- v1 面向公开 feed。需要登录、cookie 或 token 的 feed 不支持。

## 2. 交互

### 展开态

- 多个 feed 的条目合并成一个列表，按发布时间倒序。
- 每条显示：标题（单行省略）、来源名称、相对时间（例如“3 小时前”）。打开“显示摘要”后，标题下方再显示最多两行纯文本摘要。
- 标题是链接，`target="_blank"`、`rel="noopener noreferrer"`。
- 右上角是刷新按钮，点一次后冷却 60 秒。
- 显示条数可选 5、8、15，默认 8。

### 折叠摘要

最新一条的标题和来源，例如“Next.js 16.4 发布 · Vercel Blog”。没有内容时显示“未添加订阅”。

### 空状态、加载态和错误态

- 空状态：“添加一个网站或 RSS 地址”，按钮打开组件设置。
- 首次加载：3 行骨架占位，不出现转圈。
- 有本机缓存：先显示缓存，后台刷新，刷新完成后替换列表。
- 某个 feed 失败：其他 feed 照常显示。失败的 feed 有旧数据就继续显示，并在组件底部提示“1 个订阅更新失败”，点开可以看到是哪个、什么原因。
- 离线：显示缓存，标注“离线，显示的是上次的内容”。
- 没有配置 Supabase（本地开发或环境变量缺失）：组件选择器里不出现 RSS。

### 添加订阅

1. 在组件设置里粘贴网址。可以是 feed 地址，也可以是网站首页。
2. 点“检查”，前端调用 `rss-proxy`。如果是网页，服务端在页面里找 `<link rel="alternate" type="application/rss+xml|atom+xml">`，自动换成 feed 地址。
3. 成功后显示 feed 标题和前 3 条预览，名称默认取 feed 标题，可改，然后保存。
4. 失败时直接显示原因（不是 feed、打不开、超时、太大、地址不允许），不保存。

## 3. 配置和数据边界

### `HomeDocumentV2.widgets[].config`

```ts
interface RssFeedWidgetConfig {
  feeds: Array<{
    id: string;
    url: string;    // 检查后得到的 feed 地址，http/https，≤ 2048 字符
    label: string;  // 显示名称，≤ 40 字符
    order: number;
  }>;               // 最多 5 个
  itemCount: 5 | 8 | 15;  // 默认 8
  showSummary: boolean;   // 默认 false
}
```

- 按现有组件的方式写 `normalizeRssFeedConfig`：丢弃非法项、去重（按规范化后的 URL）、截断到上限。
- 整个首页最多 10 个 feed（跨所有 RSS 组件），添加第 11 个时提示。
- 配置随首页一起进入本地历史、云端同步、快照和数据包导出，和其他组件一样。
- 公开分享页本来就不包含组件，RSS 也不会出现在分享页里。

### 不进首页文档的东西

- 文章条目、抓取时间、错误状态、已读位置都不写进文档，所以刷新不会产生同步写入和历史快照。
- 浏览器本机缓存：`localStorage` 键 `homepage:rss-cache:v1`，按 feed 存最近 15 条和抓取时间，总量上限 200 KB，超出按最久未用淘汰。不进数据包导出，清空浏览器数据即消失。

### 刷新节奏

- 打开首页时，缓存超过 30 分钟才请求服务端。
- 标签页从后台切回来、且距上次刷新超过 30 分钟时再刷新一次。
- 一个 RSS 组件一次刷新只发一个请求（批量带上它的所有 feed）。

## 4. 服务端：`rss-proxy` Edge Function

### 接口

`POST /functions/v1/rss-proxy`，用前端已有的 Supabase anon key 调用（`verify_jwt = true`，登录与否都能用）。

请求：

```json
{ "mode": "read", "feeds": ["https://example.com/feed.xml"] }
```

- `mode` 为 `read`（读取，最多 5 个地址）或 `check`（添加时检查，只能 1 个地址，允许网页自动发现 feed）。
- 请求体上限 8 KB，未知字段直接拒绝，和 `admin-read` 的校验方式一致。

响应：

```json
{
  "feeds": [{
    "url": "https://example.com/feed.xml",
    "status": "ok",
    "fetchedAt": "2026-10-09T08:00:00Z",
    "title": "Example Blog",
    "siteUrl": "https://example.com/",
    "items": [{
      "id": "c2a1…",
      "title": "…",
      "link": "https://example.com/post",
      "publishedAt": "2026-10-08T12:00:00Z",
      "summary": "…"
    }]
  }]
}
```

`status` 取值：`ok`、`stale`（这次抓取失败或正在被别的请求刷新，返回的是旧缓存）、`pending`（新 feed 正在被别的请求首次抓取）、`error`。`error` 和 `stale` 带 `errorCode`：`invalid_url`、`blocked_address`、`not_feed`、`fetch_failed`、`timeout`、`too_large`、`rate_limited`。

### CORS

只放行 `https://mylinker.net`、`https://www.mylinker.net`、本地开发地址和 Cloudflare Pages 预览域名。和 `admin-read` 一样，Origin 不是身份，真正的防线是下面的限流和抓取限制。旧的 GitHub Pages 站点不放行，那里不显示 RSS 组件。

### 防止被当成通用代理或用来打内网（SSRF）

- 只允许 `http`/`https`，端口只能是默认端口，URL 里不能带用户名密码。
- 拒绝 `localhost`、`*.local`、`*.internal`、`*.localhost` 这类主机名，拒绝私网、回环、链路本地、组播、云元数据地址，包括 IPv6、IPv4 映射 IPv6，以及十进制、八进制等写法的 IP。
- 解析 DNS 后检查所有 A/AAAA 记录，有一个不合规就拒绝。
- 只检查一次 DNS 不够：之后 `fetch` 会再解析一次，攻击者可以让第二次解析指向内网（DNS rebinding）。所以真正连接的必须是检查过的那个 IP，或者由网络层挡住内网。v1 开工的第一步是做一个验证，三选一，**都做不到就不上线，不能退回“只检查 IP 字面量”**：
  1. 运行时能把连接钉在检查过的 IP 上，同时保留原主机名的 Host 头和 TLS 校验（例如 `Deno.createHttpClient` 支持自定义解析）。
  2. Supabase Edge 的出口网络本身就到不了私网和云元数据地址：在测试项目里部署一个临时函数，用一个会解析到 `169.254.169.254` 和私网地址的测试域名去请求，确认连不上，结果写进运行手册。
  3. 改用 Cloudflare Worker 做抓取（见第 10 节），并同样做第 2 条的验证。
- 重定向手动跟随，最多 3 次，每一跳都重新检查地址。网页自动发现 feed 也算一跳。
- 总超时 8 秒，响应体边读边计数，超过 1 MB 立即中断。
- 只接受 XML 和 feed 类型的响应（`check` 模式额外接受 HTML 用于自动发现）。
- 返回给前端的只有清洗后的字段，拿不到原始响应，所以没法用它代理任意内容。
- 请求头带 `User-Agent: MyLinkerFeedFetcher/1.0 (+https://mylinker.net)`，并用缓存里的 `ETag`/`Last-Modified` 做条件请求。

### 解析和清洗

- 支持 RSS 2.0、RSS 1.0（RDF）和 Atom 1.0。
- 只用纯 JavaScript、不会自己发网络请求或读文件的 XML 解析库，并关闭实体展开。
- 解析前处理 `<!DOCTYPE`：带内部子集（`[` … `]`，可能声明实体）的一律拒绝；不带内部子集的（老的 RSS 0.91 feed 会有）直接删掉再解析，绝不去加载它指向的外部 DTD，防止实体炸弹和借 DTD 地址绕过抓取检查。
- 标题去标签、解码实体、合并空白，最多 200 字符；摘要同样处理，最多 240 字符。
- 链接相对地址按 feed 地址补全，只保留 `http`/`https`，其他协议（比如 `javascript:`）整条丢弃。
- 时间统一转成 ISO 字符串，解析不了就留空，排序时放最后。
- 条目 `id` 取 `guid`、链接或标题的哈希。
- 每个 feed 最多存 20 条，序列化后不超过 64 KB。

### 服务端缓存（migration 022）

表 `public.rss_feed_cache`：

| 字段 | 说明 |
|---|---|
| `url_hash` | 规范化 feed 地址的 SHA-256，主键 |
| `feed_url` | 规范化后的地址，重新抓取时要用 |
| `title`、`site_url`、`items` | 清洗后的结果，`items` 为 jsonb |
| `etag`、`last_modified` | 条件请求用 |
| `status`、`error_code`、`failure_count` | 最近一次抓取结果 |
| `fetched_at`、`next_fetch_at`、`last_requested_at` | 缓存控制和清理 |
| `refresh_lease_until` | 刷新租约，保证同一时间只有一个请求在抓 |

- 新鲜期 30 分钟。过期后第一个请求触发重新抓取，失败时返回旧数据（`stale`），旧数据最多保留 7 天。
- 同一个 feed 同时只允许一个请求去抓：抓取前先调用 `rss_claim_refresh(url_hash)`，它在一条 `update … where refresh_lease_until is null or refresh_lease_until < now()` 里原子地拿到 60 秒的租约（新 feed 先 `insert … on conflict do nothing` 建占位行）。拿到租约的请求去抓，抓完写结果并清掉租约；没拿到的直接返回现有缓存。新 feed 还没有缓存时，没拿到租约的请求每 500 毫秒重读一次，最多等 8 秒，仍然没有就返回 `pending`，前端 5 秒后重试一次。表里因此多一个 `refresh_lease_until` 字段。
- 连续失败会拉长下次抓取的间隔（30 分钟、1 小时、2 小时，最长 6 小时），避免反复打一个挂掉的站。
- 缓存按 feed 共享、不关联任何用户：同一个 feed 不管多少人订阅，30 分钟内只抓一次。
- 30 天没人请求的行会被删除：函数每次调用有 1% 概率顺带清理一批，另外提供 `delete_stale_rss_feed_cache()` 供手动执行，和埋点清理函数的做法一致。
- 表启用 RLS 且不建任何 policy，并收回 `anon`、`authenticated` 的权限，只有函数用 service role 访问。

### 限流（migration 022）

表 `public.rss_rate_limits(bucket_key, window_start, request_count)`，加一个 `security definer` 函数 `rss_consume_rate(p_key, p_window_seconds, p_limit)`，原子地加一并返回是否超限，只授权给 `service_role`。

| 限制 | 默认值 | 超限时 |
|---|---|---|
| 每个 IP 的请求数 | 10 分钟 60 次 | 整个请求返回 `rate_limited` |
| 每个 IP 的 `check` 次数 | 10 分钟 20 次 | 返回 `rate_limited` |
| 全局真实抓取次数（不含命中缓存） | 每分钟 300 次 | 有缓存就返回 `stale`，没有返回 `rate_limited` |

- IP 不落库：`bucket_key` 是 `SHA-256(IP + 服务端密钥 RSS_RATE_LIMIT_SALT)`。客户端 IP 从平台转发头里取，取哪一个头要在开工时对照 Supabase 文档确认。
- 一天前的限流行顺带清理。

### 日志

每个请求只记一行 JSON：请求 id、`mode`、feed 数量、命中缓存的数量、各 feed 的错误码、耗时。不记 URL、不记 IP，也不记任何按 feed 固定不变的标识（普通 SHA-256 前缀可以被人拿常见 feed 地址算出来对上）。

## 5. 埋点和错误监控

- 添加组件沿用现有 `widget.added`，`widgetType = "rss.feed"`。
- 新增 `rss.feed_checked`，属性 `result`（`ok` 或错误码）和 `discovered`（是否从网页自动发现）。用来看“粘贴网址后能成功订阅”的比例。需要在 migration 022 里一起加进埋点白名单。
- 不上报 feed 地址、域名、标题或条目内容，也不做刷新成功/失败的逐次埋点，避免噪音。
- 前端错误监控只记录错误码，不记录地址。

## 6. 模板和移动端

- 六个模板默认都不放 RSS：它依赖联网，而且没有配置时只是一个空组件。
- 移动端每条的整行都可点，点击区域高度不小于 44px；设置表单沿用现有组件设置的布局。
- 新文案进 8 种语言的翻译。

## 7. 上线步骤

0. 完成第 4 节的出口网络验证，三条路都不通就停在这里。
1. migration 022：缓存表、限流表和函数、刷新租约函数、埋点白名单（`rss.feed_checked`、`discovered`）、验证脚本 `supabase/checks/024_rss_proxy_verify.sql`（`requiresRollback: true`）。
2. 设置服务端密钥 `RSS_RATE_LIMIT_SALT`，部署 `rss-proxy`。目前的远程部署流程只处理 migration，不部署 Edge Function，所以要在运行手册里补上函数的部署和回滚步骤。
3. 前端合入后照常发布。函数还没上线时，组件会在“检查”这一步失败并提示“服务暂不可用”，不会影响其他功能。

第 1、2 步会改线上数据库和 Supabase 项目，执行前需要 Gerald 确认。`rss-proxy` 不依赖 `admin-read` 或 migration 020，两者可以分开上线。

## 8. 测试计划

- Deno 单元测试：URL 规范化和地址拦截（各种 IP 写法、IPv6、重定向到内网）、三种 feed 格式和残缺 feed 的解析、实体炸弹、带外部 DTD 地址的 feed（确认不会发出请求）、超大响应、清洗规则（`javascript:` 链接、HTML 标题）。
- Deno handler 测试：用假的 `fetch` 和假的存储覆盖缓存命中、过期重抓、失败回退旧数据、退避、限流、CORS、请求校验，以及同一 feed 并发过期时只有一个请求去抓。
- pgTAP：`rss_consume_rate` 的计数和窗口、`rss_claim_refresh` 的租约（两次连续调用只有第一次成功，租约过期后可以再拿）、表和函数的权限（`anon`、`authenticated` 不能访问）。
- 上线前验证：第 4 节的出口网络验证，结果写进运行手册。
- 前端：配置归一化、本机缓存淘汰、合并排序；Playwright 用假的函数响应跑一遍添加订阅、刷新、部分失败和离线。

## 9. v1 不做

- 需要登录或 token 的 feed、自定义请求头。
- 图片、播客音频、全文阅读、已读/未读状态。
- OPML 导入导出。
- 按关键词过滤、通知提醒。

## 10. 考虑过的其他方案

- **浏览器直接抓取**：大多数 feed 不带 CORS 头，抓不到。
- **公共 RSS 转 JSON 服务**：省事，但把用户的订阅交给第三方，而且有额度和稳定性问题。
- **Cloudflare Worker**：`mylinker.net` 已经在 Cloudflare 上，Worker 自带边缘缓存，免费额度也宽松。但要多一个部署面和一套密钥管理，和“基于 Edge Function 基座”的计划不一致。v1 仍用 Supabase，接口保持简单，以后换成 Worker 时前端只需要改调用地址。如果第 4 节的出口网络验证在 Supabase 上不通过，Worker 就是备选。

## 11. 成本估算

一个 RSS 用户每天大约触发 10 次函数调用（打开首页和切回标签页，每次最多一个请求，30 分钟内不重复）。1,000 个活跃 RSS 用户约每月 30 万次调用；真实抓取次数取决于 feed 数量，不取决于用户数。Supabase 免费计划的每月调用额度以当前定价页为准，接近时可以把刷新间隔调长，或者改用 Cloudflare Worker。

## 12. 待确认

1. ~~不登录也能用吗？~~ 已定（Gerald，2026-10-09）：不登录也能用，按 IP 限流和共享缓存控制滥用。
2. **数量上限**：每个组件 5 个 feed、整个首页 10 个，是否合适。
3. **刷新间隔**：服务端和本机都是 30 分钟。新闻类用户可能想更快，但会增加调用量。
