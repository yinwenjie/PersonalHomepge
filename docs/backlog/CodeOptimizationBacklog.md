# Code Optimization Backlog

代码 review 发现的优化点，按优先级排列。

## 优先级：高

### 1. `useSupabaseAuth` 多次订阅问题

**问题：**
`WidgetPanel`（`src/components/widget-panel.tsx:15`）和 `AccountPanel`（`src/components/account-panel.tsx:5`）各自独立调用 `useSupabaseAuth()`，在同一页面会触发两次 `onAuthStateChange` 订阅和两次 `getSession()` 调用，数据完全重复，存在资源浪费和潜在状态不同步风险。

**建议方案：**

- 在父组件（`HomeDashboard` 或 `SettingsDashboard`）层调用一次 `useSupabaseAuth`，将 `{ user, loading }` 作为 props 传入子组件；
- 或者用 React Context 把 auth 状态提升共享，避免多处重复订阅。

**影响：** 性能 + 潜在状态不同步。Phase 1.5.3+ 账号层功能扩展时，重复订阅问题会随功能增加而放大，建议尽早处理。

---

## 优先级：中

### 2. `SyncPanel visible={false}` 意图不清晰

**问题：**
`sync-panel.tsx:462` 的 `if (!visible) return null` 在所有 hooks 之后执行，所以当 `visible=false` 时（`HomeDashboard` 中的用法），整个组件仍然初始化了约 10 个 state、4 个 useEffect、多个 useCallback，只是不渲染 JSX。

这是有意为之——通过挂载组件但不渲染 UI 来保持自动同步 effect 运行。但代码没有注释或命名表达这个意图，未来维护者容易误删或误重构。

**建议方案：**

将自动同步逻辑提取成独立的 `useSyncEngine` hook，`SyncPanel` 只负责 UI 渲染，`HomeDashboard` 直接挂载 `useSyncEngine`。
这样 `visible=false` 时直接不渲染 `<SyncPanel>`，同步引擎仍正常运行，意图也更清晰。

**影响：** 可维护性。

---

### 3. `normalizeStoredSyncBinding` 的 round-trip 验证冗余

**问题：**
`src/domain/sync-code.ts:68-71` — `normalizeStoredSyncBinding` 先把字段 `String(value.spaceId ?? "")` 拼成参数，再调用 `formatSyncCode({...})` 生成字符串，再调用 `parseSyncCode(...)` 解析回来，仅为了复用验证逻辑。每次从 localStorage 恢复 binding 都走了一次完整的 format → parse 转换，存在不必要的中间 string 构造。

**建议方案：**

将 `assertValidSpaceId` 和 `assertValidSecret` export，在 `normalizeStoredSyncBinding` 中直接调用，去掉中间的 `formatSyncCode → parseSyncCode` round-trip。

**影响：** 轻微冗余，可读性。

---

## 优先级：低

### 4. `createId` 降级路径与 `randomBase64Url` 行为不一致

**问题：**
`src/domain/home-document.ts:241` — `createId` 在 `globalThis.crypto?.getRandomValues` 不可用时降级到 `Math.random()`。而 `src/domain/sync-code.ts:91` 的 `randomBase64Url` 在同样情况下直接 throw。

两者行为不一致：`createId` 的降级路径在非安全上下文会生成可预测的 ID，且不通知调用方。

**建议方案：**

让 `createId` 也 throw，或至少在降级路径加 `console.warn`。当前场景（浏览器 + GitHub Pages HTTPS）几乎不会命中降级路径，但一致性更好。

**影响：** 健壮性。

---

### 5. `window.confirm` / `window.alert` 散落各处

**问题：**
以下位置直接调用 `window.confirm` 或 `window.alert`：

- `src/hooks/use-home-document-editor.ts:97`（删除分组）
- `src/hooks/use-home-document-editor.ts:109`（删除网站）
- `src/hooks/use-home-document-controller.ts:97`（导入 JSON）
- `src/hooks/use-home-document-controller.ts:104`（重置默认）
- `src/components/sync-panel.tsx:391`（绑定同步码）
- `src/components/sync-panel.tsx:428`（解除本机）
- `src/components/sync-panel.tsx:448`（废弃同步码）

这些调用：① 在移动端体验较差；② 无法定制样式；③ 不易在测试中 mock。

**建议方案：**

Phase 1.6 之前可以接受，作为 backlog 项记录。后续用统一的内联确认组件（如自定义 `<ConfirmDialog>`）替换，消除直接的浏览器原生对话框依赖。

**影响：** 用户体验（尤其移动端）、可测试性。

---

### 6. `exportJson` 中的 DOM append 方式

**问题：**
`src/hooks/use-home-document-controller.ts:76-86` — 通过 `document.body.append(link); link.click(); link.remove()` 触发下载。现代浏览器已不要求将 `<a>` 元素插入 DOM 后才能触发 click，多余的 append/remove 增加了代码噪声。

**建议方案：**

```ts
// 简化为：
const link = document.createElement("a");
link.href = url;
link.download = `homepage-${new Date().toISOString().slice(0, 10)}.json`;
link.click();
URL.revokeObjectURL(url);
```

**影响：** 可读性，影响很小。
