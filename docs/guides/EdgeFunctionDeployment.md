# Edge Function 部署与回滚

## 范围

`.github/workflows/deploy-edge-function.yml` 只负责 Edge Function 的部署和回滚，一次只处理一个函数。数据库 migration 仍然只走 `deploy-supabase.yml`（见 `SupabaseRemoteDeployment.md`）。两条工作流共用 `supabase-production` Environment 和同一个 concurrency group，不会同时运行。

可以部署的函数由 `supabase/remote-deploy.json` 的 `edgeFunctions` 白名单决定。每个条目包括：

- `name`：`supabase/functions/<name>/index.ts` 必须存在，`supabase/config.toml` 中 `[functions.<name>]` 必须为 `verify_jwt = true`。
- `preflightChecks`：部署前在目标数据库运行的检查。只能引用已经列在 `postMigrationChecks` 中、带 rollback 的检查文件，所以函数依赖的 migration 没有上线时部署会失败。
- `requiredSecrets`：函数需要的自定义 secret 名称。内置的 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 等不需要列出。

`npm run verify:edge-function-config` 会校验白名单、`verify_jwt`、工作流里的函数选项和 master/Environment 边界；`verify-supabase.yml` 在每个相关 PR 上都会运行它。

## 三种模式

所有模式都只能从 `master` 运行，并需要在 GitHub 上批准 `supabase-production` Environment。

### `check`（默认，只读）

1. 本地 Deno fmt、lint、type-check 和测试。
2. `supabase link` 后运行该函数的 `preflightChecks`。
3. 按名称检查 `requiredSecrets` 是否都已设置；日志只输出 present/MISSING，不输出值或 digest。
4. `supabase functions list` 记录当前线上函数版本。

不会部署或修改任何东西。

### `deploy`

在 `check` 全部通过后执行：

1. 要求 `confirm_project_ref` 与 `SUPABASE_PROJECT_ID` 完全一致。
2. `supabase functions deploy <name> --use-api`，`verify_jwt` 取自 `config.toml`，工作流不允许出现 `--no-verify-jwt`。
3. 冒烟检查：不带凭证 POST 函数地址，必须返回 `401`，证明函数已上线且 JWT 校验生效。
4. 再次 `supabase functions list` 记录新版本。

### `delete`（紧急回滚）

要求 `confirm_project_ref` 一致，然后 `supabase functions delete <name>`，并确认函数地址返回 `404`。这条路径故意跳过本地 Deno 校验、数据库检查和 secret 检查，master 上的函数代码有问题或数据库故障时也能执行；只保留白名单校验、master 限制和 Environment 审批。删除只影响函数，不改数据库和 secret。

## Secret 设置

Secret 只在 Supabase Dashboard 设置：Project → Edge Functions → Secrets。不要把值写进仓库、issue、PR、聊天或日志。

| 函数 | Secret | 说明 |
| --- | --- | --- |
| `admin-read` | `ADMIN_ALLOWED_ORIGINS`（可选） | 逗号分隔的额外 HTTPS origin；不设置时只允许内置的生产后台 origin 和本地开发 origin。 |
| `rss-proxy` | `RSS_RATE_LIMIT_SALT` | 限流键的随机盐，至少 32 个随机字符（例如 `openssl rand -hex 32` 的输出）。换盐会让现有限流计数失效，不影响缓存。 |
| `rss-proxy` | `RSS_EGRESS_VERIFIED` | 固定为 `true`，表示设计文档第 4 节的出口网络验证已评审（2026-10-09 已完成并接受剩余风险）。不设置时函数拒绝启动。 |

新增函数时，在本表和 `requiredSecrets` 中同时登记。

## 上线顺序

1. 函数依赖的 migration 先通过 `deploy-supabase.yml` apply，并且对应检查通过。
2. 在 Dashboard 设置 `requiredSecrets`。
3. 运行 `check`，确认检查、secret 和当前版本。
4. 运行 `deploy`，填写 project ref。
5. 按函数自己的 runbook 做端到端验证（例如 `AdminDashboardRunbook.md`）。

`admin-read` 另有前置条件：`AdminDashboardRunbook.md` 的“Phase 1.18.2 开始门禁”全部满足，包括已初始化明确的测试管理员。

`rss-proxy` 的前置条件和上线后验证：migration 022 已 apply 且检查 024 通过；部署后按 `docs/implementation/phase-2/Phase2_2_RssWidgetDesign.md` 的“上线前验证限流键”做 61 次请求检查，没有被限流就立即运行 `delete`。

## 回滚

按影响从小到大选择：

1. **修代码再部署**：在 master 上 revert 或修复，CI 通过后重新运行 `deploy`。Supabase 不保留可切换的旧版本，回到旧代码就是从 master 重新部署旧代码。
2. **函数自带的关闭开关**：如果函数在 runbook 中定义了开关（例如管理员表的 `enabled`），先用开关停止能力，再处理代码。
3. **删除函数**：运行 `delete`。前端调用会得到 `404`，应按“服务不可用”处理。恢复时从 master 重新运行 `deploy`。

回滚后在 PR 或 thread 中记录时间、运行链接和原因，不记录 secret、IP 或用户数据。
