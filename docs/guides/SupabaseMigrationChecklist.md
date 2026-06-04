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

## 执行规则

- 新 Supabase project：按 `001 -> 002 -> 003` 顺序执行。
- 已经执行过 `001` 和 `002` 的项目：只执行 `003`。
- 执行前确认目标 project 是线上使用的 Supabase project。
- 执行后可以在 SQL Editor 中检查函数是否存在：

```sql
select public.next_sync_revision(998) as rev_999;
select public.next_sync_revision(999) as rev_0;
```

预期结果：

- `rev_999 = 999`
- `rev_0 = 0`

## 注意事项

- 前端代码部署不等于数据库迁移已执行。
- 如果前端调用了数据库中不存在的 RPC，会出现同步失败。
- `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 是公开前端配置，不是服务端密钥。
- 不要把 Supabase service role key 写入前端代码、GitHub Pages 环境变量或公开仓库。
