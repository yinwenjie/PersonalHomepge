# 错误监控数据使用指南

## Summary

Phase 1.11.9 的错误监控用于定位前端稳定性问题，不用于查看用户首页内容。v1 数据写入 Supabase `client_error_events`，只能通过受控 RPC `record_client_error_event(...)` 上报；普通前端角色没有直接读取表的权限。

## 数据边界

可以分析：

- React 渲染错误、Next 路由错误、全局运行时异常。
- 未处理 Promise rejection。
- script/style/image 等资源加载失败的类型和同源/跨源粗粒度来源。
- 同步、账号、数据恢复、数据包、图片上传、书签导入草稿保存等关键异步失败。
- 错误 fingerprint、发生页面、release/app version、匿名浏览器诊断 ID、会话 ID、用户登录状态。

不能分析：

- 网站 URL、网站名称、分组名称、搜索词、Todo 内容、组件具体配置。
- Banner/背景图片 URL 或 Storage path。
- 完整首页文档、云端历史 `document_json`、同步码、access token、encryption key、账号托管恢复凭证。
- 邮箱、Supabase user id、Supabase session、refresh token。
- localStorage dump、完整请求体、完整错误对象。

## 表字段

`client_error_events` 的核心字段：

- `event_type`：`react_render_error`、`window_error`、`unhandled_rejection`、`resource_load_failed`、`async_operation_failed`。
- `severity`：`info`、`warning`、`error`、`fatal`。
- `fingerprint`：由脱敏后的错误类型、操作、消息和栈顶信息生成，用于聚合。
- `anonymous_id`：当前浏览器本机匿名诊断 ID，不等同账号 ID。
- `session_id`：当前页面会话 ID，用于粗略分组。
- `user_state`：`anonymous` 或 `signed-in`，不保存具体用户 ID。
- `page_path`：不含 query/hash 的页面路径。
- `operation`：如 `sync.pull`、`snapshot.cloud_restore`、`storage.asset_upload`。
- `message_sanitized` / `stack_sanitized` / `component_stack_sanitized`：脱敏并截断后的错误信息。
- `properties`：白名单脱敏属性。
- `client_created_at` / `created_at`：客户端时间和数据库写入时间。

## 常用查询

按天统计错误量：

```sql
select
  date_trunc('day', created_at) as day,
  severity,
  count(*) as error_count,
  count(distinct anonymous_id) as affected_installs
from public.client_error_events
where created_at >= now() - interval '14 days'
group by 1, 2
order by 1 desc, 2;
```

Top 错误 fingerprint：

```sql
select
  fingerprint,
  event_type,
  operation,
  max(message_sanitized) as sample_message,
  count(*) as occurrences,
  count(distinct anonymous_id) as affected_installs,
  max(created_at) as last_seen
from public.client_error_events
where created_at >= now() - interval '14 days'
group by 1, 2, 3
order by affected_installs desc, occurrences desc
limit 20;
```

关键操作失败分布：

```sql
select
  operation,
  severity,
  count(*) as occurrences,
  count(distinct anonymous_id) as affected_installs
from public.client_error_events
where event_type = 'async_operation_failed'
  and created_at >= now() - interval '14 days'
group by 1, 2
order by affected_installs desc, occurrences desc;
```

资源加载失败：

```sql
select
  properties ->> 'resourceKind' as resource_kind,
  properties ->> 'resourceOriginKind' as origin_kind,
  count(*) as occurrences,
  count(distinct anonymous_id) as affected_installs
from public.client_error_events
where event_type = 'resource_load_failed'
  and created_at >= now() - interval '14 days'
group by 1, 2
order by occurrences desc;
```

按版本对比：

```sql
select
  coalesce(app_version, 'unknown') as app_version,
  severity,
  count(*) as error_count,
  count(distinct fingerprint) as unique_errors,
  count(distinct anonymous_id) as affected_installs
from public.client_error_events
where created_at >= now() - interval '30 days'
group by 1, 2
order by error_count desc;
```

## 解读规则

- 错误事件数不是用户数；同一浏览器可多次触发同一 fingerprint。
- `anonymous_id` 是当前浏览器本机诊断标识，清空浏览器数据、换设备、隐私模式都会变化。
- `user_state = signed-in` 只代表上报时有登录 session，不代表可以识别具体账号。
- `fingerprint` 是客户端脱敏聚合键，不保证等同于精确源码位置。
- 未公开 sourcemap 时，stack 只能辅助判断大致来源；正式定位仍以复现、release diff 和本地日志为准。

## 排障用法

当用户反馈问题时，可以用时间窗口、页面和操作名确认是否发生过相关错误：

```sql
select
  created_at,
  event_type,
  severity,
  operation,
  fingerprint,
  page_path,
  message_sanitized,
  properties
from public.client_error_events
where created_at between timestamptz '2026-06-26 00:00:00+00'
  and timestamptz '2026-06-27 00:00:00+00'
  and operation in (
    'sync.pull',
    'sync.push',
    'snapshot.cloud_restore',
    'data_package.restore_preview',
    'storage.asset_upload'
  )
order by created_at desc
limit 200;
```

注意：错误监控只能证明“某类异常发生过、影响范围多大、集中在哪些流程”，不能替代数据恢复中心、本地审计日志、云端审计或用户复现步骤。

## 保留策略

v1 建议保留 90-180 天。Supabase 迁移提供 `delete_client_error_events_older_than(p_retention_days)` 维护函数，但没有授予前端角色执行权限。需要清理时由项目管理员在 SQL Editor 中执行：

```sql
select public.delete_client_error_events_older_than(180);
```

## 上线检查

- 已执行 `supabase/migrations/015_client_error_events.sql`。
- 已执行 `supabase/checks/017_client_error_events_verify.sql`，确认表权限、RPC 权限和隐私约束符合预期。
- 前端环境已设置 Supabase URL 和 anon key；未配置时错误监控静默降级，不影响产品使用。
- 设置页“产品改进”里可关闭“匿名错误诊断”。
- 开发环境默认不向生产错误表发送数据；如需本地调试，临时设置 `NEXT_PUBLIC_ERROR_MONITORING_DEBUG=true`。
- 生产部署不公开 sourcemap；GitHub Pages 静态部署下尤其要确认 `.map` 文件没有随站点公开。
