# Phase 1.6 实施记录：账号托管同步与 Beta 打磨

## Summary

Phase 1.6 的目标是把登录用户的默认同步体验从“手动管理同步码”升级为“账号管理首页空间”。同步码继续保留匿名同步、恢复和高级管理价值；账号托管空间提供空白设备登录后直接恢复首页的能力。

Phase 1.6.0 是账号托管同步的设计收口和 Supabase 基础迁移阶段，不改变当前线上前端体验，不隐藏同步码入口，也不实现空白设备直接恢复。Phase 1.6.1 开始接入前端创建账号托管空间。

## Phase 1.6.0：账号托管同步基础

### 1. 用户侧体验

Phase 1.6.0 完成后，用户侧没有明显变化。

- 未登录用户继续使用本地首页和同步码。
- 已登录用户继续看到账号资料、偏好骨架和已认领首页空间。
- 已登录用户激活 `sync-code` 首页空间时，仍需输入完整同步码。
- 设置页不会新增账号托管空间创建入口。
- 空白设备登录账号后仍不能直接恢复 `sync-code` 空间内容。
- 同步码面板、认领、空间切换、导入导出和恢复默认行为不变。

### 2. 后端数据库结构

Phase 1.6.0 新增 Supabase 迁移 `006_account_managed_sync_foundation.sql`。

主要结构变化：

- `home_spaces` 新增 `access_mode`：
  - `sync-code`：当前同步码空间，默认值。
  - `account-managed`：账号托管空间，Phase 1.6.1+ 使用。
  - `password-protected`：未来高隐私空间预留值。
- `home_spaces` 新增 `(id, user_id)` 唯一约束，用于凭证表的账号一致性外键。
- 新增 `home_space_credentials`：
  - `home_space_id`
  - `user_id`
  - `credential_type`
  - `access_token`
  - `encryption_key`
  - `created_at`
  - `updated_at`
  - `revoked_at`
- `home_space_credentials` 启用 RLS。
- `home_space_credentials` 只向 `authenticated` 授予 `SELECT, INSERT, UPDATE`。
- `anon` 和 `public` 不能读取账号托管凭证。
- 每个首页空间当前只允许一个未废弃的 `sync-space-v1` 托管凭证。

新增 RPC：

- `create_account_managed_home_space(...)`
  - 仅 `authenticated` 可执行。
  - 在同一事务中创建底层 `sync_spaces`、`home_spaces` 和 `home_space_credentials`。
  - 当前前端尚未调用；Phase 1.6.1 才接入。

### 3. 系统架构

Phase 1.6.0 固化新的访问模式模型：

```text
Account
  -> Home Spaces
       -> access_mode: sync-code | account-managed | password-protected
       -> sync_space_id: 底层密文首页文档
       -> home_space_credentials: 账号托管访问凭证
```

和 Phase 1.5 的区别：

- Phase 1.5：
  - 账号只保存首页空间索引。
  - 当前浏览器必须持有完整同步码才能激活空间。
- Phase 1.6：
  - `sync-code` 空间继续保持完整同步码访问模式。
  - `account-managed` 空间由账号托管访问凭证。
  - 空白设备登录账号后，未来可通过 RLS 读取本人的托管凭证并恢复首页。

安全边界：

- 账号托管凭证不是零知识模型。
- Supabase 数据库保存 `access_token` 和 `encryption_key`，通过账号身份和 RLS 限制只有本人可读。
- 首页文档仍保存在 `sync_spaces` 中，继续是密文，数据库不保存首页明文。
- 高隐私需求后续进入 `password-protected` 模式。

### 4. 其他改动

- 新增验证脚本 `007_account_managed_sync_verify.sql`。
- 更新 Supabase 迁移执行清单，明确 `006` 的执行顺序。
- 更新 Phase 1 路线图和账号托管同步 backlog。
- 不修改前端 UI、repository 或用户可见流程。
- 不改变现有 `create/pull/check/push/force_push/revoke` 同步码 RPC。

## Phase 1.6.0 验收标准

- `006_account_managed_sync_foundation.sql` 可在 Supabase SQL Editor 中执行成功。
- `007_account_managed_sync_verify.sql` 的只读检查结果符合预期。
- 现有 `home_spaces` 行默认被标记为 `sync-code`。
- `home_space_credentials` RLS 开启。
- `anon` 不能读取 `home_space_credentials`。
- `create_account_managed_home_space` 只允许 `authenticated` 执行。
- 现有同步码 RPC 仍允许 `anon` 和 `authenticated` 执行。
- 前端本地构建通过。

## Phase 1.6.1：账号托管空间创建

### 1. 用户侧体验

Phase 1.6.1 完成后，登录用户可以在设置页“首页空间”区域创建账号托管空间。

- 设置页新增“创建账号托管空间”表单。
- 用户输入空间名称后，可以把当前本地首页保存为一个 `account-managed` 空间。
- 创建成功后，该空间出现在账号首页空间列表中。
- 当前浏览器会自动绑定新空间，并继续复用现有同步引擎上传/拉取。
- 同步码面板对账号托管空间显示“账号托管，不显示完整同步码”，复制按钮不可用。
- 账号托管空间不能从同步码面板直接废弃，避免只废弃底层 `sync_spaces` 后留下失效的账号空间和托管凭证。
- 空间列表展示访问模式：`同步码`、`账号托管` 或未来的 `密码保护`。
- 非当前本机的 `account-managed` 空间暂不提供激活入口，显示“待恢复”；空白设备恢复进入 Phase 1.6.2。

本阶段不做：

- 不实现空白设备免同步码恢复。
- 不实现同步码空间迁移为账号托管空间。
- 不实现空间删除、重命名或多设备凭证管理。
- 不隐藏整个同步码面板。

### 2. 后端数据库结构

Phase 1.6.1 创建流程主要使用 Phase 1.6.0 的结构：

- `home_spaces.access_mode`
- `home_space_credentials`
- `create_account_managed_home_space(...)`
- `activate_home_space(...)`

创建账号托管空间时，前端调用 `create_account_managed_home_space(...)`，由数据库在同一事务中创建：

- `sync_spaces` 密文首页文档。
- `home_spaces`，且 `access_mode = 'account-managed'`。
- `home_space_credentials`，保存账号托管的 `access_token` 和 `encryption_key`。

随后前端调用已有 `activate_home_space(...)`，把新空间设置为当前账号默认空间。

本阶段追加 Supabase 热修复 `007_account_managed_credential_regex_fix.sql`：

- 修复 `006` 中 `home_space_credentials` 凭证约束和 `create_account_managed_home_space(...)` RPC 使用 `{32,512}` 正则范围导致的 PostgreSQL 运行时错误。
- 修复前的线上错误表现为：`invalid regular expression: invalid repetition count(s)`，错误码 `2201B`。
- 修复后改为 `char_length(...) between 32 and 512` 加 `^[A-Za-z0-9_-]+$` 字符集检查。
- 该脚本只替换约束和 RPC，不删除数据，不改变 RLS 和同步码 RPC。

### 3. 系统架构

前端数据层开始区分首页空间访问模式：

```ts
type HomeSpaceAccessMode =
  | "sync-code"
  | "account-managed"
  | "password-protected";
```

`HomeSpace` 增加 `accessMode` 字段。本机同步绑定 `StoredSyncBinding` 增加 `accessMode` 字段，用于区分当前浏览器持有的是用户可见同步码，还是账号托管凭证。

账号托管空间创建流程：

```text
当前 HomeDocumentV2
  -> 浏览器生成 accessToken / encryptionKey
  -> 浏览器加密首页文档
  -> create_account_managed_home_space RPC
  -> activate_home_space RPC
  -> 保存本机 StoredSyncBinding(accessMode = account-managed)
  -> 更新本地 syncMeta
```

底层同步仍复用现有 `sync_spaces` 和同步码 RPC。账号托管空间的差异在于：凭证由账号表托管，用户界面不展示完整同步码。

### 4. 其他改动

- `AccountRepository` 新增 `createAccountManagedHomeSpace(...)`。
- `useAccountData` 新增创建账号托管空间的状态和动作。
- 设置页 `HomeSpacesPanel` 新增创建表单和访问模式标签。
- `SyncPanel` 在当前绑定为 `account-managed` 时不显示完整同步码，并禁用同步码废弃入口。
- 更新 Phase 1 路线图和账号托管同步 backlog。

## Phase 1.6.1 验收标准

- 登录账号后，设置页可以创建账号托管空间。
- 创建成功后，Supabase 中出现：
  - `home_spaces.access_mode = 'account-managed'`
  - 对应的 `home_space_credentials` 行。
  - 对应的 `sync_spaces` 密文文档。
- 当前浏览器自动绑定新空间，设置页同步码面板显示账号托管状态。
- 账号托管空间不显示完整同步码，复制按钮不可用。
- 账号托管空间不能通过同步码面板废弃；空间删除和凭证撤销进入后续空间管理阶段。
- 现有 `sync-code` 空间认领和激活流程不回退。
- 未登录用户看不到创建账号托管空间入口。
- 线上 Supabase 已执行 `007_account_managed_credential_regex_fix.sql` 后，不再出现 `invalid repetition count(s)`。
- `008_account_managed_credential_regex_fix_verify.sql` 检查结果为 `ok`。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。

## Phase 1.6 后续拆分

| 子阶段 | 目标 | 主要交付 |
|---|---|---|
| Phase 1.6.1 | 账号托管空间创建 | 已接入 `create_account_managed_home_space`，登录用户可创建账号托管空间 |
| Phase 1.6.1a | 恢复默认同步保护 | 对已绑定同步码或账号托管空间，清空恢复默认前提示会影响当前同步空间，并在重置后提供上传默认、拉取云端、解除本机、恢复备份等选择 |
| Phase 1.6.2 | 空白设备账号恢复 | 登录后读取 `home_space_credentials` 并恢复账号托管空间 |
| Phase 1.6.3 | 同步码迁移为账号托管 | 当前同步码空间解密后迁移为账号托管空间，可选择废弃旧同步码 |
| Phase 1.6.4 | 首页空间 CRUD | 创建、重命名、删除和默认空间管理 |
| Phase 1.6.5 | 同步码入口降级 | 账号托管空间默认隐藏同步码，保留高级/恢复入口 |
| Phase 1.6.6 | 全局偏好编辑 | 语言、主题、字体、默认搜索引擎等偏好可编辑 |
| Phase 1.6.7 | Beta 质量补齐 | 空状态、错误状态、保存/同步状态和数据导出 |
| Phase 1.6.8 | 主域名准备 | 自购主域名、Auth redirect、`basePath` 和缓存隔离回归 |
