# Phase 1.18 受控服务端与只读后台 Dashboard v1 实施计划

## Summary

Phase 1.18 为 MyLinker 建立第一条受控服务端管理链路，使授权管理员能够在留痕、最小权限、不破坏普通同步码密文边界且不向普通用户交付后台页面资源的前提下排查账号托管首页空间。

当前状态：Phase 1.18.0 方案、安全边界和准备阶段已完成；2026-08-10 Phase 1.18.1 已完成仓库、本地、CI 和线上数据库门禁，目标项目的 001-019 schema/history 一致，标准 dry-run 与完整 `021` verify 通过。尚未初始化持久化管理员；开始 1.18.2 联调前仍须按运行手册初始化明确的测试管理员。Edge Function、私有 Admin 仓库、管理页面和 Access 配置仍未实施。

v1 的产品结果是只读后台：管理员可以精确查找用户、查看空间元数据、查看账号托管云端历史与用户侧云端审计，并在高权限和强审计条件下预览单个账号托管快照。除管理员审计记录外，后台不得写入任何用户数据。

## 1.18.0 已确认决策

### 架构

- 受控后端固定采用 Supabase Edge Functions；不新增独立 Node 服务、Cloudflare Worker 或 Next.js Server Route。
- Admin UI 固定使用独立的私有源码仓库、独立的 Next.js static export、独立的 Cloudflare Pages project 和独立域名 `https://admin.mylinker.net/`。Admin UI 不复用当前公开主站构建，不在本仓库新增 `app/admin/`，也不部署到 GitHub Pages legacy。
- 当前 `PersonalHomepge` 仓库为公开仓库，因此不得把 Admin UI 页面、组件、样式、前端路由或构建产物提交到本仓库；本仓库只保存可公开审阅的 migration、数据库检查、Edge Function、浏览器安全 API 合约、验证脚本和实施文档。
- `mylinker.net` 主站不得增加后台入口、后台导航、`/admin/` 路由、sitemap 项或 Admin UI bundle。普通用户访问主站及 GitHub Pages legacy 时，不应下载或执行任何后台页面代码。
- `admin.mylinker.net`、Admin Pages 的生产 `<admin-project>.pages.dev` 和全部 `*.<admin-project>.pages.dev` 预览入口必须分别受 Cloudflare Access 保护。Access 是页面资源到达浏览器前的外层身份门禁，Supabase JWT、`admin_users.enabled` 和角色矩阵仍是管理 API 的最终授权。
- 浏览器只持有公开 Supabase URL、anon key 和当前登录 session。service role 只存在于 Supabase Edge Function 运行环境，不得使用 `NEXT_PUBLIC_` 前缀，不得写入仓库、Cloudflare Pages 或 GitHub Actions 静态构建环境。
- 所有跨用户读取统一经一个 `admin-read` Edge Function；普通浏览器不得直接查询 `admin_users`、`admin_audit_events`、其他用户的 `profiles`、`home_spaces`、`home_space_snapshots` 或 `home_space_audit_events`。

### 页面隔离与 Cloudflare Access

- Cloudflare Access policy 采用默认拒绝，只允许负责人确认的精确管理员身份或受控 IdP 管理员组；不得使用 `Allow everyone`，也不得仅按普通用户同样拥有的邮箱域名放行。
- Access 必须要求已启用的身份提供方和 MFA，并使用不超过 8 小时的会话；最终身份列表、IdP 和会话时长属于部署输入，不在公开仓库保存邮箱或组成员明细。
- 自定义域名、生产 `pages.dev` 和预览通配域名是三个独立入口，缺少任一 Access application 都视为上线门禁失败。Pages 自带的 preview access policy 不能替代生产 `pages.dev` 或自定义域名保护。
- 自定义域名必须先绑定并验证，再创建或启用对应 Access application。不得为方便验证而临时公开生产或预览部署。
- Admin Pages 固定输出 `noindex`、`nofollow`、`noarchive` 和禁止缓存的响应头，禁用浏览器 source map；robots 和不公开链接只是辅助措施，不能替代 Access。
- “不暴露”在本阶段定义为：普通主站没有入口或后台 bundle，未通过 Access 的请求拿不到 Admin HTML/JS/CSS，未通过 Supabase 管理员授权的调用拿不到管理数据。不承诺隐藏 `admin.mylinker.net` 的 DNS、TLS 证书或 Access 登录页存在性。
- Edge Function 位于 Supabase 公网域名，Cloudflare Access 不直接保护该 URL；因此即使 Admin Pages 已受 Access 保护，Edge Function 仍必须对缺失/伪造 JWT、普通 Supabase 用户、disabled 管理员和越权角色独立拒绝。

实施时以 Cloudflare 官方的 [Pages preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)、[Pages Access known issues](https://developers.cloudflare.com/pages/platform/known-issues/)、[Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/) 和 [Access self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/) 为配置依据；Supabase JWT 继续以 [Edge Function authentication](https://supabase.com/docs/guides/functions/auth) 和 [function configuration](https://supabase.com/docs/guides/functions/function-configuration) 为准。Dashboard 手工界面名称变化时可以按官方文档调整点击路径，但不得放宽本节的三入口保护和服务端二次鉴权。

### 数据与权限

- v1 角色固定为 `owner`、`admin`、`support`。
- `owner` 和 `admin` 可以执行 v1 全部只读查询；`support` 只能查找用户、查看空间元数据、快照摘要列表和用户侧云端审计，不得读取 `document_json`，也不得查询其他管理员的审计记录。
- v1 不提供管理员名单管理 API 或 UI。首个 `owner` 由有 Supabase Dashboard 权限的运维人员使用明确的 Auth user UUID 手动初始化；migration 中不得硬编码邮箱或用户 UUID。
- 管理员启用、停用和角色调整在 v1 仍是受控运维操作，不属于 Dashboard 的用户数据写入能力。后续若产品化，必须进入独立阶段并增加二次确认和审计。
- 后台只读取账号托管空间已有的 `home_space_snapshots`。不读取或解密 `sync_spaces` 当前内容，不读取 `home_space_credentials`，不生成新的云端快照。
- 普通 `sync-code` 空间只展示空间元数据和允许的风险/审计摘要；任何接口都不得返回其密文、凭证、同步码、managed secret 或可预览明文。
- “当前内容”在 v1 中统一解释为“最新一条账号托管云端快照”，UI 必须标注快照时间和 revision，不能宣称实时状态。

### 审计与隐私

- 除不读取跨用户数据的 `get-admin-context` 权限握手外，每个管理 API 请求都必须携带人工填写的访问理由，trim 后长度为 8-500 字符；不能使用固定默认理由绕过填写。UI 明确提示理由中不得填写邮箱、URL、首页内容或凭证，服务端拒绝明显的邮箱、URL、JWT/token 和同步码形态。
- 每次成功查询都写入 `admin_audit_events`；任何 operation 的审计写入失败时都必须 fail closed，不返回查询结果。
- 审计只记录管理员 UUID、角色快照、动作、目标 UUID、结果数量、请求 ID、理由和低敏感状态，不记录邮箱搜索词、首页标题、网站名称/URL、组件内容、`document_json`、同步凭证、access token、JWT 或 service role。
- Admin UI 不调用现有产品 analytics、client error monitoring 或本地审计；管理查询、搜索词、访问理由和响应正文不写入 URL query、localStorage、sessionStorage、cookie 或 console。
- 快照预览中的站点 URL 只显示为文本，不生成可点击外链；Banner、背景和其他远程资源只显示“已配置/未配置、来源类型”状态，不请求远程 URL、不生成 Storage signed URL，避免访问者追踪和额外数据外发。

### 严格不做

- 不修改、恢复、删除或创建用户首页、空间、快照、同步码、凭证或分享。
- 不提供数据包导出、批量复制、下载 `document_json` 或原始 JSON 展示。
- 不读取普通同步码空间明文，不新增服务端解密流程。
- 不增加模糊用户目录浏览、全量用户列表或无条件批量查询。
- 不接 RSS、天气、GitHub、支付、OAuth、账号删除或其他联网产品功能。
- 不把 admin 权限做成普通 RLS policy，不向 `authenticated` 授予跨用户表权限或 service-role RPC。

## 交付顺序

| 子阶段 | 目标 | 主要产物 | 开始条件 | 完成条件 |
|---|---|---|---|---|
| 1.18.0 | 方案与安全边界 | 本文档、主计划和 backlog 状态 | Phase 1.17 线上验收完成 | 架构、权限、数据、审计、部署和非目标无歧义 |
| 1.18.1 | 管理员身份与审计数据库 | `019` migration、`021` verify、初始化/回滚说明 | 1.18.0 完成 | 前端零表权限，约束、索引和 A/B/C 检查通过 |
| 1.18.2 | 受控 Edge Function 基座 | JWT 校验、角色矩阵、CORS、请求/响应协议、审计 helper | 1.18.1 在线且已初始化测试管理员 | 非管理员无法跨用户读取，service role 不出服务端 |
| 1.18.3 | 只读查询 API | 精确用户解析、空间、快照摘要、用户审计、管理员审计接口 | 1.18.2 鉴权门禁通过 | 字段白名单、分页、模式隔离和审计 fail-closed 通过 |
| 1.18.4 | 独立 Admin Pages 基座 | 私有 Admin 仓库、独立 static export、鉴权态、搜索、空间与列表视图 | 1.18.3 API 合约固定，私有仓库和 Pages project 已确认 | Admin UI 不进入公开主站或 GitHub Pages，搜索数据不持久化 |
| 1.18.5 | 受控快照预览 | 完整内容只读预览、图片状态、敏感访问确认 | 1.18.4 完成 | 仅 owner/admin 可预览，逐次审计，无外链/远程资源请求 |
| 1.18.6 | 回归、Access 部署与运行手册 | 自动校验、A/B/C 回归、Edge/Admin Pages/Access 部署、回滚演练 | 1.18.1-1.18.5 全部完成 | 三类 Admin Pages 入口均受 Access 保护，API 权限、审计、隐私和主站隔离通过 |

## 准备阶段：本地 Supabase 与 CI 基线

状态：已于 2026-07-25 完成，不包含 Phase 1.18 业务 migration、函数或页面。

已完成：

- 安装并验证 Supabase CLI `2.109.1`、Colima `0.10.3`、Docker CLI `29.6.2`、Docker Engine `29.5.2` 和 Deno `2.9.4`；Colima 使用 4 CPU、8 GiB 内存的本地 arm64 VM。
- 新增最小 `supabase/config.toml`，只配置本地端口和本地 Auth redirect；显式保留 `[functions.admin-read] verify_jwt = true`，没有 project link、生产 project ref 或服务端密钥。
- 新增 `supabase/tests/database/000_existing_migrations_test.sql`，通过 pgTAP 验证 `001-018` 重放后的关键表与公开分享 RPC；它不创建管理员表或测试用户。
- 新增 `supabase/functions/deno.json` 和无业务逻辑的 Deno 运行时自检，为 1.18.2 的 Functions 测试提供独立于 Next.js 的类型检查环境。
- 新增 `scripts/verify-supabase-preparation.mjs`、`npm run verify:supabase-preparation` 和 `.github/workflows/verify-supabase.yml`；CI 只执行本地 migration replay、lint、pgTAP 与 Deno 检查，不连接或部署远端 Supabase。
- 根 `tsconfig.json` 排除 `supabase/functions`，Next.js 使用 TypeScript 检查主站，Deno 独立检查 Edge Function，避免运行时类型互相污染。

本地验收结果：

- `supabase db start` 和 `supabase db reset` 成功，`001-018` 在 PostgreSQL 17 本地数据库中从空库完整重放。
- `supabase db lint --level error` 返回零错误。
- `supabase test db` 通过 `1` 个文件、`10` 项断言。
- Deno fmt、lint、type-check 和测试通过，测试结果为 `1 passed / 0 failed`。
- 主站 typecheck、lint、隐私检查、公开分享校验、i18n、production build 和根路径 static export 验证通过。

准备阶段没有执行 `supabase link`、`supabase db push`、`supabase functions deploy`、远端 migration、管理员初始化或 Cloudflare 变更。

## 1.18.1：管理员身份与审计数据库

状态：仓库、本地、CI 和线上数据库门禁已于 2026-08-10 完成；待 1.18.2 联调前初始化明确的测试管理员。

### 文件范围

- 新增 `supabase/migrations/019_admin_readonly_foundation.sql`。
- 新增 `supabase/checks/021_admin_readonly_foundation_verify.sql`。
- 新增 `supabase/tests/database/001_admin_readonly_foundation_test.sql`。
- 更新 `docs/guides/SupabaseMigrationChecklist.md`。
- 新增 `docs/guides/AdminDashboardRunbook.md`，记录初始化、验证、停用和回滚流程。

不得修改 `home_spaces`、`home_space_snapshots`、`home_space_audit_events`、`sync_spaces` 或 `home_space_credentials` 的既有 RLS/grant，以管理员需求为由扩大普通用户权限。

### `admin_users`

建议字段固定为：

```text
id uuid primary key
user_id uuid not null unique -> auth.users(id)
role text not null: owner | admin | support
enabled boolean not null default true
created_by uuid nullable -> auth.users(id)
created_at timestamptz not null
updated_at timestamptz not null
```

要求：

- 开启 RLS；撤销 `anon`、`authenticated` 和 `public` 的全部表权限；不创建普通前端 policy。
- `role`、唯一管理员身份和时间字段使用数据库约束/trigger 固化。
- migration 只创建空表，不能插入具体管理员。
- 初始化语句必须使用明确 UUID，并先确认该 UUID 存在于 `auth.users`；不得按模糊邮箱插入，也不得把初始化 UUID 提交到仓库。

### `admin_audit_events`

建议字段固定为：

```text
id uuid primary key
request_id uuid not null unique
admin_user_id uuid nullable -> admin_users(id) on delete set null
admin_auth_user_id uuid not null
admin_role text not null
action text not null
severity text not null: info | warning | danger
reason text not null
target_user_id uuid nullable
target_home_space_id uuid nullable
target_sync_space_id uuid nullable
target_snapshot_id uuid nullable
result_count integer nullable
metadata jsonb not null default '{}'
created_at timestamptz not null
```

要求：

- 表只允许 service role 追加与读取；无前端 direct grant、无普通用户 RLS policy。
- migration 显式只授予 `service_role`：`admin_users` 为 `select`，`admin_audit_events` 为 `select, insert`；Edge Function 使用的 service-role client 不获得 update/delete grant。
- 不提供 update/delete API。v1 默认永久保留；归档与清理另行设计。
- `action` 使用固定白名单：`admin.session.check`、`admin.user.resolve`、`admin.home_space.list`、`admin.snapshot.list`、`admin.snapshot.preview`、`admin.home_audit.list`、`admin.audit.list`。
- `admin.session.check` 使用固定系统理由且不接收客户端 reason；其他 action 的 `reason` trim 后限制 8-500 字符并拒绝明显的邮箱、URL、JWT/token 和同步码形态。`result_count` 限制为 `0-50`；`metadata` 只允许版本、分页方向、access mode、结果状态等低敏感字段。
- `admin_auth_user_id` 与 target UUID 作为审计时点快照保留，不使用会因账号或用户数据删除而级联清除审计记录的外键；`admin_user_id` 可以在管理员记录删除时置空。
- 为管理员、目标用户、目标空间、目标快照和 `created_at desc` 建立查询索引。

### 数据库验证

`021` 至少验证：

- 两张表、约束、索引和 RLS 均存在。
- `anon`、`authenticated`、`public` 没有 direct table privilege。
- 没有允许普通用户跨用户查询的 policy 或前端 RPC grant。
- 非法 role/action/severity、过短理由、过大结果数和非法 metadata 被拒绝。
- A（owner）、B（support）、C（普通账号）使用 transaction-scoped 测试，结束必须 `rollback`，不得留下管理员或审计测试数据。

### 实施结果

- `019` 已创建空的 `admin_users` 和 `admin_audit_events`，复用 `set_updated_at()` trigger；没有管理员、邮箱或 UUID 被写入 migration。
- 两张表均启用 RLS 且没有 policy；`anon`、`authenticated`、`PUBLIC` 零 direct table grant。`service_role` 对 `admin_users` 只有 `SELECT`，对 `admin_audit_events` 只有 `SELECT, INSERT`，没有 update/delete。
- 数据库约束已固化角色、七类 action、三类 severity、固定 session reason、8-500 字符理由、邮箱/URL/JWT/token/同步码形态拒绝、0-50 结果数和四类低敏感 metadata。
- 审计索引覆盖管理员、目标用户、目标首页空间、目标同步空间、目标快照、action 和稳定的 `created_at desc, id desc` 游标顺序。
- `021` Section 1-7 提供只读结构/权限检查；Section 8 自动创建 synthetic A=owner、B=support、C=普通账号，验证负向约束和 service-role 追加后统一 rollback。
- 本地 Supabase CLI `2.113.0` 已从空库重放 `001-019`；数据库 lint 零错误。pgTAP 共 `2` 个文件、`56` 项断言通过，其中 Phase 1.18.1 为 `46` 项。
- 已在本地完整执行 `021`，A/B/C、两条合法审计和全部负向约束通过；rollback 后 synthetic Auth、管理员和审计行数均为 `0`。
- 已补充 `.github/workflows/deploy-supabase.yml`、`scripts/deploy-supabase-remote.mjs`、`supabase/remote-deploy.json` 和远程 history preflight；`021` 也增加机器可失败的结构/权限和 rollback 残留断言。远程链路默认 dry-run，只执行 manifest 白名单检查，apply 需要受保护 Environment 审批和精确 project-ref 二次确认。
- GitHub `supabase-production` Environment、secrets、required reviewer、禁止管理员绕过、`master` deployment branch policy 和 project ref 已配置。
- 2026-08-10 先由标准 dry-run 确认远端 schema 已存在但 CLI history 为空；经一次性受保护 schema/permission/021 审计，将固定 001-019 history 标记为 applied。对齐后标准 dry-run 返回远端 up to date，标准 verify 再次通过 baseline 和 `021` rollback。
- 一次性 repair workflow 已删除，正式远程 workflow 继续禁止 `migration repair`、`--include-all` 和远程 reset。本次没有重跑 migration、执行 apply、初始化持久化管理员、部署 Functions 或修改 Cloudflare。

## 1.18.2：受控 Edge Function 基座

状态：2026-10-09 代码与单元测试已完成，尚未部署 Function，也未用真实 JWT 和测试管理员做端到端联调（需先按运行手册初始化测试管理员）。

- `admin-read/handler.ts` 按下文 9 步顺序实现请求流程；Auth、`admin_users` 查询和审计写入通过端口注入，`index.ts` 只负责用服务端 env 组装 service role client。
- 1.18.2 只开放 `get-admin-context`；其余 operation 在 1.18.3 补齐 handler 前一律返回 `invalid_request`。
- 响应先序列化并检查总字节上限，再写审计；审计写入失败返回 `audit_failed`，不返回数据。
- `tests/admin_read_handler_test.ts` 与 `tests/admin_contract_test.ts` 覆盖 origin、preflight、方法、token、非管理员、Auth 故障、严格 body、角色矩阵、审计 fail-closed、响应上限和日志内容。

### 文件范围

- 新增 `supabase/functions/admin-read/index.ts`。
- 新增 `supabase/functions/_shared/admin-auth.ts`、`admin-audit.ts`、`admin-contract.ts`、`cors.ts`；共享模块不得被浏览器代码导入。
- 若 Supabase Functions 需要 import map/config，仅新增其运行所需最小配置。

### 请求流程

每个请求必须依次执行，不能调整顺序：

1. 只接受 `POST`；`OPTIONS` 仅处理允许 origin 的 CORS preflight。
2. 校验 `Origin` 属于 `https://admin.mylinker.net`、`ADMIN_ALLOWED_ORIGINS` 中明确登记的单个 Admin Pages preview origin，或本地开发使用的 `http://localhost:3000` / `http://127.0.0.1:3000`。不得允许 `https://mylinker.net`、GitHub Pages、任意 `*.pages.dev` 通配或请求 body 自报 origin。Origin 不是身份凭据，后续仍必须验证 JWT。
3. 从 `Authorization: Bearer <access-token>` 读取 session，调用 Supabase Auth 验证真实用户；不相信请求 body 中的 user/role。
4. 使用仅服务端 client 精确查询 `admin_users.user_id`，要求记录存在且 `enabled = true`。
5. 解析 operation、reason、filters 和 cursor；拒绝未知字段、未知 operation、过大 body 和非法 UUID。只有 `get-admin-context` 不接收人工 reason，且不得查询任何目标用户数据。
6. 根据服务端查询到的 role 执行权限矩阵；客户端提交的 role 永远忽略。
7. 执行字段白名单查询并生成固定 response DTO。
8. 使用服务端生成的 request ID 写入 `admin_audit_events`；任何读取的审计写入失败时都不返回步骤 7 的结果。
9. 返回安全 envelope，不把原始 Postgres/Auth error、SQL、JWT、邮箱搜索词或用户内容写入日志或错误响应。

### 固定协议

请求 body：

```text
operation: 固定 operation 字符串
reason: 除 get-admin-context 外必填的 8-500 字符人工理由
filters: operation 对应的严格对象
cursor: 可选的不透明分页游标
```

成功响应：`{ ok: true, requestId, data, nextCursor }`。

失败响应只允许稳定错误码：`invalid_request`、`not_authenticated`、`not_authorized`、`not_found`、`rate_limited`、`audit_failed`、`service_unavailable`。`not_found` 不区分用户、空间或快照是否曾存在；HTTP status 与错误码映射写入共享 contract。

### 服务端约束

- 单页默认 20，最大 50；所有列表使用稳定排序与游标，不使用客户端可控 offset 做无限遍历。
- 设定请求 body、单项快照和响应总字节上限；超过限制返回安全错误，不截断 JSON 后继续渲染。
- Edge Function 不输出 `console.log(request/body/response/error)`；必要日志只包含 request ID、operation、结果类别和无内容计数。
- 不使用 `service_role` 调用用户可控的任意表名、列名、排序表达式或 RPC 名称。
- 不接收或信任浏览器自报的 Cloudflare Access 身份、邮箱或 role。Admin Pages 到 Supabase 公网函数的请求只使用 Supabase access token，Access 身份与 Supabase 管理员授权保持两道独立门禁。
- CORS、Cloudflare Access、隐藏入口和独立仓库都不能替代 API 授权；JWT、`admin_users` 和 role matrix 缺一不可。

## 1.18.3：只读查询 API

状态：2026-10-09 代码与单元测试已完成，尚未部署，也未连真实数据库联调。`preview-snapshot` 的服务端投影属于 1.18.5，在此之前该 operation 仍返回 `invalid_request`。

- `_shared/admin-read-store.ts` 固定表名、列名和排序（`created_at desc, id desc` keyset 分页），不查询 `document_json`；`admin-read/operations.ts` 校验各 operation 的严格 filters 并投影 DTO。
- 分页游标绑定 operation 和目标（管理员审计绑定完整 filter 组合），换目标重放会被拒绝。
- `content_fingerprint` 实际是文档内容的稳定序列化（含标题、站点 URL 和组件配置），所以快照 DTO 只返回其 SHA-256 前 12 位 `fingerprintDigest`。
- 快照 summary 只保留分组/站点/组件数量、主题 preset 和 banner/背景布尔值，不返回 `documentTitle`。
- `profiles.email` 可由用户本人修改，且注册是开放的，所以按邮箱查用户改为调用迁移 `020_admin_auth_email_lookup.sql` 的 `admin_find_auth_user_ids_by_email`：security definer、空 search_path、只授权 `service_role`，按 Auth 邮箱精确返回最多 20 个用户 ID；DTO 的 email 也一律取自 Auth。这一点替代了上文“邮箱从 `profiles.email` 精确解析”的原设计（2026-10-09 负责人确认）。远程部署后由 `supabase/checks/022_admin_auth_email_lookup_verify.sql` 验证。
- `home_space_audit_events.event_type` 没有数据库约束，未知值统一投影为 `other`；metadata 只保留 `snapshotSource` 和 `snapshotSaved`。

### Operation 与角色矩阵

| Operation | owner | admin | support | 数据边界 |
|---|---:|---:|---:|---|
| `get-admin-context` | 允许 | 允许 | 允许 | 只返回当前管理员 role；无目标用户数据，使用系统审计理由 |
| `resolve-user` | 允许 | 允许 | 允许 | 仅精确 UUID、精确邮箱或空间 UUID；最多 20 条 |
| `list-home-spaces` | 允许 | 允许 | 允许 | 空间元数据，不返回 credential 或 document |
| `list-snapshots` | 允许 | 允许 | 允许 | 只返回账号托管快照摘要，不返回 `document_json` |
| `preview-snapshot` | 允许 | 允许 | 拒绝 | 服务端投影后的单个账号托管快照预览 DTO；必须独立理由和审计 |
| `list-home-audit-events` | 允许 | 允许 | 允许 | 字段白名单，不返回敏感 metadata 原文 |
| `list-admin-audit-events` | 允许 | 允许 | 拒绝 | 管理员审计 DTO，不返回用户内容 |

### 查询规则

- 用户搜索只允许精确匹配：规范 UUID、trim/lowercase 后完整邮箱、或完整 home space UUID。禁止空条件、前缀、模糊、全文和“列出全部用户”。
- 邮箱从 `profiles.email` 精确解析；不得把 Supabase Admin API 的全量 `listUsers` 当作搜索实现。
- 空间 DTO 只包含 `id`、`userId`、`name`、`accessMode`、`syncSpaceId`、`isDefault`、`createdAt`、`updatedAt`、`lastUsedAt`。
- 快照列表先验证空间属于目标用户且 `access_mode = 'account-managed'`，只返回 id、revision、source、summary、fingerprint 的安全缩略值和 createdAt。
- 快照正文只能按已验证的 snapshot UUID 单条读取，且再次校验 snapshot、home space 和 target user 的关联；不得只依赖客户端上一步列表结果。Edge Function 必须在服务端把 `document_json` 投影为 `AdminSnapshotPreviewDocument`，浏览器不得收到原始 `HomeDocumentV2`、未列入 DTO 的内部字段或 raw JSON。
- 用户侧云端审计 DTO 使用 event type、severity、revision、关联 snapshot UUID、低敏感 summary 和时间；原始 metadata 必须经过服务端白名单投影。
- 管理员审计按管理员、目标用户、目标空间、action 和时间范围过滤；不得提供删除、修改或 CSV/JSON 导出。

## 1.18.4：独立 Admin Pages 基座

状态：待实施。

### 文件范围

- 本公开仓库不得新增 `app/admin/`、后台组件、后台样式或后台构建产物；新增 `scripts/verify-admin-isolation.mjs` 和 `verify:admin-isolation`，持续断言主站根路径、GitHub Pages base-path 构建、导航、sitemap 和静态输出都不包含后台页面或入口。
- 在负责人确认的私有 Admin 仓库中初始化独立 Next.js static export；最低文件范围为 `app/layout.tsx`、`app/page.tsx`、`app/globals.css`、`src/domain/admin-dashboard.ts`、`src/infrastructure/admin-dashboard-repository.ts`、`src/infrastructure/supabase-browser.ts`、`src/components/admin-dashboard.tsx`、`public/robots.txt`、`public/_headers` 和 Admin Pages 专项校验脚本。
- 私有 Admin 仓库的 `src/domain/admin-dashboard.ts` 只放浏览器安全 DTO、严格 parser、role/operation 类型、API version 和大小限制；不得导入本公开仓库的服务端模块，也不得通过 git submodule、本地路径依赖或公开 npm package 暴露 Admin UI 源码。
- `admin-dashboard-repository.ts` 只调用 `admin-read` Edge Function，不直接 `.from(...)` 查询管理表或其他用户表；响应必须先验证 API version、envelope 和 DTO，再交给组件。
- Admin Pages 不复用主站 analytics、client error monitoring、本地审计或持久化模块；需要的登录和 UI 能力在私有仓库内以最小实现提供，不复制主站编辑、同步、恢复或公开分享业务。
- Admin Pages 默认关闭生产浏览器 source map，所有路径输出 `Cache-Control: no-store, private`、`X-Robots-Tag: noindex, nofollow, noarchive`、`Referrer-Policy: no-referrer` 和禁止 framing 的安全头；CSP 只允许本身、所需 Supabase Auth/Function 连接和必要内联样式。

### 登录边界

- Cloudflare Access 在 HTML/JS/CSS 返回前完成第一层身份校验；Access 拒绝时 Admin React 应用不会启动，也不依赖客户端代码渲染“无权限”。
- 通过 Access 后仍必须建立独立的 Supabase 登录态。Admin Pages 使用现有 Supabase Auth 用户，只允许 `signInWithOtp` 登录既有账号并设置 `shouldCreateUser: false`，不得通过后台入口自动创建用户。
- Supabase Auth Redirect URLs 必须增加 `https://admin.mylinker.net/`、明确用于验收的单个 preview callback 和本地 `http://localhost:3000/`；不得加入任意 `*.pages.dev` 通配。
- Access 身份和 Supabase 用户不要求前端自行比对邮箱；能否读取管理数据只由 Edge Function 根据 Supabase JWT 和 `admin_users` 决定。

### 页面状态

- `signed-out`：复用现有 Supabase Magic Link 登录，不另建管理员密码体系。
- `checking-access`：调用 `get-admin-context`，只显示固定加载状态；不得直接查询 `admin_users` 或预判管理员身份。
- `denied`：非管理员、disabled 或 support 越权统一显示无权限，不透露管理员名单。
- `ready`：展示当前服务端确认的角色和只读说明。
- `error`：使用安全错误码文案，不展示 raw error、请求 body 或用户内容。

### 交互约束

- 搜索、理由、目标 UUID 和 API 结果只保存在当前组件内存；退出登录、离开 Admin Pages 或切换目标时立即清除。
- 搜索条件不写 URL query/hash，不恢复上次搜索，不进入浏览器标题、剪贴板快捷操作、analytics、error monitoring 或 local audit。
- 每次请求前要求输入本次理由；预览快照时必须再次确认，不能沿用搜索请求的理由静默打开。
- 页面只提供只读查看和分页，不显示“恢复、删除、编辑、导出、复制 JSON、复制全部”按钮。
- 所有现有支持语言都有完整 key；320px、390px、768px 和桌面布局均无横向溢出。

## 1.18.5：受控快照预览

状态：待实施。

### 预览模型

- 保持 Phase 1.17 的 `PublicHomeDocumentV1` 和 `ReadOnlyHomeRenderer` 公开合约不变，不向公开分享模型加入组件、图片或账号托管字段。
- 新增独立 `AdminSnapshotPreviewDocument` 服务端投影和浏览器 parser。Edge Function 从单个 `HomeDocumentV2` 生成字段白名单 DTO，私有 Admin Pages 只解析该 DTO；未知版本、非法结构和超过上限的正文直接拒绝，原始 `document_json` 不返回浏览器。
- 预览展示页面标题、主题 preset/accent、分组、网站、组件、布局和组件用户内容；`syncMeta`、billing、credential、账号资料和内部恢复字段不进入预览 DTO。
- 站点 URL 可作为不可点击文本显示；不得触发外链导航、favicon 网络请求或第三方预取。
- Banner/背景只展示配置状态、source 和安全文件类型摘要，不显示完整外部 URL、Storage path，不请求图片，也不创建 signed URL。
- 预览组件在私有 Admin 仓库中实现，不从公开主站构建产物加载运行时代码；可以按已固定的安全字段重做只读展示，但不得复制或挂载编辑、拖拽、计时写回、设置弹窗、同步、恢复、本地存储或观测副作用。

### 1.18.3 遗留（2026-10-09 已由 migration 023 处理）

- 问题：`home_space_snapshots.content_fingerprint`、`summary`、`home_space_audit_events.metadata`/`summary_*`/`event_type` 和 `profiles.display_name` 都没有长度上限，且用户本人可以直接写入。admin-read 原来取回原始列，再在 Edge Function 里投影，所以用户可以让后台查看自己数据时失败。
- 处理：`023_admin_read_bounded_projections.sql` 新增 4 个只授权 `service_role` 的函数，投影改在数据库里做：
  - 指纹只返回 SHA-256 前 12 位。
  - summary 只保留 6 个字段。
  - metadata 只保留 3 个短字段。
  - 超长的 event_type 变为 `other`。
  - display_name 截断到 80 字符。
- 同时发现：本地新建的 Supabase 不再默认给 `service_role` 授予 public 表的读权限。所以读取函数改为 security definer，`home_spaces` 只对 `service_role` 授权后台需要的元数据列。线上部署后由 `supabase/checks/025_admin_read_bounded_projections_verify.sql` 验证，它也是部署 `admin-read` 前的预检之一。

### 安全行为

- `support` 在前端不显示预览入口，Edge Function 仍必须独立拒绝伪造的 `preview-snapshot` 请求。
- owner/admin 每次预览单个快照都重新提交理由；审计事件 `admin.snapshot.preview` 成功写入后才返回正文。
- 正文只存在当前页面内存；关闭预览、切换空间、退出登录或组件卸载时清除引用。
- 渲染错误 boundary 不上报 document、组件内容或 URL；只显示固定不可用状态。

## 1.18.6：回归、部署与运行观察

状态：待实施。

### 自动校验

- 本公开仓库新增 `npm run verify:admin-isolation`，检查不存在 `app/admin/`、`/admin/index.html`、后台导航/sitemap、Admin UI 组件或样式、Admin Pages 构建产物和 private repository token；Edge Function 与 migration 不计入页面代码。
- 本公开仓库扩展 `verify:privacy`，禁止 admin 搜索词、访问理由、邮箱、snapshot document、JWT 和 service role 进入观测 metadata 或持久化路径；运行 typecheck、lint、`verify:privacy`、`verify:admin-isolation`、Edge Function 测试和两套主站静态构建。
- 主站根路径与 `NEXT_PUBLIC_BASE_PATH=/PersonalHomepge` 构建必须继续通过；`verify:export` 改为断言两套输出均没有 `/admin/index.html`，主站及 GitHub Pages legacy 不产生后台资源。
- 私有 Admin 仓库新增 `verify:admin-pages`，检查前端只调用 Edge Function、没有 service-role 标识、没有管理表 direct query、没有用户数据 mutation、没有 analytics/error/local-audit/persistent storage、没有 source map，并验证 robots、`_headers`、CSP、API version 和生产 static export。
- 私有 Admin 仓库独立运行 typecheck、lint、unit test、build 和 `verify:admin-pages`；Admin Pages 构建不得依赖本公开仓库的 `out/`、GitHub Pages base path 或主站部署 artifact。

### 数据库与 API 回归

- 执行 `019_admin_readonly_foundation.sql` 后完整运行 `021_admin_readonly_foundation_verify.sql`。
- 准备 A=owner/admin、B=support、C=普通账号以及至少一个 account-managed、一个 sync-code 测试空间。
- 验证过期/伪造 JWT、disabled admin、普通账号、未知 origin、未知 operation、非法 UUID、过大 body 和越权 role 均被拒绝。
- 验证 support 无法获取 `document_json` 或管理员审计；owner/admin 可按单个快照预览且逐次生成审计。
- 验证 sync-code 空间不会返回密文、凭证或明文预览；account-managed 只返回已有快照，不读取当前 `sync_spaces`。
- 验证任一 operation 审计插入失败时响应 fail closed；每个服务端 request ID 恰好对应一条成功查询审计。
- 检查 Edge logs、浏览器 Network/console/storage、产品 analytics、client error events 和本地审计，确认没有 JWT、service role、邮箱搜索词、理由、首页内容、URL 或 snapshot JSON 泄露。
- 直接调用 Edge Function 时，缺失/伪造/过期 JWT 返回 `401`，普通 Supabase 用户、disabled 管理员和越权角色返回 `403`；结果不能因请求来自 Admin Pages origin 而放宽。

### Access 与页面隔离回归

- 未登录 Access 的无痕浏览器和无 Access cookie 的 HTTP 请求分别访问 `admin.mylinker.net`、生产 `<admin-project>.pages.dev`、一个 branch alias 和一个 hash preview；只能得到 Access challenge/拒绝，不得返回 Admin HTML 标记，也不得直接取得 JS/CSS asset。
- 通过 Access 但未登录 Supabase 时只能看到登录状态；普通 Supabase 用户登录后得到统一无权限；只有 enabled 的 A 管理员同时通过两层门禁后进入 ready。
- 验证 `mylinker.net/admin/`、GitHub Pages legacy `/admin/`、主站导航和 sitemap 均不存在后台页面或入口，主站浏览器 Network 中不下载 Admin bundle。
- 检查生产与预览响应没有 source map，Admin HTML/JSON 使用 `no-store, private`，robots/noindex 生效；这些检查不能替代未授权请求的 Access 拒绝检查。
- Cloudflare Access policy 审核必须确认三个 hostname application 均为默认拒绝、只允许精确管理员身份/组，并启用已确认的 MFA 条件和会话时长；不得只凭能够看到 Access 登录页判定配置完成。

### 部署顺序

1. 备份并记录目标 Supabase 环境、当前 migration 状态和回滚窗口。
2. 执行 `019` migration 与 `021` verify；使用明确测试 Auth UUID 初始化测试管理员，不把 UUID 写入仓库。
3. 配置 Edge Function server-only secrets 和精确 `ADMIN_ALLOWED_ORIGINS`，保持 JWT verification 开启后部署 `admin-read`；先用 C 普通账号和 B support 验证拒绝边界，再用 A 验证允许路径。
4. 在私有仓库完成 Admin static export 并创建独立 Cloudflare Pages project；先添加并验证 `admin.mylinker.net`，不得把 Admin artifact 部署到主站 Pages project 或 GitHub Pages。
5. 为 `admin.mylinker.net` 创建独立 Access application；按 Pages Access known issues 的流程启用 preview access、确认或拆分生产 `<admin-project>.pages.dev` 的精确 application，并保留 `*.<admin-project>.pages.dev` 的 preview application。最终必须同时存在自定义域名、生产精确域名和预览通配域名三道默认拒绝门禁，并配置精确管理员 allow policy、IdP/MFA 和已确认的会话时长。
6. 将正式域名和本次验收使用的精确 preview origin/callback 分别加入 Edge CORS 与 Supabase Auth Redirect URLs；不得加入通配 Pages origin。
7. 先执行未授权的三类 hostname/asset 检查，再运行 Access + Supabase A/B/C、审计 fail-closed、隐私、主站隔离和双仓库构建检查。
8. 全部通过后再启用正式管理员账号；测试管理员和测试数据按运行手册处理，并保存不含人员身份明细的 Access application/policy ID 与验证记录。

### 安全回滚

- 首选立即将 `admin_users.enabled` 设为 false，并把三个 Access application 切换为不允许任何用户的 fail-closed policy；保留 `admin_audit_events` 供调查。
- 如服务端行为异常，回滚/停用 `admin-read` Edge Function，并将 Admin Pages 回滚到已验证的安全版本或无内容维护版本；不得删除 Access application 后留下公开 Pages 内容。
- 不使用 `drop table`、不清空审计、不修改用户表 RLS、不回滚 Phase 1.11 或 Phase 1.17 数据。
- 修复后必须重新运行 `021`、A/B/C API、三类 Access hostname、主站隔离和隐私检查，再逐个恢复管理员 `enabled` 与 Access allow policy。

## 实施前所需外部输入

开始 1.18.1 编码不需要真实管理员资料；部署与真实验收前必须由项目负责人提供或确认：

- 首个 `owner` 的 Supabase Auth user UUID；不得在计划、提交、聊天摘要或公开日志中保存邮箱和 UUID 对照。
- 用于 A/B/C 验收的测试账号与测试空间，且不得使用真实用户内容作为预览样本。
- 私有 Admin GitHub 仓库、独立 Cloudflare Pages project、生产 `<admin-project>.pages.dev` hostname 和 `admin.mylinker.net` DNS/域名控制权；私有仓库名和连接凭据不得写入本公开计划。
- Cloudflare Access 使用的 IdP、精确管理员身份或管理员组、MFA 条件和不超过 8 小时的会话时长；公开仓库只记录配置原则和无身份明细的 policy ID。
- 本次允许调用 admin Edge Function 的精确 Admin Pages preview origin；默认不允许任何 preview，不开放通配 `*.pages.dev`。
- Supabase Auth 增加 `admin.mylinker.net` 和选定 preview callback 的变更窗口。
- 管理员审计的实际运维访问人和回滚窗口。

若这些输入尚未确认，可以完成本地代码和事务测试，但不得初始化生产管理员或开放线上管理入口。
