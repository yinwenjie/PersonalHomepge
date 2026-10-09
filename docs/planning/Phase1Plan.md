# Phase 1 MVP 产品设计与实施路线

## Summary

Phase 1 的目标是把当前静态首页推进到可公测、可恢复、可持续扩展的个人首页产品。Phase 1.1-1.17 已完成本地编辑、同步码、账号托管、模板、主题、组件、导入、数据保全、观测、产品化、多语言、主域名、低成本组件和公开快照分享。正式主域名为 `mylinker.net`，Cloudflare Pages 主站与 GitHub Pages legacy 部署链路均已建立。2026-07-22 Phase 1.17 已通过线上验收；2026-08-10 Phase 1.18.1 管理员身份和审计数据库已完成仓库、本地、CI、远端 history/schema 和 `021` rollback 门禁，下一步是在初始化明确测试管理员后实施 1.18.2 受控 Edge Function 基座。

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
- Phase 1.14.5 最小版已完成（2026-10-08）：GitHub Pages legacy 继续保留完整应用，首页顶部增加可关闭的迁移提示，引导纯本地用户导出数据包后到 `mylinker.net` 导入；旧站降级为跳转页仍后移。
- Phase 1.14.6 暂缓：闭源开发与仓库安全收口后移。
- Phase 1.14.7 已完成：`mylinker.net` 已作为主站入口完成回归，Supabase `Site URL` 已切换为 `https://mylinker.net/`，GitHub Pages legacy 继续保留完整应用作为 fallback。
- Phase 1.15.0 已完成：多语言 locale 数据模型、`system` 解析、账号偏好 migration 和 verify 脚本已落地。
- Phase 1.15.1 已完成：I18n Provider、`useI18n()`、静态 dictionary、统一 formatter、首页日期/月历和组件折叠摘要的运行时接入已落地。
- Phase 1.15.2 已完成：设置页通用设置语言入口、语言选项、`system` resolved locale 提示、保存状态和偏好摘要已接入 i18n runtime。
- Phase 1.15.3 已完成：首页外壳、模板库、站点集合、首页直编弹窗、组件侧栏、Widget Shell 和 Todo 基础交互已接入 i18n runtime。
- Phase 1.15.4 已完成：设置页核心路径、账号、首页空间、主题、图片、恢复中心和高级操作入口已接入 i18n runtime。
- Phase 1.15.5 已完成：同步面板、书签/URL 导入、本机状态、本地审计、产品改进和错误边界已接入 i18n runtime。
- Phase 1.15.6 已完成：新增 `verify:i18n` 校验、补齐同步/导入/设备/审计/错误等关键路径在 `fr-FR`、`es-ES`、`ja-JP`、`ko-KR`、`it-IT` 的覆盖，并完成桌面、平板、移动端多视口回归；回归中修复书签/URL 导入面板默认提示在语言偏好加载后仍停留简中的问题。
- Phase 1.16 已完成并部署：Notes、Countdown、World Clock、模板组件组合、恢复预览摘要和观测隐私校验已落地；Cloudflare Pages 主站与 GitHub Pages legacy 已完成构建、发布和线上访问验证。

Phase 1.17 已完成并通过线上验收。只读 Renderer、公开投影、最小授权 RPC、设置页分享管理、会话内链接、`/share/` 通用失败页和 robots 边界均已落地；目标 Supabase 已执行 `018` 热修复并通过 `020`、`019` 结构权限与 transaction-scoped A/B 检查，真实账号的发布、更新、撤销、重新发布及真实 token 生命周期已完成 smoke test。2026-07-22 Cloudflare Pages preview、`mylinker.net` 与 GitHub Pages legacy 三个静态入口也已通过部署检查。Phase 1.18.1 数据库基础已于 2026-08-10 完成线上门禁；尚未创建持久化管理员或 Edge Function。

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
| Phase 1.14：主域名准备 | 已完成 | Cloudflare Pages 主站迁移、根路径构建、Supabase 回调、安全头、切流回归和回滚演练；1.14.5 迁移提示最小版已上线，1.14.6 暂缓，GitHub Pages legacy 保留完整应用 | 后续只做主域名运行观察和安全补强 |
| Phase 1.15：多语言支持 v1 | 已完成 | 语言数据模型、账号/本地偏好、I18n Provider、静态 dictionary、日期时间/月历 locale formatter、首页、设置页、同步、导入和错误细节本地化；新增 i18n 校验、小语种关键路径覆盖和多视口人工回归 | 后续只做翻译修订和缺陷修复 |
| Phase 1.16：低成本组件扩展 | 已完成并部署 | Notes、Countdown、World Clock、模板组合、恢复预览摘要、观测隐私校验和多视口回归已完成 | 后续仅做缺陷修复与组件候选评估 |
| Phase 1.17：只读渲染与分享链接 v1 | 已完成并通过线上验收 | 只读首页 renderer、公开快照存储/RPC、设置页发布管理、会话内链接、撤销机制、`/share/` 静态公开入口 | 后续仅做缺陷修复、安全回归和运行观察 |
| Phase 1.18：受控服务端与后台 dashboard v1 | 1.18.1 数据库基础与线上门禁完成 | Edge Function、管理员身份、管理员审计、独立私有 Admin Pages、Cloudflare Access | 初始化明确测试管理员后实施 1.18.2，继续保持只读、强审计、双层鉴权和主站零后台资源 |

## Candidate Feature Evaluation

本表只保留 Phase 1 内仍可能推进或需要设计兜底的候选功能。Phase 1 之外的长期计划已移动到 `memory.md`。

| 优先级 | 功能 | 产品收益 | 工程影响 | 难度 | 建议 |
|---|---|---:|---|---:|---|
| P0 | 设置页信息架构 v2 | High | 设置页抽象、折叠面板、历史版本下拉 | M | 已完成，作为后续设置扩展底座 |
| P0 | 可编辑页面标题 | High | `HomeDocumentV2`、浏览器标题、模板、快照 | M | 已完成；页面标题与空间管理名称分离 |
| P0 | 主域名准备 | High | `basePath`、Auth redirect、缓存隔离、Cloudflare Pages、legacy fallback、安全基线、部署回归 | M-L | 已完成；后续只做运行观察和安全补强 |
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
| P2 | 后台管理 dashboard | High | Edge Function、service role、管理员审计、私有 Admin Pages、Cloudflare Access | XL | Phase 1.18.0 隔离方案已完成；后续按只读、强审计、双层鉴权和最小权限分阶段实施 |

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
- 明确主站迁移到 Cloudflare Pages，GitHub Pages 保留为旧路径完整应用 fallback 和短期回退入口。
- 明确纯本地用户的数据迁移策略：旧站导出、新站导入；已登录用户通过账号同步恢复。
- 制定回滚策略：Cloudflare Pages 回滚到上一部署、DNS/证书异常时保留 Pages preview 和旧 GitHub Pages fallback。
- 列出迁移观察窗口和关键监控项：登录、同步、Storage 图片、错误监控、访问量和异常 4xx/5xx。

实施结果：

- 明确主站迁移到 Cloudflare Pages，GitHub Pages 保留 legacy 完整应用和短期回退入口。
- 明确 canonical host 使用 `https://mylinker.net/`，`https://www.mylinker.net/` 后续可作为跳转到 apex 的别名。
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

- 明确 Supabase Auth `Site URL` 在正式切流阶段切换为正式主域名，Phase 1.14.2 不立即修改 Dashboard。
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

状态：仓库侧已完成，Cloudflare Dashboard Step 1-7 已完成，Step 8 之后暂缓。

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

Dashboard 状态：

- 已按 `CloudflareSecurityBaseline.md` 完成 Step 1-7。
- Step 8 之后的 WAF Managed Rules、Custom WAF Rule、Rate limiting 和 Bot Fight Mode 暂缓，避免切流阶段扩大误伤面。
- 主域名回归已完成，Auth、账号托管恢复、同步码和 Storage 图片未受影响。

### Phase 1.14.5：GitHub Pages 旧站迁移提示

状态：最小版已完成（2026-10-08）；旧站降级为极简跳转页或关闭仍暂缓。

已完成：

- 新增 `LegacySiteNotice`，仅在 `*.github.io` 主机名下于首页顶部显示，主站 `mylinker.net` 和 Cloudflare Pages preview 不显示。
- 提示说明已登录用户到新站登录即可恢复，同步码用户需先复制完整同步码到新站重新绑定，纯本地用户需先“导出数据包”再到新站“导入/恢复数据包”，并提醒确认新站前不要清除旧站浏览器数据；提供打开主站、前往设置导出和“不再提示”三个操作。
- “不再提示”只写入本机 `homepage:legacy-notice:v1`，不写入 `HomeDocumentV2`、不同步、不埋点。
- 文案已覆盖 8 种界面语言并通过 `verify:i18n`。

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

已完成（2026-10-08）：

- `npm run verify:export` 新增发布安全检查：`out/` 中不得出现 `.map` 文件、`sourceMappingURL` 引用或 `.env*` 文件；不得出现 `service_role` 字样、`sb_secret_` 密钥或 role 不是 `anon` 的 JWT。GitHub Pages 部署工作流已在构建后执行该检查。

### Phase 1.14.7：正式切流、回归和回滚演练

状态：已完成。

目标：完成主域名正式上线，并用数据保全 P0 标准验证切流安全。

主要任务：

- 新增 `docs/guides/MainDomainCutoverRunbook.md`，记录当前基线、Supabase Site URL 切换、`www` alias/redirect 策略、回归矩阵和回滚演练。
- 切流前完成根路径构建、Cloudflare Pages preview、Supabase Redirect URLs 和 GitHub Pages legacy 完整应用验证。
- 切流后回归首页加载、Magic Link、账号恢复、同步、Storage 图片、数据恢复中心、埋点、错误监控和本地缓存隔离。
- GitHub Pages legacy 继续保留完整应用，不做迁移提示页，不关闭旧站。
- CloudflareSecurityBaseline Step 8 之后暂缓，不在切流阶段新增 WAF、Custom Rule、Rate limiting 或 Bot Fight Mode。
- Supabase `Site URL` 已切换为 `https://mylinker.net/`，Redirect URLs 保留 localhost、GitHub Pages legacy、Cloudflare Pages preview、`mylinker.net` 和 `www.mylinker.net`。
- 主域名手动回归已完成：Auth、账号托管恢复、同步、Storage、数据恢复中心和 P0 数据保全路径通过。
- 演练并记录 Cloudflare Pages 回滚、Supabase Auth 回滚和旧站 fallback 路径。
- 后续继续观察 24 小时以上，作为运行期监控，不阻塞 Phase 1.14.7 完成状态。

## Phase 1.15 Breakdown

Phase 1.15 采用分层交付：先固化语言偏好的数据模型和兼容边界，再落地 Provider、设置页入口和主路径文案。简体中文和英语作为 v1 质量基线，繁体中文、法语、西班牙语、日语、韩语和意大利语先达到可用，再逐步精修。

### Phase 1.15.0：多语言数据模型与 migration

状态：已完成。

目标：把“保存的语言偏好”和“实际渲染语言”拆开，为 `system` 和更多语言建立兼容的数据模型。

已完成：

- 扩展前端语言类型，支持 `system`、`zh-CN`、`zh-TW`、`en-US`、`fr-FR`、`es-ES`、`ja-JP`、`ko-KR`、`it-IT`。
- 定义 `LocaleMode` / `ResolvedLocale` 或等价模型：`system` 只作为偏好保存，渲染时解析为具体 locale。
- 更新 `homepage:ui-preferences:v1` 的本地偏好 normalize 逻辑，兼容旧的 `zh-CN | en-US` 值。
- 新增最小 Supabase migration，放宽 `account_preferences.locale` 约束，不新增表，不改变 RLS、grant、默认空间和账号托管数据模型。
- 新增 verify SQL，确认新语言值、RLS、权限和旧数据兼容。
- 保持数据包、首页文档、同步码和历史快照不新增语言字段；语言仍属于账号/本地偏好，不进入 `HomeDocumentV2`。

### Phase 1.15.1：I18n Provider 与 formatter 底座

状态：已完成。

目标：建立静态 dictionary、翻译函数和统一格式化入口，避免组件直接散落 `Intl` 和硬编码语言判断。

主要任务：

- 新增 `I18nProvider`、`useI18n()`、`t()` 和必要的 typed key 结构。
- 新增静态 dictionary 目录，v1 先保证简体中文和英语完整可用，其他语言可先使用人工维护的基础翻译。
- 新增 `resolveLocale()`，根据 `system`、浏览器语言和支持列表解析最终 locale。
- 新增 `formatDateTime()`、`formatRelativeOrShortDate()`、`formatMonthLabel()` 等统一 formatter。
- 将 `html lang` 设置为 resolved locale，而不是保存值 `system`。

### Phase 1.15.2：设置页语言选择落地

状态：已完成。

目标：让用户能在设置页切换语言，并按登录状态保存到账号或本机。

主要任务：

- 扩展“通用设置”中的语言选项：系统、简体中文、繁体中文、英语、法语、西班牙语、日语、韩语、意大利语。
- 未登录用户保存到 `homepage:ui-preferences:v1`，登录用户保存到 `account_preferences.locale`。
- 设置页摘要显示当前语言模式和 resolved locale。
- 保存失败时保留当前偏好，不影响首页数据和同步状态。
- 回归账号登录、退出登录、跨浏览器账号偏好同步和本地偏好回退。

### Phase 1.15.3：首页主路径本地化

状态：已完成。

目标：优先覆盖用户每天看到的首页主路径，形成可感知的多语言体验。

主要任务：

- 首页标题区系统文案、日期、搜索栏 placeholder/按钮、网站收集区入口、空状态和基础操作接入 i18n。
- Widget Shell 标题旁操作、组件空状态和通用按钮接入 i18n。
- 搜索引擎名称、用户自定义分组名、网站名、页面标题和 Todo 内容不翻译。
- 确认移动端长文本不重叠，尤其是法语、西班牙语、意大利语。

### Phase 1.15.4：设置页核心路径本地化

状态：已完成。

目标：覆盖设置页的一级栏目、摘要和核心操作，让配置流程在多语言下可完成。

主要任务：

- 账号、首页空间、主题风格、Banner/背景、通用设置、数据恢复中心和高级操作的标题、摘要、按钮、空状态接入 i18n。
- 保留危险操作和 P0 数据保全文案的准确性，避免翻译弱化风险提示。
- 数据恢复中心的本地/云端历史版本选择、预览和恢复确认接入 i18n。
- 高级操作中的导入导出、审计、本机状态等高风险入口保持清晰可理解。

### Phase 1.15.5：组件、同步和恢复细节本地化收口

状态：已完成。

目标：补齐 Todo、月历、同步面板、导入流程和错误/状态提示中的剩余硬编码文案。

主要任务：

- Todo List、月历和后续 Widget 候选统一复用 i18n 和 formatter。
- 同步码、账号托管同步、冲突处理、暂停状态和云端/本地覆盖确认接入 i18n。
- 书签/URL 导入、撤销导入、模板应用和危险写入保护提示接入 i18n。
- 错误边界、错误监控用户提示和本地审计展示文案接入 i18n；埋点事件名不本地化。

### Phase 1.15.6：质量回归与文档

状态：已完成。

目标：完成多语言 v1 的质量回归、文档记录和可维护性检查，确保后续新增文案不会再次失控。

主要任务：

- 补充 Phase 1.15 实施记录和用户说明。
- 增加缺失翻译 key 检查或构建期校验，避免 runtime 出现明显 key 名。
- 执行桌面、平板、移动端布局回归，重点检查长文本按钮、select、恢复中心和同步冲突提示。
- 执行账号偏好、本地偏好、Magic Link、账号托管恢复、同步码绑定、Storage 图片和数据恢复中心回归。
- 明确 v1 支持范围：产品 UI 本地化；用户自定义内容、外部网站标题、导入数据和埋点事件名不自动翻译。

已完成：

- 新增 `scripts/verify-i18n-messages.mjs` 与 `npm run verify:i18n`，校验 placeholder 一致性、无效 override key，以及 `settings.document.class.*`、`settings.sync.*`、`settings.import.*`、`settings.error.*`、`settings.audit.*`、`settings.device.*`、`settings.analytics.*` 在 `fr-FR`、`es-ES`、`ja-JP`、`ko-KR`、`it-IT` 不再回落英语。
- 补齐上述关键路径在法语、西班牙语、日语、韩语、意大利语的文案覆盖；繁体中文继续通过 `settings.*` 转换器生成。
- 明确共享产品名和稳定技术名可保留原样，例如模板 preset 名、`Magic Link`、埋点事件名、监控 operation 和用户自定义内容。
- 完成 `fr-FR`、`es-ES`、`ja-JP`、`ko-KR`、`it-IT` 在桌面、平板、移动端的设置页多视口回归；同步、恢复中心、导入、本机状态、审计和产品改进区块未发现横向溢出。
- 修复书签/URL 导入面板默认提示使用 `useState` 初始化后无法随语言偏好加载更新的问题，避免小语种下短暂或持续显示简中文案。

## Phase 1.16 Breakdown

### Phase 1.16：低成本组件扩展

状态：已完成并部署。

目标：在现有 Widget Registry、Widget Shell、统一配置弹窗、快照、同步和恢复体系上，新增少量纯前端、低数据体积、高日常价值的组件。Phase 1.16 不是组件市场阶段，不接联网组件，不引入后端服务，不扩大账号权限边界。

阶段边界：

- 只实现纯前端组件，数据继续写入 `HomeDocumentV2.widgets[].config`。
- 不新增 Supabase 表、RPC、Storage bucket、Edge Function 或第三方 API key。
- 不接入 OAuth、浏览器定位、通知提醒、服务端缓存或后台任务。
- 不把 Notes 正文、倒计时标题、城市名称、时区配置等用户意图内容写入基础埋点、错误监控或本地审计 metadata。
- 新组件必须复用现有 Widget Shell、统一配置入口、折叠摘要、空状态、错误态和触屏可达性规则。
- 新组件进入模板前必须先验证默认信息密度，不能让新空间首屏变拥挤。

### Phase 1.16.0：组件扩展设计收口

状态：已完成。

目标：先把 Notes、Countdown 和 World Clock 的数据模型、交互边界、隐私约束和验收标准写清楚，避免实现阶段范围漂移。

主要任务：

- 新增 `docs/implementation/phase-1/Phase1_16_Implement.md`，记录 Phase 1.16 的阶段边界和实施计划。
- 为每个候选组件定义 `HomeWidgetType`、`config` 字段、默认配置、normalize 规则、展开态、折叠摘要、配置弹窗字段和空状态。
- 明确每个组件是否允许多个实例、是否适合加入模板、是否需要迁移旧数据。
- 明确埋点、错误监控和本地审计的脱敏边界：只记录 widget type、动作类别和数量级，不记录正文、标题、城市名或完整 config。
- 明确验收基线：`typecheck`、`lint`、`build`、`verify:export`、`verify:i18n`，以及桌面、平板、移动端多视口回归。
- 新增 `docs/implementation/phase-1/Phase1_16_Implement.md`，固化 Notes、Countdown、World Clock 的 config shape、展开态、折叠摘要、配置入口、隐私边界和模板候选策略。

### Phase 1.16.1：Notes v1

状态：已完成并部署。

目标：提供轻量便签组件，满足短备忘、临时想法和链接说明等首页工作台需求。

实现范围：

- 新增 Notes widget type：`notes.list`。
- `widget.config` 保存短便签列表：`id`、`text`、`order`、`createdAt`、`updatedAt`。
- 限制数据体积：最多 20 条便签，单条 500 字符。
- 展开态支持添加、编辑、删除和排序；空状态提示添加第一条便签。
- 折叠摘要只显示数量或最近更新时间，不显示正文。
- 配置弹窗支持组件名称和便签数量只读统计；布局模式、Markdown、标签、全文搜索和附件暂缓。
- Notes 正文不得进入埋点、错误监控、审计 metadata 或配置弹窗摘要。

主要改动点：

- `src/domain/home-document.ts`：扩展 `HomeWidgetType`。
- `src/domain/widget-registry.ts`：注册 Notes 定义、默认配置和 normalize。
- `src/domain/notes-widget.ts`：新增 Notes config normalize、长度限制和排序工具。
- `src/components/widgets/notes-list-widget.tsx`：新增 Notes 内容组件。
- `src/components/widgets/widget-config-dialog.tsx`：接入 Notes 配置展示。
- `src/components/widget-panel.tsx`：接入渲染分支和折叠摘要。
- `src/i18n/messages.ts`、`src/i18n/home-presentation.ts`：补齐组件名、设置标题、空状态和操作文案。
- 数据恢复预览、模板摘要和数据包回归保持完整组件摘要可读。

实施结果：

- 已提交 `f35a5cf feat: add notes widget`。
- 已推送到 `master` 和 `production`。
- Cloudflare Pages 主站和 GitHub Pages legacy 均已完成部署验证。
- Notes v1 已在 Phase 1.16.4 中进入通用效率和工作办公模板，且默认折叠以控制首屏密度。

### Phase 1.16.2：Countdown v1

状态：已完成并部署。

目标：提供简单倒计时组件，覆盖考试、发布、纪念日和项目节点等低成本高感知场景。

实现范围：

- 新增 Countdown widget type：`countdown.timer`。
- `widget.config` 保存事件标题、目标日期和显示模式。
- 无效日期处理策略：显示未配置状态，不静默生成可能误导用户的日期。
- 目标日期按浏览器本地时区解释；v1 不做提醒、通知、重复事件、日历联动或服务器时间校准。
- `days-hours` 模式使用精确剩余时长，24 小时内显示小时，超过 24 小时显示天数和小时；`days` 模式显示日历天差。
- 展开态展示事件名、剩余天数、目标日期、今天到期和已过去状态。
- 折叠摘要显示剩余天数、今天到期、已过去或未配置，不显示事件标题。
- 配置弹窗支持组件名称、事件标题、目标日期和显示模式。
- 倒计时标题和目标日期可能包含用户意图，不进入埋点、错误监控或审计 metadata。

主要改动点：

- `src/domain/home-document.ts`：扩展 `HomeWidgetType`。
- `src/domain/widget-registry.ts`：注册 Countdown 定义、默认配置和 normalize。
- `src/domain/countdown-widget.ts`：新增 Countdown config normalize、日期校验和状态计算。
- `src/components/widgets/countdown-timer-widget.tsx`：新增 Countdown 展示组件。
- `src/components/widgets/widget-config-dialog.tsx`：接入 Countdown 配置字段。
- `src/components/widget-panel.tsx`：接入渲染分支和折叠摘要。
- `src/i18n/messages.ts`、`src/i18n/home-presentation.ts`：补齐组件名、设置标题、配置项、空状态和状态文案。

### Phase 1.16.3：World Clock v1

状态：已完成并部署。

目标：提供纯前端世界时钟组件，服务开发者、远程协作和跨时区工作场景。

实现范围：

- 新增 World Clock widget type：`world-clock.list`。
- `widget.config` 保存时钟列表：`id`、`label`、`timeZone`、`order`。
- 使用浏览器 `Intl.DateTimeFormat` 和 IANA timezone，不接定位、不接天气、不接外部 API。
- 限制数据体积：最多 6 个时区。
- 时区选择使用 curated list，避免把完整时区数据库做成沉重配置 UI。
- 展开态显示城市/标签、当前时间和日期偏移提示。
- 折叠摘要只显示时钟数量或空状态，不显示 label/timeZone。
- 城市/标签可能包含用户意图，不进入埋点、错误监控或审计 metadata。

主要改动点：

- `src/domain/home-document.ts`：扩展 `HomeWidgetType`。
- `src/domain/widget-registry.ts`：注册 World Clock 定义、默认配置和 normalize。
- `src/domain/world-clock-widget.ts`：新增 World Clock config normalize、curated timezone list 和排序工具。
- `src/components/widgets/world-clock-list-widget.tsx`：新增 World Clock 展示组件。
- `src/components/widgets/widget-config-dialog.tsx`：接入新增、编辑、删除、排序和 timezone 选择。
- `src/components/widget-panel.tsx`：接入渲染分支和折叠摘要。
- `src/i18n/messages.ts`、`src/i18n/home-presentation.ts`：补齐组件名、设置标题、配置项、空状态、摘要和日期偏移文案。

### Phase 1.16.4：模板组件组合调整

状态：已完成代码接入、自动校验和人工回归。

目标：在新组件稳定后，小幅调整模板默认组件组合，只影响新建首页，不自动修改用户已有首页。

实际调整：

- 空白首页继续不预设组件。
- 极简起步继续保持轻，只保留折叠月历，不默认加入 Notes。
- 通用效率新增折叠 Notes，标题为“快速便签”。
- 工作办公新增折叠 Notes，标题为“工作便签”。
- 学习研究新增折叠 Countdown，标题为“重要节点”，不预设目标日期。
- 开发者工作台新增折叠 World Clock，标题为“协作时区”，预设 UTC、Shanghai、New York 三个通用协作时区。
- 新增模板组件标题已接入 `zh-CN`、`zh-TW`、`en-US`、`fr-FR`、`es-ES`、`ja-JP`、`ko-KR`、`it-IT`。

验收要求：

- 模板默认组件不超过当前信息密度上限。
- 模板卡片、创建流程和组件摘要随新组件本地化展示。
- 只影响新建/套模板首页，不迁移或修改已有首页、快照和云端历史。

### Phase 1.16.5：回归与部署收口

状态：已完成并部署。

目标：完成 Phase 1.16 的自动检查、人工多视口回归、数据保全回归和部署准备。

验收清单：

- `npm run typecheck` 通过。
- `npm run lint` 通过。
- `npm run build` 通过。
- `npm run verify:export` 通过。
- `npm run verify:i18n` 通过。
- `npm run verify:privacy` 通过。
- 首页添加、删除、排序、折叠、配置新组件均可用。
- 本地保存、同步码、账号托管、数据恢复中心、JSON 导出、数据包导出和恢复能保留新组件摘要和 config。
- 桌面、平板、移动端无横向溢出；深色、浅色、紧凑密度和小语种下文案不遮挡。
- 埋点、错误监控和本地审计不记录 Notes 正文、倒计时标题、城市名、时区完整配置或其他用户自定义内容。

实施结果：

- 数据恢复中心为 Notes、Countdown 和 World Clock 增加隐私安全 config 摘要，分别展示便签数量、倒计时状态和时钟数量，不展示正文、事件标题、城市标签或时区明细。
- 本地审计 metadata 增加组件正文、配置、标题、日期、标签、时区、URL 和搜索词等字段的递归脱敏，并规范化大小写、下划线和短横线变体。
- 新增 `verify:privacy`，自动验证审计递归脱敏，以及产品埋点和错误属性白名单拒绝组件自定义内容。
- 修复移动端恢复预览在长警告文案下压缩 Grid 隐式行、导致后续标题与警告重叠的问题；预览内容改为自然高度并进入内部滚动区。
- 已验证开发者工作台模板生成后包含 Todo、Calendar 和折叠 World Clock，World Clock 保留 UTC、Shanghai、New York 三个预设时区。
- 已验证 Notes、Countdown、World Clock 设置入口、管理操作、折叠状态、本地刷新、快照预览、HomeDocument JSON、数据包导出和数据包恢复预览链路。
- 已覆盖桌面 `1440px`、平板 `768px`、移动端 `390px` 和窄屏 `320px`；`zh-TW`、`en-US`、`fr-FR`、`es-ES`、`ja-JP`、`ko-KR`、`it-IT` 下摘要和 World Clock 配置弹窗无横向溢出。
- 本轮使用隔离本地浏览器数据，未创建真实同步码或账号托管测试空间；两条远端链路继续复用完整 `HomeDocumentV2` 序列化，没有新增组件专用传输分支，部署后保留账号态 smoke test。
- 已提交 `f133453 feat: finalize phase 1.16 widget expansion`，并推送 `master` 与 `production`；GitHub Pages workflow、Cloudflare Pages 主站 `https://mylinker.net/` 与 GitHub Pages legacy 均验证返回成功。

## Phase 1.17 Breakdown

### Phase 1.17：只读渲染与分享链接 v1

状态：已完成并于 2026-07-22 通过线上数据库、真实账号、真实 token 与静态部署验收。

目标：在不暴露同步码、账号托管凭证或可编辑首页原件的前提下，为账号托管首页提供可撤销的公开快照分享。该阶段同时沉淀可复用于模板展示、历史预览、未来后台预览和自定义域名的只读渲染底座。

阶段决策：

- 分享的是显式发布的只读快照，不是实时公开当前 `HomeDocumentV2`，后续编辑不会自动更新已发布内容。
- v1 只支持已登录且属于当前用户的账号托管首页空间；普通同步码空间维持密文边界，不支持公开分享。
- 公开 payload 使用独立 `PublicHomeDocumentV1` 投影，不直接返回完整 `HomeDocumentV2`；必须移除 `syncMeta`、账号信息、同步凭证、审计信息和私有资源引用。
- v1 默认公开页面标题、主题外观、分组和网站；Notes、Todo、Countdown、World Clock 等组件及其用户自定义内容默认不进入公开 payload，后续如需公开必须新增明确 opt-in 和逐类审查。
- 分享 token 与同步码、账号托管 access token、encryption key 完全隔离；数据库只保存 token hash。
- 正式公开链接使用 `https://mylinker.net/share/#<token>`；loopback 本地测试使用当前 origin 的 `/share/#<token>`，避免未部署的新路由跳到线上旧构建。token 位于 URL fragment，不随 HTTP 请求或外链 Referer 发送；`/share/` 保持 Next.js 静态导出，兼容 Cloudflare Pages 根路径和 GitHub Pages 子路径。
- v1 不做密码保护、搜索引擎索引、访问统计、访问者身份、协作编辑、公开评论或自定义域名。

### Phase 1.17.0：方案与安全边界收口

状态：已完成。

目标：先固化公开数据、访问控制、撤销与静态部署策略，避免把分享实现成对同步空间的旁路读取。

主要任务：

- 新增 `docs/implementation/phase-1/Phase1_17_Implement.md`，记录数据流、SQL/RPC 边界、交互状态和回归清单。
- 定义 `PublicHomeDocumentV1`、版本字段、允许字段、尺寸上限与 normalize/validate 策略。
- 明确分享快照的创建、更新、撤销、过期和重新发布语义；v1 采用每个账号托管空间最多一个有效分享，撤销后旧 token 不可恢复。
- 明确公开链接的 canonical 域名为 `mylinker.net`，GitHub Pages 仅验证静态入口兼容，不作为对外推荐链接。
- 明确隐私、noindex、缓存和错误态要求；不记录 token、完整网站 URL、标题或公开 snapshot 内容到埋点、错误监控和本地审计。
- 新增 `docs/implementation/phase-1/Phase1_17_Implement.md`，固化交付顺序、`PublicHomeDocumentV1` 白名单字段、尺寸上限、最小授权 RPC 合约、静态入口与完整验收清单。
- 明确 token 仅保存在创建/更新成功的当前会话内；数据库只保存 hash，刷新后不能复制旧链接，重新发布会生成并替换为新链接，避免 token 进入本地持久化或审计路径。

### Phase 1.17.1：只读 Renderer 基座

状态：已完成。

目标：抽离与数据来源无关、没有编辑副作用的首页展示层。

主要任务：

- 建立接收规范化 document 与展示模式的只读 renderer，复用现有主题、分组、网站和站点图标展示能力。
- 明确只读模式不挂载编辑弹窗、拖拽、配置入口、同步、本地快照、恢复、账号管理或 localStorage 写入。
- 补齐加载、空内容、无效 payload 和渲染失败的稳定降级状态。
- 保持现有可编辑首页行为不变，并为模板、历史版本和后台预览预留相同 renderer 入口。
- 新增 `ReadOnlyHomeRenderer`、`ReadOnlyHomeRendererBoundary` 和最小只读展示模型；仅展示标题、主题、分组及站点，不包含搜索、组件或编辑操作。
- 新增不访问账号、Storage、同步或本地偏好的 `ReadOnlyThemeStyleBridge`；仅按 theme preset/accent 与访问者系统深浅色写入视觉 token，并明确不加载 Banner/背景资源。
- `SiteIcon` 改为仅依赖 `url`/`mark`，对非法 URL 或非 HTTP(S) 协议稳定回落到 mark；公开 renderer 对非法站点 URL 不生成链接。
- `npm run typecheck`、`npm run lint`、`npm run build` 和 `npm run verify:export` 已通过。

### Phase 1.17.2：公开数据投影与隐私校验

状态：已完成。

目标：让发布内容从源文档中显式派生，确保公开 API 永远无法返回私密字段。

主要任务：

- 实现从 `HomeDocumentV2` 到 `PublicHomeDocumentV1` 的白名单投影与标准化，不复用对象扩展或黑名单删除。
- 移除 sync metadata、账号信息、组件 config、搜索历史、审计/恢复信息、Storage 私有 URL 和其他不可公开字段。
- 对外链图片和远程资源采用保守策略：v1 不包含用户 Banner/背景图片；保留安全的本地 appearance preset 与站点图标 fallback。
- 新增自动校验，覆盖投影字段、敏感字段缺失、payload 大小、无效输入和稳定序列化。
- 新增 `PublicHomeDocumentV1` 与共享只读模型，采用逐字段白名单投影、派生公开 ID、严格字段/数量/UTF-8 payload 上限和 canonical HTTP(S) URL 校验。
- 新增严格 parser 与固定字段顺序序列化；未知字段、危险 URL、非法 schema、部分内容过滤和不支持版本均不能进入后续分享存储。
- 新增 `verify:public-document` 并扩展 `verify:privacy`，自动验证组件/同步/账号/asset sentinel 缺失和分享 token/公开 payload 的观测脱敏。

### Phase 1.17.3：Supabase 分享快照与 RPC

状态：已完成；目标 Supabase 已执行 `018`，并通过 `020`、`019` 与真实发布回归。

目标：建立独立、最小授权的公开快照存储和读取路径。

主要任务：

- 新增分享快照表、必要索引和迁移校验脚本；分享表与 `sync_spaces`、账号托管凭证和云端历史物理隔离。
- owner 侧 RPC 只允许当前登录用户为其账号托管空间创建、更新、撤销或查询分享元数据。
- anon 侧只提供按 token 读取有效公开快照的受限 RPC；表本身不向 `anon` 或 `authenticated` 直接开放读取。
- token 使用浏览器密码学随机值，传入 RPC 后哈希比较；严格校验长度、有效状态、过期时间和 payload schema。
- 撤销、过期、无效 token 和不存在记录返回同一公开失败语义，避免枚举分享状态；不在公开读取路径记录用户内容或 token。
- 已新增 `017_public_home_shares.sql`、`018_public_home_share_upsert_conflict_fix.sql`、`019_public_home_shares_verify.sql` 和 `020_public_home_share_upsert_conflict_fix_verify.sql`：分享表与同步空间、托管凭证、云端历史和审计物理隔离；`(home_space_id, user_id)` 复合 FK 绑定账号 owner，并以 `home_space_id`/`token_hash` 唯一约束限制为一个分享和一个 hash。
- 分享 token 固定为 `crypto.getRandomValues()` 生成的 32 字节无 padding Base64URL（43 字符）；RPC 内固定使用 `SHA-256("mylinker-public-share-v1:" || token)`，数据库绝不保存 raw token。
- 新增 `upsert_public_home_share`、`get_public_home_share_metadata`、`revoke_public_home_share` 和 `read_public_home_share`。三个 owner RPC 仅 `authenticated`，公开 read 仅 `anon`/`authenticated`；没有任何 frontend direct table grant 或 RLS policy。
- 新增 v1 JSONB schema validator、固定 `security definer` search path、撤销时 hash 覆盖、过期状态过滤和 token/公开 payload 无日志语义；浏览器 `PublicHomeShareRepository` 只经 RPC 访问并以不保留 raw error 的安全类别区分数据库未更新、会话、空间、网络与内容问题。
- 首次真实发布暴露 `ON CONFLICT (home_space_id)` 与 `RETURNS TABLE` 同名输出变量的 PostgreSQL `42702`；`018` 改为命名约束冲突目标，`017` 同步修正新环境，`020` 校验在线函数定义与 grant。
- 新增 `verify:public-share` 及 SQL rollback A/B 检查；目标数据库已执行 `018` 并通过 `020`、`019` 和真实账号分享验收。

### Phase 1.17.4：分享管理与发布预览

状态：已完成；真实 owner 发布、更新、刷新后重新发布与撤销链路已通过回归。

目标：在已有账号空间管理路径中提供可理解、可撤销的发布操作。

主要任务：

- 增加创建分享、公开预览、复制链接、更新已发布快照、撤销分享和重新发布入口。
- 发布前展示实际 `PublicHomeDocumentV1` 预览和不可公开内容说明，确认后才调用创建/更新 RPC。
- 明确“编辑首页不会自动更新分享”的状态摘要，并在有已发布快照时提供显式更新操作。
- 链接复制失败时提供可见且可访问的降级提示；撤销操作使用明确确认，成功后立即清除 UI 中旧链接。
- 所有新增文案纳入现有 i18n dictionary；管理 UI 在窄屏和小语种下保持可操作。

实施结果：

- 设置页“首页空间”内新增公开快照分享面板，覆盖账号/空间资格说明、owner metadata、实际公开预览、字段边界、发布/更新/刷新后重新发布、复制 fallback 和撤销确认。
- token/链接只存在于当前页面会话的只读输入框，不进入本地持久化、埋点、错误监控或审计；资格变化与撤销会清空链接。
- 八种支持语言均有分享路径文案，预览、metadata、链接和操作在窄屏下降为单列。

### Phase 1.17.5：公开分享页与静态部署兼容

状态：已完成；真实 token、通用失败语义与双站静态部署已通过 smoke test。

目标：在两个静态站点目标上可靠加载公开快照并以只读方式渲染。

主要任务：

- 新增静态 `/share/` 页面，客户端从 URL fragment 读取 token 并调用受限公开 RPC。
- 设置公开页标题、`noindex` metadata、加载、网络失败、无效/撤销/过期链接和空快照状态；错误文案不透露 token 是否曾有效。
- 渲染完成后不展示编辑、登录恢复、同步、设置或数据恢复入口；外链保持安全的 `noopener noreferrer` 行为。
- 校验 `NEXT_PUBLIC_BASE_PATH` 下的资源、返回入口和 URL 生成，分别覆盖 Cloudflare Pages 根路径与 GitHub Pages legacy 子路径。

实施结果：

- 新增静态 `/share/` 页面；token 仅从 fragment 读取且不进入 React state，公开 RPC 成功后只渲染严格解析的 `PublicHomeDocumentV1`。
- 缺少、随机、撤销、过期 token、网络失败与非法响应使用同一失败页；固定 title 和 `noindex/nofollow/noarchive/nocache` metadata 不含用户内容。
- 根路径与 `/PersonalHomepge` 两套构建均已验证 `out/share/index.html`、robots 和 `_next` 资源前缀；对外链接固定为 `mylinker.net`。

### Phase 1.17.6：回归、上线与运行观察

状态：已完成；仓库门禁、数据库 A-B、真实账号交互、真实 token 与线上静态入口均已通过。

目标：完成公开数据、权限、静态导出和双站发布的端到端收口。

验收清单：

- `npm run typecheck`、`npm run lint`、`npm run build`、`npm run verify:export`、`npm run verify:i18n`、`npm run verify:privacy` 均通过。
- 新增 Supabase migration 与只读验证脚本通过：无直接表读取权限、owner 隔离、anon 只能按有效 token 获取投影快照、撤销/过期立即失效。
- 公开 payload 不含同步码、access token、encryption key、账号资料、`syncMeta`、组件用户内容、Storage 私有 URL 或审计信息。
- 创建、预览、复制、更新快照、撤销和重新发布均经过人工回归；已撤销链接和随机 token 显示相同通用失败页。
- 桌面、平板、移动端以及全部支持语言下，公开页和分享管理 UI 无横向溢出、无编辑入口；token 只允许存在于分享 URL fragment 和 Supabase RPC TLS request body，不得泄露到可观测 metadata。
- Cloudflare Pages 主站与 GitHub Pages legacy 均完成 `/share/` 静态入口验证；对外复制链接始终指向 `mylinker.net`。

本地实施结果：

- 类型、lint、i18n、公开投影、分享 token/权限合约、观测隐私、构建和静态导出校验保持为本地回归门禁。
- 自动校验已覆盖 canonical fragment URL、分享组件不持久化/不上报、公开页 token 不进入 React state、静态 share entry、robots、A/B rollback SQL 防偏差和部署 smoke 脚本存在性。
- 2026-07-22 已运行 `npm run verify:public-share-deployment`，Cloudflare Pages preview、`mylinker.net` 与 GitHub Pages legacy 的无 token `/share/` 静态入口均通过 HTTP 200/robots smoke test。
- `PublicHomeShareDatabaseRunbook.md` 已固化 `017`/`018`、`020`、`019` 只读检查、transaction-scoped A/B、部署 smoke test、真实账号验证和不删数据的 execute-grant 安全回滚。
- 2026-07-22 目标 Supabase 已执行 `018`，`020`、`019` Section 1-7 与 transaction-scoped A/B 检查均通过；测试事务未保留 A/B 临时分享数据。
- 真实账号已完成公开快照的发布、更新、撤销、重新发布和新旧 token 失效语义检查；普通同步码空间、未登录用户、非 owner、随机 token、撤销 token 与过期 token 均保持规划中的拒绝或通用失败行为。
- Phase 1.17 至此完成生产闭环，后续不再增加 1.17 子阶段，仅保留缺陷修复、安全回归和运行观察。

## Phase 1.18 Breakdown

### Phase 1.18：受控服务端与只读后台 Dashboard v1

状态：1.18.0 与准备阶段已完成；1.18.1 已完成仓库、本地、CI 和线上数据库门禁，待 1.18.2 联调前初始化测试管理员；Edge Function、私有 Admin 仓库和 Access 配置尚未实施。

目标：建立第一条受控服务端管理链路，使授权管理员能够在强审计、最小权限和不破坏普通同步码密文边界的前提下，精确查询账号、查看空间元数据、账号托管云端历史和用户侧云端审计，并受控预览单个账号托管快照。

阶段决策：

- 后端采用 Supabase Edge Functions；Admin UI 固定使用私有源码仓库、独立 Next.js static export、独立 Cloudflare Pages project 和 `admin.mylinker.net`，不进入公开主站 `/admin/`、主站 bundle 或 GitHub Pages legacy。
- Cloudflare Access 必须分别保护 `admin.mylinker.net`、生产 `<admin-project>.pages.dev` 和全部 `*.<admin-project>.pages.dev` 预览入口；采用默认拒绝、精确管理员身份/组、MFA 和短会话。
- Access 只负责页面资源的外层门禁；Supabase Edge Function 仍对公网请求执行 JWT、`admin_users.enabled` 和 role matrix 校验，普通用户即使直接调用 API 也不能获得管理数据。
- service role 只存在于 Edge Function 环境；静态前端只使用 anon key 和当前管理员 session。
- 管理员身份由 `admin_users` 控制，角色为 `owner`、`admin`、`support`；所有跨用户读取都经服务端 JWT、enabled 和 role matrix 检查。
- v1 严格只读。除追加 `admin_audit_events` 外，不创建、修改、恢复、删除或导出任何用户数据。
- `support` 不得读取快照正文或其他管理员的审计；owner/admin 的每次快照预览都需要独立理由并在审计成功后才返回内容。
- 普通同步码空间只显示允许的元数据，不返回密文、凭证或明文；账号托管“当前内容”只表示最新云端快照，不读取当前 `sync_spaces`。
- 搜索采用精确 UUID、精确邮箱或精确空间 UUID，不提供模糊用户目录、全量列表或无条件遍历。
- 管理搜索、理由、响应和用户内容不得进入 URL、浏览器持久化、analytics、error monitoring、本地审计或 console。
- 当前公开主仓库只保存可公开审阅的数据库、Edge Function、验证和计划内容；Admin UI 页面、组件、样式、构建产物与私有仓库凭据不得提交到主仓库。
- 完整实施基线见 `docs/implementation/phase-1/Phase1_18_Implement.md`；backlog 仅保留原始候选背景。

### Phase 1.18.0：方案与安全边界

状态：已完成规划，未修改运行时代码或数据库。

已完成：

- 固定 Edge Function + 私有独立 Admin Pages + Cloudflare Access 架构，以及主站/GitHub Pages 零后台资源和 service role 隔离。
- 固定自定义域名、生产 `pages.dev`、预览通配域名三类 Access 门禁与未授权资源验证；明确域名存在性可以被发现，但后台 HTML/JS/CSS 和数据不得向普通用户返回。
- 固定管理员角色矩阵、精确查询边界、强审计与 fail-closed 语义。
- 固定账号托管快照与普通同步码空间的数据边界。
- 固定 1.18.1-1.18.6 文件范围、交付顺序、自动校验、A/B/C 回归、部署和不删审计的安全回滚。
- 明确生产初始化前仍需提供首个 owner 的精确 Supabase Auth UUID、测试账号/空间、私有 Admin 仓库、独立 Pages project、Access IdP/管理员 allow policy 和回滚窗口；人员身份、UUID 对照与凭据不得提交到公开仓库。
- 2026-07-25 已完成本地 Supabase 配置、PostgreSQL 17 migration replay、数据库 lint/pgTAP、Deno Functions 测试基线和只读 GitHub Actions；没有 link 或修改远端 Supabase。

### Phase 1.18.1：管理员身份与审计数据库

状态：仓库、本地、CI 和线上数据库门禁已完成。

目标：新增 `admin_users`、`admin_audit_events`、RLS/zero-direct-grant 边界、`019` migration、`021` verify 和管理员初始化/停用运行手册。不得修改既有用户表权限或在 migration 中硬编码管理员。

实施结果：已新增 `019`、`021`、Phase 1.18.1 pgTAP 和 `AdminDashboardRunbook.md`。本地 PostgreSQL 17 从空库重放 `001-019`、数据库 lint、`56` 项 pgTAP 和完整 `021` A/B/C rollback 检查均通过，回滚后测试数据为零；默认 dry-run、history fail-closed、SQL 白名单、protected Environment 审批和 project-ref 二次确认的远程 workflow 已上线。2026-08-10 经一次性受保护审计将手动执行的 001-019 schema 与 CLI history 对齐；后续标准 dry-run 显示远端 up to date，verify 再次通过 021 rollback。一次性 repair 入口已删除，没有持久化管理员记录。

### Phase 1.18.2：受控 Edge Function 基座

状态：待实施。

目标：实现 `admin-read` 的 POST-only 协议、JWT 验证、管理员 enabled/role 校验、CORS、请求大小限制、稳定错误码、服务端字段白名单和审计 helper。权限判断不得相信客户端 role 或隐藏路由。

### Phase 1.18.3：只读查询 API

状态：待实施。

目标：实现精确用户解析、空间列表、账号托管快照摘要、服务端投影后的单快照预览 DTO、用户侧云端审计和管理员审计六类 operation；原始 `document_json` 不返回浏览器，所有列表分页且最多 50 条，敏感响应在审计失败时 fail closed。

### Phase 1.18.4：独立 Admin Pages 基座

状态：待实施。

目标：在负责人确认的私有仓库中新增独立 Admin Pages static export，通过 `admin.mylinker.net` 提供 Supabase 登录、精确搜索、空间/快照/审计列表和安全错误态；主站及 GitHub Pages 不新增 `/admin/` 或后台 bundle。查询条件、访问理由和响应只保存在组件内存，不提供用户数据写入、导出或 raw JSON 操作。

### Phase 1.18.5：受控快照预览

状态：待实施。

目标：保持 Phase 1.17 公开投影不变，由 Edge Function 新增独立 admin snapshot preview 服务端投影，私有 Admin Pages 只接收严格 DTO；owner/admin 可只读查看标题、主题、分组、网站、组件和图片配置状态，support 被前后端同时拒绝。预览不加载外链或 Storage 图片，不挂载编辑、同步、恢复、持久化或观测副作用。

### Phase 1.18.6：回归、部署与运行观察

状态：待实施。

目标：补齐公开主站隔离检查、私有 Admin Pages 专项校验、隐私检查、`021` 数据库验证、owner/support/普通账号 A/B/C API 回归，并分别保护 `admin.mylinker.net`、生产 `pages.dev` 和所有预览入口；完成 Access + Supabase 双层门禁、审计 fail-closed 与不公开 Pages 内容的安全回滚演练。

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
- `homepage:legacy-notice:v1`：GitHub Pages 旧站迁移提示是否已关闭，仅本机。

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

Phase 1.14 主域名准备未新增 Supabase migration，已调整 Supabase Auth `Site URL`、`Redirect URLs` 和相关生产环境变量。Phase 1.15.0 已新增 `016_account_preferences_i18n_locale.sql`，复用 `account_preferences.locale` 保存语言模式；该 migration 只放宽 locale 约束，不新增账号偏好表。

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
