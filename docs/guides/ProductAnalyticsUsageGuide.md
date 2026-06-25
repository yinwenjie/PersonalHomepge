# 基础埋点数据使用指南

## Summary

Phase 1.11.8 的基础埋点用于回答产品漏斗和功能使用问题，不用于查看用户首页内容。v1 数据写入 Supabase `product_analytics_events`，只能通过受控 RPC `record_product_event(...)` 上报；普通前端角色没有直接读取表的权限。

## 数据边界

可以分析：

- 首次打开、设置页打开、搜索提交、模板应用。
- 收藏/链接导入的打开、解析、完成和失败。
- 同步码创建/绑定、同步冲突出现和解决方向。
- 账号托管空间创建、模板创建、恢复、迁移和移除。
- 数据恢复中心打开、历史版本预览和恢复。
- 数据包导出、恢复预览、恢复成功和恢复失败。
- 主题、Banner/背景和组件新增等配置动作。

不能分析：

- 网站 URL、网站名称、分组名称、搜索词、Todo 内容、组件具体配置。
- Banner/背景图片 URL 或 Storage path。
- 完整首页文档、云端历史 `document_json`、同步码、access token、encryption key、账号托管恢复凭证。
- 邮箱、Supabase user id、Supabase session、refresh token。

## 表字段

`product_analytics_events` 的核心字段：

- `event_name`：白名单事件名。
- `schema_version`：事件 schema 版本，v1 固定为 `1`。
- `anonymous_id`：当前浏览器本机匿名安装 ID，不等同账号 ID。
- `session_id`：当前页面会话 ID，用于粗略分组。
- `user_state`：`anonymous` 或 `signed-in`，不保存具体用户 ID。
- `page_path`：不含 query/hash 的页面路径。
- `referrer_origin`：仅来源 origin，不含完整来源 URL。
- `properties`：白名单脱敏属性。
- `client_created_at` / `created_at`：客户端时间和数据库写入时间。

## 常用查询

按天统计事件量：

```sql
select
  date_trunc('day', created_at) as day,
  event_name,
  count(*) as event_count
from public.product_analytics_events
where created_at >= now() - interval '30 days'
group by 1, 2
order by 1 desc, 3 desc;
```

估算每日活跃匿名安装：

```sql
select
  date_trunc('day', created_at) as day,
  count(distinct anonymous_id) as active_installs
from public.product_analytics_events
where created_at >= now() - interval '30 days'
group by 1
order by 1 desc;
```

新用户启动漏斗：

```sql
with first_seen as (
  select anonymous_id, min(created_at) as first_seen_at
  from public.product_analytics_events
  group by anonymous_id
),
events_7d as (
  select e.*
  from public.product_analytics_events e
  join first_seen f on f.anonymous_id = e.anonymous_id
  where e.created_at < f.first_seen_at + interval '7 days'
)
select
  count(distinct anonymous_id) filter (where event_name = 'home.viewed') as opened_home,
  count(distinct anonymous_id) filter (where event_name = 'template.applied') as applied_template,
  count(distinct anonymous_id) filter (where event_name in ('site.added', 'group.added', 'widget.added')) as edited_home,
  count(distinct anonymous_id) filter (where event_name in ('sync.code_created', 'sync.code_bound', 'home_space.account_managed_created')) as connected_sync
from events_7d;
```

导入成功率：

```sql
select
  properties ->> 'sourceKind' as source_kind,
  count(*) filter (where event_name = 'bookmark_import.parsed') as parsed,
  count(*) filter (where event_name = 'bookmark_import.completed') as completed,
  count(*) filter (where event_name = 'bookmark_import.failed') as failed
from public.product_analytics_events
where event_name like 'bookmark_import.%'
  and created_at >= now() - interval '30 days'
group by 1
order by 1;
```

导入失败原因：

```sql
select
  properties ->> 'sourceKind' as source_kind,
  properties ->> 'reasonCode' as reason_code,
  count(*) as failed_count
from public.product_analytics_events
where event_name = 'bookmark_import.failed'
  and created_at >= now() - interval '30 days'
group by 1, 2
order by failed_count desc;
```

数据恢复中心使用情况：

```sql
select
  event_name,
  properties ->> 'source' as snapshot_source,
  count(*) as event_count,
  count(distinct anonymous_id) as install_count
from public.product_analytics_events
where event_name in (
  'recovery.center_opened',
  'recovery.local_previewed',
  'recovery.local_restored',
  'recovery.cloud_previewed',
  'recovery.cloud_restored'
)
  and created_at >= now() - interval '30 days'
group by 1, 2
order by event_count desc;
```

同步冲突与解决方向：

```sql
select
  event_name,
  properties ->> 'source' as source,
  count(*) as event_count
from public.product_analytics_events
where event_name in (
  'sync.conflict_detected',
  'sync.resolved_cloud',
  'sync.resolved_local'
)
  and created_at >= now() - interval '30 days'
group by 1, 2
order by event_count desc;
```

模板使用分布：

```sql
select
  properties ->> 'templateId' as template_id,
  count(*) as applied_count,
  count(distinct anonymous_id) as install_count
from public.product_analytics_events
where event_name in ('template.applied', 'home_space.account_managed_template_created')
  and created_at >= now() - interval '30 days'
group by 1
order by applied_count desc;
```

## 解读规则

- 事件数不是用户数；同一浏览器可触发多次同类事件。
- `anonymous_id` 是当前浏览器本机标识，清空浏览器数据、换设备、隐私模式都会变化。
- `user_state = signed-in` 只代表上报时有登录 session，不代表可以识别具体账号。
- 小样本只用于发现方向，不能直接证明功能成败。
- 导入、恢复、同步类事件只记录数量级和结果，不记录具体内容；无法从埋点数据还原用户首页。

## 排障用法

当用户反馈问题时，可以用时间窗口和事件类型确认是否发生过关键流程：

```sql
select
  created_at,
  event_name,
  user_state,
  page_path,
  properties
from public.product_analytics_events
where created_at between timestamptz '2026-06-25 00:00:00+00'
  and timestamptz '2026-06-26 00:00:00+00'
  and event_name in (
    'bookmark_import.failed',
    'document.json_import_failed',
    'sync.conflict_detected',
    'recovery.local_restored',
    'recovery.cloud_restored'
  )
order by created_at desc
limit 200;
```

注意：埋点只能证明“发生了哪个流程、结果是什么、数量级大概是多少”，不能替代本地审计日志、数据恢复中心或 Supabase 账号托管审计。

## 保留策略

v1 建议保留 90-180 天。Supabase 迁移提供 `delete_product_analytics_events_older_than(p_retention_days)` 维护函数，但没有授予前端角色执行权限。需要清理时由项目管理员在 SQL Editor 中执行：

```sql
select public.delete_product_analytics_events_older_than(180);
```

## 上线检查

- 已执行 `supabase/migrations/014_product_analytics_events.sql`。
- 已执行 `supabase/checks/016_product_analytics_events_verify.sql`，确认表权限、RPC 权限和隐私约束符合预期。
- 前端环境已设置 Supabase URL 和 anon key；未配置时埋点静默降级，不影响产品使用。
- 设置页“产品改进”开关可关闭匿名基础埋点。
- 开发环境默认不向生产埋点表发送数据；如需本地调试，临时设置 `NEXT_PUBLIC_PRODUCT_ANALYTICS_DEBUG=true`。
