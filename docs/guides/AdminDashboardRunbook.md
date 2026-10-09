# Phase 1.18 管理员数据库运行手册

## 目标与当前状态

本手册覆盖 Phase 1.18.1 的 `admin_users` 管理员身份表和 `admin_audit_events` 追加式审计表，包括本地验证、线上 migration、首个 owner 初始化、管理员停用、角色调整、权限复核和安全回滚。

仓库实现不包含任何真实管理员 UUID、邮箱、Supabase 密钥或 Cloudflare 身份信息。`019_admin_readonly_foundation.sql` 只创建空表；在 Phase 1.18.2 Edge Function 上线前，必须由有数据库运维权限的人员使用明确的 Supabase Auth user UUID 初始化测试管理员。

Phase 1.18.1 不创建 Admin API 或页面，不修改用户首页、同步空间、账号托管凭证、云端快照、公开分享及其 RLS/grant。

## 文件

- `supabase/migrations/019_admin_readonly_foundation.sql`：创建管理员身份、追加式审计、约束、索引、RLS 和 service-role 最小权限。
- `supabase/checks/021_admin_readonly_foundation_verify.sql`：结构、权限、约束和 transaction-scoped A/B/C 验证。
- `supabase/tests/database/001_admin_readonly_foundation_test.sql`：本地/CI pgTAP 自动回归。

`019` 是 migration 编号；`021` 是检查脚本编号。检查编号 `019` 和 `020` 已由 Phase 1.17 公开分享占用，不得重命名或覆盖。

## 数据与权限边界

### `admin_users`

- 一个 `auth.users.id` 最多对应一个管理员。
- 角色固定为 `owner`、`admin`、`support`。
- 普通管理员生命周期变更使用 `enabled` 和 `role`；v1 不删除管理员记录。
- `created_by` 记录执行初始化或后续运维变更时指定的 Auth user UUID。首个 owner 可以将 `created_by` 指向自身。
- `anon`、`authenticated` 和 `PUBLIC` 没有直接表权限，也没有 RLS policy。
- `service_role` 只有 `SELECT`，不能通过 Edge Function 创建、更新或删除管理员。

### `admin_audit_events`

- `service_role` 只有 `SELECT`、`INSERT`，不能更新或删除审计。
- `request_id` 唯一，确保一个成功管理请求只对应一条审计。
- 审计保留管理员 Auth UUID 和角色快照；Auth 用户或管理员身份记录被删除时，不级联删除审计。
- reason 必须 trim 后为 8-500 字符，并拒绝明显的邮箱、URL、JWT/token 和完整同步码形态。
- metadata 只允许 API 版本、分页方向、空间模式和结果状态四类低敏感字段。
- 审计中不得保存邮箱搜索词、首页标题、站点名称或 URL、组件内容、`document_json`、同步凭证、JWT 或 service role。

## 本地验证

在仓库根目录执行：

```bash
npm run verify:supabase-preparation
```

该命令只操作本地 Supabase，依次执行：

1. 启动本地数据库。
2. 从空库重放 `001-019`。
3. 执行数据库 lint。
4. 运行 pgTAP，包括 Phase 1.18.1 的结构、权限、负向约束和 A/B/C 测试。
5. 运行 Deno 格式化、lint、类型检查和测试。

不得为了本地验证给该命令增加 `--linked`、`--db-url`、`db push` 或 Functions deploy。

## 线上执行前检查

以下检查用于新环境首次部署；当前生产目标已于 2026-08-10 完成 019/021 与 history 门禁。

1. 确认目标是当前正式站点实际使用的 Supabase project。
2. 确认目标数据库已执行至 `018_public_home_share_upsert_conflict_fix.sql`。
3. 保存当前 migration 状态、数据库备份状态、执行人和回滚窗口。
4. 确认没有同名 `admin_users` 或 `admin_audit_events` 手工表。
5. 准备 A=owner/admin、B=support、C=普通账号的测试 Auth UUID；不得使用真实用户首页内容作为后续预览样本。
6. 不在公开仓库、提交信息、工单、截图或聊天摘要中保存邮箱和 UUID 对照。

仓库已新增并验证受保护的远程 migration/verification 工作流；GitHub `supabase-production` Environment、secrets、required reviewer、禁止管理员绕过、`master` 分支限制和 project ref 均已配置。2026-08-10 已完成 001-019 migration history 对齐、标准 dry-run 和 verify，完整 `021` rollback 通过。配置和一次性 history 记录见 `SupabaseRemoteDeployment.md`。

## 执行 migration 与验证

推荐使用 `.github/workflows/deploy-supabase.yml`：

1. 先从 `master` 运行 `dry-run`，确认 history/schema preflight 通过且只显示预期的新 migration。
2. 再运行 `apply`，输入精确 project ref，并通过 `supabase-production` required reviewer 审批。
3. workflow 自动执行待部署 migration，随后通过 `supabase db query --linked --file` 运行 manifest 白名单 verification。
4. 确认 verification 的机器断言和 rollback 标记均通过。
5. 确认最终 migration list 已记录新版本。

如果 GitHub Actions 不可用，才使用 Supabase Dashboard SQL Editor 作为人工 fallback：先完整执行 `019`，再完整执行 `021`，不能只执行输出查询而跳过机器断言、Section 8 或末尾 rollback。人工执行后还必须安全对齐 `019` migration history，不能直接让后续 `db push` 猜测状态。

如果任一步不符合预期，不得初始化真实 owner，不得开始 Phase 1.18.2 部署。

## 初始化首个 owner

只接受明确的 Supabase Auth user UUID。不要按模糊邮箱搜索并直接插入，也不要把替换完成后的 SQL 保存回仓库。

先确认 UUID 恰好存在一行：

```sql
select id, created_at
from auth.users
where id = 'replace-with-explicit-auth-user-uuid'::uuid;
```

然后在一个事务中初始化。以下占位符故意不是有效 UUID，执行前必须人工替换：

```sql
begin;

do $$
declare
  v_owner_user_id uuid := 'replace-with-explicit-auth-user-uuid'::uuid;
begin
  if not exists (
    select 1
    from auth.users
    where id = v_owner_user_id
  ) then
    raise exception 'Target Auth user does not exist';
  end if;

  if exists (
    select 1
    from public.admin_users
    where user_id = v_owner_user_id
  ) then
    raise exception 'Administrator already exists';
  end if;

  insert into public.admin_users (user_id, role, enabled, created_by)
  values (v_owner_user_id, 'owner', true, v_owner_user_id);
end;
$$;

select id, user_id, role, enabled, created_by, created_at, updated_at
from public.admin_users
where user_id = 'replace-with-explicit-auth-user-uuid'::uuid;

commit;
```

预期只返回一行，角色为 `owner`、`enabled = true`。如返回行数、UUID 或角色不符合预期，应在 `commit` 前改为 `rollback`。

## 新增测试管理员

Phase 1.18 v1 不提供管理员名单 API 或 UI。新增 `admin` 或 `support` 仍由受控数据库运维执行：

```sql
begin;

do $$
declare
  v_target_user_id uuid := 'replace-with-explicit-auth-user-uuid'::uuid;
  v_operator_user_id uuid := 'replace-with-operator-auth-user-uuid'::uuid;
begin
  if not exists (select 1 from auth.users where id = v_target_user_id) then
    raise exception 'Target Auth user does not exist';
  end if;

  if not exists (
    select 1
    from public.admin_users
    where user_id = v_operator_user_id
      and role = 'owner'
      and enabled
  ) then
    raise exception 'Enabled owner operator was not found';
  end if;

  insert into public.admin_users (user_id, role, enabled, created_by)
  values (v_target_user_id, 'support', true, v_operator_user_id);
end;
$$;

commit;
```

把 `support` 改为 `admin` 前必须重新确认所需权限。不得使用 migration 硬编码人员身份。

## 停用、启用与角色调整

优先停用，不删除记录：

```sql
update public.admin_users
set enabled = false
where user_id = 'replace-with-explicit-auth-user-uuid'::uuid
returning id, user_id, role, enabled, updated_at;
```

重新启用前必须确认停用原因已经处理：

```sql
update public.admin_users
set enabled = true
where user_id = 'replace-with-explicit-auth-user-uuid'::uuid
  and enabled = false
returning id, user_id, role, enabled, updated_at;
```

角色调整必须使用固定值，并检查返回行：

```sql
update public.admin_users
set role = 'support'
where user_id = 'replace-with-explicit-auth-user-uuid'::uuid
returning id, user_id, role, enabled, updated_at;
```

生产环境不允许通过 Edge Function、Admin Pages 或普通 authenticated session 执行上述语句。

## 日常权限复核

定期运行 `021` Section 1-7，并重点确认：

- 两张表 `rowsecurity = true`。
- `pg_policies` 返回 0 行。
- `anon`、`authenticated`、`PUBLIC` 表权限返回 0 行。
- `service_role` 只有 `admin_users/SELECT`、`admin_audit_events/SELECT` 和 `admin_audit_events/INSERT`。
- 没有新建可由前端执行、且读取管理员表或跨用户数据的 RPC。
- 审计总量只做数量检查，不复制 reason、目标或 metadata 到外部日志。

## 安全回滚

### 立即关闭管理能力

如果发现管理员身份、Edge Function 或 Pages 配置异常，先执行：

```sql
update public.admin_users
set enabled = false
where enabled;

revoke all on table public.admin_users from service_role;
revoke all on table public.admin_audit_events from service_role;
```

这会阻止 Edge Function 继续读取管理员身份或追加/读取审计。随后关闭 Edge Function 和 Cloudflare Access allow policy。

### 恢复最小权限

问题修复并重新通过 `021` 与 A/B/C 回归后，先恢复服务端最小权限：

```sql
grant select on table public.admin_users to service_role;
grant select, insert on table public.admin_audit_events to service_role;
```

再逐个启用已确认的管理员。不要一次性启用全部记录。

### 禁止的回滚方式

- 不 `drop table`。
- 不清空或删除 `admin_audit_events`。
- 不修改用户表、同步表、快照表或凭证表 RLS。
- 不向 `authenticated` 增加跨用户权限。
- 不删除 Cloudflare Access application 后留下公开 Admin Pages 内容。

审计记录是调查依据，故障期间必须保留。

## Phase 1.18.2 开始门禁

只有以下条件全部满足，才可以开始部署 `admin-read` Edge Function：

- 目标数据库已执行 `019`。
- `021` Section 1-8 全部通过且测试事务无残留。
- 已使用明确 Auth UUID 初始化测试 owner/admin 和 support。
- 普通账号 C 没有 `admin_users` 记录。
- 已确认 Edge Function server-only secrets、精确 CORS origin 和回滚窗口。
- 仍未向公开主站或 GitHub Pages 添加后台页面、入口或 bundle。

满足后按 `EdgeFunctionDeployment.md` 先运行 `check`，再运行 `deploy`。
