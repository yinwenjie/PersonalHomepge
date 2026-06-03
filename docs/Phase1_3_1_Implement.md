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
