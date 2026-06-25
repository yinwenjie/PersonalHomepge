# 后台管理 Dashboard Backlog

## 状态

- 当前状态：候选大需求，延期到 Phase 1.14。
- 延期原因：后台管理 dashboard 需要受控服务端入口、管理员身份、管理员审计、service role 隔离和独立部署策略，复杂度明显高于 Phase 1.11 用户侧数据保全功能。
- 触发条件：商业化正式域名上线后，再进入实现评估。
- 当前阶段：只保存设计方案，不进入近期实现。

## 背景

Phase 1.11.5 已为账号托管空间建立云端历史版本，Phase 1.11.6 已明确账号托管空间是“账号可信托管、可恢复、可审计”模型。后台管理 dashboard 的目标是在受控、留痕、最小权限的前提下，让管理员能够帮助用户排障、审计和恢复非离线加密数据。

这个能力不能直接放进 GitHub Pages 前端，也不能把 Supabase service role、管理员密钥或跨用户查询能力暴露给普通浏览器代码。

## 产品目标

- 查看账号托管用户和首页空间的基本信息。
- 查看账号托管空间云端历史版本和审计事件。
- 对账号托管云端历史生成完整只读预览。
- 查看普通同步码空间的元数据和风险事件，但不默认查看明文内容。
- 记录管理员自己的访问、预览、导出和恢复辅助行为。

## v1 范围

Phase 1.14 v1 建议只做只读后台：

- 用户搜索：按邮箱、用户 id、空间 id 查询。
- 空间列表：展示 `home_spaces`、access mode、sync space id、创建时间、更新时间。
- 账号托管云端历史：读取 `home_space_snapshots`。
- 快照预览：读取 `document_json`，完整展示分组、网站、组件、主题和图片状态。
- 云端操作记录：读取 `home_space_audit_events`。
- 管理员审计：写入并展示 `admin_audit_events`。

v1 不做：

- 不直接修改用户首页。
- 不替用户执行恢复到云端。
- 不删除首页空间。
- 不废弃同步码。
- 不导出完整用户数据包。
- 不绕过普通同步码空间的密文边界。

## 推荐架构

优先方案：Supabase Edge Functions + Admin Web UI。

- Admin UI 可独立部署，也可在正式域名下提供受保护路由。
- Admin UI 只持有公开 anon key 和当前管理员 session。
- 所有跨用户数据读取都通过 Edge Function。
- Edge Function 使用 service role，但 service role 只存在服务端环境变量中。
- Edge Function 每次执行前检查当前用户是否在 `admin_users` 且启用。
- 每次读取敏感数据前或后写入 `admin_audit_events`。

备选方案：独立后台服务。

- 使用 Vercel、Cloudflare 或其他后端服务承载 admin API。
- 安全边界更清楚，部署和运维成本更高。

不推荐方案：

- GitHub Pages 前端直接访问跨用户数据。
- 在前端环境变量、构建产物或公开仓库中保存 service role。
- 用普通用户 RLS policy 扩展出管理员跨用户读取能力。

## 建议数据模型

### `admin_users`

用途：定义管理员身份。

建议字段：

```text
id
user_id
role
enabled
created_at
created_by
updated_at
```

建议角色：

- `owner`：最高权限，可管理管理员名单。
- `admin`：可查看用户、空间、云端历史和审计。
- `support`：只读排障，权限更窄。

### `admin_audit_events`

用途：记录管理员行为。

建议字段：

```text
id
admin_user_id
admin_auth_user_id
target_user_id
target_home_space_id
target_sync_space_id
target_snapshot_id
action
severity
reason
metadata
created_at
```

建议事件：

- `admin.user_search`
- `admin.user_view`
- `admin.home_space_view`
- `admin.snapshot_list`
- `admin.snapshot_preview`
- `admin.audit_event_view`
- `admin.export_requested`
- `admin.restore_assistance_requested`

## 权限原则

- 管理员入口必须要求 Supabase 登录态。
- 管理员身份由 `admin_users` 控制，不依赖前端隐藏路由。
- 普通用户界面不暴露管理员入口。
- 所有读取账号托管明文历史的动作必须留痕。
- 普通同步码空间默认只展示元数据，不展示明文。
- 管理员导出、复制、恢复辅助属于高风险操作，需要更高 severity 和二次确认。

## 需要额外确认的信息

- 后台部署位置：Supabase Edge Functions、独立后台服务，还是正式域名下的 admin app。
- 初始管理员名单：至少需要一个 Supabase user id 或邮箱。
- v1 是否严格只读：建议是。
- 是否允许查看账号托管“当前内容”：v1 建议先用最新云端快照表示，不做服务端解密当前 `sync_spaces`。
- 是否允许导出：v1 建议不允许完整导出，只允许人工复制有限字段并写审计。
- 审计保留策略：v1 建议永久保留，后续再设计归档。

## 依赖

- 正式域名和 Auth redirect 稳定。
- 服务端或 Edge Function 部署通道稳定。
- Supabase secrets 管理明确，service role 不进入静态前端。
- Phase 1.11.5 云端历史表和审计表已经在线。
- Phase 1.11.6 账号托管/普通同步码/高隐私模式边界已经文档化。

## 风险

- service role 泄露风险高于普通前端功能。
- 管理员查看用户内容如果没有审计，会破坏用户信任。
- 如果后台误读普通同步码空间，会破坏密文边界。
- 如果 v1 同时加入写操作，可能引入新的 P0 数据事故入口。
- 后台 dashboard 一旦上线，权限、日志和访问理由都要长期维护。

## 验收标准

- 普通前端构建产物中没有 service role 或管理员密钥。
- 非管理员无法调用任何 admin API。
- 管理员每次查看用户首页内容或云端历史都会写入 `admin_audit_events`。
- 普通同步码空间不会显示明文首页内容。
- 账号托管云端历史可完整预览，但 v1 不提供直接修改用户数据的操作。
- 管理员审计事件可按管理员、目标用户、目标空间和时间查询。
