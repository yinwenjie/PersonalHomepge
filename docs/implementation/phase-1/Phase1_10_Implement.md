# Phase 1.10 Implementation Plan：正式推出前基础收口

## 阶段定位

Phase 1.10 用来补齐正式推出前的基础安全感：用户能恢复数据、能理解当前设备和同步状态，出问题时能看到最近关键操作；同时把账号删除、只读分享链接、密码保护空间这类高风险能力先固定为设计候选，不在本阶段贸然改动后端模型。

本阶段原则：

- 不改变 `HomeDocumentV2` 核心结构。
- 不新增 Supabase 表、RPC 或 Storage bucket。
- 数据恢复只恢复首页文档内容，不恢复登录 session、完整同步码、账号托管凭证或 Supabase secret。
- 操作审计和设备状态先走本地 `localStorage`，后续如果需要云端治理，再替换仓储实现。
- 同步请求优化只包裹现有同步动作，不改变端到端加密同步协议。

## 已落地能力

### Phase 1.10.1：数据导入/恢复 v1

设置页“高级操作 / 数据包”新增“导入/恢复数据包”。

行为：

- 支持读取 `homepage-data-export-v1` 数据包。
- 兼容直接导入 `HomeDocumentV2` JSON 和旧版 `HomeDocumentV1` JSON。
- 导入后先展示恢复预览：来源、分组数、网站数、组件数、主题、图片、导出时间和文档更新时间。
- 确认恢复前自动把当前首页保存为最近一次恢复前备份。
- 只写回首页文档内容；账号资料、首页空间索引、同步码摘要、诊断信息都不会写回。
- 如果当前浏览器已绑定同步空间，恢复后把同步状态设为 `paused`，避免恢复内容立刻自动覆盖云端。

关键文件：

- `src/domain/data-restore.ts`
- `src/hooks/use-home-document-controller.ts`
- `src/components/settings-dashboard.tsx`

### Phase 1.10.2：本地操作审计日志

新增本地审计仓储和设置页面板。

已记录事件包括：

- 数据包导出、恢复预览失败、确认恢复。
- JSON 导入、恢复默认、恢复重置前备份。
- 同步码创建、绑定、解除本机、废弃。
- 手动拉取、手动上传、强制覆盖和同步冲突。

边界：

- 审计日志只保存在当前浏览器。
- 日志写入失败不阻塞主操作。
- metadata 会屏蔽 `accessToken`、`encryptionKey`、`syncCode`、`session`、`refreshToken` 等敏感字段。

关键文件：

- `src/infrastructure/local-audit-log-repository.ts`
- `src/components/local-audit-log-panel.tsx`

### Phase 1.10.3：设备状态 v1

设置页“高级操作”新增“本机状态”面板。

展示内容：

- 本机短 ID。
- 登录状态。
- 当前同步方式。
- 当前首页空间或同步空间。
- 首页同步状态。
- 本地文档 revision。
- 文档更新时间。
- 当前浏览器最近在线时间。

边界：

- 当前只展示本机状态，不做跨设备列表。
- 设备 ID 只保存在当前浏览器，不写入账号或同步空间。

关键文件：

- `src/infrastructure/local-device-repository.ts`
- `src/components/device-status-panel.tsx`

### Phase 1.10.4：同步请求多标签协调

新增本地同步锁，减少多个标签页同时对同一个同步空间发起检查、拉取、上传和废弃请求。

行为：

- 使用 `localStorage` lock 作为来源事实，`BroadcastChannel` 仅作为状态提示增强。
- lock 按 `spaceId` 维度串行化，避免同一空间内的 check/pull/push 并发。
- lock 带 TTL，避免异常关闭标签页后永久锁死。
- 如果其他标签页正在同步，当前页显示“其他标签页正在同步这个首页空间，本次操作已跳过。”。

边界：

- 不改变 Supabase RPC。
- 不改变 revision 冲突处理。
- 不把跨标签协调扩展成跨设备锁；跨设备仍依赖现有 revision 检测。

关键文件：

- `src/infrastructure/sync-coordinator.ts`
- `src/components/sync-panel.tsx`

## 高风险候选设计

### Phase 1.10.5：账号删除与治理

本阶段只保留候选方案，不实现。

需要进一步设计：

- 删除账号时，`profiles`、`account_preferences`、`home_spaces`、账号托管凭证如何删除。
- 底层 `sync_spaces` 是否删除、废弃或保留，尤其普通同步码空间可能仍被其他设备使用。
- Supabase Auth 用户删除与应用数据删除的顺序。
- Storage 中 Banner/背景图片是否级联清理。
- 删除前确认流程、冷静期、导出提醒和不可恢复提示。

推荐后续原则：

- 先实现“从账号移除空间”的温和治理，不急着做硬删除全部数据。
- 真正账号删除需要单独 SQL/RPC、RLS 回归和手动测试清单。

### Phase 1.10.6：只读分享链接

本阶段只保留候选方案，不实现。

需要进一步设计：

- 分享 token 与编辑 secret 必须完全隔离。
- 分享页只能渲染只读快照，不能携带同步码、账号托管凭证或编辑入口。
- 支持撤销、过期、是否公开索引、是否包含组件状态。
- GitHub Pages 静态部署下的公开路由、缓存和 Supabase RLS 策略。

推荐后续原则：

- 优先设计分享快照，不直接暴露当前同步空间密文文档。
- 分享能力需要单独表或字段，不复用同步码 token。

### Phase 1.10.7：密码保护空间

本阶段只保留候选方案，不实现。

需要进一步设计：

- 使用用户密码派生加密 key 的 KDF 参数、salt、迭代成本和浏览器性能。
- 密码丢失后的不可恢复提示和备份策略。
- 与账号托管空间、普通同步码空间并存时的 UX。
- 空白设备恢复流程、密码输入频率和本地缓存策略。
- 是否需要新 `accessMode = "password-protected"` 的完整数据生命周期。

推荐后续原则：

- 不把账号密码、Magic Link 登录和首页空间密码混为一谈。
- 密码保护空间是加密模型升级，应单独阶段实现并做安全 review。

## 验证计划

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- 手动回归：
  - 数据包导出后再导入，确认预览和恢复成功。
  - 已绑定同步空间时恢复数据包，确认同步状态进入暂停，不自动覆盖云端。
  - 设置页能显示本机状态和本地审计日志。
  - 多标签页同时触发同步时，第二个标签页能看到跳过提示。

