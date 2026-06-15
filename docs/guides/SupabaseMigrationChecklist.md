# Supabase SQL 执行清单

## Summary

本项目的 Supabase 数据库变更保存在 `supabase/migrations/` 目录。当前阶段没有接入 Supabase CLI 自动迁移，线上数据库需要在 Supabase Dashboard 的 SQL Editor 中手动执行对应 SQL。

## 当前迁移顺序

1. `supabase/migrations/001_sync_spaces.sql`
   - 创建 `sync_spaces` 表。
   - 启用 RLS。
   - 创建同步码 create、pull、push、force push、revoke RPC。

2. `supabase/migrations/002_revision_limit_and_check.sql`
   - 将 revision 调整为允许 `0`。
   - 增加 `next_sync_revision()`。
   - 增加 `check_sync_space_revision()` 轻量检查 RPC。
   - 修改 push/force push 使用 revision 回绕逻辑。

3. `supabase/migrations/003_revision_limit_999.sql`
   - 将 revision 正式上限调整为 `999`。
   - 更新 `next_sync_revision()` 为 `999 -> 0`。
   - 更新 `sync_spaces_revision_range` 约束为 `0-999`。

4. `supabase/migrations/004_account_spaces.sql`
   - 创建账号资料表 `profiles`。
   - 创建账号全局偏好表 `account_preferences`。
   - 创建账号首页空间索引表 `home_spaces`。
   - 启用 RLS，并限制登录用户只能访问自己的账号数据。
   - 不保存 `accessToken`、`encryptionKey` 或完整同步码。

5. `supabase/migrations/005_account_space_activation.sql`
   - 新增 `activate_home_space(p_home_space_id uuid)` RPC。
   - 将默认首页空间激活收束到数据库事务中。
   - 同步更新 `home_spaces.is_default`、`home_spaces.last_used_at` 和 `account_preferences.default_space_id`。
   - 收紧 `account_preferences.default_space_id` 的 RLS 校验，禁止指向其他账号的首页空间。

6. `supabase/migrations/006_account_managed_sync_foundation.sql`
   - 为 `home_spaces` 增加 `access_mode`，默认现有空间为 `sync-code`。
   - 新增账号托管凭证表 `home_space_credentials`。
   - 通过 RLS 限制托管凭证只能由所属账号读取。
   - 新增 `create_account_managed_home_space(...)` RPC，供 Phase 1.6.1+ 创建账号托管空间。
   - 不改变当前前端行为，不隐藏同步码入口，不改变现有同步码 RPC。

7. `supabase/migrations/007_account_managed_credential_regex_fix.sql`
   - 修复 `home_space_credentials` 凭证校验中的 PostgreSQL 正则 `{32,512}` 运行时错误。
   - 将凭证校验改为长度检查加 Base64URL 字符集检查。
   - 重新创建 `create_account_managed_home_space(...)` RPC。
   - 不删除数据，不改变 RLS 规则，不改变同步码 RPC。

8. `supabase/migrations/008_sync_code_to_account_managed.sql`
   - 新增 `migrate_sync_code_home_space_to_account_managed(...)` RPC。
   - 支持把当前账号已认领的普通同步码空间原地迁移为账号托管。
   - 写入 `home_space_credentials`，但不修改 `sync_spaces` 密文，不废弃旧同步码。

9. `supabase/migrations/009_home_space_crud.sql`
   - 新增 `rename_home_space(...)`、`set_default_home_space(...)`、`remove_home_space_from_account(...)` RPC。
   - 支持账号首页空间重命名、设默认和从账号移除。
   - 移除账号托管空间时删除账号侧托管凭证，但不删除、不 revoke、不修改底层 `sync_spaces`。

## 执行规则

- 新 Supabase project：按 `001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 -> 009` 顺序执行。
- 已经执行过 `001`、`002`、`003`、`004`、`005` 的项目：先执行 `006`，再执行 `007`、`008` 和 `009`。
- 已经执行过 `006`、`007` 但未执行 `008` 的项目：先执行 `008`，再执行 `009`。
- 已经执行过 `006`、`007`、`008` 的项目：只需补执行 `009`。
- 执行前确认目标 project 是线上使用的 Supabase project。
- 执行 `003` 后可以在 SQL Editor 中检查 revision 函数是否存在：

```sql
select public.next_sync_revision(998) as rev_999;
select public.next_sync_revision(999) as rev_0;
```

预期结果：

- `rev_999 = 999`
- `rev_0 = 0`

执行 `004` 后可以检查账号表、RLS 和 policy 是否存在：

```sql
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'account_preferences', 'home_spaces')
order by tablename;

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'account_preferences', 'home_spaces')
order by tablename, policyname;

select
  column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'home_spaces'
  and column_name in ('access_token', 'encryption_key', 'sync_code');
```

预期结果：

- `profiles`、`account_preferences`、`home_spaces` 的 `rowsecurity` 均为 `true`。
- 三张表均存在 `select/insert/update` 的 own-data policy；`home_spaces` 额外存在 `delete` policy。
- 最后一条查询返回 0 行，表示账号首页空间索引没有保存同步码 secret 字段。

## 注意事项

- 前端代码部署不等于数据库迁移已执行。
- 如果前端调用了数据库中不存在的 RPC，会出现同步失败。
- `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 是公开前端配置，不是服务端密钥。
- 不要把 Supabase service role key 写入前端代码、GitHub Pages 环境变量或公开仓库。
- `004_account_spaces.sql` 只建立账号空间索引，不会改变现有同步码 RPC 行为。
- `005_account_space_activation.sql` 只收口默认空间激活和 RLS 校验，不引入账号托管凭证，不改变同步码密文同步模型。
- `006_account_managed_sync_foundation.sql` 会保存账号托管凭证字段，但只在 `home_space_credentials` 表中保存，并通过 RLS 限制为本人可读；本阶段前端还不会使用这些凭证。
- `007_account_managed_credential_regex_fix.sql` 是 Phase 1.6.1 热修复；如果创建账号托管空间时报 `invalid regular expression: invalid repetition count(s)`，说明线上数据库需要执行该脚本。
- Phase 1.6.2 空白设备账号恢复不新增迁移；它复用 `home_space_credentials` 的本人可读 RLS。上线前可重新执行 `007_account_managed_sync_verify.sql` 和 `008_account_managed_credential_regex_fix_verify.sql` 确认凭证表权限与正则修复仍满足要求。
- `008_sync_code_to_account_managed.sql` 不会废弃旧同步码。迁移后旧同步码仍可继续使用，这是 Phase 1.6.3 的保守设计。
- `009_home_space_crud.sql` 只管理账号侧空间索引。`remove_home_space_from_account(...)` 会删除账号托管凭证，但不会删除或废弃底层 `sync_spaces`。
- Phase 1.6.4a 不新增迁移；如果需要复核删除策略，执行 `supabase/checks/011_home_space_removal_policy_verify.sql`。
- 新设备登录后看到账号空间列表，不代表已经拥有该空间的同步凭证；只有 `account-managed` 空间可以通过账号托管凭证直接恢复，普通 `sync-code` 空间仍需输入完整同步码。

## 辅助检查脚本

- `supabase/checks/004_account_spaces_verify.sql`：验证 `004_account_spaces.sql` 是否已执行到位，包括账号表、RLS、policy、敏感字段缺失、约束和角色权限。
- `supabase/checks/004_account_spaces_repair_grants.sql`：当 `authenticated` 被授予 `TRUNCATE`、`TRIGGER`、`REFERENCES` 等过宽权限时，用于收敛账号表权限。
- `supabase/checks/005_home_space_claim_verify.sql`：验证 Phase 1.5.4 登录账号与同步空间的认领关系；只使用同步码中的 `sync_space_id`，不要把完整同步码粘贴到 SQL Editor。
- `supabase/checks/006_account_security_verify.sql`：验证 Phase 1.5.6 安全收口，包括账号表隔离、`sync_spaces` 直接表权限、`activate_home_space` RPC 权限、默认空间一致性和 A/B 用户 RLS 模拟。
- `supabase/checks/007_account_managed_sync_verify.sql`：验证 Phase 1.6.0 账号托管同步基础，包括 `access_mode`、`home_space_credentials`、RLS、角色权限、RPC 权限和现有同步码 RPC 回归。
- `supabase/checks/008_account_managed_credential_regex_fix_verify.sql`：验证 Phase 1.6.1 账号托管凭证正则热修复，确认约束和 RPC 中不再包含 `{32,512}`。
- `supabase/checks/009_sync_code_to_account_managed_verify.sql`：验证 Phase 1.6.3 同步码迁移 RPC、权限、凭证一致性和可选 A/B 功能回归。
- `supabase/checks/010_home_space_crud_verify.sql`：验证 Phase 1.6.4 首页空间 CRUD RPC、权限、默认空间一致性、凭证约束和可选 A/B 回滚测试。
- `supabase/checks/011_home_space_removal_policy_verify.sql`：验证 Phase 1.6.4a 删除策略，确认从账号移除不会删除、废弃或改写底层 `sync_spaces`。
