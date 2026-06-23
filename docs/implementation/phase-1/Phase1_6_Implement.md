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

## Phase 1.6.1a：恢复默认同步保护

### 1. 用户侧体验

Phase 1.6.1a 修复已绑定同步空间时恢复默认可能误覆盖云端的问题。

- 未绑定同步码或账号托管空间时，“清空内容并恢复默认”保持原有行为。
- 已绑定同步空间时，恢复默认确认文案明确说明：本次只重置本地，自动同步会暂停，不会立刻覆盖云端。
- 重置后同步面板显示“恢复默认后同步已暂停”提示。
- 暂停提示提供 4 个动作：
  - `上传默认`：把当前默认首页上传到当前同步空间。
  - `拉取云端`：用云端首页覆盖当前默认首页。
  - `解除本机`：清除本机同步绑定，保留云端空间。
  - `恢复备份`：恢复重置前自动保存的本地备份。
- 普通“恢复上一次重置前页面”按钮保留。

### 2. 后端数据库结构

本阶段不新增 Supabase 迁移，不修改表结构、RLS 或 RPC。

### 3. 系统架构

- `HomeSyncMeta.status` 新增 `paused`。
- `paused` 是客户端文档状态，保存在当前浏览器的首页 JSON 中。
- `SyncPanel` 在 `paused` 状态下跳过启动拉取、自动拉取和自动上传，只允许用户主动选择后续动作。
- 同步引擎继续复用现有 `pull / push / force_push / unbind` 流程。

### 4. 实施记录

- `useHomeDocumentController.resetDefault()` 支持传入重置后的 `syncMeta` 和定制确认/成功文案。
- `SettingsDashboard` 在检测到当前浏览器有同步绑定时，将恢复默认后的文档写入 `paused` 状态。
- `SyncPanel` 对 `paused` 绑定跳过启动拉取、焦点/定时拉取和自动上传。
- 暂停提示区提供 `上传默认`、`拉取云端`、`解除本机`、`恢复备份` 四个明确动作。
- 本阶段没有 Supabase SQL、RLS 或 RPC 变更。

## Phase 1.6.1a 验收标准

- 已绑定同步空间时恢复默认后，等待自动上传 debounce，云端 revision 不变化。
- 暂停状态刷新页面后仍保持暂停，不自动拉取或上传。
- `上传默认` 成功后状态恢复为 `synced`，云端 revision 增加。
- `拉取云端` 成功后状态恢复为 `synced`，本地首页被云端内容覆盖。
- `解除本机` 成功后回到本地模式，本地默认首页保留。
- `恢复备份` 成功后恢复重置前页面。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。

## Phase 1.6.2：空白设备账号恢复

### 1. 用户侧体验

Phase 1.6.2 让账号托管空间真正具备“换设备登录即可恢复”的能力。

- 空白设备或清空 localStorage 后，用户登录账号即可在设置页看到账号下的首页空间。
- `account-managed` 空间不再只显示“待恢复”，而是提供 `恢复` 按钮。
- 点击 `恢复` 后会明确确认：云端首页会覆盖当前浏览器本地首页。
- 恢复成功后：
  - 当前浏览器保存账号托管绑定。
  - 本地首页被云端账号托管空间覆盖。
  - 同步码面板显示账号托管状态，不显示完整同步码。
  - 首页空间列表将该空间标记为当前本机/已激活。
- 普通 `sync-code` 空间仍需要完整同步码激活，不做免同步码恢复。

### 2. 后端数据库结构

本阶段不新增 Supabase 迁移，不修改表结构、RLS 或 RPC。

- 复用 Phase 1.6.0 已创建的 `home_space_credentials`。
- 前端只读取当前登录用户自己的未撤销 `sync-space-v1` 凭证。
- `sync-code` 空间没有账号托管凭证，因此不会通过账号恢复暴露 secret。
- 跨账号隔离继续依赖 `home_space_credentials_select_own` RLS 和 `home_spaces` RLS。

### 3. 系统架构

- `AccountRepository.restoreAccountManagedHomeSpace(...)` 负责：
  - 校验目标空间属于当前用户。
  - 校验目标空间 `access_mode = 'account-managed'`。
  - 读取本人未撤销账号托管凭证。
  - 复用 `SyncCodeRepository.pull(...)` 拉取和解密云端首页。
  - 调用 `activate_home_space(...)` 更新默认空间和最近使用时间。
- `useAccountData` 新增账号托管恢复状态、错误和消息。
- `SettingsDashboard` 在恢复成功后保存 `StoredSyncBinding(accessMode = account-managed)`，并用云端文档覆盖本地首页。
- `HomeSpacesPanel` 对账号托管空间显示 `恢复` 操作；普通同步码空间继续显示完整同步码激活表单。

## Phase 1.6.2 验收标准

- 清空当前浏览器 localStorage 后，登录账号仍能看到账号下的 `account-managed` 空间。
- 点击账号托管空间 `恢复`，云端首页成功覆盖本地首页。
- 恢复后刷新页面，当前浏览器仍保持账号托管同步状态。
- 恢复后的自动拉取、自动上传和手动上传/拉取继续可用。
- 普通 `sync-code` 空间不出现免同步码恢复入口。
- 已撤销或缺失凭证的账号托管空间恢复失败，不覆盖本地首页。
- 用户 A 不能读取用户 B 的账号托管凭证。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。

## Phase 1.6.3：同步码迁移为账号托管

### 1. 用户侧体验

Phase 1.6.3 允许已登录用户把当前已认领的普通同步码空间迁移为账号托管空间。

- 仅当当前浏览器绑定普通 `sync-code`，且该同步空间已认领到账号时，显示 `迁移为账号托管`。
- 未认领的普通同步码空间仍先显示“认领当前首页空间”，不做一键认领并迁移。
- 迁移前提示：账号会保存托管恢复凭证；空白设备可登录账号恢复；旧同步码本阶段不会自动废弃。
- 迁移成功后当前本机绑定切换为 `account-managed`，同步码面板不再显示完整同步码。
- 当前状态为 `conflict` 或 `paused` 时禁止迁移，要求用户先处理冲突或暂停状态。

### 2. 后端数据库结构

新增 Supabase 迁移 `008_sync_code_to_account_managed.sql`：

- 新增 `migrate_sync_code_home_space_to_account_managed(p_home_space_id, p_access_token, p_encryption_key)` RPC。
- RPC 仅授予 `authenticated` 执行。
- RPC 校验目标 `home_spaces` 属于 `auth.uid()`。
- RPC 校验目标空间是 `sync-code` 或已是 `account-managed`。
- RPC 校验 `p_access_token` 能访问目标 `sync_spaces`，且目标未废弃、未过期。
- RPC 将 `home_spaces.access_mode` 更新为 `account-managed`，并写入或更新未撤销的 `home_space_credentials`。
- RPC 不修改 `sync_spaces` 密文，不保存首页明文，不废弃旧同步码。

新增验证脚本 `009_sync_code_to_account_managed_verify.sql`：

- 验证迁移 RPC 签名和执行权限。
- 验证 `sync_spaces` 仍不能直接表访问。
- 验证账号托管凭证与 `home_spaces` 所属关系一致。
- 提供可选 rollback 功能测试，用真实测试用户和同步码凭证验证迁移与跨账号隔离。

### 3. 系统架构

- `AccountRepository` 新增同步码迁移方法。
- 前端调用迁移 RPC 前先执行一次 `pull`，确认当前 access token 与 encryption key 可成功拉取并解密云端文档。
- 如果云端 revision 已变化，迁移会要求用户先拉取云端，避免迁移后无意覆盖远端更新。
- `useAccountData` 新增迁移状态、错误和成功消息。
- `HomeSpacesPanel` 只在当前已认领同步码空间上显示迁移入口。
- `SettingsDashboard` 迁移成功后更新本地 `StoredSyncBinding.accessMode = 'account-managed'`，并刷新同步面板。

## Phase 1.6.3 验收标准

- 普通同步码空间认领到账号后，可以迁移为账号托管。
- 迁移后 Supabase 中该 `home_spaces.access_mode = 'account-managed'`。
- 迁移后存在对应未撤销 `home_space_credentials`。
- 当前同步码面板切换为账号托管状态，不显示完整同步码。
- 清空本机 localStorage 后重新登录，可以通过 Phase 1.6.2 的 `恢复` 拉取该空间。
- 旧同步码仍可继续绑定和同步，这是本阶段预期行为。
- 错误 token、已废弃同步码、未认领空间、非本人空间、`paused` 或 `conflict` 状态迁移失败且不破坏本地首页。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。

## Phase 1.6.4：首页空间 CRUD

Phase 1.6.4 补齐账号下首页空间的基础管理能力，让空间列表从“只读索引 + 恢复/激活”升级为可维护的账号空间管理面板。

用户侧变化：

- 设置页“首页空间”列表支持 `设默认`、`重命名` 和 `从账号移除`。
- `设默认` 只更新账号默认空间，不拉取云端首页，也不覆盖当前浏览器本地首页。
- `重命名` 只更新账号空间名称，不影响同步码、账号托管凭证或首页内容。
- `从账号移除` 表示删除账号侧空间索引：
  - 普通 `sync-code` 空间从账号移除后，同步码本身和云端密文内容不删除。
  - 账号托管空间从账号移除后，对应 `home_space_credentials` 会随账号空间索引级联删除，空白设备不能再通过账号恢复该空间。
  - 从账号移除不废弃底层 `sync_spaces`，不做密钥轮换。
- 当前本机正在使用的账号托管空间不允许直接移除；用户需先解除本机或切换到其他空间，避免本地仍显示账号托管但账号侧凭证已删除。
- 当前本机正在使用的普通同步码空间允许从账号移除；本机同步码绑定保留，可以继续作为匿名同步码使用。

后端数据库：

- 新增迁移 `supabase/migrations/009_home_space_crud.sql`。
- 新增 `rename_home_space(p_home_space_id uuid, p_name text)` RPC。
- 新增 `set_default_home_space(p_home_space_id uuid)` RPC。
- 新增 `remove_home_space_from_account(p_home_space_id uuid)` RPC。
- 三个 RPC 均只授予 `authenticated` 执行，`anon/public` 不授权。
- RPC 内部均校验目标 `home_spaces` 属于 `auth.uid()`。
- `remove_home_space_from_account` 只删除 `home_spaces` 账号索引行：
  - `home_space_credentials` 通过现有 FK `on delete cascade` 删除。
  - `account_preferences.default_space_id` 通过现有 FK `on delete set null` 清空。
  - `sync_spaces` 不删除、不 revoke、不改密文。
- 新增检查脚本 `supabase/checks/010_home_space_crud_verify.sql`，验证 RPC 签名、执行权限、默认空间一致性、凭证唯一性和可选 A/B 回滚测试。

前端实现：

- `AccountRepository` 新增 `renameHomeSpace`、`setDefaultHomeSpace`、`removeHomeSpaceFromAccount`，统一通过 RPC 后重新读取 `preferences` 和 `homeSpaces`。
- `useAccountData` 新增重命名、设默认、从账号移除状态和错误消息。
- `HomeSpacesPanel` 为每个空间提供基础管理入口，并按当前空间、访问模式和进行中状态禁用危险操作。
- `SyncPanel` 行为不变；账号托管空间仍不能从同步码面板废弃。

## Phase 1.6.4 验收标准

- 登录用户可重命名自己的首页空间。
- 登录用户可把任意自己的首页空间设为默认，且默认标记和 `account_preferences.default_space_id` 保持一致。
- 登录用户可从账号移除非当前账号托管空间。
- 从账号移除普通同步码空间后，旧同步码仍可绑定、拉取、上传。
- 从账号移除账号托管空间后，账号空间列表不再显示该空间，空白设备不能再通过账号恢复它。
- 当前本机账号托管空间的 `从账号移除` 按钮禁用，并提示先解除本机或切换空间。
- 从账号移除默认空间后，默认空间设置被清空，不产生悬空默认标记。
- `sync_spaces` 不被删除、不被 revoke、不被改密文。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。

## Phase 1.6.4a：删除策略收口

Phase 1.6.4a 不改变数据库删除模型，也不新增“彻底删除同步空间”。本阶段只把 Phase 1.6.4 的删除语义固定为“从账号移除”，并补齐 UI 文案、禁用提示和验证脚本。

用户侧变化：

- 首页空间列表中的危险按钮统一显示为 `从账号移除`。
- 确认弹窗明确说明该操作只删除账号侧首页空间索引。
- 普通 `sync-code` 空间：
  - 从账号移除后，同步码本身和云端内容不删除。
  - 如果当前浏览器仍持有本机同步码绑定，可以继续作为普通同步码空间同步。
- `account-managed` 空间：
  - 从账号移除后，账号侧托管恢复凭证会删除。
  - 空白设备不能再通过账号恢复该空间。
  - 底层 `sync_spaces` 不删除、不废弃、不做密钥轮换。
- 当前本机正在使用的账号托管空间继续禁止从账号移除，并通过禁用按钮提示说明：需要先解除本机或切换到其他空间。
- 同步码面板不提供账号托管空间的废弃入口，账号侧移除仍在首页空间中执行“从账号移除”。

验证补充：

- 新增 `supabase/checks/011_home_space_removal_policy_verify.sql`。
- 验证 `remove_home_space_from_account(...)` 只授予 `authenticated`。
- 验证 removal RPC 源码不引用 `sync_spaces`、`revoked_at` 或密文字段。
- 验证 FK 行为仍为：
  - `home_spaces -> sync_spaces`: restrict / no action。
  - `account_preferences -> home_spaces`: set null。
  - `home_space_credentials -> home_spaces`: cascade。
- 提供可选回滚测试，验证从账号移除后事务内 `home_spaces` 消失、账号托管凭证消失，但底层 `sync_spaces` revision、updated_at、revoked_at 和密文不变。

## Phase 1.6.5：同步码入口降级

Phase 1.6.5 不改变同步码协议，也不新增数据库迁移。本阶段把登录用户的设置页主路径从“同步码”调整为“首页空间”，同步码保留为匿名同步、旧空间维护和高级恢复入口。

用户侧变化：

- 未登录用户仍优先看到 `同步码` 面板，可以创建、输入、拉取、上传、解除本机和废弃普通同步码。
- 已登录用户优先看到 `首页空间` 面板，可以创建账号托管空间、恢复账号托管空间、激活普通同步码空间、迁移为账号托管、重命名、设默认和从账号移除。
- 已登录用户的同步码面板改为 `离线同步码与恢复`，默认折叠同步码创建、绑定和旧空间维护操作。
- 当前浏览器绑定账号托管空间时，离线同步码面板不显示完整同步码，也不提供废弃入口；只保留同步状态、手动拉取/上传、解除本机和输入同步码恢复其他空间等必要能力。
- 当前浏览器绑定普通 `sync-code` 空间时，展开高级区域后仍可以复制同步码、拉取、上传、解除本机和废弃同步码。
- `paused` 和 `conflict` 状态不会被折叠隐藏；恢复默认后的暂停操作和冲突处理按钮始终可见。

系统实现：

- `SyncPanel` 新增 `presentation = "primary" | "advanced"` 展示模式。
- 组件仍保持挂载并继续负责本机 binding 读取、启动拉取、自动上传、自动 revision check、冲突处理和暂停处理。
- `SettingsDashboard` 在登录后把 `HomeSpacesPanel` 前置，把 `SyncPanel` 切换为 `advanced` 模式；未登录时保持同步码面板优先。
- 账号托管空间在离线同步码面板中隐藏完整凭证和废弃操作，避免把账号托管空间误理解为普通同步码空间。

本阶段不做：

- 不新增 Supabase SQL、RLS、RPC 或验证脚本。
- 不废弃已迁移空间的旧同步码。
- 不做多设备凭证、单设备撤销或密钥轮换。
- 不拆分 `SyncPanel` 的同步引擎；后续若需要更复杂的信息架构，再考虑抽出 `useSyncEngine`。

## Phase 1.6.5 验收标准

- 未登录访问设置页时，同步码面板仍是主入口，创建和绑定同步码可用。
- 已登录访问设置页时，首页空间显示在离线同步码区域之前。
- 已登录且当前本机为账号托管空间时，不显示完整同步码，不显示废弃同步码按钮。
- 已登录且当前本机为普通同步码空间时，展开高级区域后仍可复制、上传、拉取、解除本机和废弃同步码。
- 恢复默认后的 `paused` 状态仍显示 `上传默认`、`拉取云端`、`解除本机`、`恢复备份`。
- 同步冲突状态仍显示 `使用云端版本`、`本地覆盖云端`、`暂不处理`。
- 首页 `/` 中不可见的 `SyncPanel` 自动同步行为不回退。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。

## Phase 1.6.5a：同步码管理边界补强

Phase 1.6.5a 不改变同步码协议和数据库结构。本阶段补强“离线同步码与恢复”和“首页空间”的管理边界，避免用户把解除本机、废弃同步码、从账号移除和账号托管恢复凭证混为同一类操作。

用户侧变化：

- `离线同步码与恢复` 能识别当前本机绑定是否已经属于账号首页空间。
- 当前本机为普通 `sync-code` 且已认领到账号时，高级区域会提示：废弃同步码只会让底层同步码失效，不会自动从账号移除首页空间索引。
- 对已认领的普通同步码执行 `废弃同步码` 时，确认弹窗明确说明：
  - 所有设备都不能再用该同步码上传或拉取。
  - 账号首页空间索引不会自动移除。
  - 如果只是停止当前浏览器同步，应使用 `解除本机`。
- 对账号托管空间执行 `解除本机` 时，确认弹窗明确说明：只清除当前浏览器绑定，账号空间和托管恢复凭证仍保留，可之后从首页空间恢复。
- 在已登录高级区域输入同步码时，确认弹窗明确说明：只绑定当前浏览器，不会自动认领到账号，也不会迁移为账号托管。
- 账号托管空间继续不显示完整同步码，也不提供废弃底层同步空间入口。

系统实现：

- `SettingsDashboard` 将当前本机绑定对应的账号 `HomeSpace` 传入 `SyncPanel`。
- `SyncPanel` 根据 `currentAccountHomeSpace` 和 `accessMode` 生成边界提示和确认文案。
- 本阶段只做前端状态上下文和 UX 文案补强，不新增 Supabase SQL、RPC 或 RLS policy。

## Phase 1.6.5a 验收标准

- 未登录普通同步码创建、绑定、上传、拉取、解除本机、废弃流程不回退。
- 已登录但当前同步码未认领时，高级区域提示输入同步码不会自动认领或迁移。
- 已登录且当前同步码已认领时，废弃同步码前出现账号空间索引不会自动移除的警告。
- 已登录且当前为账号托管空间时，不显示完整同步码，不显示废弃同步码按钮，解除本机确认说明账号空间仍保留。
- `从账号移除` 仍只在首页空间中执行，语义保持不删除、不废弃底层 `sync_spaces`。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。

## Phase 1.6.6：全局偏好编辑

Phase 1.6.6 将设置页“通用设置”从只读账号偏好骨架升级为可编辑表单，并让低风险偏好立即影响当前浏览器体验。

用户侧变化：

- 未登录用户也可以编辑通用偏好，偏好只保存在当前浏览器。
- 登录用户读取并保存账号级偏好，保存成功后镜像到本地缓存。
- 账号偏好加载失败时，首页继续使用本地偏好，不阻塞登录、同步码或首页空间功能。
- 支持编辑：
  - 语言：当前仅影响日期/时间格式，不做完整 UI 文案翻译。
  - 主题偏好：`system`、`light`、`dark`。
  - 字体：系统默认、衬线、等宽。
  - 界面密度：舒适、紧凑。
  - 默认搜索引擎：DuckDuckGo、Google、Bing、Yandex。
- 默认首页空间仍只读展示，由“首页空间”面板负责管理。

后端数据库：

- 新增迁移 `supabase/migrations/010_account_preferences_editing.sql`。
- `account_preferences` 新增：
  - `font_family text not null default 'system'`
  - `density text not null default 'comfortable'`
  - `default_search_engine text not null default 'duckduckgo'`
- 新增枚举型 check 约束，限制：
  - `locale`: `zh-CN | en-US`
  - `theme_preference`: `system | light | dark`
  - `font_family`: `system | serif | mono`
  - `density`: `comfortable | compact`
  - `default_search_engine`: `duckduckgo | google | bing | yandex`
- 迁移会先回填历史非法值，避免新增约束失败。
- 本阶段不修改 RLS、grants、`default_space_id` policy 或首页空间逻辑。
- 新增验证脚本 `supabase/checks/012_account_preferences_editing_verify.sql`。

系统实现：

- 新增 `UiPreferences` domain、固定枚举、默认值和搜索 URL builder。
- 新增本地偏好缓存 `homepage:ui-preferences:v1`。
- 新增全局 `UiPreferencesProvider`：
  - 启动时先读取本地缓存。
  - 登录后读取账号偏好并镜像到本地缓存。
  - 账号偏好失败时保留本地偏好。
  - 通过根节点 `data-theme`、`data-font-family`、`data-density` 和 `lang` 应用低风险 UI 偏好。
- `AccountRepository` 增加偏好读取兼容：
  - 优先读取新字段。
  - 如果前端先部署但 SQL 未执行，退回旧字段读取并用默认值补齐。
  - 保存新字段失败时提示先执行 `010_account_preferences_editing.sql`。
- 首页搜索使用当前默认搜索引擎，首页日期和同步状态时间使用当前 locale。
- 偏好不写入 `HomeDocumentV2`，不调用首页文档保存，不触发同步码上传。

## Phase 1.6.6 验收标准

- 未登录访问 `/edit` 时可保存本地偏好，刷新后仍生效。
- 未登录访问 `/` 时，主题、字体、密度、日期格式和默认搜索引擎按本地偏好生效。
- 登录后 `/edit` 读取账号偏好，保存后 Supabase `account_preferences` 更新。
- 登录后 `/` 使用账号偏好；登出后继续使用已镜像的本地偏好。
- 未执行 `010` 时，账号登录和同步码功能继续可用，偏好保存给出明确错误。
- `supabase/checks/012_account_preferences_editing_verify.sql` 检查新增列、默认值、约束、RLS 和权限。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。

## Phase 1.6.7：Beta 状态统一

Phase 1.6.7 不新增数据库迁移、不改变同步协议。本阶段把设置页中分散的加载、保存、同步、错误和禁用状态统一成更一致的 Beta 期状态表达。

用户侧变化：

- 设置页顶部新增状态总览，集中展示：
  - 当前账号状态。
  - 当前同步模式：本地模式、普通同步码、账号托管。
  - 当前本地首页状态：本地读取中、默认首页、本地已保存。
- 当存在同步冲突或恢复默认后的暂停状态时，总览会优先提示待处理事项。
- 账号、首页空间、同步码、配置文件和通用设置面板统一使用状态提示组件区分普通信息、成功、警告和错误。
- 关键禁用按钮补充 `title` 原因，包括：
  - 清空内容并恢复默认。
  - 同步码创建、拉取、上传、绑定、废弃。
  - 首页空间创建、恢复、激活、迁移、重命名、设默认、从账号移除。
  - 偏好保存。
- `paused` 和 `conflict` 状态继续保留原有操作入口，不因离线同步码区域折叠而隐藏。

系统实现：

- 新增 `StatusMessage` 组件，统一面板内状态提示的语义、样式和 ARIA role。
- 新增 `.status-message-*`、`.settings-status-summary` 等全局样式，复用现有色彩变量并补充 success/warning 变量。
- `SettingsDashboard` 根据账号、同步、本地存储和当前首页空间派生只读总览状态。
- `SyncPanel`、`HomeSpacesPanel`、`AccountPanel`、`AccountPreferencesPanel` 的主要状态提示改为使用统一组件。
- 本阶段不新增 Supabase SQL，不读取或导出账号托管 secret，不改变 `HomeDocumentV2` schema。

## Phase 1.6.7 验收标准

- 未登录访问 `/edit`：顶部总览显示本地模式，同步码入口仍可创建/绑定。
- 登录访问 `/edit`：顶部总览能区分普通同步码、账号托管和未绑定状态。
- 恢复默认后的 `paused` 状态：顶部总览和同步面板均提示同步已暂停，四个后续动作仍可用。
- 同步冲突状态：顶部总览提示冲突待处理，同步面板仍显示保留云端/本地的选择。
- 当前本机账号托管空间的“从账号移除”仍禁用，禁用原因只通过按钮提示表达，不新增重复可见文案。
- 账号资料或偏好加载失败时，错误状态统一显示，但不阻塞本地首页和同步码功能。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。

## Phase 1.6.7b：数据导出 v1

Phase 1.6.7b 属于低频高级操作，不放入普通“配置文件”区域。本阶段已在设置页新增独立 `高级操作` 面板，用于承载数据导出和后续类似的诊断/备份能力。

用户侧变化：

- `配置文件` 面板继续保留当前本地首页的 `导出 JSON`、`导入 JSON`、恢复备份和恢复默认。
- 新增 `高级操作` 面板，提供 `导出数据包`。
- `导出数据包` 导出当前本地首页、账号资料摘要、账号偏好、首页空间索引和必要诊断信息。
- 面板文案明确说明：导出文件不包含完整同步码、账号托管 `access_token`、`encryption_key` 或 Supabase session。
- 当前不提供“导入数据包”入口，避免把诊断/备份包误作为恢复协议。

系统边界：

- 不新增 Supabase SQL、RLS、RPC 或同步协议。
- 不读取 `home_space_credentials`，不导出账号托管凭证。
- 导出结构使用固定 schema `homepage-data-export-v1`，后续只追加字段，不改变既有语义。
- 新增 `src/domain/data-export.ts`，集中生成导出数据包和下载 JSON。
- 导出构建层只输出本机同步绑定摘要，不输出 `accessToken`、`encryptionKey`、完整同步码或 session。
- 导出构建层包含禁止字段检查，若导出对象中出现 `accessToken`、`encryptionKey`、`access_token`、`encryption_key`、`session` 等 key，会直接中止导出。

## Phase 1.6.7b 验收标准

- 未登录用户可在 `高级操作` 中导出数据包。
- 登录用户导出的数据包包含账号资料摘要、账号偏好和首页空间索引。
- 数据包包含当前本地首页 `HomeDocumentV2` 和当前同步绑定安全摘要。
- 数据包不包含完整同步码、`accessToken`、`encryptionKey`、账号托管凭证或 Supabase session。
- 原 `配置文件` 面板的 `导出 JSON` / `导入 JSON` 行为不变。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。

## Phase 1.6.8：模板库 v1

Phase 1.6.8 将空白启动和新建空间从“自己从 0 搭首页”升级为“选择接近场景的首页模板”。本阶段不新增数据库迁移、不新增 Supabase 表、不改变同步码协议；模板作为前端静态配置，应用后生成普通 `HomeDocumentV2`。

用户侧变化：

- 首页首次启动时展示模板库，用户可从 `空白首页`、`极简起步`、`通用效率`、`工作办公`、`开发者工作台`、`学习研究` 中选择起点。
- 首页首次启动仍保留 `输入同步码` 和 `稍后`，避免阻断已有同步码用户。
- 设置页 `首页空间` 面板支持从模板创建账号托管空间。
- 设置页仍保留 `用当前首页创建`，兼容已有首页继续创建账号托管空间的路径。
- 从模板创建账号托管空间成功后，当前浏览器保存新账号托管凭证，并切换到模板生成的新首页。
- 从模板创建账号托管空间前有二次确认，说明会创建新空间、切换当前浏览器并替换当前本地首页，但不会删除已有空间或底层同步空间。
- 本地或预览环境未配置 Supabase 环境变量时，设置页进入账号与云端同步未配置状态，禁用登录和远端同步操作，但本地首页、模板、导入导出继续可用。

模板内容：

- `空白首页`：不预设网站，面向想完全自定义的用户。
- `极简起步`：Google、YouTube、Wikipedia、ChatGPT、Gmail、Google Drive、Google Calendar、Notion 等少量通用入口。
- `通用效率`：搜索与 AI、社交与社区、工作效率、购物与生活。
- `工作办公`：邮件日历、文档云盘、协作沟通、项目管理、职业与业务。
- `开发者工作台`：代码协作、问答学习、包与文档、云与部署。
- `学习研究`：通用知识、在线课程、学术研究、阅读与笔记。

系统边界：

- 新增 `src/domain/home-template.ts`，集中定义模板 registry、模板摘要和 `createHomeDocumentFromTemplate(...)`。
- 新增 `src/components/template-library-panel.tsx`，复用模板卡片网格。
- 生成模板文档时，每次都生成新的 `documentId`、group id 和 site id，避免复用静态 id。
- 模板应用后写入普通 `HomeDocumentV2`，`revision` 从 0 开始，`syncMeta` 初始为本地；账号托管创建成功后再写入当前绑定信息。
- 模板 v1 不做收藏、不做后端配置、不做地区化推荐；所有模板暂时使用全球通用高知名度网站。
- Supabase browser client 提供配置检测和中文配置错误；Auth Provider、账号面板和同步码面板在缺少 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 时统一降级，不再暴露 `Missing Supabase environment variables`。

## Phase 1.6.8 验收标准

- 空白浏览器首次打开首页时显示 6 个模板入口。
- 选择任一模板后，本地首页生成对应分组和网站，刷新后保留。
- 选择 `空白首页` 后生成空白起点，并进入设置页继续整理。
- 点击 `输入同步码` 仍进入设置页同步码恢复路径。
- 登录用户可在 `首页空间` 面板从任一模板创建账号托管空间。
- 模板创建账号托管空间成功后，当前浏览器切换到新空间，且同步面板显示账号托管状态。
- `用当前首页创建` 账号托管空间路径仍可用。
- 缺少 Supabase 环境变量时设置页不显示英文裸错误，账号登录和需要云端的同步码操作被禁用，并提示仍可继续使用本地首页。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。

## Phase 1.6 当前收口状态

截至 Phase 1.6.8，账号托管同步主链路已经形成，并已补齐账号级通用偏好编辑、Beta 状态统一、安全数据导出和模板库冷启动能力：

- 登录用户可以创建账号托管空间，并在空白设备登录后恢复。
- 已认领普通同步码空间可以迁移为账号托管，旧同步码仍保留有效。
- 首页空间支持重命名、设默认和从账号移除。
- 删除策略已固定为账号侧移除，不删除或废弃底层 `sync_spaces`。
- 登录用户默认通过 `首页空间` 管理同步，普通同步码能力收起到 `离线同步码与恢复`。
- 同步码管理边界已补强，`解除本机`、`废弃同步码`、`从账号移除` 和账号托管凭证在 UI 文案和确认弹窗中明确区分。
- 全局偏好支持账号保存和未登录本地兜底，低风险展示偏好已在首页生效。
- 设置页已具备统一状态总览、统一状态提示组件和关键禁用按钮原因提示。
- 设置页 `高级操作` 已支持导出数据包，用于备份和排障，且不导出同步码 secret 或账号托管凭证。
- 模板库 v1 已接入首页首次启动和账号托管空间创建，模板应用后生成普通 `HomeDocumentV2`。
- Supabase 未配置环境下的设置页已补齐中文降级提示，本地能力不会被账号或云端同步配置缺失阻断。

Phase 1.6.6 新增了账号偏好字段迁移；Phase 1.6.7、1.6.7b 和 1.6.8 仅做前端状态、导出和模板生成能力收口。它们都没有改变同步码协议或首页文档 schema。Phase 1.6 到模板库 v1 收口，不再把浏览器收藏/标签导入作为 Phase 1.6.9 直接实现。

浏览器收藏/标签导入已从 Phase 1.6.9 移出，后续排到 Phase 1.9B 独立需求集重新设计；Phase 1.9A 先处理前端页面布局和 UI/UX 优化。导入需求暂不细化，调整原因：

- 普通网页不能直接读取浏览器收藏夹或当前打开标签页。
- 用户收藏可能有上千条，需要单独设计大批量导入、清洗、去重、分组、抽样预览、性能和回滚策略。
- 是否采用书签 HTML、粘贴 URL 列表、浏览器扩展或多方案组合，留到 Phase 1.9B 需求设计阶段决定。

原 Phase 1.9 正式推出前收口整体后移到 Phase 1.10；后续计划调整后，Phase 1.10 保留数据导入/恢复、操作审计、设备状态、账号删除、只读分享链接和密码保护空间评估，主域名准备进一步延期到 Phase 1.12。

关于“为空间生成新同步码”：该能力主要服务高级恢复、旧码补救或多同步码管理，对当前账号托管主路径的可用性提升有限，且会触及同步码生命周期、旧设备兼容和账号托管凭证边界。它已从 Phase 1.6 近期计划中移出，优先级降为 P4，阶段设为未定义。

## Phase 1.6 后续拆分

| 子阶段 | 优先级 | 状态 | 目标 | 主要交付 | 复杂度 | 风险 |
|---|---|---|---|---|---|---|
| Phase 1.6.1 | - | 已完成 | 账号托管空间创建 | 已接入 `create_account_managed_home_space`，登录用户可创建账号托管空间 | M | Medium |
| Phase 1.6.1a | - | 已完成 | 恢复默认同步保护 | 已新增 `paused` 同步状态，恢复默认后暂停自动同步并提供上传默认、拉取云端、解除本机、恢复备份等选择 | M | Medium |
| Phase 1.6.2 | - | 已完成 | 空白设备账号恢复 | 已支持登录后读取 `home_space_credentials` 并恢复账号托管空间 | M | Medium |
| Phase 1.6.3 | - | 已完成 | 同步码迁移为账号托管 | 已支持当前已认领同步码空间原地迁移为账号托管；旧同步码保留有效 | M | Medium |
| Phase 1.6.4 | - | 已完成 | 首页空间 CRUD | 已支持重命名、设默认和从账号移除；不删除底层 `sync_spaces` | M | Medium |
| Phase 1.6.4a | - | 已完成 | 删除策略收口 | 已统一“从账号移除”语义、禁用当前本机账号托管空间移除，并补充删除策略验证脚本 | S | Low |
| Phase 1.6.5 | - | 已完成 | 同步码入口降级 | 已将登录用户的同步码操作折叠到离线同步码与恢复区域，首页空间成为账号用户主入口 | S | Low |
| Phase 1.6.5a | - | 已完成 | 同步码管理边界补强 | 已补强解除本机、废弃同步码、输入同步码恢复与账号首页空间之间的边界提示 | S | Low |
| Phase 1.6.6 | - | 已完成 | 全局偏好编辑 | 已支持账号偏好编辑、未登录本地偏好兜底、主题/字体/密度/日期/默认搜索引擎生效 | M | Medium |
| Phase 1.6.7 | - | 已完成 | Beta 状态统一 | 已新增设置页状态总览、统一状态提示组件和关键禁用按钮原因提示 | S-M | Medium |
| Phase 1.6.7b | - | 已完成 | 数据导出 v1 | 设置页新增 `高级操作` 栏，提供账号空间索引、本地首页 JSON 和必要诊断信息导出；不导出账号托管 secret | S-M | Medium |
| Phase 1.6.8 | - | 已完成 | 模板库 v1 | 已支持空白浏览器首次启动和新建账号托管空间时从模板创建首页；模板应用后生成普通 `HomeDocumentV2`；Supabase 未配置时设置页中文降级 | M | Medium |
| Phase 1.9A | P1 | 待实现 | 前端页面布局和 UI/UX 优化 | 设置页信息架构、首页空间创建流程、Banner/背景面板和首页网站收集区编辑入口收口 | M-L | Medium |
| Phase 1.9B | P1 | 待设计 | 浏览器收藏/标签导入需求集 | 作为独立需求集重新设计；暂不细化具体导入方案 | L | High |
| Phase 1.10 | P2 | 待规划 | 正式推出前基础收口 | 数据导入/恢复、操作审计、设备状态、账号删除、只读分享链接和密码保护空间评估 | L | High |
| Phase 1.11 | P1 | 新增 | 组件设计和优化 | 复盘 Todo、月历、组件管理模式和模板默认组件，优化配置入口、视觉密度、移动端布局和后续组件候选 | M-L | Medium |
| Phase 1.12 | P2 | 延后 | 主域名准备 | 域名购买决策完成后，在正式推出前处理自购主域名、Auth redirect、`basePath` 和缓存隔离回归 | M | High |
| 未定义 | P4 | 降级候选 | 为空间生成新同步码 | 暂不进入近期计划；仅作为高级恢复/旧码补救方向保留 | L | High |
