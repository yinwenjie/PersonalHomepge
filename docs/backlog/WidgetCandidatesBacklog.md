# Widget Candidates Backlog

## Summary

本文档是 Phase 1.12.6 的交付物，用于评估 Todo 和月历之后的下一批组件候选。当前组件体系已经具备 Widget Registry、统一 Widget Shell、统一配置入口、Todo/月历体验优化和模板默认组件组合；下一步如果继续新增组件，必须先判断它是否适合“首页轻量工作台”，以及是否会引入隐私、同步体积、后端 API、账号权限或商业化复杂度。

Phase 1.12.6 只做候选设计和排序，不新增 `HomeWidgetType`，不修改 `HomeDocumentV2.widgets` schema，不新增 Supabase 表、RPC、Storage bucket 或复杂组件市场。

## Decision Principles

- 优先选择纯前端、低数据体积、可随完整首页文档同步的组件。
- 组件应当增强首页的日常使用，而不是把首页变成完整项目管理、内容阅读或开发平台。
- 内容敏感的组件必须默认脱敏：错误监控、基础埋点、本地审计都不能记录用户输入内容或完整 config。
- 需要 API key、OAuth、代理抓取、缓存或第三方 token 的组件，不直接进入近期实现。
- 新组件必须复用现有 Widget Shell、统一配置入口、折叠摘要、空状态、错误态和触屏可达性规范。
- 新组件进入模板前必须先验证默认信息密度，不能让新空间一打开就显得拥挤。

## Candidate Tiers

### Tier 1：低风险优先候选

这些组件可以优先作为下一批实现候选，基本不需要后端或外部 API。

| 候选组件 | 用户价值 | 数据边界 | 同步/快照影响 | 风险 | 建议 |
|---|---|---|---|---|---|
| Notes / 便签 | 记录短备忘、临时想法、链接说明 | 文本写入 `widget.config`，建议限制长度和条数 | 随完整首页文档同步和进入历史快照 | 内容可能敏感，必须避免埋点/错误记录正文 | P1，适合做 Notes v1 |
| Countdown / 倒计时 | 考试、发布、纪念日、项目节点提醒 | 标题、目标日期、显示模式写入 `widget.config` | 体积极小，适合快照 | 时区和日期边界需要清楚 | P1，适合做 Countdown v1 |
| World Clock / 世界时钟 | 跨时区协作、开发者和远程工作 | 城市/时区列表写入 `widget.config` | 体积小，纯前端计算 | 时区选择 UI 需要克制 | P1，适合做 World Clock v1 |

### Tier 2：中风险候选

这些组件用户价值明确，但需要额外后端、第三方 API、缓存或更强隐私设计。

| 候选组件 | 用户价值 | 数据边界 | 后端/API 需求 | 主要风险 | 建议 |
|---|---|---|---|---|---|
| RSS | 订阅新闻、博客、产品更新 | feed URL 和显示偏好可写入 config，但文章缓存不宜写入首页文档 | 需要代理抓取和缓存，静态 GitHub Pages 前端不能可靠跨域抓取 | CORS、抓取失败、缓存、内容体积、隐私 | 延后到有受控服务端或 Edge Function 后 |
| Weather / 天气 | 日常查看天气 | 城市/地区和单位偏好写入 config | 需要天气 API、服务端代理或安全的 API key 管理 | API 成本、定位隐私、缓存和失败降级 | 延后，先做城市手动选择方案设计 |
| GitHub | 开发者查看 PR、Issue、Repo 状态 | repo 列表和展示偏好写入 config；token 不能进入首页文档 | 公共数据可匿名 API，私有数据需 OAuth/token | rate limit、OAuth、隐私、token 存储 | 先评估 public repo v1，私有数据暂缓 |

### Tier 3：暂缓候选

这些组件容易把首页推向完整应用或平台能力，暂不进入近期实现。

| 候选组件 | 暂缓原因 | 后续条件 |
|---|---|---|
| 日程/外部日历集成 | 需要 OAuth、日历权限、冲突/隐私边界，复杂度高于现有月历 | 账号权限和服务端 token 模型明确后再设计 |
| 文件/附件组件 | 依赖 Storage、文件生命周期、加密和容量策略 | Phase 1.16 后或文件缓存需求独立阶段 |
| 邮件/消息组件 | 权限极高，隐私风险大 | 不进入个人首页 MVP 近期范围 |
| AI 摘要/智能整理组件 | 成本、隐私、提示注入和计费复杂 | Phase 2 AI 能力统一规划 |
| 股票/基金/比赛比分 | 实时数据、地区差异、API 成本和合规风险 | 等 API 策略和商业化模型稳定后 |
| 复杂看板/项目管理 | 会和 Todo 边界重叠，容易变成独立应用 | 先增强轻量 Todo，不做项目管理套件 |

## Recommended Implementation Order

如果 Phase 1.15 多语言支持之后继续推进组件实现，建议顺序如下：

1. Notes v1：最贴近首页轻量工作台，纯前端可做，但必须加长度限制和隐私边界。
2. Countdown v1：实现成本低，适合工作、学习、发布、生活场景，也适合模板默认组合候选。
3. World Clock v1：对开发者和跨时区工作有明确价值，纯前端实现，配置体积小。
4. RSS design only：等服务端/Edge Function 策略稳定后再决定是否实现。
5. Weather design only：先确认 API key、缓存、城市选择和隐私策略，再实现。
6. GitHub public repo design：仅考虑 public repo，不碰 OAuth 和 private repo，等开发者用户需求更明确后再实现。

## Component Design Template

后续每个候选组件进入实现前，都应补齐以下信息：

- 组件名称和 `HomeWidgetType` 候选值。
- 目标用户和默认使用场景。
- 首页展开态展示内容。
- 折叠摘要展示内容。
- 空状态、错误态和加载态。
- 配置字段和默认值。
- 数据是否写入 `HomeDocumentV2.widgets[].config`。
- 是否会进入本地历史、云端历史和数据包导出。
- 是否需要 Supabase 表、RPC、Storage、Edge Function 或第三方 API。
- 是否需要账号登录、OAuth、token 或用户地理位置。
- 埋点、错误监控和审计的脱敏边界。
- 是否适合加入六个模板的默认组件组合。
- 移动端和触屏交互规则。

## Data Boundary Notes

- Notes 正文、倒计时标题、城市名称、RSS feed URL、GitHub repo 名称都可能带有用户意图，不能进入基础埋点或错误监控。
- 纯前端组件优先写入 `HomeDocumentV2.widgets[].config`，继续复用本地保存、同步码、账号托管、快照和数据包恢复。
- 大体积列表、文章缓存、天气响应、GitHub API 响应不应直接写入首页文档。
- 任何 token、OAuth refresh token、API key、service role 或第三方凭证都不能进入 GitHub Pages 前端代码、首页文档、localStorage 数据包导出或错误上报。

## Acceptance For Phase 1.12.6

- 已建立候选组件 backlog。
- 已明确低风险、中风险和暂缓候选。
- 已给出下一批组件推荐顺序。
- 已定义后续组件进入实现前的设计模板。
- 未新增运行时代码、widget type、SQL、RPC 或 Storage。
