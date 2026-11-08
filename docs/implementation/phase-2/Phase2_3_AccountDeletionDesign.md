# Phase 2.3 账号删除设计

状态：设计已确认（2026-11-08，第 10 节）。本文只定方案，不包含运行时代码、migration 或部署。

## 背景

`phase-1/Phase1_10_Implement.md` 的 1.10.5 只列了账号删除要回答的问题，没有定方案；`planning/Phase1Plan.md` 要求它“基于数据生命周期重新设计”。收费之前必须先有账号删除：用户付费后提出删除，我们要能说清删了什么、留了什么、为什么留。

现在没有任何删除账号的入口、RPC 或 Edge Function。用户只能“从账号移除空间”（`remove_home_space_from_account`，009），它只删账号索引，不动底层数据。

## 结论摘要

| 问题 | 决定 |
|---|---|
| 入口 | 设置页 → 账号 → 删除账号。只对已登录用户显示 |
| 确认 | 先发一封新的登录邮件重新验证身份，回来后再输入自己的邮箱确认；15 分钟内有效 |
| 冷静期 | 不设，确认后立即删除（已确认） |
| 谁来删 | 新 Edge Function `account-delete`，用户自己的 JWT 调用，服务端用 service role 执行 |
| 账号托管空间 | 删除云端历史、分享和底层加密数据（没有其他账号引用时） |
| 普通同步码空间 | 只从账号解绑，底层数据保留，持有同步码的设备照常同步 |
| 图片 | 删除 Storage 里 `{userId}/` 下的全部 Banner 和背景 |
| Auth 用户 | 最后删除，级联清掉剩余的账号数据 |
| 管理员 | 在 `admin_users` 里有记录的账号不能自助删除 |
| 管理员审计 | 保留（1.18 已定为永久保留，只含 UUID，不含邮箱和内容） |
| 删除记录 | 新表 `account_deletions` 只存 user id 的哈希、时间和数量，不存邮箱 |
| 本机数据 | 退出登录并清掉账号相关的本机数据；本机首页默认保留，可勾选一起清除 |

## 1. 账号数据在哪里

下表是删除时要处理的全部位置。FK 行为来自 migration 原文。

| 位置 | 和账号的关系 | 删除 Auth 用户时 | 本设计的处理 |
|---|---|---|---|
| `profiles` | `id` → `auth.users`，cascade（004） | 自动删除 | 随 Auth 用户删除 |
| `account_preferences` | cascade（004） | 自动删除 | 随 Auth 用户删除 |
| `home_spaces` | cascade（004）；`sync_space_id` 是 restrict | 自动删除 | 在 RPC 里先删，以便处理底层空间 |
| `home_space_credentials` | 经 `home_spaces` cascade（006），存明文 token 和密钥 | 自动删除 | 随 `home_spaces` 删除 |
| `home_space_snapshots` | cascade（013），存明文 `document_json`，`sync_space_id` 是 restrict | 自动删除 | 随 `home_spaces` 删除 |
| `home_space_audit_events` | cascade（013） | 自动删除 | 随 Auth 用户删除 |
| `public_home_shares` | cascade（017） | 自动删除，链接失效 | 随 `home_spaces` 删除 |
| `sync_spaces` | **没有用户字段**（001） | **不会删除** | 见第 3 节 |
| Storage `home-assets` | 路径第一级是 user id（012） | **不会删除** | 第 4 节逐个删除 |
| `admin_users` | cascade（019） | 自动删除 | 有记录时拒绝删除，见第 5 节 |
| `admin_audit_events` | 只存 UUID，故意没有 FK（019） | 不受影响 | 保留 |
| `product_analytics_events`、`client_error_events` | 只有匿名 id，没有 user id、邮箱、IP（014、015） | 不受影响 | 无法也无需按账号删除，按 180 天保留期清理 |
| `rss_feed_cache`、`rss_rate_limits` | 与账号无关（022） | 不受影响 | 不处理 |
| `auth.audit_log_entries` | Supabase Auth 自带，可能含邮箱 | 不会删除 | 2026-11-08 线上为 0 行，项目没有写这张表，不处理（见第 10 节） |
| Resend 邮件日志 | 发信记录含邮箱 | 不受影响 | 按 Resend 的保留期自动过期，文档里写明 |
| 浏览器本机 | 见第 7 节 | 不受影响 | 删除成功后由页面清理 |

## 2. 用户流程

1. 设置页“账号”区块最下方是“删除账号”，点开后先说明会删什么、留什么（下面三条），并提供两个按钮：“先导出数据”和“继续”。
   - 会删除：账号、偏好、账号托管空间的云端历史和分享链接、上传的图片。
   - 不会删除：普通同步码空间（持有同步码的设备还能用）、本机首页（可选清除）。
   - 不可恢复。
2. “先导出数据”调用现有的数据导出，并提示它不含云端历史；如需保留某个账号托管空间的内容，先在首页导出首页 JSON。
3. “继续”会给当前邮箱发一封新的登录邮件，链接带 `intent=delete-account`。用户点开后回到设置页，删除对话框自动打开。
4. 对话框里列出将受影响的空间（名称和类型）和图片数量，用户输入自己的邮箱，可勾选“同时清除本机首页数据”，然后点“永久删除”。
5. 成功后显示“账号已删除”，页面回到未登录状态。失败时显示错误码，可以重试；重试是安全的（见第 6 节）。

身份验证用 JWT 里的 `amr` 时间戳：最近一次邮件登录必须在 15 分钟内，否则服务端返回 `reauth_required`。这样即使有人拿到一个长期有效的 session，也删不了账号。

## 3. 底层同步空间怎么处理

`sync_spaces` 没有用户字段，一个同步空间可能被多个账号认领（`home_spaces` 只要求 `(user_id, sync_space_id)` 唯一），普通同步码空间也可能被没登录的设备直接使用。所以不能“删账号就删同步空间”。

| 空间类型 | 判断 | 处理 |
|---|---|---|
| 账号托管，且没有其他账号的 `home_spaces` 引用同一个 `sync_space_id` | 服务端有该空间的凭证 | 删除快照、分享、`home_spaces`，然后删除 `sync_spaces` 行（密文一起删除） |
| 账号托管，但其他账号也引用了它 | 同上 | 只删本账号的行，底层空间保留，在删除记录里计数 |
| 普通同步码空间 | 服务端没有 token，也无法判断还有哪些设备在用 | 只删本账号的 `home_spaces`，底层空间保留 |

账号托管迁移时旧同步码没有作废（008），所以删掉底层空间后，还拿着旧同步码的设备会同步失败、本机数据不受影响。这是用户选择删除的预期结果，对话框里会提示。

普通同步码空间如果用户也想作废，可以在删除前用现有的同步码面板作废（`revoke_sync_space`）。v1 不在删除流程里替用户作废，因为服务端没有这些空间的 token。

## 4. 服务端执行顺序

新 Edge Function `account-delete`，POST-only，开启 JWT 校验，CORS 只放行主站域名。复用 `admin-read` 的请求校验和稳定错误码写法。

1. **校验**：JWT 有效；`amr` 邮件登录时间在 15 分钟内；请求体里的邮箱与 JWT 邮箱一致（不区分大小写）。不满足时分别返回 `reauth_required`、`confirmation_mismatch`。
2. **拒绝管理员**：`admin_users` 里有该用户的任何记录时返回 `admin_account`。管理员要先按 `AdminDashboardRunbook.md` 停用并移除，再删账号，避免误删唯一的 owner。
3. **付费检查**：有付费权益后，先取消订阅，取消失败就停下（见 `Phase2_4_EntitlementDesign.md` 第 7 节）。在没有付费功能前这一步跳过。
4. **写删除记录**：在 `account_deletions` 里按 user id 哈希插入或取回一行，状态 `started`。
5. **删图片**：用 service role 列出 `home-assets` 里 `{userId}/banner/` 和 `{userId}/background/`，分批删除，记下数量。
6. **删应用数据**：调用 service role 专用 RPC `delete_account_app_data(p_user_id)`，在一个事务里按第 3 节处理每个空间，删掉 `home_spaces`（级联凭证、快照、分享），再删可删的 `sync_spaces`。返回各项数量。
7. **删 Auth 用户**：`auth.admin.deleteUser(userId)`，级联删掉 `profiles`、`account_preferences`、用户侧审计等剩余行。
8. **完成**：删除记录改为 `completed`，写入数量；返回 `{ status: "deleted", counts }`。

任何一步失败都把错误码写进删除记录并返回 `service_unavailable`。每一步都可以重复执行：已删的图片列不出来，已删的行删不到，Auth 用户不存在时第 7 步视为成功。所以用户直接重试即可，不需要人工介入。

函数日志只记 request id、步骤和数量，不记邮箱、空间名称或内容。

## 5. 管理员和审计

- 管理员账号自助删除被拒绝，原因见第 4 节第 2 步。
- `admin_audit_events` 保留。1.18 已定为永久保留，且故意不用会级联删除的外键（`Phase1_18_Implement.md`）。这些行只有 UUID、动作和数量，账号删除后它们指向一个已不存在的 UUID，无法再关联到邮箱。
- 后台查这个 UUID 会得到“未找到”。v1 不在后台显示“已删除”，需要时管理员可以用 UUID 的哈希去查 `account_deletions`。

## 6. 新表 `account_deletions`（migration 026）

| 列 | 说明 |
|---|---|
| `id` | uuid 主键 |
| `user_id_hash` | `sha256(user_id)` 十六进制，唯一 |
| `status` | `started` / `completed` / `failed` |
| `requested_at`、`completed_at` | 时间 |
| `counts` | jsonb：空间数、删除的同步空间数、保留的同步空间数、快照数、分享数、图片数 |
| `error_code` | 最近一次失败的错误码 |

不存邮箱、空间名称和内容。只有 service role 能读写，前端没有任何权限。v1 永久保留，用来回答“这个账号是不是已经删了、什么时候删的”。

## 7. 浏览器本机清理

删除成功后，页面在当前浏览器里：

- 退出登录，删掉 Supabase session（`sb-<ref>-auth-token`）。
- 删掉 IndexedDB `homepage:theme-images:v1` 里该账号的图片缓存（现有 `clearAccount`）。
- 如果 `homepage:sync-code:v1` 绑定的是该账号的账号托管空间，删掉这个绑定（它含 token 和密钥）。
- 重置匿名埋点 id 和诊断 id（`homepage:analytics:v1`、`homepage:error-monitoring:v1`），之后的事件和删除前的事件不再有关联。
- 勾选了“同时清除本机首页数据”时，再删本机首页文档、本机快照、本机审计和重置备份（`homepage:document:v2`、`homepage:data:v1`、`homepage:reset-backup:v1`、`homepage:local-snapshots:v1`、`homepage:audit-log:v1`），然后回到默认首页。

其他设备上的本机数据我们碰不到。那些设备的 session 会在 Auth 用户删除后失效，下次请求会被退回未登录状态。

## 8. 埋点和错误监控

- 新增事件 `account_delete_started`、`account_delete_completed`、`account_delete_failed`（带错误码），不带任何账号信息。
- 错误监控只记错误码。

## 9. 上线步骤

1. migration 026（`account_deletions` + `delete_account_app_data`），本地 pgTAP 覆盖：只删本账号；被其他账号引用的空间保留；普通同步码空间保留；重复执行不出错；前端角色无权调用。
2. Edge Function `account-delete` 和 Deno 测试，覆盖第 4 节每个错误码。
3. 前端入口、重新验证流程和本机清理。
4. 按现有流程上线：migration 用 deploy-supabase 工作流，函数用 Edge Function 部署工作流（需加入白名单），前端走 production。每一步都要你确认。
5. 用一个专门的测试账号走一遍真实删除：有账号托管空间、普通同步码空间、分享链接、图片；删除后逐项核对第 1 节表格。

## 10. 决定记录

1. **冷静期**（2026-11-08 Gerald 确认）：不设，重新验证并输入邮箱后立即删除。
2. **`auth.audit_log_entries`**（2026-11-08 Gerald 在 SQL Editor 查询，结果 0 行）：项目没有写这张表，删除流程不处理它。如果以后在 Supabase 里打开了 Auth 审计日志的表存储，需要回来补上。
3. **本机首页默认保留**：沿用默认，删除账号后本机首页保留（本地优先），勾选才清除。
4. **完整导出**：沿用默认，v1 只提示用户先导出首页 JSON；导出全部云端历史以后另做。

## 11. 相关发现（本设计不处理）

- 认领空间时，`home_spaces` 的插入策略只检查 `user_id = auth.uid()`，不检查认领者是否知道同步码（006）。由于 `sync_space_id` 是随机 UUID、不公开，实际风险低；但一个账号可以凭 UUID 关联别人的空间，并因 restrict 外键阻止底层空间被删除。建议另开一项把认领改成必须提交 token 的 RPC。
- 埋点和错误事件的 180 天清理现在靠手动运行，建议改成定时执行。
