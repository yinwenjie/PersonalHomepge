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

“设为首页”引导漏斗（migration 021 之后才有数据）：

```sql
select
  properties ->> 'source' as source,
  properties ->> 'browserFamily' as browser_family,
  count(distinct anonymous_id) filter (where event_name = 'homepage_guide.opened') as opened_installs,
  count(distinct anonymous_id) filter (where event_name = 'homepage_guide.address_copied') as copied_installs
from public.product_analytics_events
where event_name in ('homepage_guide.opened', 'homepage_guide.address_copied')
  and created_at >= now() - interval '30 days'
group by 1, 2
order by opened_installs desc;
```

首页提示被关闭的次数看 `homepage_guide.tip_dismissed`。`address_copied` 只说明用户复制了网址，不代表已经设置成功；浏览器不会告诉网页它是不是首页。

## 北极星指标

短期北极星是“用户把 MyLinker 设为首页并留存 30 天”。下面的查询只用现有的 `home.viewed` 等事件，不需要新的埋点或权限，在 Supabase SQL Editor 里直接执行即可。

口径约定：

- **安装**：一个 `anonymous_id`，即一个浏览器里的一份本机数据，不等于一个人或一个账号。
- **新安装日**：这个安装第一次上报 `home.viewed` 的日期。表里最早的 30 天不算新安装：埋点上线前就在用的老用户，以及按保留策略清理掉早期事件的老用户，都会在那段时间里“第一次出现”。所以清理时请保留至少 120 天（建议 180 天），否则 D30 没有可算的新安装。这个排除只对每天都来的老用户完全有效：执行过清理之后，隔了 30 天以上才回来的老用户仍会被算成新安装。在还没执行过 `delete_product_analytics_events_older_than` 之前，口径是准确的；要在清理之后也准确，需要另存一份不随清理删除的“首次出现时间”。
- **活跃**：当天至少上报过一次 `home.viewed`。日期统一按 UTC 切分。
- **未满期的不计入**：例如新安装才 5 天，它的 D7 还没到，就不进 D7 的分母，避免把“还没发生”算成“没回来”。

### 1. 新安装留存（D1 / D7 / D30）

按新安装所在的周分组，看第 1、7、30 天当天是否回来打开首页。

```sql
with views as (
  select anonymous_id, (created_at at time zone 'UTC')::date as day
  from public.product_analytics_events
  where event_name = 'home.viewed'
  group by 1, 2
),
data_start as (
  select min(day) as first_day from views
),
cohorts as (
  select anonymous_id, min(day) as cohort_day
  from views
  group by 1
),
flags as (
  select
    c.anonymous_id,
    c.cohort_day,
    -- null = the day has not fully passed yet, so this install does not count either way
    case when c.cohort_day + 1 < current_date then bool_or(v.day = c.cohort_day + 1) end as d1,
    case when c.cohort_day + 7 < current_date then bool_or(v.day = c.cohort_day + 7) end as d7,
    case when c.cohort_day + 30 < current_date then bool_or(v.day = c.cohort_day + 30) end as d30
  from cohorts c
  cross join data_start d
  -- One join plus aggregation instead of a subquery per install, so cost stays linear.
  join views v on v.anonymous_id = c.anonymous_id
  -- Skip the first 30 retained days: anyone whose earlier views were deleted or predate
  -- analytics would otherwise look like a new install there.
  where c.cohort_day >= greatest(current_date - 90, d.first_day + 30)
  group by c.anonymous_id, c.cohort_day
)
select
  date_trunc('week', cohort_day)::date as cohort_week,
  count(*) as new_installs,
  round(100.0 * count(*) filter (where d1) / nullif(count(d1), 0), 1) as d1_pct,
  round(100.0 * count(*) filter (where d7) / nullif(count(d7), 0), 1) as d7_pct,
  round(100.0 * count(*) filter (where d30) / nullif(count(d30), 0), 1) as d30_pct
from flags
group by 1
order by 1 desc;
```

### 2. 周留存（第 2 周 / 第 5 周）

样本小的时候 D7/D30 波动很大，按“那一周里有没有回来过”看更稳。`week1_pct` 是新安装后第 7–13 天回来过的比例，`week4_pct` 是第 28–34 天。

```sql
with views as (
  select anonymous_id, (created_at at time zone 'UTC')::date as day
  from public.product_analytics_events
  where event_name = 'home.viewed'
  group by 1, 2
),
data_start as (
  select min(day) as first_day from views
),
cohorts as (
  select anonymous_id, min(day) as cohort_day
  from views
  group by 1
),
flags as (
  select
    c.anonymous_id,
    c.cohort_day,
    case when c.cohort_day + 13 < current_date
      then bool_or(v.day between c.cohort_day + 7 and c.cohort_day + 13) end as week1,
    case when c.cohort_day + 34 < current_date
      then bool_or(v.day between c.cohort_day + 28 and c.cohort_day + 34) end as week4
  from cohorts c
  cross join data_start d
  join views v on v.anonymous_id = c.anonymous_id
  -- Skip the first 30 retained days: anyone whose earlier views were deleted or predate
  -- analytics would otherwise look like a new install there.
  where c.cohort_day >= greatest(current_date - 90, d.first_day + 30)
  group by c.anonymous_id, c.cohort_day
)
select
  date_trunc('week', cohort_day)::date as cohort_week,
  count(*) as new_installs,
  round(100.0 * count(*) filter (where week1) / nullif(count(week1), 0), 1) as week1_pct,
  round(100.0 * count(*) filter (where week4) / nullif(count(week4), 0), 1) as week4_pct
from flags
group by 1
order by 1 desc;
```

### 3. 日均打开次数

一个活跃安装在活跃的那一天打开首页的次数。真正设为启动页或主页的人一天会打开很多次，所以“每天打开 3 次以上的活跃天比例”可以作为“已经设为首页”的间接信号。从设置页返回首页也会再记一次 `home.viewed`，所以次数会略偏高。只统计最近 4 个完整的 UTC 周（周一到周日），当天和本周还没过完，算进来会把次数拉低。

```sql
with bounds as (
  select
    (date_trunc('week', now() at time zone 'UTC') - interval '28 days') at time zone 'UTC' as from_at,
    date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' as to_at
),
install_days as (
  select
    e.anonymous_id,
    (e.created_at at time zone 'UTC')::date as day,
    count(*) as opens
  from public.product_analytics_events e
  cross join bounds b
  where e.event_name = 'home.viewed'
    and e.created_at >= b.from_at
    and e.created_at < b.to_at
  group by 1, 2
)
select
  date_trunc('week', day)::date as week,
  count(distinct anonymous_id) as active_installs,
  round(avg(opens), 2) as avg_opens_per_active_day,
  percentile_cont(0.5) within group (order by opens) as median_opens_per_active_day,
  round(100.0 * count(*) filter (where opens >= 3) / count(*), 1) as pct_active_days_with_3plus_opens
from install_days
group by 1
order by 1 desc;
```

### 4. 新安装第一周是否把首页变成自己的

默认首页自带 20 多个示例网站，所以“链接数 ≥10”没有区分度。这里改看第一周内有没有把首页变成自己的。原则是：只要有一个成功事件说明本机首页已经不是默认示例，就算。只统计满 7 天、且在 60 天内的新安装。算进去的有：

- 自己编辑：添加网站、分组或组件，换主题、Banner 或背景，套用模板（含账号托管空间从模板创建）
- 带入已有内容：导入书签，导入 JSON，恢复数据包或重置前的备份，从恢复中心恢复
- 同步和账号：绑定同步码，拉取云端首页，启用、认领或迁移同步码空间，创建或恢复账号托管空间
- 兜底：首页已经是本机保存的文档（`home.viewed` 带 `hasStoredDocument = true`）

以后新增“把别的首页写进本机”的事件时，要一起加进下面的列表。

```sql
with data_start as (
  select min(created_at) as first_at
  from public.product_analytics_events
  where event_name = 'home.viewed'
),
first_seen as (
  select anonymous_id, min(created_at) as first_seen_at
  from public.product_analytics_events
  where event_name = 'home.viewed'
  group by 1
  having min(created_at) >= greatest(now() - interval '60 days', (select first_at from data_start) + interval '30 days')
     and min(created_at) < now() - interval '7 days'
),
first_week as (
  select e.anonymous_id, e.event_name, e.properties
  from public.product_analytics_events e
  join first_seen f on f.anonymous_id = e.anonymous_id
  where e.created_at >= f.first_seen_at
    and e.created_at < f.first_seen_at + interval '7 days'
)
select
  count(distinct f.anonymous_id) as new_installs,
  round(100.0 * count(distinct w.anonymous_id) filter (
    where w.event_name in ('site.added', 'group.added', 'widget.added', 'theme.changed', 'theme_image.changed', 'template.applied', 'home_space.account_managed_template_created', 'bookmark_import.completed', 'data_package.restored', 'document.json_imported', 'document.reset_backup_restored', 'recovery.local_restored', 'recovery.cloud_restored', 'sync.code_bound', 'sync.pull_applied', 'home_space.sync_code_activated', 'home_space.claimed', 'home_space.sync_code_migrated', 'home_space.account_managed_created', 'home_space.account_managed_restored')
       or (w.event_name = 'home.viewed' and w.properties ->> 'hasStoredDocument' = 'true')
  ) / nullif(count(distinct f.anonymous_id), 0), 1) as customized_in_7d_pct,
  round(100.0 * count(distinct w.anonymous_id) filter (
    where w.event_name = 'bookmark_import.completed'
  ) / nullif(count(distinct f.anonymous_id), 0), 1) as imported_bookmarks_in_7d_pct
from first_seen f
left join first_week w on w.anonymous_id = f.anonymous_id;
```

“设为首页”引导本身的转化见上面的“设为首页”引导漏斗。

## 解读规则

- 事件数不是用户数；同一浏览器可触发多次同类事件。
- `anonymous_id` 是当前浏览器本机标识，清空浏览器数据、换设备、隐私模式都会变化。
- `user_state = signed-in` 只代表上报时有登录 session，不代表可以识别具体账号。
- 小样本只用于发现方向，不能直接证明功能成败。
- 关闭了“产品改进”开关的用户不上报任何事件，留存和打开次数只代表开着开关的用户。
- 清空浏览器数据或换设备会产生新的 `anonymous_id`，同一个人会被算成流失加一个新安装，所以留存会被低估。
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
