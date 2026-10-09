# Supabase 远程 Migration 与 Verification 自动化

## 状态

仓库已经具备并验证受保护的远程执行链路。GitHub `supabase-production` Environment 已配置 required reviewer、禁止管理员绕过、仅允许 `master`，并保存 `SUPABASE_PROJECT_ID`、`SUPABASE_ACCESS_TOKEN` 和 `SUPABASE_DB_PASSWORD`。2026-08-10 已完成目标项目的 001-019 schema 审计、一次性 migration history 对齐、标准 dry-run 和 verify；当前 Local/Remote history 一致，远端没有待执行 migration。

该链路只自动执行：

1. 本地 migration replay、数据库 lint、pgTAP 和 Deno 检查。
2. 远程 migration history/schema 基线检查。
3. `supabase db push --linked --dry-run`。
4. 经人工批准的 `supabase db push --linked`。
5. `supabase/remote-deploy.json` 明确列入白名单的远程 SQL verification。

它不会执行 `migration repair`、`--include-all`、远程 `db reset`、seed、Edge Function 部署、管理员初始化或任意目录扫描。

Edge Function 部署和回滚使用单独的 `deploy-edge-function.yml`，见 `EdgeFunctionDeployment.md`。

## 仓库文件

- `.github/workflows/deploy-supabase.yml`：仅由 `workflow_dispatch` 启动的远程工作流。
- `.github/workflows/verify-supabase.yml`：PR/master/production 的本地 Supabase 门禁，不接触远程数据库。
- `scripts/deploy-supabase-remote.mjs`：固定执行顺序、参数校验、project-ref 二次确认和 SQL 白名单编排。
- `supabase/remote-deploy.json`：CLI 版本、历史基线、preflight check 和 post-migration check 白名单。
- `supabase/checks/000_remote_migration_history_baseline.sql`：远程 001-018 history/schema 与 019 history/schema 一致性门禁。
- `supabase/checks/021_admin_readonly_foundation_verify.sql`：Phase 1.18.1 机器可失败的结构、权限、约束和 rollback A/B/C 检查。

CLI 固定为 `2.113.0`。本地验证 workflow、远程 workflow 和 manifest 必须使用同一版本；`npm run verify:supabase-remote-config` 会检查版本漂移。

## 三种运行模式

### `dry-run`

默认模式。执行本地全量验证、远程 link、migration list、history/schema preflight 和 `db push --dry-run`，不应用 migration，也不运行依赖新 schema 的 post-migration check。

首次配置完成后必须先运行此模式。预期只显示确实待部署的 migration；当前目标项目应显示 001-019 一致并返回远端 up to date。

### `verify`

不执行 `db push`，但会在 preflight 和 dry-run 后执行白名单 verification。用于 migration 已在线后的定期权限复核。

`021` 会在一个事务中创建固定 synthetic A/B/C 数据并 `rollback`。SQL 中任何结构、权限、负向约束或 rollback 异常都会令 workflow 失败。

### `apply`

执行 preflight、dry-run、`db push`、白名单 verification 和最终 migration list。除 GitHub Environment 审批外，还必须在 workflow input 中输入与 `SUPABASE_PROJECT_ID` 完全相同的 project ref；不匹配时在远程写入前失败。

## GitHub Environment 配置

以下配置已于 2026-08-10 全部完成；secret 只保存于受保护 Environment：

1. 打开 `Settings -> Environments`。
2. 新建 environment：`supabase-production`。
3. 启用 required reviewers；生产 migration 至少需要一名明确负责人批准。
   - 关闭 `Allow administrators to bypass configured protection rules`。
4. 将 deployment branches/tags 限制为 `master`。workflow 自身也会拒绝非 `refs/heads/master`。
5. 新增 Environment variable：
   - `SUPABASE_PROJECT_ID`：Dashboard URL 中的 20 位 project ref。
6. 新增 Environment secrets：
   - `SUPABASE_ACCESS_TOKEN`：Supabase account access token。
   - `SUPABASE_DB_PASSWORD`：目标 project 的 Postgres database password。

可以在 GitHub `Settings -> Environments -> supabase-production` 中录入，也可以在可信本机终端分别运行以下命令，并在交互提示中粘贴值：

```bash
gh secret set SUPABASE_ACCESS_TOKEN --env supabase-production
gh secret set SUPABASE_DB_PASSWORD --env supabase-production
```

不要把 secret 作为 `--body` 参数写入 shell history，也不要把值发送到聊天。

不要配置或提交：

- `SUPABASE_SERVICE_ROLE_KEY`
- anon key
- 管理员 UUID/邮箱对照
- Cloudflare token
- connection string

project ref 不是密钥，但必须精确指向生产 project。access token 和 database password 不应粘贴到聊天、workflow input、Actions variable、仓库文件或日志中。

## 一次性 Migration History 对齐

目标线上 001-019 历史上通过 Dashboard SQL Editor 执行，因此最初数据库结构完整但 `supabase_migrations.schema_migrations` 为空。2026-08-10 首次标准 dry-run 在 history preflight 处按设计终止；随后经明确授权，使用一次性受保护工作流先完成关键表、列、RLS、Storage、RPC、约束、grant 和完整 `021` rollback 审计，再将固定 001-019 标记为 applied。一次性 repair workflow 和审计脚本已从 `master` 删除，正式远程 workflow 仍不具备 repair 能力。

对齐后重新运行的标准 dry-run 已确认 001-019 Local/Remote 一一对应、`remote_migration_history_baseline_ok`，并返回 `Remote database is up to date.`；随后 verify 再次通过 history baseline、dry-run 和 `admin_readonly_foundation_rollback_ok`。本次没有重跑 migration，也没有执行 `apply`。

新环境或再次发现 history 不一致时，远程 workflow 仍会在 `db push` 前终止。先使用只读命令检查：

先使用只读命令检查：

```bash
supabase login
supabase link --project-ref <production-project-ref>
supabase migration list --linked
```

如果 001-018 的数据库对象已存在但 history 缺失，必须先人工核对线上 schema 和既有 `019` / `020` 分享检查，再由负责人执行：

```bash
supabase migration repair \
  001 002 003 004 005 006 007 008 009 \
  010 011 012 013 014 015 016 017 018 \
  --status applied \
  --linked
```

该命令只修复 history，不执行 migration。以下情况不得 repair：

- 无法确认目标 project。
- 001-018 任一关键表、RPC、约束或权限不存在。
- 远程 schema 与仓库 migration 内容不一致。
- `019` 已经通过 SQL Editor 手动执行，但 history 未记录。

如果 `019` 已被手动执行，必须先运行 `021` 并单独核对 019 history/schema，再决定是否将 `019` 标记为 applied；不能让 workflow 重复猜测。

## Phase 1.18.1 线上验证结果

2026-08-10 已确认目标项目在自动化接入前手动执行过 `019`，因此没有再次运行 `apply`。完成的线上门禁为：

1. 一次性 schema/permission 审计与完整 `021` rollback 通过。
2. migration history 001-019 与已存在 schema 安全对齐。
3. 标准 `dry-run` 确认远端 up to date，没有待执行 migration。
4. 标准 `verify` 再次运行 021，结构、权限、负向约束和 rollback 均通过。
5. synthetic Auth/admin/audit 数据未保留，现有业务 migration 未被重复执行。

`021` 成功不等于管理员已初始化。首个 owner 仍按 `AdminDashboardRunbook.md` 使用明确 Auth UUID 受控初始化。

## 后续新增 Migration

每个新 migration 必须按以下方式接入：

1. 新增 `supabase/migrations/<version>_<name>.sql`。
2. 新增或更新 pgTAP，确保空库 replay、lint 和负向测试通过。
3. 新增机器可失败的 SQL verification；不应只输出供人工阅读的结果。
4. 如果 verification 会写 synthetic 数据，必须在同一文件中显式 `rollback`，不得包含 `commit`。
5. 将 verification 明确加入 `supabase/remote-deploy.json` 的 `postMigrationChecks`。
6. 先运行 `npm run verify:supabase-remote-config` 和 `npm run verify:supabase-preparation`。
7. 先走远程 `dry-run`，再走受保护的 `apply`。

工作流不会自动执行整个 `supabase/checks/` 目录，因为其中包含修复 SQL、人工检查和不同历史阶段的脚本。只有 manifest 白名单中的文件可以远程执行。

## 本地命令

只验证配置，不连接远程：

```bash
npm run verify:supabase-remote-config
```

本地验证全部 migrations：

```bash
npm run verify:supabase-preparation
```

本地终端如需运行远程 dry-run，应先通过环境变量提供三项配置，然后执行：

```bash
SUPABASE_REMOTE_MODE=dry-run npm run deploy:supabase:remote
```

本地 `apply` 还必须设置 `SUPABASE_REMOTE_CONFIRM_PROJECT_REF` 为精确 project ref。推荐生产写入只通过 GitHub Environment 审批，不从开发机直接 apply。

## 失败与恢复

- history baseline 失败：停止，不运行 `--include-all`；人工核对 migration history 和 schema。
- dry-run 出现 001-018：停止，说明 history 尚未安全对齐。
- `db push` 失败：不继续 Edge Function 或 Admin Pages 部署；保留完整错误和 migration 状态。
- post-migration check 失败：migration 可能已经成功提交，但 Phase 1.18 门禁失败；立即按对应 runbook 关闭新能力，不删除表或审计。
- workflow 中断：重新运行 `dry-run` 和 `migration list`，不要直接重试 apply。
- secret 泄露：立即在 Supabase 轮换 access token/database password，并更新 GitHub Environment secret。

永远不要对生产运行：

```text
supabase db reset --linked
supabase db push --include-all
```
