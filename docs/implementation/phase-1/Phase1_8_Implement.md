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

## 2026-10-10 图片加载与本地缓存优化

已实现刷新后图片缓存复用，解决 Storage signed URL 只在内存中缓存、刷新后重复签名下载，以及 Banner 和背景必须全部加载后才能显示的问题。

### 实际实现

- `home-asset-cache-repository.ts` 使用 IndexedDB `homepage:theme-images:v1` 保存 Blob，而不是保存不能跨刷新复用的 `blob:` URL。
- 缓存键包括 Supabase project URL、当前账号、来源、bucket、path/外链 URL 和资源 `updatedAt`。Storage 缓存仅允许当前账号访问其自身顶级目录；访客、其他账号和其他项目不能复用该私有图片。
- Storage 图片按资源版本复用，缓存命中无需重新签名或下载；外链缓存最多复用 24 小时，避免固定 URL 的外部图片长期不更新。
- 单图片最多 5MB，类型限定 JPG/PNG/WebP/GIF；总容量最多 50MB、20 项，按最近使用时间淘汰。下载过程中也限制缓存读取大小，过大外链回退直接显示。
- 图片上传成功后直接缓存已压缩文件，避免上传完成后立即再次下载。保留等待缓存写入完成（最多 1.5 秒）的行为，确保首次展示可命中缓存；缓存失败不会把已成功上传视为失败。
- `home-theme-image-loader.ts` 先查本地 Blob，命中后为当前页面创建 Object URL 并解码；缓存缺失才申请 signed URL、下载、解码和异步写缓存。解码失败会清理损坏缓存并重新下载。
- 外链允许 CORS 读取时参与 Blob 缓存；CORS 不允许、文件类型或大小不适合缓存时，回退直接图片 URL。没有使用 `no-cors` 获取不可读 Blob。外链 fetch 出现非超时 `TypeError`、但直接图片成功显示时，将可能的 CORS 限制记在内存和 `sessionStorage` 中，最多 20 项、有效期 10 分钟；同版本刷新跳过失败 fetch，版本变化或到期重新尝试。记录按项目、账号和图片版本隔离；sessionStorage 不可用时仅在当前页面记忆。
- IndexedDB 不存在、打开失败、阻塞、配额不足和事务失败均降级为网络加载，不影响首页数据保存。缓存操作最多等待 1.5 秒；可选的 Blob 下载和 Blob 解码各设 15 秒超时。Storage 与外链下载超时、读取失败或不适合缓存时均回退原始/签名图片 URL；直接网络图片预加载不设 15 秒截止，但仍可被空间/账号切换取消，避免慢网大图片持续无法显示。
- 图片 effect 仅依赖 Banner/背景配置内容及文档、空间、登录/恢复状态，不依赖整个主题。即使文档归一化重建图片对象，颜色和遮罩滑块变化也不会反复中止并重启加载。
- `home-theme-image-controller.ts` 分别加载 Banner/背景：一张图慢或失败不会阻塞另一张。同账号、同文档与空间内更换图片时保留旧图，直到新图就绪；失败时保留旧图供重试。
- 首页/设置页之间导航保留最多两张已显示图片及 Object URL，避免组件卸载时提前释放；保存的首页文档恢复完成前，不用临时默认文档清除现有图片。
- 切换文档/空间或账号时立即清除旧显示；清除图片时移除对应缓存；退出或切换账号时清理该账号的 Blob 和签名缓存。过期请求不能回写页面，也不能重新填充已经清除的账号或图片缓存。
- Blob 不进入首页 JSON、导出、同步文档或公开分享投影；公开分享继续不加载账号私有背景。没有新增 migration、调整 Storage RLS 或引入 Service Worker。

本地 Blob 是此前已授权下载的浏览器副本，命中时不会向服务器重新确认对象是否已删除；远端删除也无法即时收回此前下载的副本。清除图片配置、同步新的引用或退出账号时会停止显示。IndexedDB 与现有首页文档一样按网站 origin 隔离，Cloudflare 主域名和 GitHub Pages 的本地缓存不互通。

### 自动验证与人工验收

运行 `npm run verify:theme-images`。该脚本使用独立临时 Chrome/Chromium profile、本机回环服务、合成图片和模拟 Storage 接口，真实执行 IndexedDB、Blob 解码、CSS 更新和页面刷新，不连接真实 Supabase、不读取已有浏览器数据；退出后关闭测试浏览器并删除临时 profile。默认查找系统 Chrome/Chromium，可用 `CHROME_BIN` 指定路径。

覆盖冷/热缓存、真实刷新后的零签名/零图片下载、版本失效、并发下载去重、上传直接缓存、损坏缓存恢复、Storage 慢 body 超时/下载与读取失败/直接加载取消、CORS 回退及真实刷新后的失败 fetch 跳过、CORS 记忆版本隔离和到期重试、外链 Blob 24 小时过期、IndexedDB/配额失败降级、无 Content-Length 时的下载大小限制、条目及容量淘汰、账号/项目隔离、清除后迟到写入、Banner/背景独立显示、导航图片复用、切换空间与退出清理、过期响应和 Object URL 释放，以及实际 bridge effect 对归一化图片副本和颜色/遮罩变化的依赖稳定性。慢网用例只将生产 15 秒计时器加速至 30 毫秒，服务端立即返回 headers、150 毫秒后返回 body，真实执行 fetch body 中止与随后超过该预算的 Image 加载。

线上人工验收时：上传背景并等待首次显示，在 Network 中记录 Storage 签名及图片请求，刷新确认同版本图片不再传输；再验证更换/清除、两个首页空间、退出/切换账号，以及慢 Banner 不阻塞背景。将网络限速至 2Mbps，加载接近 5MB 的未缓存 Storage 图片，确认下载超过 15 秒后仍能经直接签名 URL 显示；在加载期间拖动遮罩滑块，确认不反复重启图片请求。首次访问、缓存被浏览器清理、资源版本更新或外链缓存过期仍需要下载；JavaScript 启动、登录态恢复与图片解码仍可能产生短暂显示延迟。登录态 `loading` 结束后才读图片缓存，token 过期时仍可能等待联网刷新，不保证首帧显示。

本次本地验证：`verify:theme-images` 的真实浏览器回归通过，忽略 HTTP 缓存刷新后同一私有图片产生零签名请求、零图片请求；慢网与 Storage 失败回退、CORS 记忆跨刷新复用、图片 effect 依赖回归通过；lint、typecheck、国际化、隐私、公开文档/分享和 Todo 回归通过；根路径与 `/PersonalHomepge` 子路径生产构建、静态导出及 Admin 隔离校验通过。

### 发布范围与流程

- 改动在 `fix/theme-image-cache-review` 整理，发布前整合最新 `origin/master`（基线 `8c555eb`，含 #36），保留上游全部 package scripts 与锁定依赖。
- 基础设施：新增 Blob 缓存、图片加载器、双图片显示控制器；Storage 上传/签名/删除接入缓存与账号隔离。
- 页面与认证：首页、设置页传入文档/空间恢复状态；图片 effect 按资产内容稳定依赖；清除图片及退出/切换账号时清理显示和缓存。
- 验证与文档：新增 `verify:theme-images` 隔离浏览器回归，补充缓存边界、慢网/CORS 降级、测试步骤与已知首帧延迟。
- 源码按 `master → production` 同步，沿用 `production` 推送触发 Cloudflare Pages 根路径构建及 GitHub Actions 的 GitHub Pages 子路径发布，再核对部署状态和线上首页、设置页、分享页与静态资源。
- 本次仅发布前端图片缓存优化，不执行 Supabase migration、checks 或 Edge Function 部署。真实账号的上传、刷新和慢网人工验收仍需在发布后执行，不能以静态访问检查替代。

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

## Phase 1.8.2：个性化细节收口

Phase 1.8.2 已完成主题、图片、字体、密度和响应式表现的收口。本阶段不新增用户可见的大功能，不新增 Supabase 表或迁移，重点是让 Phase 1.8.0 和 Phase 1.8.1 已有能力在不同主题、明暗模式、图片背景和窄屏下表现稳定。

### 产品边界

- 继续维持账号级偏好和空间级主题的分层：
  - 账号级偏好：语言、明暗模式、字体、密度、默认搜索引擎。
  - 空间级主题：主题 preset、accent、Banner、背景图和遮罩强度。
- 不新增账号级 Banner/背景默认值。
- 不新增 Storage 用量管理、裁剪器、图片库或高级背景能力。
- 不修改 `HomeDocumentV2` schema；只收口现有字段的视觉呈现和布局稳定性。

### 已落地能力

- 将 focus ring、拖拽目标色、浮层遮罩、浮层阴影和危险态边框收敛为 CSS token：
  - `--focus-ring`
  - `--drop-target-bg`
  - `--drop-target-outline`
  - `--modal-overlay`
  - `--modal-shadow`
  - `--danger-line-soft`
- 将网站卡片、模板卡片、主题卡、设置面板、状态面板等 hover/focus/shadow 状态统一到 token。
- `HomeThemeStyleBridge` 路由切换时不再清理主题 CSS 变量，只移除系统明暗监听，减少首页与设置页切换时的视觉闪烁。
- 设置页面板增加统一阴影，背景图存在时仍能保持面板层级和可读性。
- 状态消息增加换行保护，避免 Supabase、Storage 或导入错误等长文本撑破布局。
- 设置页 Banner/背景图片卡片在中等宽度开始单列排布，避免预览、按钮、URL 输入和遮罩滑条挤压。
- 极窄屏下偏好行和主题 preset 卡片切换为单列，避免字体切换或长文本造成重叠。
- 日历组件控制区允许换行，紧凑密度和窄屏下不再强行挤压。

### 数据与同步

本阶段无新增数据库迁移，无新增 Storage policy。

同步行为保持不变：

- 账号级字体、密度和明暗偏好继续使用 `account_preferences` 与本地偏好缓存。
- 空间级主题、图片和遮罩继续保存在 `HomeDocumentV2.theme`。
- 本地、同步码和账号托管空间继续复用完整首页文档同步链路。

### 验收标准

- 首页和设置页在主题切换、路由切换时不出现明显主题 token 闪烁。
- 6 个主题 preset 的 focus、hover、拖拽目标、危险态和浮层状态不再固定蓝色或固定浅色阴影。
- 背景图存在时，设置页和首页主要面板仍可读。
- Banner/背景图片面板在桌面、中等宽度和移动端均不重叠。
- 紧凑密度、serif、mono 字体下主要按钮、偏好行、主题卡片、日历控制区不撑破容器。

### 验证记录

- `npm run typecheck` 通过。
- `npm run lint` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。

## 后续衔接

Phase 1.8 已完成主题风格、Banner/背景图片和个性化细节收口。后续如果继续扩展个性化，应进入 Phase 2 高级定制方向，例如动态背景、高级主题包、图片库、裁剪器或付费主题资源；Phase 1 后续主线转入 Phase 1.9，先做前端页面布局和 UI/UX 优化，再进入浏览器收藏/标签导入需求集。
