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
