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

10. `supabase/migrations/010_account_preferences_editing.sql`
    - 扩展 `account_preferences`，新增 `font_family`、`density`、`default_search_engine`。
    - 将 `locale`、`theme_preference` 和新增偏好字段收紧为固定枚举值。
    - 执行前先回填历史非法值为默认值，避免新增约束失败。
    - 不修改 RLS、grants、`default_space_id` 或首页空间逻辑。

11. `supabase/migrations/011_account_preferences_search_engine_yandex.sql`
    - 将账号默认搜索引擎候选从 Baidu 替换为 Yandex。
    - 回填已有 `baidu` 或非法值为 `duckduckgo`。
    - 更新 `account_preferences_default_search_engine_allowed` 约束。

12. `supabase/migrations/012_home_assets_storage.sql`
    - 固化 `home-assets` Supabase Storage bucket 配置；如果 Dashboard 已手动创建，会保持同名 bucket 并更新参数。
    - bucket 为 private，单文件限制 5MB，只允许 JPG、PNG、WebP 和 GIF。
    - 在 `storage.objects` 上创建 Banner/背景图 RLS policy，限制登录用户只能访问自己目录下的图片。

13. `supabase/migrations/013_cloud_home_snapshots.sql`
    - 新增账号托管空间云端历史表 `home_space_snapshots`，只保存有效用户首页的完整 `document_json`。
    - 新增账号托管空间审计表 `home_space_audit_events`。
    - 新增账号托管专用 v2 创建/迁移 RPC，以及普通上传/强制覆盖 RPC；普通同步码 RPC 保持兼容。
    - 每个账号托管首页空间最多保留最近 50 个云端快照。

14. `supabase/migrations/014_product_analytics_events.sql`
    - 新增隐私优先产品埋点表 `product_analytics_events`。
    - 新增受控上报 RPC `record_product_event(...)`，允许 `anon` 和 `authenticated` 调用。
    - 普通前端角色没有直接表级读写权限；事件名、匿名 ID、属性白名单、payload 大小和禁采字段均由 RPC/约束校验。
    - 新增 `delete_product_analytics_events_older_than(...)` 清理函数，不授予前端角色。

15. `supabase/migrations/015_client_error_events.sql`
    - 新增隐私优先前端错误监控表 `client_error_events`。
    - 新增受控上报 RPC `record_client_error_event(...)`，允许 `anon` 和 `authenticated` 调用。
    - 普通前端角色没有直接表级读写权限；事件类型、severity、fingerprint、匿名诊断 ID、属性白名单、payload 大小和禁采字段均由 RPC/约束校验。
    - 新增 `delete_client_error_events_older_than(...)` 清理函数，不授予前端角色。

## 执行规则

- 新 Supabase project：按 `001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 -> 009 -> 010 -> 011 -> 012 -> 013 -> 014 -> 015` 顺序执行。
- 已经执行过 `001`、`002`、`003`、`004`、`005` 的项目：先执行 `006`，再执行 `007`、`008`、`009`、`010`、`011`、`012`、`013`、`014` 和 `015`。
- 已经执行过 `006`、`007` 但未执行 `008` 的项目：先执行 `008`，再执行 `009`、`010`、`011`、`012`、`013`、`014` 和 `015`。
- 已经执行过 `006`、`007`、`008` 的项目：先执行 `009`，再执行 `010`、`011`、`012`、`013`、`014` 和 `015`。
- 已经执行过 `009` 的项目：先补执行 `010`、`011`、`012`、`013`、`014` 和 `015`。
- 已经执行过 `010` 的项目：先补执行 `011`，再执行 `012`、`013`、`014` 和 `015`。
- 已经执行过 `012` 的项目：补执行 `013`、`014` 和 `015`。
- 已经执行过 `013` 的项目：补执行 `014` 和 `015`。
- 已经执行过 `014` 的项目：补执行 `015`。
- 已经手动创建 `home-assets` bucket 的项目：仍需执行 `012`，因为上传所需的 RLS policy 不会由 Dashboard 创建 bucket 自动生成。
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
- `010_account_preferences_editing.sql` 是 Phase 1.6.6 偏好编辑迁移。建议先执行该脚本，再部署前端；如果前端先部署，账号偏好读取会降级到旧字段，但保存新偏好会提示需要先执行 `010`。
- `011_account_preferences_search_engine_yandex.sql` 是默认搜索引擎候选热修。执行后 Baidu 不再是合法账号偏好值，历史 Baidu 会回落为 DuckDuckGo。
- `012_home_assets_storage.sql` 是 Phase 1.8.1 Banner/背景图片上传所需迁移。前端可以保存外链图片，但登录用户上传 Storage 图片前必须执行该脚本。
- `012_home_assets_storage.sql` 只允许用户访问 `{auth.uid()}/banner/...` 和 `{auth.uid()}/background/...` 路径下的图片；不要把通用文件缓存、公开分享或端到端加密文件复用到这个 bucket policy 中。
- `013_cloud_home_snapshots.sql` 是 Phase 1.11.5 账号托管云端历史版本所需迁移。执行前端代码但未执行该脚本时，账号托管上传和数据恢复中心云端历史读取会失败。
- `013_cloud_home_snapshots.sql` 只为 `account-managed` 空间保存明文 `document_json` 云端历史；普通 `sync-code` 空间继续使用既有密文同步模型，不保存可预览明文历史。
- Phase 1.11.6 不新增 migration。账号托管空间的 v1 定位是账号可信托管、可恢复、可审计；当前仍通过本人 RLS 读取 `home_space_credentials` 完成空白设备恢复，不代表前端完全不接触 managed secret。可执行 `supabase/checks/015_account_managed_recovery_model_verify.sql` 复核当前权限边界。
- `014_product_analytics_events.sql` 是 Phase 1.11.8 基础埋点所需迁移。未执行时，前端埋点会上报失败并静默降级，不影响首页、导入、同步或恢复主流程。
- `014_product_analytics_events.sql` 不保存邮箱、用户 ID、URL、搜索词、首页内容、同步码、账号托管 secret 或云端历史 `document_json`；普通客户端只能调用 `record_product_event(...)`，不能直接查询埋点表。
- `015_client_error_events.sql` 是 Phase 1.11.9 错误监控所需迁移。未执行时，前端错误监控会上报失败并静默降级，不影响首页、导入、同步或恢复主流程。
- `015_client_error_events.sql` 不保存邮箱、用户 ID、URL、搜索词、首页内容、同步码、账号托管 secret 或云端历史 `document_json`；普通客户端只能调用 `record_client_error_event(...)`，不能直接查询错误监控表。
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
- `supabase/checks/012_account_preferences_editing_verify.sql`：验证 Phase 1.6.6 偏好编辑字段、默认值、约束、RLS、权限和默认空间 FK/RLS 边界。
- `supabase/checks/013_home_assets_storage_verify.sql`：验证 Phase 1.8.1 `home-assets` bucket 参数、Storage object policies 和 RLS 状态。
- `supabase/checks/014_cloud_home_snapshots_verify.sql`：验证 Phase 1.11.5 云端历史表、审计表、RLS、权限、账号托管 RPC、旧同步码 RPC 兼容和快照约束。
- `supabase/checks/015_account_managed_recovery_model_verify.sql`：验证 Phase 1.11.6 账号托管可恢复模型的当前 v1 权限边界，包括 `home_space_credentials`、云端历史表、审计表的 RLS、anon/PUBLIC 权限、账号托管 RPC 权限和旧同步码 RPC 兼容。
- `supabase/checks/016_product_analytics_events_verify.sql`：验证 Phase 1.11.8 基础埋点表、RLS、前端表权限、受控 RPC、敏感字段缺失和属性白名单/禁采字段约束。
- `supabase/checks/017_client_error_events_verify.sql`：验证 Phase 1.11.9 错误监控表、RLS、前端表权限、受控 RPC、敏感字段缺失和属性白名单/禁采字段约束。
