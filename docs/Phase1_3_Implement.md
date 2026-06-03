# Phase 1.3 实施计划：同步码跨设备同步

## Summary

在 Phase 1.2 的 Next.js 本地首页基础上，新增“同步码”能力，让用户不注册账号也能在不同电脑、不同浏览器之间同步同一份首页配置。同步码阶段仍不做正式会员登录、不接 Stripe、不开放复杂后台；目标是用最低成本验证“跨设备同步”是否是用户愿意持续使用和付费的核心价值。

本阶段的关键原则是：普通页面 URL 不具备编辑权，只有持有同步码的人可以读取和更新对应首页；云端只保存加密后的首页文档，首页明文仍由浏览器本地解密和渲染。

## Goals

- 用户可以基于当前本地首页创建一个同步空间。
- 系统生成一串同步码，用户复制到另一台设备后可以恢复同一份首页。
- 任一已绑定同步码的设备编辑首页后，可以上传到云端。
- 另一台设备刷新、重新聚焦窗口或手动点击同步后，可以拉取云端更新。
- 继续保留未同步状态：不创建同步码时，首页仍只保存在当前浏览器。
- 为后续 Supabase Auth 登录同步预留迁移路径。

## Non Goals

- 不实现正式注册、登录、注销、用户管理。
- 不实现会员支付、订阅、Stripe Customer 绑定。
- 不实现多人协作权限、分享只读链接、团队空间。
- 不实现复杂实时协同编辑；MVP 只做 revision 冲突检测。
- 不上传 Banner/背景图片文件；图片上传进入后续登录阶段。

## Key Decisions

- 云端平台使用 Supabase，优先使用 Postgres 表 + RPC 函数，前端通过 Supabase anon key 调用。
- 当前项目仍保持 static export，可以继续部署到 GitHub Pages。
- 前端不使用 Next.js API Routes，因为 GitHub Pages 无服务端运行时。
- 同步码同时包含：
  - `spaceId`：定位同步空间。
  - `accessToken`：调用云端读写接口时用于授权，会发送到 Supabase RPC。
  - `encryptionKey`：浏览器本地加密/解密首页文档，永远不上传。
- Supabase 数据库只保存 `accessToken` 的 hash，不保存明文 token。
- 首页文档使用 Web Crypto 在浏览器端加密后上传，云端不保存明文 `HomeDocumentV2`。
- 同步冲突先采用“提示用户选择本地或云端版本”，不做自动合并。

## Sync Code Format

同步码建议使用可读但不短的结构：

```text
hp1_<spaceId>_<accessToken>_<encryptionKey>
```

- `hp1`：格式版本，便于未来升级。
- `spaceId`：Supabase 返回的同步空间 UUID。
- `accessToken`：256-bit 随机值，Base64URL 编码。
- `encryptionKey`：256-bit 随机值，Base64URL 编码。

示例：

```text
hp1_Q9VnK..._mt55R..._vdYvR...
```

安全含义：

- 拿到同步码的人拥有该首页的读取和编辑权。
- 只拿到普通网页地址的人没有同步空间的读取和编辑权。
- 只泄露 `spaceId` 不应能读取或更新数据。
- 云端数据库泄露时，攻击者只能得到密文首页文档和 token hash，不能直接得到首页明文。

## Data Model

### Supabase Extension

需要启用 `pgcrypto`，用于生成 UUID、hash token 或计算 digest。

```sql
create extension if not exists pgcrypto;
```

### Table: sync_spaces

```sql
create table public.sync_spaces (
  id uuid primary key default gen_random_uuid(),
  access_token_hash text not null,
  document_ciphertext text not null,
  document_iv text not null,
  document_salt text not null,
  document_schema_version integer not null default 2,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_pulled_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
```

字段说明：

- `id`：同步空间 ID，对应同步码中的 `spaceId`。
- `access_token_hash`：`accessToken` 的不可逆 hash，用于授权校验。
- `document_ciphertext`：加密后的 `HomeDocumentV2` JSON。
- `document_iv`：AES-GCM 加密使用的 IV。
- `document_salt`：从 `encryptionKey` 派生加密 key 时使用的 salt。
- `document_schema_version`：当前首页文档版本，Phase 1.3 为 `2`。
- `revision`：云端版本号，每次成功 push 加 1。
- `expires_at`：可选，未来用于清理长期无人使用的匿名同步空间。
- `revoked_at`：同步码废弃时写入，废弃后不允许 pull/push。

### Optional Table: sync_events

MVP 可以先不建；如果需要排查同步问题或做基础审计，再新增。

```sql
create table public.sync_events (
  id bigint generated always as identity primary key,
  sync_space_id uuid not null references public.sync_spaces(id) on delete cascade,
  event_type text not null,
  client_id text,
  base_revision integer,
  next_revision integer,
  created_at timestamptz not null default now()
);
```

事件类型：

- `create`
- `pull`
- `push`
- `conflict`
- `revoke`

## Row Level Security

`sync_spaces` 必须开启 RLS，并禁止前端通过 table API 直接读写。

```sql
alter table public.sync_spaces enable row level security;
```

不要创建允许 anon 直接 `select`、`insert`、`update` 的宽松 policy。前端只通过受控 RPC 函数访问。

## RPC Functions

### create_sync_space

用途：创建同步空间。

输入：

```json
{
  "accessToken": "string",
  "documentCiphertext": "string",
  "documentIv": "string",
  "documentSalt": "string",
  "documentSchemaVersion": 2
}
```

输出：

```json
{
  "spaceId": "uuid",
  "revision": 1,
  "updatedAt": "ISO_DATE"
}
```

行为：

- 校验字段长度和格式。
- 保存 `accessToken` 的 hash。
- 保存密文、IV、salt 和 schema version。
- 初始 `revision = 1`。
- 不接收、不保存 `encryptionKey`。

### pull_sync_space

用途：拉取云端密文首页。

输入：

```json
{
  "spaceId": "uuid",
  "accessToken": "string"
}
```

输出：

```json
{
  "documentCiphertext": "string",
  "documentIv": "string",
  "documentSalt": "string",
  "documentSchemaVersion": 2,
  "revision": 3,
  "updatedAt": "ISO_DATE"
}
```

行为：

- 查找未废弃的同步空间。
- 校验 `accessToken` hash。
- 校验失败返回通用错误，不透露空间是否存在。
- 成功后更新 `last_pulled_at`。

### push_sync_space

用途：上传本地修改。

输入：

```json
{
  "spaceId": "uuid",
  "accessToken": "string",
  "baseRevision": 3,
  "documentCiphertext": "string",
  "documentIv": "string",
  "documentSalt": "string",
  "documentSchemaVersion": 2
}
```

输出：

```json
{
  "status": "ok",
  "revision": 4,
  "updatedAt": "ISO_DATE"
}
```

冲突输出：

```json
{
  "status": "conflict",
  "remoteRevision": 5,
  "updatedAt": "ISO_DATE"
}
```

行为：

- 校验 token。
- 如果 `baseRevision` 等于云端 `revision`，允许更新并把 revision 加 1。
- 如果 `baseRevision` 小于云端 `revision`，拒绝覆盖，返回 conflict。
- 如果 `baseRevision` 大于云端 `revision`，视为客户端状态异常，拒绝更新。

### revoke_sync_space

用途：废弃当前同步码。

输入：

```json
{
  "spaceId": "uuid",
  "accessToken": "string"
}
```

输出：

```json
{
  "status": "revoked"
}
```

行为：

- 校验 token。
- 写入 `revoked_at`。
- 废弃后 pull/push 都失败。
- 用户如果要继续同步，需要重新创建同步空间。

## Client Data Model Changes

### HomeSyncMeta

Phase 1.2 目前只有 local 状态。Phase 1.3 需要扩展：

```ts
export type SyncMode = "local" | "sync-code";
export type SyncStatus =
  | "local-only"
  | "linked"
  | "syncing"
  | "synced"
  | "offline"
  | "conflict"
  | "error";

export interface HomeSyncMeta {
  mode: SyncMode;
  status: SyncStatus;
  provider: "supabase" | null;
  spaceId: string | null;
  remoteRevision: number | null;
  lastSyncedAt: string | null;
}
```

### Local Storage Keys

继续保留：

```text
homepage:document:v2
```

新增：

```text
homepage:sync-code:v1
```

`homepage:sync-code:v1` 保存当前浏览器已绑定的同步码信息：

```json
{
  "version": 1,
  "spaceId": "uuid",
  "accessToken": "base64url",
  "encryptionKey": "base64url",
  "remoteRevision": 3,
  "lastSyncedAt": "ISO_DATE"
}
```

注意：这是本地浏览器数据。拿到这份 localStorage 的人等同拿到同步码，因此不把它当成服务端安全边界。

## Frontend Entry Points

### Header Status

在页面顶部或编辑工具条中增加同步状态：

- `仅本地`
- `已绑定同步码`
- `同步中`
- `已同步`
- `有冲突`
- `同步失败`

状态文字要轻，不要破坏首页极简体验。

### Sync Panel

编辑模式中新增“同步”区域，包含：

- 创建同步码。
- 输入同步码并绑定。
- 手动同步。
- 复制当前同步码。
- 解除本机绑定。
- 废弃当前同步码。

建议入口文案：

- `创建同步码`
- `输入同步码`
- `同步`
- `复制`
- `解除`
- `废弃`

### Create Sync Code Flow

1. 用户点击 `创建同步码`。
2. 前端生成 `accessToken`、`encryptionKey`。
3. 使用 `encryptionKey` 加密当前 `HomeDocumentV2`。
4. 调用 `create_sync_space`，上传 token、密文、IV、salt。
5. 云端返回 `spaceId` 和 `revision`。
6. 前端组装同步码并展示给用户复制。
7. 本地保存 `homepage:sync-code:v1`。
8. 更新 `homeDocument.syncMeta` 为 `sync-code / synced`。

### Bind Existing Sync Code Flow

1. 用户点击 `输入同步码`。
2. 前端解析同步码，校验版本和字段格式。
3. 调用 `pull_sync_space` 获取密文。
4. 使用同步码中的 `encryptionKey` 解密。
5. 用 `normalizeHomeDocument()` 校验解密后的文档。
6. 提示用户选择：
   - 使用云端首页覆盖本地。
   - 取消绑定。
7. 用户确认后保存到 `homepage:document:v2` 和 `homepage:sync-code:v1`。
8. 更新 UI 为已同步状态。

### Auto Push Flow

编辑首页后的保存流程变为：

1. 先保存到 `homepage:document:v2`。
2. 如果当前没有同步码，流程结束。
3. 如果已绑定同步码，debounce 1-2 秒后执行 push。
4. push 时使用本地记录的 `remoteRevision` 作为 `baseRevision`。
5. push 成功后更新本地 `remoteRevision` 和 `lastSyncedAt`。
6. push 冲突后进入 conflict 状态，不覆盖云端。
7. 网络失败时进入 offline/error 状态，下次手动或自动重试。

### Auto Pull Flow

触发时机：

- 页面启动后。
- 浏览器窗口重新获得焦点。
- 用户点击手动同步。

流程：

1. 如果没有同步码，跳过。
2. 调用 `pull_sync_space`。
3. 如果云端 `revision` 等于本地 `remoteRevision`，只更新时间，不改文档。
4. 如果云端 `revision` 大于本地 `remoteRevision`，尝试解密并校验文档。
5. 如果本地没有未上传修改，直接应用云端文档。
6. 如果本地有未上传修改，进入冲突处理。

## Conflict Handling

### Conflict Detection

本地需要维护两类 revision：

- `remoteRevision`：本地最后一次成功同步时的云端 revision。
- `localRevision`：`HomeDocumentV2.revision`，本地每次编辑加 1。

出现以下情况时认为有冲突：

- push 时 `baseRevision < cloudRevision`。
- pull 时云端 revision 更新了，同时本地自上次同步后也有修改。

### MVP Resolution UI

冲突提示只提供两个选择：

- `使用云端版本`：拉取云端文档覆盖本地，更新 `remoteRevision`。
- `使用本地版本`：以最新云端 revision 作为 base，再强制上传本地文档。

强制上传应调用单独的 `force_push_sync_space`，或在 `push_sync_space` 中显式传入 `force: true`。MVP 建议单独函数，避免误用。

### Deferred Merge

不做字段级合并，原因：

- 首页文档包含分组、网站、组件、主题，合并规则容易变复杂。
- 早期用户量小，双设备同时编辑概率较低。
- 清晰提示比隐式合并更安全。

## Encryption Design

### Algorithm

- 使用 Web Crypto API。
- 使用 AES-GCM 加密首页文档 JSON。
- 使用 PBKDF2 或 HKDF 从同步码里的 `encryptionKey` 派生 AES key。
- 每次上传生成新的 96-bit IV。
- `documentSalt` 可在创建同步空间时生成，后续保留；也可以每次上传更新。

### Encrypted Payload

明文：

```json
{
  "version": 2,
  "documentId": "home_xxx",
  "updatedAt": "ISO_DATE",
  "revision": 12,
  "groups": [],
  "widgets": [],
  "theme": {},
  "syncMeta": {},
  "billing": {}
}
```

密文保存：

```json
{
  "ciphertext": "base64url",
  "iv": "base64url",
  "salt": "base64url"
}
```

解密失败时：

- 不覆盖本地首页。
- 提示同步码无效或数据损坏。
- 记录为 `error` 状态。

## Security Requirements

- 同步码必须由浏览器 `crypto.getRandomValues()` 生成，不允许用户自定义。
- `accessToken` 不以明文保存到 Supabase。
- `encryptionKey` 不上传到 Supabase。
- `sync_spaces` 不允许 anon 直接 table 读写，只允许执行受控 RPC。
- RPC 校验失败时返回通用错误，避免枚举 `spaceId`。
- RPC 需要限制 payload 大小，防止上传超大 JSON。
- 前端导入、同步拉取后的文档必须经过 `normalizeHomeDocument()`。
- URL 仍只允许 `http://` 和 `https://`。
- React 仍然不使用 `dangerouslySetInnerHTML` 渲染用户输入。
- 外链继续使用 `target="_blank"` 和 `rel="noopener noreferrer"`。
- Supabase anon key 可以暴露；service role key 永远不能进入前端仓库。
- 后续接入 Auth 后，登录用户数据必须使用 RLS 和 `auth.uid()` 保护。

## Rate Limit And Abuse Control

MVP 可先依赖 Supabase 基础限流和合理的 RPC 校验，但正式公测前建议增加：

- `create_sync_space` 按 IP 或匿名 client id 限制创建频率。
- `pull_sync_space` 和 `push_sync_space` 对失败 token 校验做限速。
- 限制单个文档密文大小，例如 256 KB。
- 限制单个同步空间每日写入次数。
- 定期清理长期未访问且未登录绑定的匿名同步空间。

如果 Supabase RPC 难以满足 IP 级限流，后续可在 Supabase 前增加 Cloudflare Worker，把同步 API 包一层。

## Repository Structure Changes

建议新增：

```text
src/domain/sync-code.ts
src/infrastructure/sync-code-repository.ts
src/infrastructure/sync-crypto.ts
src/components/sync-panel.tsx
supabase/migrations/001_sync_spaces.sql
```

职责：

- `sync-code.ts`：同步码生成、解析、格式校验。
- `sync-code-repository.ts`：调用 Supabase RPC 的 repository。
- `sync-crypto.ts`：Web Crypto 加密、解密、Base64URL 转换。
- `sync-panel.tsx`：创建、输入、复制、解除、废弃同步码 UI。
- `001_sync_spaces.sql`：建表、RLS、RPC 函数。

## Implementation Sequence

1. 文档确认：完成本文件并确认同步码安全边界。
2. 类型扩展：扩展 `HomeSyncMeta`、新增同步码本地存储类型。
3. 加密模块：实现同步码生成、解析、AES-GCM 加密和解密。
4. Supabase 初始化：创建项目、配置 URL 和 anon key。
5. 数据库迁移：新增 `sync_spaces` 表、RLS、RPC 函数。
6. Repository：实现 `create`、`pull`、`push`、`revoke`。
7. 前端 UI：新增同步面板和状态显示。
8. 自动同步：接入编辑保存后的 debounce push、页面启动和 focus pull。
9. 冲突处理：实现云端覆盖本地、本地覆盖云端两个选择。
10. 部署配置：在 GitHub Actions 中配置 Supabase URL 和 anon key。
11. 回归测试：本地、线上、跨浏览器验证同步流程。

## Environment Variables

前端只允许使用 anon 级别配置：

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

禁止出现在前端和 GitHub Pages 构建产物中的值：

```text
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
SYNC_TOKEN_PEPPER
```

如果未来需要服务端 secret 或更强限流，应放到 Supabase Edge Function 或 Cloudflare Worker 中，不进入静态前端。

## Test Plan

### Local Only Regression

- 不创建同步码时，编辑首页后刷新仍保留。
- 清空 localStorage 后恢复默认首页。
- 导入、导出、恢复默认仍可用。

### Sync Creation

- 创建同步码后，云端出现一条 `sync_spaces` 记录。
- 数据库记录中看不到首页明文。
- 复制同步码后刷新页面，仍显示已绑定状态。

### Cross Browser Sync

- 浏览器 A 创建同步码。
- 浏览器 B 输入同步码，能拉取 A 的首页。
- 浏览器 B 新增网站并保存。
- 浏览器 A 刷新或重新聚焦后能看到新网站。

### Conflict

- 浏览器 A 和 B 同时基于同一 revision 修改。
- A 先上传成功。
- B 上传时进入冲突状态。
- B 选择云端版本后，本地被 A 的版本覆盖。
- B 选择本地版本后，云端被 B 的版本覆盖，A 再拉取能看到 B 的版本。

### Security

- 随机猜测 `spaceId` 不能拉取数据。
- 错误 `accessToken` 不能拉取或推送。
- 错误 `encryptionKey` 会导致解密失败且不覆盖本地。
- 直接调用 Supabase table API 不能读取 `sync_spaces`。
- 上传 `javascript:`、`data:` URL 的文档被本地 normalize 拒绝或清理。

## Acceptance Criteria

- 用户可以创建同步码，并在另一个浏览器恢复首页。
- 绑定同步码后，本地编辑可以同步到云端。
- 另一设备可以通过刷新、focus 或手动同步看到云端更新。
- 冲突不会静默覆盖用户数据。
- 云端数据库不保存首页明文和 encryption key。
- 普通线上页面地址不具备编辑或读取任何同步空间的能力。
- GitHub Pages 静态部署模式继续可用。

## Assumptions

- 同步码泄露等同于该同步空间泄露。
- 匿名同步空间是 MVP 过渡方案，不是最终账号权限系统。
- 本阶段只同步首页 JSON，不同步上传图片文件。
- 用户规模较小时，手动冲突解决足够。
- Supabase 免费额度足够支持早期验证；真正增长后再引入 Worker 限流、账号体系和付费策略。
