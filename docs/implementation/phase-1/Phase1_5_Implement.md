# Phase 1.5 实施记录：账号登录与首页空间管理

## Summary

Phase 1.5 已完成并发布。最终实现保持最初的产品边界：账号系统作为同步码首页空间的上级身份层，而不是用账号同步替代同步码。账号负责登录状态、首页空间索引、全局偏好和未来会员权益；首页内容继续由现有 `sync_spaces` 密文同步机制承载。

当前阶段已经完成 Supabase Auth、Resend SMTP、账号资料与偏好骨架、同步码认领、首页空间切换和安全回归。Phase 1.6 才引入账号托管凭证、空白设备免同步码恢复、空间 CRUD 和偏好编辑。

## 当前状态

| 子阶段 | 状态 | 主要产物 |
|---|---|---|
| Phase 1.5.0：账号模型与数据库计划 | 已完成 | `004_account_spaces.sql`、账号表模型、RLS 边界 |
| Phase 1.5.1：Auth 基础登录 | 已完成 | Supabase Auth session、Magic Link、登出、登录状态展示 |
| Phase 1.5.2：Resend Custom SMTP | 已完成 | Resend SMTP 配置和 Magic Link 发信回归 |
| Phase 1.5.3：账号资料与偏好骨架 | 已完成 | Auth Context、`profiles` / `account_preferences` 幂等初始化、只读偏好展示 |
| Phase 1.5.4：同步码认领 | 已完成 | `home_spaces` 列表、当前同步码认领、重复认领复用 |
| Phase 1.5.5：首页空间切换 | 已完成 | 账号空间激活、完整同步码校验、确认后拉取覆盖本地 |
| Phase 1.5.6：安全回归与收口 | 已完成 | `005_account_space_activation.sql`、`006_account_security_verify.sql`、默认空间原子激活 |

## 结论

- Phase 1.5 已满足“账号管理多个同步码首页空间”的 MVP 目标。
- 账号表和首页空间索引已经启用 RLS，并通过 SQL 检查脚本验证权限边界。
- 账号空间列表不保存 `accessToken`、`encryptionKey` 或完整同步码。
- 没有完整同步码的空白设备仍不能直接恢复 `sync-code` 空间内容。
- 下一步主线应进入 Phase 1.6：账号托管同步。

## Phase 1.5 总体决策

- 账号登录不与同步码互斥。
- 同步码是某个首页空间的访问凭证。
- 一个账号可以管理多个首页空间。
- 每个首页空间在 Phase 1.5 中先关联一个现有 `sync_spaces` 记录。
- 账号只保存空间索引和全局偏好，不保存同步码 secret。
- 首页内容继续通过现有同步码密文机制读取和写入。
- 新设备登录后能看到账号下的空间列表；如果本机没有对应同步绑定，需要重新输入完整同步码才能激活该空间。

## Phase 1.5.0 当时边界

- 不保存 `accessToken`、`encryptionKey` 或完整同步码。
- 不实现账号自动同步替代同步码。
- 不修改 `supabase-client.ts` 的 Auth 配置。
- 不改设置页账号占位 UI。
- Phase 1.5.0 本身不执行 SQL；后续子阶段已按迁移清单在 Supabase Dashboard 手动执行和验证。

## 数据模型

### profiles

用户基础资料表，绑定 Supabase Auth 用户。

- `id`: `auth.users.id`
- `email`: 用户邮箱，用于账号状态展示。
- `display_name`: 预留展示名。
- `created_at`
- `updated_at`

### account_preferences

账号级全局偏好表，用于保存跨首页空间共享的设置。

- `user_id`: `auth.users.id`
- `locale`: 默认 `zh-CN`
- `theme_preference`: 默认 `system`
- `default_space_id`: 默认首页空间，允许为空。
- `created_at`
- `updated_at`

### home_spaces

账号下的首页空间索引表。

- `id`: 首页空间索引 ID。
- `user_id`: 所属账号。
- `sync_space_id`: 对应现有 `sync_spaces.id`。
- `name`: 用户可识别的空间名称。
- `is_default`: 是否默认空间。
- `last_used_at`: 最近使用时间。
- `created_at`
- `updated_at`

约束：

- `(user_id, sync_space_id)` 唯一，避免重复认领同一个同步空间。
- `home_spaces` 不保存任何同步码 secret。
- `sync_space_id` 只用于建立账号空间索引，不直接授予读取首页内容的能力。

## RLS 安全边界

- `profiles`：用户只能 `select/insert/update` 自己的 `id = auth.uid()` 行。
- `account_preferences`：用户只能 `select/insert/update` 自己的 `user_id = auth.uid()` 行。
- `home_spaces`：用户只能 `select/insert/update/delete` 自己的 `user_id = auth.uid()` 行。
- `anon` 不授予账号表读写权限。
- `authenticated` 获得表权限，但所有访问都必须通过 RLS policy。
- 前端不得使用 service role key。

## 空间切换规则

- 用户在设置页选择某个首页空间时，必须先确认该操作可能拉取云端首页并覆盖当前本地显示。
- 如果当前浏览器已有该 `sync_space_id` 对应的本地 `StoredSyncBinding`，切换后复用现有同步码拉取流程。
- 如果当前浏览器没有对应本地绑定，页面要求用户输入完整同步码。
- 用户输入完整同步码并绑定成功后，才能激活该首页空间。
- 空间切换成功后，可更新 `account_preferences.default_space_id` 和 `home_spaces.last_used_at`。

## 子阶段实施记录

### Phase 1.5.1：Auth 基础登录

- 开启 Supabase Auth session 持久化。
- 支持邮箱 Magic Link。
- 支持登录状态展示。
- 支持登出。
- 验证 GitHub Pages 登录回调。
- 回归现有同步码 RPC。

实施记录：

- `supabase-client.ts` 开启 `persistSession`、`autoRefreshToken` 和 `detectSessionInUrl`。
- 新增 `useSupabaseAuth`，统一读取 session、监听 auth 状态变化、发送 Magic Link 和登出。
- 设置页账号区从静态占位改为邮箱 Magic Link 登录面板。
- 首页右侧状态区显示当前登录邮箱或 `Local` 状态。
- 本阶段不写 `profiles`、`account_preferences`、`home_spaces`，不认领同步码，不改变同步码 RPC。

### Phase 1.5.2：Resend Custom SMTP

- 配置 Resend 作为 Supabase Auth Custom SMTP，替代 Supabase 内置测试邮件通道。
- 完成发信域名验证，配置 SPF、DKIM 和必要的 DMARC 记录。
- 在 Supabase Dashboard 中填写 Resend SMTP Host、Port、Username、Password、Sender email 和 Sender name。
- 调整 Supabase Auth 邮件发送 rate limits，使本地测试和线上测试不再受内置邮件低额度限制。
- 回归 Magic Link 登录：
  - 本地 `http://localhost:3000/` 和 `http://127.0.0.1:3000/`。
  - 线上 `https://yinwenjie.github.io/PersonalHomepge/`。
  - 已登录 session 刷新保持。
  - 登出后重新发送 Magic Link。
- 本阶段不改前端账号表逻辑，不写 `profiles`、`account_preferences` 或 `home_spaces`。

验收：

- Magic Link 邮件由 Resend 发出。
- 连续测试不再触发 Supabase 内置 provider 的低额度限制。
- 邮件发件人、主题、链接跳转和登录状态均正常。
- Supabase Auth `auth.users` 和 `auth.sessions` 行为与 Phase 1.5.1 保持一致。

### Phase 1.5.3：账号资料与偏好骨架

- 使用已执行的 `004_account_spaces.sql` 中的 `profiles` 和 `account_preferences`。
- 登录后读取或初始化 `profiles` 和 `account_preferences`。
- 设置页展示语言、主题偏好、默认空间等状态。
- 本阶段采用只读骨架，不提供偏好编辑，不让偏好影响首页 UI。

实施记录：

- 新增全局 Supabase Auth Provider，让首页右侧状态区和设置页账号区共享同一份 auth session。
- `useSupabaseAuth` 改为读取 Auth Context，避免多个组件重复订阅 `onAuthStateChange` 和重复调用 `getSession()`。
- 新增账号资料与偏好数据层，登录后幂等读取或初始化 `profiles` 和 `account_preferences`。
- `profiles` 初始化只保存账号 `id` 和邮箱，不覆盖已有展示名。
- `account_preferences` 初始化只写 `user_id`，语言、主题和默认空间使用数据库默认值。
- 设置页账号区显示资料初始化状态；通用设置区显示只读语言、主题偏好和默认首页空间。
- 本阶段不写 `home_spaces`，不实现同步码认领，不保存 `accessToken`、`encryptionKey` 或完整同步码。

### Phase 1.5.4：同步码认领

- 登录后可将当前本机绑定的同步码认领为账号下的首页空间。
- 认领时填写或确认空间名称。
- 认领后设置页展示该空间。

实施记录：

- 账号数据层扩展读取 `home_spaces` 列表。
- 设置页新增“首页空间”面板，未登录、未绑定同步码、已认领和可认领状态分别展示。
- 同步码面板将当前本机绑定状态回传给设置页；用户创建、绑定、解除或废弃同步码后，首页空间面板同步更新。
- 认领时只写入 `user_id`、`sync_space_id` 和用户填写的空间名称。
- 重复认领同一个 `sync_space_id` 时复用已有 `home_spaces` 行，不创建重复记录。
- 本阶段不保存 `accessToken`、`encryptionKey` 或完整同步码，不实现首页空间切换。

### Phase 1.5.5：首页空间切换

- 设置页展示账号下空间列表。
- 用户选择空间后按空间切换规则激活。
- 切换后复用现有同步码拉取流程。

实施记录：

- 首页空间列表为非当前本机空间提供“激活”入口。
- 激活时要求用户输入完整同步码，并校验同步码中的 `spaceId` 必须匹配所选 `home_spaces.sync_space_id`。
- 激活前二次确认会覆盖当前浏览器本地首页。
- 激活成功后保存新的本机 `StoredSyncBinding`，拉取目标空间首页内容并替换当前本地首页。
- 激活成功后更新 `account_preferences.default_space_id` 和 `home_spaces.last_used_at`。
- 本阶段仍不保存 `accessToken`、`encryptionKey` 或完整同步码到账号表；没有同步码的空白设备直接恢复空间内容进入 Phase 1.6 账号托管同步。

### Phase 1.5.6：安全回归

- 验证 RLS 隔离。
- 验证账号空间列表不泄露同步码 secret。
- 验证登录前后同步码 RPC 正常。
- 验证空间切换不会静默覆盖本地首页。

实施记录：

- 新增 `005_account_space_activation.sql`，用 `activate_home_space(p_home_space_id uuid)` 将首页空间激活收束到数据库事务中。
- `activate_home_space` 只允许 `authenticated` 执行，并校验目标 `home_spaces.id` 必须属于 `auth.uid()`。
- 激活空间时原子更新 `home_spaces.is_default`、`home_spaces.last_used_at` 和 `account_preferences.default_space_id`，避免前端多次 table update 造成默认空间状态不一致。
- 收紧 `account_preferences` insert/update policy：`default_space_id` 为空或必须指向当前用户自己的 `home_spaces`。
- 新增 `006_account_security_verify.sql`，覆盖账号表 RLS、角色权限、敏感字段缺失、`sync_spaces` 直接表权限、`activate_home_space` RPC 权限和 A/B 用户隔离验证。
- 前端账号数据层改为调用 `activate_home_space` RPC；如果线上 SQL 未执行，空间激活会失败并显示错误，不会保存新绑定或覆盖本地首页。
- 本阶段不引入账号托管凭证，不改变同步码密文同步模型，不实现空白设备免同步码恢复。

## 安全验收

- 未登录用户不能读取 `profiles`、`account_preferences`、`home_spaces`。
- 用户 A 不能读取或修改用户 B 的账号资料、偏好或首页空间索引。
- `home_spaces` 表不包含 `accessToken`、`encryptionKey` 或完整同步码字段。
- 前端仍只使用公开 anon key。
- 现有同步码创建、绑定、上传、拉取、废弃不受账号表影响。

## Phase 1.6 衔接

- 账号托管凭证进入 Phase 1.6，不回补到 Phase 1.5。
- 空白设备登录后免同步码恢复进入 Phase 1.6。
- 同步码空间迁移为账号托管空间进入 Phase 1.6。
- 空间创建、重命名、删除和偏好编辑进入 Phase 1.6。
- 多设备凭证、多同步码、操作审计进入 Phase 1.7。

## Assumptions

- Supabase SQL 仍通过 Dashboard SQL Editor 手动执行和验证。
- Phase 1.5 保持 GitHub Pages static export 架构，不引入服务端 API。
- Phase 1.5 不接 Stripe、不实现 VIP 权益、不做团队共享。
