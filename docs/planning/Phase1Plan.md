# Phase 1 MVP 产品设计与实施路线

## Summary

Phase 1 的目标是把当前静态首页推进到可公测、可恢复、可持续扩展的个人首页产品。当前 Phase 1.1-1.13 已完成本地编辑、同步码、账号托管、模板、主题、组件、导入、数据保全、观测、组件体验优化和产品化体验收口。Phase 1.14 已启动主域名准备，正式主域名确定为 `mylinker.net`。Phase 1.14.0 已完成迁移方案与回滚预案，Phase 1.14.1 已完成根路径构建与部署目标配置，Phase 1.14.2 已完成 Supabase Auth、Storage 与回调 URL 迁移准备，Phase 1.14.3 已完成 Cloudflare Pages preview 部署和回归，Phase 1.14.4 已完成仓库侧安全响应头和 Dashboard 操作手册；Phase 1.14.5/1.14.6 暂缓，Phase 1.14.7 进入主域名正式切流、回归和回滚演练；多语言支持顺延为 Phase 1.15。

当前产品原则：

- P0：用户数据保全，防止误覆盖和数据丢失。
- P1：隐私和防泄露。
- P2：编辑体验、组件能力、视觉风格和增长能力。

## Key Product Decisions

- 首页数据继续以完整 `HomeDocumentV2` 为同步、快照、导入导出和恢复单位；范围包含网站、主题、Banner/背景、组件、布局、标题和同步状态，不只包含网站列表。
- 默认页、空白页和未编辑模板页不视为有效用户首页；用户编辑后的模板页与正常编辑首页合并为有效用户首页。
- 账号托管空间是“账号可信托管、可恢复、可审计”模式；普通同步码空间继续保持用户持有完整同步码、云端默认只保存密文的边界。
- 后续设置项增加前，必须先建立可扩展设置页结构，避免设置页继续平铺膨胀。
- 页面标题、搜索引擎 logo 和主题风格 v2 都属于正式主域名前的产品化体验收口；主域名准备独立为 Phase 1.14；多语言支持顺延为 Phase 1.15，避免在域名和部署路径变化前扩大文案和布局回归面。
- 纯前端轻量组件优先复用现有 Widget Shell、统一配置入口、快照和同步能力；需要服务端、API key、OAuth、Storage 或大体积缓存的功能暂不直接实现。
- 只读分享、后台 dashboard 以及 RSS/天气/GitHub 等联网能力都依赖更明确的只读渲染层、受控服务端入口、权限/额度和审计底座。
- Phase 1 之外的长期计划统一沉淀到根目录 `memory.md`，不再混写在 Phase 1 路线中。

## Current Status

截至当前实现：

- Phase 1.1-1.6 已完成：本地编辑、统一数据结构、同步码、设置页、账号登录、首页空间、账号托管同步、模板库和 Beta 打磨。
- Phase 1.7 已完成：组件框架、Todo List、月历、组件布局编辑和模板默认组件。
- Phase 1.8 已完成：主题风格 v1、Banner/背景图片和个性化细节收口。
- Phase 1.9 已完成：页面布局/UI 优化、收藏/标签导入设计、大批量导入设计和导入 MVP。
- Phase 1.10 已完成：数据包恢复、本地审计、本机状态和同步请求多标签协调。
- Phase 1.11 已完成：数据保全基线、本地历史、数据恢复中心、危险写入保护、同步误覆盖防护、云端历史、账号托管恢复模型、P0 演练、基础埋点和错误监控。
- Phase 1.12 已完成：组件体验审计、Widget Shell 统一、Todo/月历体验优化、组件配置入口统一、模板组件组合优化和后续组件候选设计。
- Phase 1.13.0 已完成：设置页信息架构 v2，一级设置项默认收起，展开状态仅保存在当前浏览器，数据恢复中心历史版本改为下拉选择。
- Phase 1.13.1 已完成：产品身份收口，可编辑首页标题、浏览器标题和搜索引擎 logo 已落地。
- Phase 1.13.2 已完成：主题风格 v2，主题从配色 preset 扩展为 appearance preset，并加入 Millennium 门户目录风格。
- Phase 1.14.0 已完成：主域名迁移方案与回滚预案，正式主域名确定为 `mylinker.net`，明确 Cloudflare Pages 主站、GitHub Pages legacy、localStorage 跨域迁移和回滚路径。
- Phase 1.14.1 已完成：根路径构建与部署目标配置，`NEXT_PUBLIC_BASE_PATH` 规范化、静态导出验证脚本和 GitHub Pages workflow 校验已落地。
- Phase 1.14.2 已完成：Supabase Auth、Storage 与回调 URL 迁移准备，明确当前来源回跳、Redirect URLs、Storage 回归和回滚记录。
- Phase 1.14.3 已完成：Cloudflare Pages preview 已生成并完成回归，Supabase preview Redirect URLs 已添加，首页内容可在 preview 拉取并显示。
- Phase 1.14.4 仓库侧已完成：新增 Cloudflare Pages 安全响应头、静态导出安全头校验和 `CloudflareSecurityBaseline.md` 操作手册；Cloudflare Dashboard Step 8 之后暂缓。
- Phase 1.14.5/1.14.6 暂缓：GitHub Pages legacy 继续保留完整应用作为 fallback，不做迁移提示页；闭源开发与仓库安全收口后移。
- Phase 1.14.7 进行中：新增主域名正式切流与回滚演练手册，记录当前命令级基线和 Supabase Site URL 切流步骤。

下一步完成 Phase 1.14.7：Supabase Site URL 切流、主域名手动回归和 24 小时观察。

## Phase Plan

| 阶段 | 当前状态 | 已落地或目标能力 | 后续动作 |
|---|---|---|---|
| Phase 1.1：本地可编辑首页 | 已完成 | 分组、网站、本地保存、导入导出、恢复默认 | 只做缺陷修复 |
| Phase 1.2：统一数据结构与 Next.js 迁移 | 已完成 | `HomeDocumentV2`、Next.js App Router、静态导出 | 继续保持 schema 兼容 |
| Phase 1.3：同步码跨设备同步 | 已完成 | 加密同步码、Supabase RPC、revision check、冲突处理 | 只做兼容和安全回归 |
| Phase 1.4：展示页与设置页优化 | 已完成 | 首页轻量展示、设置页、首页直编、恢复默认前备份 | 后续确认弹窗统一进入体验优化 |
| Phase 1.5：账号登录与首页空间管理 | 已完成 | Magic Link、Resend SMTP、账号资料、偏好骨架、同步码认领、空间切换 | 只做账号安全和回归维护 |
| Phase 1.6：账号托管同步与 Beta 打磨 | 已完成 | 账号托管空间、空白设备恢复、同步码迁移、空间 CRUD、全局偏好、数据导出、模板库 | 只做兼容维护 |
| Phase 1.7：组件开发 | 已完成 | Widget Registry、Todo List、月历、组件布局、模板默认组件 | 新组件进入 Phase 1.16 后续候选 |
| Phase 1.8：主题与普通个性化 | 已完成 | 主题 v1、Banner/背景图片、遮罩强度、个性化细节收口 | 主题风格 v2 进入 Phase 1.13.2 |
| Phase 1.9：页面布局/UI 优化与浏览器导入需求集 | 已完成 MVP | 设置页信息架构 v1、首页空间弹窗化、Banner/背景布局、网站编辑入口、书签 HTML/URL 导入 MVP | 浏览器扩展导入留 Phase 1 候选，不直接排入近期 |
| Phase 1.10：正式推出前基础收口 | MVP 已完成 | 数据包恢复、本地审计、本机状态、同步请求多标签协调；账号删除/分享/高隐私形成候选设计 | 账号删除需重新基于数据生命周期设计 |
| Phase 1.11：数据保全与发布观测体系 | 已完成 | 文档分类、本地/云端历史、恢复中心、危险写入保护、同步误覆盖防护、账号托管恢复边界、P0 演练、基础埋点、错误监控 | 继续作为所有后续功能的 P0 约束 |
| Phase 1.12：组件设计优化子阶段 | 已完成 | 组件体验规范、Widget Shell、Todo/月历优化、配置入口、模板组件组合、候选组件 backlog | 纯前端新组件留 Phase 1.16 |
| Phase 1.13：产品化体验收口 | 已完成 | 设置页信息架构 v2、产品身份收口、主题风格 v2 | 主域名准备独立到 Phase 1.14 |
| Phase 1.14：主域名准备 | 进行中 | Cloudflare Pages 主站迁移、根路径构建、Supabase 回调、安全头、切流回归和回滚演练；1.14.5/1.14.6 暂缓，GitHub Pages legacy 保留完整应用 | 下一步执行 Supabase Site URL 切流和 1.14.7 回归 |
| Phase 1.15：多语言支持 v1 | 候选 | 语言模式、账号/本地偏好、静态 dictionary、日期时间/月历 locale formatter、主路径 UI 本地化 | 放在主域名准备之后独立实现 |
| Phase 1.16：低成本组件扩展 | 候选 | Notes、Countdown、World Clock | 仅实现纯前端、低数据体积组件 |
| Phase 1.17：只读渲染与分享链接 v1 | 候选 | 只读首页 renderer、只读分享链接、撤销机制 | 依赖主域名和只读渲染层设计 |
| Phase 1.18：受控服务端与后台 dashboard v1 | 候选 | Edge Function/受控后端、管理员身份、管理员审计、只读后台 | 仅在主域名稳定后评估，v1 必须只读 |

## Candidate Feature Evaluation

本表只保留 Phase 1 内仍可能推进或需要设计兜底的候选功能。Phase 1 之外的长期计划已移动到 `memory.md`。

| 优先级 | 功能 | 产品收益 | 工程影响 | 难度 | 建议 |
|---|---|---:|---|---:|---|
| P0 | 设置页信息架构 v2 | High | 设置页抽象、折叠面板、历史版本下拉 | M | 已完成，作为后续设置扩展底座 |
| P0 | 可编辑页面标题 | High | `HomeDocumentV2`、浏览器标题、模板、快照 | M | 已完成；页面标题与空间管理名称分离 |
| P0 | 主域名准备 | High | `basePath`、Auth redirect、缓存隔离、Cloudflare Pages、旧站迁移提示、安全基线、部署回归 | M-L | Phase 1.14 独立做 |
| P0 | 多语言支持 v1 | High | i18n provider、账号/本地偏好、日期格式、静态 dictionary | L | Phase 1.15 独立做，放在主域名准备之后 |
| P1 | 搜索引擎 Logo | Medium | 搜索引擎 registry、图标资源、搜索栏布局 | S | 已完成；随产品身份收口落地 |
| P1 | 主题风格 v2 | High | 主题 token、appearance preset、旧主题兼容 | L | 已完成；新增 curated appearance preset 和 Millennium 风格 |
| P1 | Notes 便签组件 | High | Widget config、长度限制、隐私边界 | S-M | Phase 1.16 首选，纯前端低成本 |
| P1 | Countdown 倒计时 | Medium-High | Widget config、日期/时区处理 | S | Phase 1.16 候选，低成本高感知 |
| P1 | World Clock 世界时钟 | Medium | Widget config、时区选择 UI | S-M | Phase 1.16 候选，适合开发者/远程办公模板 |
| P1 | 只读渲染层 | High | 只读首页 renderer、权限边界、公开展示 | L | Phase 1.17 前置底座，先做 renderer 再做链接 |
| P1 | 只读分享链接 | High | share token、只读路由、撤销机制 | L | 依赖主域名和只读渲染层 |
| P2 | 浏览器扩展导入 | High | 扩展端、权限、导入草稿复用 | L | 用户价值高，但作为独立候选推进 |
| P2 | RSS 组件 | Medium | 服务端代理、缓存、CORS 处理 | L | 等受控服务端入口后再做 |
| P2 | Weather 天气 | Medium | API key、缓存、额度、隐私说明 | M-L | 依赖 API 代理和 quota |
| P2 | GitHub public repo 组件 | Medium | API rate limit、缓存、错误降级 | M | 只考虑 public repo，OAuth 暂缓 |
| P2 | 账号删除 | Medium-High | 数据生命周期、审计、RLS/RPC | L | 合规重要，但要单独设计和强回归 |
| P2 | 后台管理 dashboard | High | Edge Function、service role、管理员审计 | XL | Phase 1.18 候选；正式域名稳定后做只读 v1 |

## Phase 1.13 Breakdown

### Phase 1.13.0：设置页信息架构 v2

状态：已完成。

目标：让设置页从“所有配置平铺展示”升级为可扩展的信息架构。

已完成：

- 新增统一 `SettingsSection` 抽象。
- 各一级设置项默认收起，header 显示标题、状态摘要和展开入口。
- 展开状态只作为本地 UI 偏好，不写入首页文档。
- 数据恢复中心中，本地历史和云端历史改为下拉选择版本，选择后展示摘要、预览和恢复操作。
- 危险操作仍保留清晰提示，不能因为折叠而降低数据恢复可发现性。

### Phase 1.13.1：产品身份收口

状态：已完成。

目标：补齐产品化基础标识，让首页不再只有浏览器默认标题和隐式搜索引擎状态。

已完成：

- 在 `HomeDocumentV2` 中增加可编辑页面标题字段。
- 浏览器 `document.title` 使用页面标题。
- 模板可提供默认页面标题；历史快照、数据包导出和云端历史都应包含标题。
- 扩展 Search Engine Registry，使搜索引擎定义包含 `id`、`label`、`searchUrl` 和 `icon`。
- 首页搜索栏最左侧显示当前搜索引擎 logo 或稳定 fallback。

### Phase 1.13.2：主题风格 v2

状态：已完成。

目标：把主题从“配色 preset”升级为“界面设计和显示风格 preset”。

已完成：

- 新增 appearance preset 概念，覆盖色彩、字体/密度、边框、阴影、搜索栏、Widget Shell、背景处理和按钮视觉强度。
- 保留旧主题兼容，旧 `slate`、`mint`、`indigo`、`sunrise` 仍可正常读取；新模板按 accent 映射到 v2 风格。
- v2 preset 采用 curated 模式，不开放过多自由组合。
- 已落地 preset：Classic、Focus、Dense、Soft、Glass、Editorial、Terminal、Minimal Mono、Millennium。
- 更新模板默认风格，但不自动修改用户已有首页。
- 新增 `docs/design/theme-v2-demo.html` 作为非业务视觉参考。

## Phase 1.14 Breakdown

### Phase 1.14.0：主域名迁移方案与回滚预案

状态：已完成。详见 `docs/guides/MainDomainMigrationRunbook.md`。

目标：确认主域名、canonical host、Cloudflare Pages 作为主站、GitHub Pages 作为旧站兼容/应急入口的整体迁移策略。

主要任务：

- 确认正式主域名和 `www` 跳转方向，推荐 apex domain 作为 canonical。
- 明确主站迁移到 Cloudflare Pages，GitHub Pages 保留为旧路径提示和短期回退入口。
- 明确纯本地用户的数据迁移策略：旧站导出、新站导入；已登录用户通过账号同步恢复。
- 制定回滚策略：Cloudflare Pages 回滚到上一部署、DNS 切回旧站、旧 GitHub Pages 保留迁移提示。
- 列出迁移观察窗口和关键监控项：登录、同步、Storage 图片、错误监控、访问量和异常 4xx/5xx。

实施结果：

- 明确主站迁移到 Cloudflare Pages，GitHub Pages 转为 legacy 迁移提示和短期回退入口。
- 明确 canonical host 使用 `https://mylinker.net/`，`https://www.mylinker.net/` 跳转到 apex。
- 明确正式主站使用根路径 `/`，旧站继续使用 `/PersonalHomepge/`。
- 明确 localStorage origin 隔离风险和三类用户迁移路径：账号托管登录恢复、同步码重新绑定、纯本地导出导入。
- 固化 pre-cutover、Supabase/Auth、Cloudflare Pages、安全基线、切流、观察和回滚 checklist。

### Phase 1.14.1：根路径构建与部署目标配置

状态：已完成。

目标：让同一套代码能支持 GitHub Pages legacy 项目路径和正式主域名根路径，避免静态资源路径错误。

主要任务：

- 调整 `next.config.mjs` 的 `basePath` / `assetPrefix` 策略，正式主域名构建时使用根路径。
- 保留 GitHub Pages legacy 构建能力，旧站继续使用 `/PersonalHomepge`。
- 明确 `NEXT_PUBLIC_BASE_PATH`、`NEXT_PUBLIC_SITE_ORIGIN` 等环境变量边界。
- 本地验证 `npm run build` 产物中 `_next`、静态资源、图片和路由均不带错误前缀。

实施结果：

- `next.config.mjs` 对 `NEXT_PUBLIC_BASE_PATH` 做规范化：空值或 `/` 表示根路径；非空值必须以 `/` 开头；尾部斜杠会被去除；重复斜杠会阻止构建。
- 保留未显式设置 `NEXT_PUBLIC_BASE_PATH` 时从 `GITHUB_REPOSITORY` 推导 GitHub Pages 项目路径的能力。
- 新增 `scripts/verify-static-export.mjs` 和 `npm run verify:export`，用于检查 `out/index.html`、`out/_next` 和导出 HTML 中的 `_next` 资源前缀。
- GitHub Pages workflow 在构建后自动执行静态导出验证，并输出当前 base path。
- `NEXT_PUBLIC_SITE_ORIGIN` 暂不在本阶段引入；正式站点 origin 和 Auth redirect 统一进入 Phase 1.14.2 处理。

### Phase 1.14.2：Supabase Auth、Storage 与回调 URL 迁移

状态：已完成配置准备，不执行线上配置变更。

目标：让登录、账号恢复、Storage 图片、云端历史和观测事件在新主域名下可用。

主要任务：

- 明确 Supabase Auth `Site URL` 后续切换为正式主域名，本阶段不立即修改 Dashboard。
- 准备 `Redirect URLs` 清单，迁移窗口同时保留正式主域名、localhost 和旧 GitHub Pages 地址。
- 回归 Magic Link、登录恢复、账号托管空间恢复、同步码绑定和退出登录。
- 回归 Supabase Storage signed/public URL 在新域名下的图片展示。
- 确认埋点和错误监控的来源域名、诊断字段和隐私边界不变。

实施结果：

- Magic Link 回调策略保持当前来源回跳：从哪个 host/path 发起登录，就回到同一 host/path；query 和 hash 会被去掉。
- 不新增 `/auth/callback`，不强制跳主域名，不引入 `NEXT_PUBLIC_SITE_ORIGIN`。
- 新增 `docs/guides/SupabaseDomainMigrationChecklist.md`，固化 `Site URL`、`Redirect URLs`、Storage 回归、观测边界和回滚记录模板。
- 明确迁移窗口至少保留 localhost、GitHub Pages legacy、正式主域名首页和设置页 Redirect URLs；Cloudflare Pages preview URL 在 Phase 1.14.3 创建项目后补充。
- Storage 不新增 migration，继续复用 private bucket `home-assets`、012 migration 和 013 verify 脚本。
- 埋点和错误监控不新增 host/origin 字段，不新增 Supabase migration；新旧域名区分先依赖 Cloudflare/GitHub 侧统计和现有 `page_path`。

### Phase 1.14.3：Cloudflare Pages 主站部署

状态：已完成。

目标：以最低 CI/CD 成本建立正式主站部署链路。

主要任务：

- Cloudflare Pages 绑定当前 GitHub 仓库，生产分支使用 `production`。
- 构建命令保持轻量：`npm run typecheck && npm run lint && npm run build && npm run verify:export`。
- 输出目录使用 `out`，Node 版本对齐当前 GitHub Actions。
- 配置生产环境变量和 preview 环境变量。
- 使用 Cloudflare Pages preview deployments 做切流前验证。

操作准备：

- 新增 `docs/guides/CloudflarePagesDeploy.md` 作为 Cloudflare Pages 创建和 preview 回归手册。
- Cloudflare Pages 构建显式使用根路径：`NEXT_PUBLIC_BASE_PATH=/`。
- Cloudflare Pages preview URL 已生成：`https://personalhomepge.pages.dev/`。
- 已将 preview 首页和 `/edit/` URL 回填到 `docs/guides/SupabaseDomainMigrationChecklist.md` 的 Redirect URLs 清单，并已在 Supabase Auth 中添加。
- Preview 首页和 `/edit/` 均可访问。
- Magic Link、账号托管首页内容拉取与显示、Storage Banner/背景图片显示已完成手动回归。

### Phase 1.14.4：Cloudflare 安全基线

状态：仓库侧已完成，Dashboard 手动配置待执行。

目标：主站上线时同时建立低成本安全防线，减少入侵、勒索软件和 DDoS 风险。

主要任务：

- 仓库侧新增 Cloudflare Pages `_headers`，设置低误伤安全响应头：`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`、`X-Frame-Options`。
- 新增 `docs/guides/CloudflareSecurityBaseline.md`，详细记录 Cloudflare Dashboard 操作、验证和回滚。
- Dashboard 侧开启或确认 Cloudflare 代理、HTTPS、Always Use HTTPS 和 DNSSEC。
- SSL/TLS 使用 `Full (strict)`；HSTS 先暂缓或短周期观察，稳定后再考虑长期策略。
- 启用 Cloudflare DDoS 默认防护和 WAF Managed Ruleset。
- 配置保守的 Custom WAF Rules，阻断明显扫描路径；Rate limiting 本阶段可暂缓或只做极高频 challenge。
- Cloudflare、GitHub 和 Supabase 管理账号启用 2FA，优先使用硬件密钥；严禁 service role 或第三方 secret 进入前端。

已完成：

- 新增 `public/_headers`。
- `npm run verify:export` 已增加 `out/_headers` 和必需安全头校验。
- 新增 `docs/guides/CloudflareSecurityBaseline.md`。

待手动完成：

- 在 Cloudflare Dashboard 中按 `CloudflareSecurityBaseline.md` 完成 DNS/TLS/WAF/DNSSEC/2FA 配置。
- 执行 preview 或正式主域名回归，确认 Auth、账号托管恢复、同步码和 Storage 图片均不受影响。

### Phase 1.14.5：GitHub Pages 旧站迁移提示

状态：暂缓。

目标：让旧地址用户知道主站迁移，并避免因为 localStorage origin 变化误以为数据丢失。

主要任务：

- GitHub Pages 旧站保留迁移提示、数据导出入口和新主站入口。
- 不让旧站长期承载完整主应用，避免账号回调、localStorage 和 SEO 分裂。
- 保留一段迁移窗口后，将旧站降级为极简跳转页或关闭。
- 文案明确说明：已登录用户可在新主站登录恢复；纯本地用户需从旧站导出后到新站导入。

### Phase 1.14.6：闭源开发与仓库安全收口

状态：暂缓。

目标：评估并执行仓库闭源后的开发和部署策略，同时保持前端公开产物的安全边界清晰。

主要任务：

- 评估 GitHub 仓库转 private 对协作、Actions、Pages 和 Cloudflare Pages 连接的影响。
- 明确闭源只能保护源码、历史、规划文档和 migration 脚本，不能保护浏览器可下载的前端 JS/CSS/HTML。
- GitHub Pages 若继续使用 private repo，需确认账号套餐和 Pages 权限；长期推荐 Cloudflare Pages 作为主站。
- 整理 repository secrets、Actions variables、Supabase anon key、Cloudflare token 的权限边界。
- 增加发布前检查：不发布 sourcemap、不提交 `.env`、不暴露 service role、管理员密钥或第三方 API key。

### Phase 1.14.7：正式切流、回归和回滚演练

状态：进行中。

目标：完成主域名正式上线，并用数据保全 P0 标准验证切流安全。

主要任务：

- 新增 `docs/guides/MainDomainCutoverRunbook.md`，记录当前基线、Supabase Site URL 切换、`www` redirect、回归矩阵和回滚演练。
- 切流前完成根路径构建、Cloudflare Pages preview、Supabase Redirect URLs 和 GitHub Pages legacy 完整应用验证。
- 切流后回归首页加载、Magic Link、账号恢复、同步、Storage 图片、数据恢复中心、埋点、错误监控和本地缓存隔离。
- GitHub Pages legacy 继续保留完整应用，不做迁移提示页，不关闭旧站。
- CloudflareSecurityBaseline Step 8 之后暂缓，不在切流阶段新增 WAF、Custom Rule、Rate limiting 或 Bot Fight Mode。
- 观察至少 24 小时后再标记 1.14.7 完成。
- 演练 Cloudflare Pages 回滚和旧站回退路径。

## Phase 1.15 Breakdown

### Phase 1.15.0：多语言支持 v1

目标：主域名路径稳定后，建立完整产品本地化底座，让设置页可切换语言，支持指定语言或跟随系统。

主要任务：

- 新增 `I18nProvider` 和静态 dictionary。
- v1 支持 `system`、`zh-CN`、`zh-TW`、`en-US`、`fr-FR`、`es-ES`、`ja-JP`、`ko-KR`、`it-IT`。
- 登录用户语言模式写入账号偏好；未登录用户写入本地偏好。
- UI 文案、日期时间、版本时间、日历展示走统一 formatter。
- 用户自定义内容不自动翻译，例如网站名、分组名、Todo、Notes 和页面标题。
- 多语言实施分层交付：优先保证简体中文和英语质量，其他语言达到可用后逐步精修。

## Shared Foundations

### 1. Settings Section Foundation

统一设置页一级栏目结构：默认收起、状态摘要、展开显示完整配置。恢复中心历史版本列表使用下拉选择，节省空间但保留完整预览和恢复。

### 2. Product Preferences And I18n Foundation

语言模式属于产品偏好，不属于首页空间内容。登录用户保存到账户偏好，未登录用户保存到本地偏好。日期、时间、版本号、日历展示统一走 locale formatter。该底座独立放在 Phase 1.15，避免在主域名迁移前同时扩大文案和布局回归面。

### 3. Home Identity Metadata

页面标题属于当前首页空间内容，进入 `HomeDocumentV2`。它必须随本地保存、同步、快照、模板、数据包导出和历史恢复完整流转。

### 4. Search Engine Registry

搜索引擎从简单 URL 配置升级为 registry：`id`、`label`、`searchUrl`、`icon`。首页搜索栏、设置页候选列表和未来搜索体验都从 registry 读取。

### 5. Appearance Preset Foundation

主题 v2 不再只管理颜色，而是管理视觉风格。每个 preset 同时定义颜色、字体密度、边框、阴影、组件外壳、搜索栏和背景处理。

### 6. Deployment And Domain Foundation

主域名迁移统一处理根路径构建、Cloudflare Pages、GitHub Pages 旧站角色、Supabase URL 配置和安全基线。后续分享、后台和公开展示都应基于正式主域名，不再依赖 GitHub Pages 项目路径。

### 7. Read-only Rendering Foundation

只读分享和未来公开展示前，先抽象不可编辑 `HomeDocumentV2` renderer。它也可以复用到后台快照预览、模板展示和历史版本预览。

### 8. Controlled Server Foundation

RSS、天气、GitHub、后台 dashboard、API key、service role、管理员能力都不能直接进入 GitHub Pages 前端。后续统一通过 Supabase Edge Functions 或受控后端处理限流、缓存、审计和权限。

### 9. Permission, Quota And Lifecycle Foundation

账号删除、分享链接撤销、云端历史保留、后台审计、联网组件缓存和未来 Storage 能力都需要统一的数据生命周期和审计策略。

## Recommended Route

1. Phase 1.13.0：设置页信息架构 v2。已完成。
2. Phase 1.13.1：产品身份收口，可编辑页面标题和搜索引擎 logo。
3. Phase 1.13.2：主题风格 v2。
4. Phase 1.14：主域名准备。
5. Phase 1.15：多语言支持 v1。
6. Phase 1.16：低成本组件扩展，优先 Notes、Countdown、World Clock。
7. Phase 1.17：只读渲染层与只读分享链接 v1。
8. Phase 1.18：受控服务端与后台 dashboard v1，只做只读、强审计、最小权限。

这一路线先解决产品化基础，再扩展低风险组件，最后进入分享和服务端能力。需要 Storage、OAuth、支付或复杂权限的新能力不进入 Phase 1 主线。

## Data And Interfaces

### HomeDocumentV2 Direction

后续 `HomeDocumentV2` 需要继续保持兼容，同时为 Phase 1.13 增加产品身份和主题风格字段。

候选方向：

```ts
type HomeDocumentV2 = {
  version: 2;
  documentId: string;
  updatedAt: string;
  revision: number;
  documentTitle?: string;
  theme: {
    preset?: string;
    appearancePreset?: string;
    bannerUrl?: string | null;
    backgroundUrl?: string | null;
    bannerAsset?: unknown;
    backgroundAsset?: unknown;
    bannerOverlayOpacity?: number;
    backgroundOverlayOpacity?: number;
  };
  syncMeta: unknown;
  billing?: unknown;
  groups: HomeGroup[];
  widgets: HomeWidget[];
};
```

原则：

- `documentTitle` 是用户首页内容，进入同步、快照、导出和恢复。
- `appearancePreset` 兼容旧 `theme.preset`，不能让老用户打开后视觉突变。
- 语言、设置页展开状态、埋点开关等属于偏好或本机 UI 状态，不写入 `HomeDocumentV2`。

### Local Storage Keys

已有关键本地 key：

- `homepage:document:v2`：当前本地首页文档。
- `homepage:sync-code:v1`：当前浏览器同步绑定。
- `homepage:reset-backup:v1`：旧恢复默认备份。
- `homepage:ui-preferences:v1`：本地 UI 偏好，后续在 Phase 1.15 承载未登录语言模式。
- `homepage:bookmark-import-draft:v1`：导入草稿。
- `homepage:bookmark-import-undo:v1`：最近一次导入撤销记录。
- `homepage:audit-log:v1`：本地操作审计日志。
- `homepage:device:v1`：当前浏览器设备记录。
- `homepage:local-snapshots:v1`：本地历史快照。
- `homepage:document-protection:v1`：文档分类和保护状态缓存。
- `homepage:analytics:v1`：本机埋点偏好和匿名安装标识。
- `homepage:settings-layout:v1`：设置页 section 展开状态。

新增或扩展方向：

- `homepage:ui-preferences:v1` 后续在 Phase 1.15 扩展 `localeMode`。
- 页面标题和主题 v2 不新增本地 key，直接进入 `HomeDocumentV2`。

### Supabase Tables And RPC

当前 Phase 1 已有核心表和 RPC：

- `sync_spaces`
- `profiles`
- `account_preferences`
- `home_spaces`
- `home_space_credentials`
- `home_space_snapshots`
- `home_space_audit_events`
- `product_analytics_events`
- `client_error_events`
- `create_sync_space`
- `pull_sync_space`
- `push_sync_space`
- `force_push_sync_space`
- `revoke_sync_space`
- `create_account_managed_home_space_v2`
- `migrate_sync_code_home_space_to_account_managed_v2`
- `push_account_managed_sync_space`
- `force_push_account_managed_sync_space`

Phase 1.14 主域名准备预计不需要新增 Supabase migration，但需要调整 Supabase Auth `Site URL`、`Redirect URLs` 和相关生产环境变量。Phase 1.15 多语言支持需要优先复用 `account_preferences.locale` 保存语言模式；若现有约束无法保存 `system` 或新增语言值，则只做最小约束 migration，不新增账号偏好表。

## Security And Privacy Requirements

- 覆盖有效用户首页前必须先保存可恢复快照；快照失败时阻止危险覆盖。
- 默认页、空白页和未编辑模板页不进入有效用户快照，也不自动上传覆盖云端。
- 账号托管空间云端历史可保存有效用户首页明文 `document_json`，但仅限本人 RLS 和未来受控后台审计访问。
- 普通同步码空间继续保持密文边界，不保存可预览明文云端历史。
- 多语言、主题、标题和搜索引擎 logo 不得破坏数据恢复中心、导入导出和同步回归。
- 埋点、错误监控、本地审计不得记录用户标题正文、网站 URL、搜索词、Todo/Notes 内容、同步码、账号托管 secret 或 Supabase session。
- 搜索引擎 logo 不应引入远程追踪像素；优先使用本地静态资源或安全 fallback。
- 受控服务端和后台 dashboard 不得把 service role、第三方 API key 或管理员能力暴露给静态前端。

## Acceptance Criteria

- 设置页一级栏目默认收起，用户能通过摘要理解当前状态，并能展开完成全部已有操作。
- 数据恢复中心的本地和云端历史版本以节省空间的选择控件展示，仍支持完整预览和确认恢复。
- 用户可在设置页选择语言：跟随系统、简体中文、繁体中文、英语、法语、西班牙语、日语、韩语和意大利语。
- 未登录用户语言偏好保存在本地；登录用户语言偏好随账号同步。
- 页面标题可编辑，并同步到浏览器 tab、模板生成、历史快照、数据包导出和云端历史。
- 搜索栏左侧显示当前搜索引擎 logo 或稳定 fallback；切换默认搜索引擎后首页显示同步更新。
- 主题风格 v2 覆盖界面设计和显示风格，不只是配色；旧主题打开后保持兼容。
- 主域名切换后，首页加载、Magic Link、账号恢复、Storage 图片、同步和本地缓存隔离均通过回归。
- Notes、Countdown、World Clock 如进入 Phase 1.16，必须复用 Widget Shell、配置入口、快照和同步体系，不新增后端表。
- 只读分享和后台 dashboard 在实现前必须先完成只读渲染层和受控服务端边界评估。

## Assumptions

- Phase 1 仍以单用户个人首页 MVP 为主，不做 Phase 1 外长期能力或完整组件市场。
- 低成本组件优先纯前端实现，内容写入 `HomeDocumentV2.widgets[].config`，但必须控制体积和隐私边界。
- 联网组件和后台能力只有在受控服务端入口稳定后才推进。
- 主域名准备只处理产品主域名；长期域名扩展能力记录在 `memory.md`。
