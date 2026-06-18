# Phase 1.8 主题与普通个性化实施记录

## Phase 1.8 总体边界

Phase 1.8 的目标是让首页从固定视觉升级为可选择的个人工作台风格。本阶段继续优先复用 `HomeDocumentV2.theme`，主题随完整首页文档走本地保存、同步码同步和账号托管同步；不新增 Supabase SQL，不新增账号级主题表。

Phase 1.8 拆分为：

- Phase 1.8.0：主题风格切换。
- Phase 1.8.1：Banner/背景图片 v1。
- Phase 1.8.2：个性化细节收口。

## Phase 1.8.0：主题风格切换

Phase 1.8.0 已完成空间级主题 preset 切换。本阶段只实现主题风格，不接入图片上传、Storage、裁剪或背景图管理；Banner 和背景图片留到 Phase 1.8.1。

### 产品边界

- 主题风格属于当前首页空间，写入 `HomeDocumentV2.theme`。
- 账号通用设置中的 `system | light | dark` 仍是全局 UI 明暗偏好，不与空间主题 preset 混合。
- 主题变更走现有 `commitHomeDocument(...)`，因此会递增本地 revision、更新 `updatedAt`，并复用现有同步链路。
- 旧首页文档没有 `theme.presetId` 时，会根据已有 `accent` 推断 preset；无法推断时回落为 `classic`。

### 已落地能力

- 新增 `src/domain/theme-preset.ts`，集中定义主题 preset、浅色/深色 token 和 CSS 变量映射。
- 新增 6 个主题 preset：
  - `classic`：经典蓝，干净中性的默认体验。
  - `slate`：石墨灰，低干扰的办公风格。
  - `mint`：薄荷绿，清爽柔和的学习风格。
  - `indigo`：靛蓝，稳定克制的深度工作风格。
  - `sunrise`：晨光，温暖清晰的阅读风格。
  - `mono`：极简黑白，低色彩的内容优先风格。
- 扩展 `HomeTheme`：
  - 新增 `presetId`。
  - 保留 `accent`、`bannerUrl`、`backgroundUrl`，兼容模板 accent 和后续图片能力。
- 新增 `HomeThemeStyleBridge`：
  - 在首页和设置页读取当前 `HomeDocumentV2.theme`。
  - 根据账号全局明暗偏好选择 light/dark token。
  - 将当前主题 token 写入根级 CSS 变量。
  - 当用户选择“跟随系统”时，监听系统明暗模式变化并实时更新。
- 新增 `ThemePresetPanel`：
  - 设置页展示 6 个主题卡片。
  - 每张卡片包含主题预览、名称、说明和当前选中状态。
  - 点击主题后立即保存到当前首页文档。
- 模板创建首页时会根据模板 accent 推断合适 preset。

### 数据与同步

本阶段无新增数据库迁移。

主题数据继续保存在 `HomeDocumentV2.theme`：

```json
{
  "presetId": "classic",
  "accent": "#246bfe",
  "bannerUrl": null,
  "backgroundUrl": null
}
```

同步行为：

- 本地模式：保存到 `homepage:document:v2`。
- 同步码模式：随完整首页文档客户端加密后上传。
- 账号托管模式：随账号托管首页空间的完整首页文档同步。

### 验收标准

- 设置页能看到“主题风格”面板和 6 个主题 preset。
- 点击任一主题后，首页和设置页视觉会应用对应 CSS token。
- 主题切换会保存到 `HomeDocumentV2.theme.presetId` 和 `theme.accent`。
- 账号全局明暗偏好仍可控制 light/dark/system，不被主题 preset 覆盖。
- 旧文档只有 `accent` 时可以正常归一化，不破坏导入、同步和模板创建。
- 不新增 Supabase SQL，不引入图片上传能力。

### 验证记录

- `npm run typecheck` 通过。
- `npm run lint` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 本地 `/edit` 页面可打开，主题面板可见；用户已完成测试验证。

## 后续衔接

Phase 1.8.1 应在当前 `HomeDocumentV2.theme.bannerUrl` 和 `backgroundUrl` 基础上继续设计 Banner/背景图片能力。若涉及上传，应单独评估 Supabase Storage 或外链/本地引用策略，不应回填到 Phase 1.8.0。

Phase 1.8.2 应基于当前 token registry 收口字体、密度、主题、背景在首页和设置页中的一致性，重点回归移动端、深色模式、组件区、状态提示和模板卡片。
