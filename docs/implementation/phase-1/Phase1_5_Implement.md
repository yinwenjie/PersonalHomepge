# Phase 1.5 实施计划：账号登录与首页空间管理

## Summary

Phase 1.5 的目标是把账号系统作为同步码首页空间的上级身份层，而不是用账号同步替代同步码。账号负责登录状态、首页空间索引、全局偏好和未来会员权益；首页内容继续由现有 `sync_spaces` 密文同步机制承载。

Phase 1.5.0 只固化账号模型和数据库安全计划，不实现登录 UI、不执行 Supabase SQL、不修改前端代码。

## Phase 1.5 总体决策

- 账号登录不与同步码互斥。
- 同步码是某个首页空间的访问凭证。
- 一个账号可以管理多个首页空间。
- 每个首页空间在 Phase 1.5 中先关联一个现有 `sync_spaces` 记录。
- 账号只保存空间索引和全局偏好，不保存同步码 secret。
- 首页内容继续通过现有同步码密文机制读取和写入。
- 新设备登录后能看到账号下的空间列表；如果本机没有对应同步绑定，需要重新输入完整同步码才能激活该空间。

## Phase 1.5.0 决策

- 不保存 `accessToken`、`encryptionKey` 或完整同步码。
- 不实现账号自动同步替代同步码。
- 不修改 `supabase-client.ts` 的 Auth 配置。
- 不改设置页账号占位 UI。
- 不执行 SQL；只提交迁移草案供后续在 Supabase Dashboard 手动执行。

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

## 后续阶段拆分

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

### Phase 1.5.5：首页空间切换

- 设置页展示账号下空间列表。
- 用户选择空间后按空间切换规则激活。
- 切换后复用现有同步码拉取流程。

### Phase 1.5.6：安全回归

- 验证 RLS 隔离。
- 验证账号空间列表不泄露同步码 secret。
- 验证登录前后同步码 RPC 正常。
- 验证空间切换不会静默覆盖本地首页。

## 安全验收

- 未登录用户不能读取 `profiles`、`account_preferences`、`home_spaces`。
- 用户 A 不能读取或修改用户 B 的账号资料、偏好或首页空间索引。
- `home_spaces` 表不包含 `accessToken`、`encryptionKey` 或完整同步码字段。
- 前端仍只使用公开 anon key。
- 现有同步码创建、绑定、上传、拉取、废弃不受账号表影响。

## Assumptions

- Phase 1.5.0 只保存计划和迁移草案。
- `004_account_spaces.sql` 需要用户后续手动复制到 Supabase Dashboard SQL Editor 执行。
- Phase 1.5.0 不改变当前线上行为。
- Phase 1.5.0 不接 Stripe、不实现 VIP 权益、不做团队共享。
