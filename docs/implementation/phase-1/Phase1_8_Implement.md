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

## Phase 1.8.1：Banner/背景图片 v1

Phase 1.8.1 已完成 Banner 和背景图片的 v1 能力。本阶段只面向首页个性化图片资产，不扩展为通用文件管理器，也不把图片二进制写入 `HomeDocumentV2`。

### 产品边界

- Banner 图片作用于首页顶部 `masthead`，仅在当前首页空间设置了 Banner 时启用带图样式。
- 背景图片作用于首页和设置页的页面底层，叠加主题色遮罩，保持文字和控件可读。
- 登录用户可上传图片到 Supabase Storage 的 private bucket：`home-assets`。
- 未登录用户不能上传 Storage，但可以保存 http/https 外链图片。
- 图片资源引用随 `HomeDocumentV2.theme` 保存和同步；Storage 文件本身不进入当前同步码的端到端加密文档。
- 本阶段不做裁剪器、图片库、通用文件缓存、端到端加密文件和 Storage 用量治理。

### 已落地能力

- 新增 Storage 迁移：
  - `supabase/migrations/012_home_assets_storage.sql`
  - `supabase/checks/013_home_assets_storage_verify.sql`
- `012` 会确保 `home-assets` bucket 为 private，限制单文件 5MB，并只允许 `image/jpeg`、`image/png`、`image/webp`、`image/gif`。
- `012` 会在 `storage.objects` 上创建 4 条 RLS policy，限制登录用户只能访问自己目录下的 `banner` 和 `background` 资源。
- 扩展 `HomeTheme`：
  - 保留旧字段 `bannerUrl`、`backgroundUrl`。
  - 新增 `bannerAsset`、`backgroundAsset`，支持 `external` 和 `storage` 两种来源。
  - 旧文档只有 URL 时会自动归一化为 `external` asset。
- 新增 `home-theme-asset` helper：
  - 校验图片类型和 5MB 大小限制。
  - 非 GIF 图片会尽量压缩为 WebP，并限制最长边 1600px。
  - 生成 `{user_id}/{banner|background}/{asset_id}.{ext}` Storage path。
- 新增 `HomeAssetStorageRepository`：
  - 上传图片。
  - 生成 private bucket signed URL。
  - 清除当前 Storage 图片。
  - 将 bucket、policy、大小等错误转为中文提示。
- 新增 `ThemeImagePanel`：
  - 设置页可上传 Banner/背景图片。
  - 可保存 Banner/背景外链 URL。
  - 可清除当前 Banner/背景。
  - 可分别调节 Banner 和背景图片遮罩强度，范围为 0-100。
  - 未登录时上传按钮禁用，外链仍可用。
- 扩展 `HomeThemeStyleBridge`：
  - 继续写入主题 token。
  - 为 `bannerAsset` 和 `backgroundAsset` 解析外链或 signed URL。
  - 将图片写入 `--home-banner-image` 和 `--home-background-image` CSS 变量。
  - 将 `bannerMaskOpacity` 和 `backgroundMaskOpacity` 写入 CSS 变量，调节后实时影响图片清晰度和文字可读性。
- 扩展 CSS：
  - 页面背景支持图片层、主题遮罩和原有主题背景。
  - 首页 masthead 在有 Banner 时启用紧凑 Banner 样式。
  - 设置页新增 Banner/背景图片面板和预览。

### 数据与同步

外链图片示例：

```json
{
  "bannerUrl": "https://example.com/banner.webp",
  "backgroundUrl": null,
  "bannerAsset": {
    "source": "external",
    "bucket": null,
    "path": null,
    "url": "https://example.com/banner.webp",
    "contentType": null,
    "width": null,
    "height": null,
    "updatedAt": "2026-06-22T00:00:00.000Z"
  },
  "backgroundAsset": null,
  "bannerMaskOpacity": 35,
  "backgroundMaskOpacity": 50
}
```

Storage 图片示例：

```json
{
  "bannerUrl": null,
  "backgroundUrl": null,
  "bannerAsset": {
    "source": "storage",
    "bucket": "home-assets",
    "path": "user_uuid/banner/asset_uuid.webp",
    "url": null,
    "contentType": "image/webp",
    "width": 1600,
    "height": 900,
    "updatedAt": "2026-06-22T00:00:00.000Z"
  },
  "backgroundAsset": null,
  "bannerMaskOpacity": 35,
  "backgroundMaskOpacity": 50
}
```

同步行为：

- 外链和 Storage 引用都会随完整 `HomeDocumentV2` 进入本地保存、同步码同步和账号托管同步。
- 遮罩强度属于当前首页空间的主题配置，不写入 `account_preferences`，也不需要新增 Supabase account migration。
- Storage private bucket 的图片显示依赖当前登录用户和 RLS；未登录设备即使拿到文档，也不会读取账号私有图片。
- signed URL 不长期写入首页文档，只在前端渲染时临时生成。

### 验收标准

- 设置页能看到 Banner/背景图片面板。
- 登录用户能上传 Banner 图片，首页顶部出现紧凑 Banner。
- 登录用户能上传背景图片，首页和设置页背景出现图片并保持内容可读。
- 未登录用户上传按钮禁用，但外链图片可保存。
- Banner 和背景图都可独立调节遮罩强度，调节结果随当前首页空间保存和同步。
- 清除 Banner/背景后，文档字段被清空，页面恢复无图状态。
- 旧文档的 `bannerUrl`、`backgroundUrl` 仍能正常导入和展示。
- 如果未执行 `012_home_assets_storage.sql`，上传失败时显示中文 policy/bucket 提示。

### 验证记录

- `npm run typecheck` 通过。
- `npm run lint` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。

## 后续衔接

Phase 1.8.2 应基于当前 token registry 和图片资产能力收口字体、密度、主题、背景在首页和设置页中的一致性，重点回归移动端、深色模式、组件区、状态提示、模板卡片和图片背景下的可读性。
