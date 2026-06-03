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

---

# Phase 1.3.1 实施计划：同步码体验完善与稳定化

## Summary

Phase 1.3 已经完成同步码的最小可用链路：创建同步码、绑定同步码、手动上传、手动拉取、解除本机绑定、废弃同步码，并已验证不同浏览器之间可以同步首页内容。

Phase 1.3.1 的目标是把同步码从“手动可用”提升到“日常可靠可用”：增加自动拉取、编辑后自动上传、清晰同步状态和基础冲突处理。该阶段仍不做正式登录、不做支付、不做实时协同、不做字段级自动合并。

## Goals

- 页面启动后，如果当前浏览器已绑定同步码，自动从云端拉取一次。
- 浏览器窗口重新获得焦点时，如果已绑定同步码，自动检查云端更新。
- 本地编辑首页后，如果已绑定同步码，debounce 后自动上传。
- 保留手动 `上传` 和 `拉取`，作为用户可控兜底。
- 冲突时不静默覆盖数据，而是进入明确的冲突状态。
- 用户可以选择：
  - 使用云端版本覆盖本地。
  - 使用本地版本覆盖云端。
- 同步状态显示清楚，包括最后同步时间。
- 完成后部署到 `production` 并验证 GitHub Pages 线上可用。

## Non Goals

- 不做 Supabase Auth。
- 不做用户注册、登录、注销。
- 不做 Stripe 或会员支付。
- 不做字段级自动合并。
- 不做实时多人协作。
- 不做 Cloudflare Worker rate limit。
- 不做同步历史版本管理。

## Current State

当前已具备：

- `sync_spaces` Supabase 表。
- RLS 和受控 RPC：
  - `create_sync_space`
  - `pull_sync_space`
  - `push_sync_space`
  - `force_push_sync_space`
  - `revoke_sync_space`
- 前端模块：
  - `sync-code.ts`
  - `sync-crypto.ts`
  - `supabase-client.ts`
  - `sync-code-repository.ts`
  - `sync-binding-repository.ts`
  - `sync-panel.tsx`
- 当前 UI 支持：
  - 创建同步码。
  - 输入同步码绑定。
  - 手动上传。
  - 手动拉取。
  - 解除本机。
  - 废弃同步码。

## Key Decisions

- 自动同步必须以 `remoteRevision` 为边界，不能无条件覆盖云端。
- 本地每次编辑仍先保存到 `localStorage`，云端同步是第二步。
- 自动上传使用 debounce，避免每次点击都立即写云端。
- 自动拉取不应打断用户正在填写编辑表单。
- 冲突时停止自动上传，等待用户手动选择处理方式。
- 手动 `上传` / `拉取` 继续保留，便于用户理解和调试。

## Sync State Model

继续使用 `HomeSyncMeta`：

```ts
type SyncMode = "local" | "sync-code";

type SyncStatus =
  | "local-only"
  | "linked"
  | "syncing"
  | "synced"
  | "offline"
  | "conflict"
  | "error";
```

建议 UI 文案：

| status | UI 文案 |
|---|---|
| `local-only` | 仅本地 |
| `linked` | 已绑定 |
| `syncing` | 同步中 |
| `synced` | 已同步 |
| `offline` | 离线 |
| `conflict` | 有冲突 |
| `error` | 同步失败 |

## Local State Needed

除当前 `homepage:document:v2` 和 `homepage:sync-code:v1` 外，前端运行时需要维护：

- `lastSyncedDocumentRevision`
  - 含义：上次成功同步时，本地 `HomeDocumentV2.revision`。
  - 可存在内存中，也可以扩展到 `homepage:sync-code:v1`。
- `pendingLocalChanges`
  - 含义：本地 revision 大于上次成功同步 revision。
  - 可由 `document.revision` 和绑定信息推导。
- `syncInFlight`
  - 含义：当前是否正在同步，防止并发 push/pull。
- `lastAutoPullAt`
  - 含义：避免窗口频繁 focus 时连续拉取。

建议扩展 `StoredSyncBinding`：

```ts
interface StoredSyncBinding {
  version: 1;
  spaceId: string;
  accessToken: string;
  encryptionKey: string;
  remoteRevision: number;
  lastSyncedAt: string | null;
  lastSyncedDocumentRevision: number;
}
```

## Auto Pull Flow

触发时机：

- 页面加载并读取到本地同步码后。
- `window` 触发 `focus`。
- 页面可见时每 30 秒自动检查一次。
- 用户手动点击 `拉取`。

自动拉取条件：

- 已绑定同步码。
- 当前没有同步操作正在进行。
- 当前不处于 `conflict` 状态。
- 当前没有打开分组/网站编辑弹窗。
- 距离上次自动拉取超过 10 秒。

流程：

1. 设置状态为 `syncing`。
2. 调用 `pull_sync_space`。
3. 如果云端 revision 等于本地 `remoteRevision`：
   - 不替换首页。
   - 更新状态为 `synced`。
   - 更新 `lastSyncedAt`。
4. 如果云端 revision 大于本地 `remoteRevision`，且本地没有未上传修改：
   - 解密云端文档。
   - 用云端文档覆盖本地。
   - 更新 `remoteRevision`、`lastSyncedAt`、`lastSyncedDocumentRevision`。
5. 如果云端 revision 大于本地 `remoteRevision`，且本地也有未上传修改：
   - 不覆盖本地。
   - 进入 `conflict` 状态。
6. 网络错误：
   - 不覆盖本地。
   - 状态设为 `offline` 或 `error`。

## Auto Push Flow

触发时机：

- 用户通过编辑功能修改首页并保存。
- 用户手动点击 `上传`。

自动上传条件：

- 已绑定同步码。
- 当前没有同步操作正在进行。
- 当前不处于 `conflict` 状态。
- 本地存在未上传修改。
- 用户停止操作后 debounce 1.5-2 秒。

流程：

1. 本地编辑先保存到 `localStorage`。
2. debounce 触发自动上传。
3. 设置状态为 `syncing`。
4. 调用 `push_sync_space`，传入本地保存的 `remoteRevision` 作为 `baseRevision`。
5. 如果返回 `ok`：
   - 更新 `remoteRevision`。
   - 更新 `lastSyncedAt`。
   - 更新 `lastSyncedDocumentRevision = currentDocument.revision`。
   - 状态设为 `synced`。
6. 如果返回 `conflict`：
   - 不覆盖云端。
   - 不覆盖本地。
   - 更新本地已知的 `remoteRevision`。
   - 状态设为 `conflict`。
7. 网络错误：
   - 保留本地数据。
   - 状态设为 `offline` 或 `error`。
   - 下次 focus 或手动上传时可重试。

## Conflict Handling

冲突出现条件：

- 本地基于旧 `remoteRevision` 上传，但云端已经有更高 revision。
- 拉取时发现云端更新，同时本地也有未上传修改。

冲突 UI 显示：

- 明确提示：`云端和本地都有修改，需要选择保留哪一份。`
- 提供三个操作：
  - `使用云端版本`
  - `本地覆盖云端`
  - `暂不处理`

### 使用云端版本

流程：

1. 调用 `pull_sync_space`。
2. 解密并校验云端文档。
3. 用云端文档覆盖本地。
4. 更新 binding：
   - `remoteRevision = cloudRevision`
   - `lastSyncedAt = cloudUpdatedAt`
   - `lastSyncedDocumentRevision = pulledDocument.revision`
5. 状态设为 `synced`。

### 本地覆盖云端

流程：

1. 调用 `force_push_sync_space`。
2. 上传当前本地文档。
3. 成功后更新 binding：
   - `remoteRevision = newCloudRevision`
   - `lastSyncedAt = cloudUpdatedAt`
   - `lastSyncedDocumentRevision = currentDocument.revision`
4. 状态设为 `synced`。

### 暂不处理

流程：

- 保留本地文档。
- 保留 `conflict` 状态。
- 自动同步暂停，直到用户选择处理方式。

## UI Changes

### Header

当前顶部已有同步状态 pill。需要改为更易读的中文状态：

- 仅本地
- 已绑定
- 同步中
- 已同步
- 离线
- 有冲突
- 同步失败

### Sync Panel

同步面板增加：

- 最后同步时间。
- 自动同步状态提示。
- 冲突处理区域。
- 手动操作按钮：
  - 上传
  - 拉取
  - 使用云端版本
  - 本地覆盖云端

### Button State

- 同步中时禁用会造成并发写入的按钮。
- 未绑定同步码时禁用上传、拉取、复制、解除、废弃。
- 冲突状态下禁用自动上传。

## Implementation Changes

建议新增或调整：

- `src/components/sync-panel.tsx`
  - 增加自动 pull/push orchestration。
  - 增加冲突处理 UI。
- `src/domain/sync-code.ts`
  - 扩展 `StoredSyncBinding`。
  - 增加 binding normalize 兼容旧数据。
- `src/components/home-dashboard.tsx`
  - 在 `commitHomeDocument()` 后触发自动上传标记。
  - 把 editor 打开状态传给 SyncPanel，避免编辑中自动覆盖。
- `src/domain/home-document.ts`
  - 确认 syncMeta normalize 不丢失合法同步字段。

不需要改：

- Supabase 表结构。
- Supabase RPC。
- 加密协议。
- Next.js 部署结构。

## Test Plan

### Local Basic

- 未绑定同步码时，首页仍可本地编辑。
- 未绑定同步码时，不触发自动上传。
- 已绑定同步码后刷新页面仍显示已绑定状态。

### Auto Pull

- 浏览器 A 创建同步码。
- 浏览器 B 绑定同步码。
- 浏览器 A 修改并上传。
- 浏览器 B 刷新或重新 focus 后自动获得 A 的改动。

### Auto Push

- 浏览器 A 绑定同步码。
- 浏览器 A 修改首页。
- 停止操作 2 秒后，状态变为已同步。
- 浏览器 B 拉取后能看到 A 的修改。

### Conflict

- A 和 B 绑定同一个同步码。
- A、B 同时基于同一版本修改。
- A 自动上传成功。
- B 自动上传时进入冲突状态。
- B 选择 `使用云端版本` 后，本地变成 A 的版本。
- B 再次制造冲突后选择 `本地覆盖云端`，A 拉取后变成 B 的版本。

### Safety

- 自动拉取不能在编辑弹窗打开时覆盖表单上下文。
- 网络错误不清空本地数据。
- 解密失败不覆盖本地数据。
- 冲突状态下不继续自动上传。

### Production

- `npm run lint` 通过。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- 推送 `master`。
- 合入并推送 `production`。
- GitHub Pages 部署成功。
- 线上页面 bundle 能访问 Supabase public env。
- 线上同步码创建、绑定、上传、拉取可用。

## Acceptance Criteria

- 已绑定同步码的浏览器可以自动上传本地编辑。
- 已绑定同步码的浏览器可以在启动或 focus 后自动拉取云端更新。
- 冲突不会静默覆盖本地或云端数据。
- 用户可以手动选择云端版本或本地版本解决冲突。
- 手动上传和手动拉取继续可用。
- 未绑定同步码的用户体验不受影响。
- GitHub Pages 线上版本可用。

## Rollout Strategy

1. 本地实现并通过 lint/typecheck/build。
2. 本地两个浏览器验证创建、绑定、自动上传、自动拉取。
3. 手动制造冲突并验证处理。
4. 提交到 `master`。
5. 合并到 `production`。
6. 等 GitHub Pages workflow 完成。
7. 在线上重复最小同步验证。

如果线上发现自动同步误覆盖或状态异常，立即回滚到 `1e28ea7 feat: add sync code foundation` 或临时关闭自动同步，只保留手动上传/拉取。

---

# Phase 1.3.2 实施计划：首页网站收集区磁贴化与拖拽直编

## Summary

Phase 1.3.2 只优化前端展示和网站收集区编辑体验，不改 Supabase、同步码 RPC、数据表或登录能力。标题栏、右侧状态展示、组件列表保持当前位置和展示结构不变；重点把网站收集区做成可直接拖拽排序的磁贴区域。

本阶段同时为后续增强型组件预留扩展方向：组件应通过 `widgets` 数据、组件 registry 和独立渲染器接入，不把具体组件逻辑写死在首页主体中。

## Future Component Brainstorm

后续可能兼容的增强型组件包括：

- 时间与日程：万年历、月历、倒计时、节假日、习惯追踪、番茄钟。
- 任务与记录：Todo list、项目管理工具、日记本、备忘录、购物单、阅读清单。
- 数据看板：AI 额度看板、股票/基金、天气、RSS、比赛实时比分、站点状态监控。
- 效率入口：快捷命令、书签搜索、常用文件、最近访问、剪贴板片段。

组件扩展原则：

- 组件类型通过 registry 注册。
- 组件配置放在 `HomeWidget.config`。
- 首页主体只负责布局和调度，不直接写死组件业务逻辑。

## Key Changes

- 使用 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities` 实现拖拽排序。
- 分组标题区提供专用拖拽柄，可上下调整分组顺序。
- 网站磁贴提供专用拖拽柄，可在同组内排序，也可拖到其他分组。
- 搜索关键词非空时禁用拖拽，避免在过滤后的部分列表上保存不确定顺序。
- 拖拽完成后更新 `groups/sites.order`，调用现有保存逻辑，触发现有自动同步。
- 新增、编辑、删除、导入、导出、恢复默认仍保留在现有编辑模式。

## Implementation Notes

- 拖拽 ID 规则：
  - `group:{groupId}`
  - `site:{siteId}`
  - `group-drop:{groupId}`
- 分组拖拽只改变 `groups` 顺序，并按当前数组位置直接重写 `group.order`。
- 网站同组拖拽只改变该组 `sites` 顺序，并按当前数组位置直接重写 `site.order`。
- 网站跨组拖拽从原分组移除并插入目标分组，再按当前数组位置统一重写 `group.order` 和 `site.order`。
- 拖拽未改变位置时不保存、不增加 revision。
- 网站磁贴本体仍是链接，只有拖拽柄负责拖拽，避免误触打开链接。

## Debugging And Fixes

本阶段实现后，本地测试先后发现了三个拖拽问题，并逐项修复。

### 1. 分组拖拽松手后回到原位置

现象：

- 拖拽分组时动画存在。
- 鼠标松开后，分组仍回到原位置。
- 刷新页面后顺序也没有变化。

定位过程：

- `DndContext`、拖拽柄、拖拽动画均已生效，说明传感器和 `useSortable()` 基础链路可用。
- 问题集中在 `handleDragEnd()` 之后的数据提交。
- 原实现中，`arrayMove(groups, activeIndex, overIndex)` 已经生成了正确的新数组，但提交前又调用了 `renumberGroups()`。
- `renumberGroups()` 内部会先调用 `sortByOrder(groups)`，也就是按旧 `order` 排序；这一步把刚刚拖出来的新数组顺序重新还原。

修复方式：

- 分组拖拽提交时不再调用 `renumberGroups()`。
- 改为对 `arrayMove()` 的结果直接 `map()`，按照当前数组下标写入新的 `order`。
- 保持未移动时不提交，避免无意义增加 document revision。

### 2. 网站同组排序松手后回到原位置

现象：

- 拖拽网站磁贴时动画存在。
- 松开鼠标后网站回到原位置，或者顺序未按目标位置保存。

定位过程：

- 根因与分组排序一致。
- 同组网站排序中，`arrayMove(sourceGroup.sites, sourceIndex, targetIndex)` 已经得到正确顺序。
- 但提交前再次调用 `renumberSites()`，而 `renumberSites()` 内部会先按旧 `order` 排序，导致拖拽结果被旧顺序覆盖。

修复方式：

- 增加 `applyCurrentOrder(groups)`，按当前 `groups` 数组位置重写 `group.order`，按当前 `sites` 数组位置重写 `site.order`。
- 同组网站排序完成后直接提交 `applyCurrentOrder(groups)`。
- 这样拖到某个网站位置时，被拖网站会插入该位置，其余网站整体前移或后移。

### 3. 网站跨组拖动命中位置混乱

现象：

- 网站跨组拖动时，有时能移动成功，有时无法移动。
- 拖到分组空白区时，目标分组不稳定。
- 拖到网站收集区外时，可能仍然命中最近的目标元素并产生移动。

定位过程：

- 原 collision 策略为了提升命中率，在 `pointerWithin()` 没有命中时回退到 `closestCorners()`。
- 对网站拖拽来说，这个兜底会带来副作用：即使鼠标已经离开网站收集区，也可能因为几何距离最近而命中某个网站或分组。
- 跨组移动提交时也存在与同组排序相同的旧 `order` 覆盖问题。

修复方式：

- 网站拖拽只接受 `pointerWithin()` 实际压住的目标：
  - 压住网站磁贴：插入到该网站位置。
  - 压住分组投放区或分组区域：追加到该分组最后。
  - 未压住任何有效目标：返回空 collision，`over` 为空，视为无效操作，不保存。
- 跨组移动后统一调用 `applyCurrentOrder(groups)`，确保目标分组和目标位置按当前数组顺序保存。

## Test Plan

- 分组拖拽后刷新页面，顺序保持。
- 网站在同组内拖拽后刷新页面，顺序保持。
- 网站跨分组拖拽后刷新页面，所属分组和顺序保持。
- 搜索时拖拽不可用，清空搜索后恢复。
- 点击网站仍正常新标签打开。
- 编辑模式下原有新增、编辑、删除、导入导出、恢复默认继续可用。
- 绑定同步码后，拖拽排序能自动上传；另一浏览器能自动拉取新顺序。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。

## Assumptions

- 本阶段不改 `HomeDocumentV2` schema。
- 本阶段不实现真实增强型组件，只记录扩展方向。
- 拖拽排序是本阶段直接首页编辑的核心交付。
- 新增、编辑、删除仍通过现有编辑模式完成。

---

# Phase 1.3.3 实施计划：中性默认模板与新用户欢迎条

## Summary

Phase 1.3.3 解决新用户首次打开首页时看到“个人收藏页”的产品问题。目标是把默认首页从个人收藏数据改为中性效率模板，并在没有任何本地数据的新用户首次进入时展示轻量欢迎条，提供三个明确入口：

- 使用默认模板。
- 输入同步码恢复已有首页。
- 从空白开始。

本阶段仍然不改 Supabase 表结构、不改同步码协议、不引入登录系统。

## Product Goals

- 新用户第一眼看到的是产品化的通用首页，而不是某个个人用户的收藏。
- 已有用户的本地自定义数据不被默认模板覆盖。
- 换设备用户能快速发现同步码入口。
- 想完全自定义的用户可以从空白首页开始。

## Key Changes

- 删除默认数据中的个人化收藏，替换为中性通用效率模板。
- 新增首次进入欢迎条，只在以下条件同时满足时展示：
  - 当前浏览器没有 `homepage:document:v2`。
  - 当前浏览器没有旧版 `homepage:data:v1`。
  - 当前浏览器没有同步码绑定。
  - 当前浏览器没有完成过 onboarding。
- 欢迎条提供四个操作：
  - `使用模板`：保存当前中性默认模板到本地，并隐藏欢迎条。
  - `输入同步码`：进入编辑模式，展示同步码面板，引导用户输入同步码。
  - `空白开始`：保存空白首页文档到本地，并隐藏欢迎条。
  - `稍后`：仅隐藏欢迎条，不改当前默认模板。

## Default Template

默认模板改为中性通用分组：

- 搜索：Google、DuckDuckGo、Bing。
- AI：ChatGPT、Claude、Gemini、Perplexity。
- 开发：GitHub、Stack Overflow、MDN、npm。
- 学习：Wikipedia、Coursera、YouTube、Khan Academy。
- 效率：Notion、Google Calendar、Google Drive、Todoist。
- 阅读：Reuters、BBC、Hacker News、Medium。
- 生活：Google Maps、Amazon、Reddit。

默认模板只作为新用户起点，不会主动覆盖已有本地数据。

## Data And Storage

- 继续使用主文档 key：`homepage:document:v2`。
- 新增 onboarding key：`homepage:onboarding:v1`。
- 判断新用户时读取：
  - `homepage:document:v2`
  - `homepage:data:v1`
  - `homepage:sync-code:v1`
  - `homepage:onboarding:v1`
- `空白开始` 使用同一个 `HomeDocumentV2` schema，仅将 `groups` 和 `widgets` 置空。

## Safety Rules

- 不读取或写入 Supabase。
- 不影响已有 localStorage 首页文档。
- 不影响已有同步码绑定。
- 不把欢迎条状态写入远端文档；它是单浏览器本地 UI 状态。

## Test Plan

- 清空本地 `homepage:document:v2`、`homepage:data:v1`、`homepage:sync-code:v1`、`homepage:onboarding:v1` 后打开页面：
  - 看到中性默认模板。
  - 看到欢迎条。
  - 状态仍为仅本地。
- 点击 `使用模板`：
  - 欢迎条隐藏。
  - 刷新后不再显示欢迎条。
  - 默认模板保留。
- 点击 `输入同步码`：
  - 进入编辑模式。
  - 同步码面板可见。
  - 可输入同步码绑定。
- 点击 `空白开始`：
  - 网站收集区为空。
  - 刷新后仍为空。
  - 可通过编辑模式新增分组和网站。
- 已有本地首页数据的浏览器：
  - 不显示欢迎条。
  - 不被默认模板覆盖。
- 运行 `npm run lint`、`npm run typecheck`、`npm run build`。

## Assumptions

- 本阶段只处理新用户启动体验，不做完整模板库。
- 中性模板只是 MVP 起点，后续可在 Phase 1.4 之后扩展为多模板选择。
- 欢迎条采用轻量横幅，不做阻断式弹窗，保留首页打开即用体验。
