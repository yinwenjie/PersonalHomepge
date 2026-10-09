# Phase 2.1 浏览器新标签页扩展设计

## Summary

Phase 2.1 让用户把 MyLinker 直接设为 Chrome / Edge 的新标签页，对齐北极星“用户真正把它当首页用”。v0 只做一件事：打开新标签页就是 MyLinker 首页，登录和同步沿用现有账号托管同步，不新增业务能力。

当前状态：2026-10-09 设计草案，待负责人确认第“已确认决策”一节的待定项后进入 2.1.1 实施。

## 现状事实（2026-10-09 核对代码）

- 主站是 Next.js 16 static export（`next.config.mjs` 的 `output: "export"`、`trailingSlash: true`），产物约 2.1 MB，路由只有 `/`、`/edit/`、`/share/`。
- 所有本地数据都在 `localStorage`，键名以 `homepage:` 开头，例如 `homepage:document:v2`、`homepage:sync-code:v1`、`homepage:local-snapshots:v1`、`homepage:ui-preferences:v1`；没有 IndexedDB、Service Worker 或 Cache Storage。
- Supabase 浏览器客户端使用 `persistSession`、`autoRefreshToken`、`detectSessionInUrl`；Magic Link 的 `emailRedirectTo` 取当前页面 URL（`supabase-auth-provider.tsx` 的 `getAuthRedirectUrl`），且 `shouldCreateUser: true`。
- `out/index.html` 有 3 段内联脚本：Turbopack chunk 注册（`<script id="_R_">`）和两段 `self.__next_f.push(...)` RSC 载荷。
- 网站图标通过 `icons.duckduckgo.com` 和站点自身 `/favicon.ico` 加载；搜索通过跳转到外部搜索引擎完成。
- 已有数据导出（`data-export.ts`）和导入恢复（`data-restore.ts`）、同步码、账号托管同步三条跨设备迁移路径。

## 关键约束

1. **Manifest V3 CSP 不允许内联脚本。** 扩展页面的 `script-src` 只能是 `'self'`（加 `'wasm-unsafe-eval'`），不能加 `'unsafe-inline'` 或哈希。Next 导出的 3 段内联脚本必须在打包时抽成同目录的外部文件，并保持原有执行顺序。
2. **扩展页面与 `mylinker.net` 是不同 origin。** `chrome-extension://<id>` 下的 `localStorage` 和网站完全隔离，老用户装上扩展后看到的是空白首页，必须有明确的迁移入口（与 1.14.5 同类问题）。
3. **Magic Link 回不到扩展页面。** 邮件里的链接不能直接打开 `chrome-extension://` 地址（普通网页和邮件客户端无权导航到扩展页面），所以扩展内登录不能沿用当前的 Magic Link 回跳。
4. **最小权限。** v0 只声明 `chrome_url_overrides.newtab`，不申请 `bookmarks`、`tabs`、`activeTab`、`storage` 或任何 `host_permissions`。扩展页面对 Supabase 的 `fetch` 走普通 CORS（Supabase 返回允许跨域），不需要主机权限。
5. **商店审核。** Chrome Web Store 和 Edge Add-ons 都要求单一用途、隐私政策 URL 和数据使用披露；覆盖新标签页后 Chrome 会提示用户“是否改回”，这是正常流程。

## 方案对比

| | A. 打包静态资源（推荐） | B. 新标签页跳转到 `mylinker.net` | C. 扩展页内嵌 iframe |
|---|---|---|---|
| 首屏 | 本地文件，离线可用，最快 | 每次新标签页都要联网加载站点 | 同 B，还多一层页面 |
| 数据 | 扩展 origin 独立，需要迁移 | 与网站共用 `localStorage`，无需迁移 | 第三方存储分区下行为不确定，需原型验证 |
| 地址栏 | 空地址栏，体验与原生新标签页一致 | 显示 `mylinker.net`，焦点落在页面而不是地址栏 | 空地址栏 |
| 发布 | 每次前端发版要同步发扩展新版本并过审 | 扩展几乎不用更新 | 需改 `X-Frame-Options`/`frame-ancestors`，放开主站被嵌入 |
| 主要风险 | 内联脚本抽离；版本漂移 | 断网白屏；商店可能认为功能过薄 | 存储分区、主站防点击劫持被削弱 |

推荐 A：新标签页每天打开次数最多，离线和首屏速度决定用户是否留下；数据迁移已有三条现成路径，不需要新后端。B 作为备选，只有在 A 的内联脚本抽离验证失败时才考虑。C 不采用。

## v0 范围（方案 A）

### 构建

- 新增 `scripts/build-extension.mjs`：以 `NEXT_PUBLIC_BASE_PATH=""` 和扩展专用环境变量执行一次 static export，复制到 `extension/dist/`。
- 后处理每个 HTML：把内联 `<script>` 按出现顺序写成 `inline-<n>.js` 并替换为 `<script src>`（不加 `async`/`defer`，保持同步顺序）；构建后断言产物中没有任何内联脚本和 `on*=` 事件属性。
- 生成 `manifest.json`（MV3）：`name`、`version` 取自 `package.json`，`chrome_url_overrides.newtab` 指向 `index.html`，`permissions: []`，不声明 `content_security_policy`（使用默认最严策略）。
- 扩展产物不包含 `/share/`（公开分享仍只走网站），不包含 `_headers`、`404.html`、source map。
- `.gitignore` 忽略 `extension/dist/`；CI 增加扩展构建与内联脚本断言，但不自动上传商店。

### 运行时差异

- 新增 `isExtensionRuntime()`（`location.protocol === "chrome-extension:"`），只用于：登录方式切换、隐藏“设为首页”引导、分享链接始终生成 `https://mylinker.net/share/...`。
- `/edit/` 等内部跳转使用相对路径；外部链接保持 `target`/普通跳转，不需要 `tabs` 权限。
- analytics 与错误监控照常上报，但 `release`/来源字段增加 `surface: "extension"`，便于区分留存。字段须先加入现有白名单，并通过 `verify:privacy`。

### 登录

- 扩展内改用邮箱验证码：`signInWithOtp({ email, options: { shouldCreateUser: true } })` 后由用户输入 6 位验证码，调用 `verifyOtp({ email, token, type: "email" })`。不需要回跳 URL，不需要在 Supabase Redirect URLs 里加入 `chrome-extension://` 地址。
- 需要把 Supabase Magic Link 邮件模板改为同时包含 `{{ .Token }}`，网站仍可继续用链接登录。这是 Dashboard 操作，由负责人执行。
- Session 仍由 supabase-js 存在扩展 origin 的 `localStorage`，与网站登录互不影响。

### 首次打开与迁移

- 扩展首次打开且本地没有 `homepage:document:v2` 时，显示一次性引导，三选一：
  1. 登录账号：已开启账号托管同步的空间自动拉取。
  2. 输入同步码：沿用现有同步码绑定流程。
  3. 导入备份文件：在网站上导出 JSON，在扩展里用现有恢复流程导入。
- 网站侧在“设置 / 数据”里增加“迁移到浏览器扩展”的说明入口，引导到上述三条路径；不做跨 origin 自动读取。
- 引导完成或选择“从空白开始”后写入一次性标记，不再重复出现。

### 版本与发布

- 扩展版本号跟随 `package.json`，只在 `production` 发版后人工打包上传；未上传前不影响网站。
- Chrome Web Store 与 Edge Add-ons 使用同一个 MV3 包；商店描述、截图、隐私政策链接由负责人确认后提交。

## 分阶段计划

| 编号 | 事项 | 产出 | 依赖 |
|---|---|---|---|
| 2.1.1 | 扩展构建原型 | `build-extension.mjs`、内联脚本抽离、Playwright 加载未打包扩展打开新标签页的冒烟测试 | 本设计确认 |
| 2.1.2 | 扩展运行时适配 | `isExtensionRuntime`、分享链接、analytics `surface`、首次引导与迁移入口 | 2.1.1 通过 |
| 2.1.3 | 扩展内验证码登录 | OTP 登录 UI 与测试；邮件模板改动清单 | 负责人修改邮件模板 |
| 2.1.4 | 商店上架准备 | 隐私政策更新、商店文案和截图、上传清单 | 负责人开通开发者账号 |
| 2.2 | 一键保存当前页 | 需要 `activeTab`，单独评估 | v0 有留存数据后 |
| 2.3 | 书签导入走扩展 | 复用 1.9 导入草稿模型，需要 `bookmarks` | v0 之后 |

## 验收

- 产物中没有内联脚本；扩展在 Chrome 和 Edge 中以默认 MV3 CSP 打开新标签页无控制台 CSP 报错。
- 断网时新标签页能显示本地首页，编辑与本地保存可用；恢复联网后账号托管同步正常。
- 未登录用户首次打开看到迁移引导；三条迁移路径各有一条端到端用例。
- 扩展内 OTP 登录成功后，云端空间能拉取；网站登录态不受影响。
- `manifest.json` 只有 `chrome_url_overrides.newtab`，`permissions` 为空，无 `host_permissions`。

## 已确认决策

- 待定 1：采用方案 A（打包静态资源）。
- 待定 2：扩展内登录改用邮箱验证码，并修改 Supabase 邮件模板加入验证码。
- 待定 3：v0 同时发布 Chrome Web Store 和 Edge Add-ons。
