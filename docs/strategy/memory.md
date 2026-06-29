# Product Memory: Browser Homepage Strategy

## Product Thesis

This product should not be positioned narrowly as a "custom browser homepage."

The long-term product thesis is:

> Become the first workspace people see when they open the internet.

The strongest positioning is:

> Personal Internet OS: a personal and team workspace at the browser entry point.

Users are not really buying background images or link cards. They are buying order, speed, continuity, and a calm starting point before entering the internet.

## Strategic Judgment

The browser homepage and new-tab page are commercially valuable because they sit before search, browsing, work, shopping, reading, and daily web habits. It is a high-frequency, high-trust position.

The product can become a company's flagship product, but only if it expands beyond visual customization into a durable browser workspace:

- Personal homepage and new-tab replacement
- Bookmark and link organization
- Widgets such as calendar, todo, notes, weather, RSS, GitHub, Notion, and custom embeds
- Search across personal links, tasks, notes, and archived pages
- AI-assisted organization and workflow launch
- Team workspace for company links, announcements, onboarding, and daily tools

If it remains only a pretty homepage, the ceiling is limited. If it becomes the user's browser entry layer, the ceiling is much higher.

## Commercial Ceiling

Estimated revenue ceiling by product maturity:

| Stage | Product Type | Revenue Potential |
|---|---|---:|
| Small personal tool | Custom homepage, links, simple widgets | $1M to $5M ARR |
| Strong indie SaaS | Sync, browser extension, Pro subscription, themes, widgets | $5M to $20M ARR |
| Personal productivity brand | AI organization, archive, cross-device workspace, marketplace | $20M to $50M ARR |
| Team workspace product | Shared team homepage, SSO, permissions, audit, templates | $50M to $150M ARR |
| Browser entry platform | Search partnerships, enterprise distribution, AI workflows, marketplace | $300M+ ARR |

The most realistic long-term target is $30M to $150M ARR if the product wins a meaningful niche in personal and team browser workspaces.

The extreme upside requires large-scale distribution through browser extensions, default new-tab adoption, enterprise deployment, and possibly search or marketplace revenue.

## Revenue Model

Primary revenue should come from subscriptions, not ads.

Recommended monetization layers:

| Revenue Layer | Use Case | Notes |
|---|---|---|
| Personal Pro | Advanced widgets, themes, multiple pages, cloud backup, AI features | Best initial paid plan |
| Team Plan | Shared pages, team templates, admin controls, onboarding workspace | Best path to higher ARPU |
| Business Plan | SSO, audit logs, advanced permissions, support, compliance | Needed for serious B2B |
| AI Add-on | AI search, link cleanup, summarization, workflow generation | Can be usage-based |
| Marketplace | Templates, widgets, themes, creator revenue share | Medium-term ecosystem |
| Search partnership | Optional search revenue from user-chosen search providers | Only after scale and trust |
| Affiliate | Transparent, user-benefiting recommendations only | Must be disclosed and conservative |

Avoid intrusive ads. The browser start page is a trust surface. If monetization damages trust, retention and distribution will suffer.

## Product Principles

1. Fast first.
   The homepage must load instantly and let users search or open a site within seconds.

2. Calm by default.
   Visual design should stay minimal, focused, and useful. Avoid decorative noise.

3. User-owned structure.
   Links, groups, widgets, themes, and pages should be portable and exportable.

4. Low-permission browser extension.
   The extension should ask for the minimum permissions needed. Trust matters more than clever automation.

5. Sync without fear.
   Users should trust that their homepage configuration will not disappear.

6. AI as organization, not decoration.
   AI should help classify links, find things, clean duplicates, detect broken links, summarize saved pages, and launch workflows.

7. Team value comes from default context.
   A team's browser homepage can become the place for daily tools, announcements, docs, onboarding, and operational shortcuts.

## Development Roadmap

### Phase 0: Current State

Current product state:

- Static single-file homepage
- Minimal visual dashboard
- Link groups rendered from front-end data
- DuckDuckGo search
- Favicon rendering

Main limitation:

- No user accounts
- No cloud sync
- No secure editing model
- No persistence beyond editing source code

### Phase 1: MVP SaaS Foundation, 0 to 3 Months

Goal:

Validate whether users are willing to set this as their browser homepage.

Core features:

- User registration, login, logout, and password reset
- Per-user homepage data
- Editable groups and website lists
- Public/private page mode
- Basic widgets: calendar and todo list
- Banner image and background image upload
- Import from browser bookmarks
- Responsive homepage editor

Recommended stack:

- Next.js for frontend and server routes
- Supabase Auth for authentication
- Supabase Postgres with Row Level Security for user data isolation
- Supabase Storage or Cloudflare R2 for images
- Vercel for deployment
- Cloudflare for DNS, WAF, Turnstile, and optional image/CDN support
- Sentry for error monitoring
- PostHog or Plausible for product analytics

Success metrics:

- 30% of new users import or create at least 10 links
- 20% of new users set the page as their homepage
- D7 retention above 20%
- Average user opens homepage at least 2 times per day

### Phase 2: Browser Extension and Paid Experiment, 3 to 6 Months

Goal:

Move from "a webpage" to "a browser entry point."

Core features:

- Chrome and Edge new-tab extension
- One-click save current page
- Quick add to group
- Global link search
- Frequently opened sites
- Multiple pages or modes: work, study, personal, weekend
- Initial Pro subscription

Paid plan candidates:

- $4 to $6 per month
- $40 to $60 per year
- Limits on advanced widgets, themes, pages, backup history, and AI features

Success metrics:

- Extension install conversion above 30% among active web users
- D30 retention above 35% for new-tab users
- Free-to-paid conversion between 2% and 5%

### Phase 3: Personal Workspace, 6 to 12 Months

Goal:

Create retention through personal data, workflows, and daily utility.

Core features:

- Widget marketplace v1
- Notes, RSS, weather, countdown, GitHub, Notion, and custom embed widgets
- AI link classification
- Duplicate and broken link detection
- Personal search across links, todos, notes, and archived pages
- Lightweight read-it-later or web archive feature
- Workflow launch: open a set of sites, docs, and tasks together

Paid plan evolution:

- Pro can move toward $6 to $8 per month
- AI features can use usage-based limits
- Annual plan should be strongly encouraged

Success metrics:

- Paid conversion between 5% and 8%
- Average saved links above 50 per active user
- More than 3 active widgets per weekly active user
- Increasing share of users adding personal data every week

### Phase 4: Team Workspace, 12 to 24 Months

Goal:

Open the B2B path and increase ARPU.

Core features:

- Team workspaces
- Shared groups and sites
- Team homepage templates
- New employee onboarding homepage
- Team announcements
- Role-based permissions
- Admin controls
- Audit logs
- SSO for business plans

Pricing candidates:

- Team: $6 to $10 per seat per month
- Business: $12 to $20 per seat per month
- Enterprise: custom pricing for SSO, audit, support, and compliance

Success metrics:

- 100 to 500 paid teams
- 5 to 50 seats per team
- Net revenue retention above 100%
- Meaningful usage from admins and non-admin members

### Phase 5: Browser Entry Platform, 24 Months and Beyond

Goal:

Become a platform rather than only a homepage app.

Core features:

- AI agent for browser workflows
- Personalized morning workspace
- Workflow automation
- Team policy deployment
- Component and template marketplace
- Search partnerships
- Enterprise browser distribution

Long-term monetization:

- Personal Pro
- Team and Business subscriptions
- AI add-ons
- Marketplace revenue share
- Search revenue share
- Enterprise contracts

## Security Strategy

Security is central because the product handles accounts, saved links, personal workflows, team data, uploaded images, and future membership/payment state.

Non-negotiable principles:

- Do not implement authentication from scratch.
- Do not store card data.
- Do not expose service role keys or payment secrets to the browser.
- Do not trust front-end ownership fields such as `owner_id`, `role`, or `plan`.
- Every user-owned row must be protected by database-level authorization.
- Membership status must come from trusted payment webhooks, not client state.

Recommended security architecture:

- Supabase Auth for authentication
- Postgres Row Level Security for all user-owned data
- Server-only routes for admin and payment operations
- Stripe Checkout and Customer Portal for billing
- Stripe webhook signature verification
- Cloudflare Turnstile for abuse-prone forms
- Rate limiting for auth, write, upload, and payment routes
- File upload validation for type, size, and dimensions
- Sentry and audit logs for incident investigation
- Regular backup and restore testing

Important future security features:

- MFA support
- Account deletion workflow
- Export data workflow
- Admin audit logs
- Security event notifications
- RLS policy tests
- Dependency scanning

## Data Model Direction

Core entities:

- `profiles`
- `pages`
- `groups`
- `sites`
- `widgets`
- `todos`
- `assets`
- `subscriptions`
- `audit_logs`

Every user-owned table should include:

- `id`
- `owner_id`
- `created_at`
- `updated_at`

Widget extensibility:

- Use `type` for widget type, such as `calendar`, `todo`, `weather`, `rss`, `notes`
- Use `config` as JSON for widget-specific settings
- Keep widget renderers in a front-end registry
- Keep sensitive integration secrets server-side only

## Key Risks

1. Product stays too shallow.
   If it remains visual customization, it can be copied or replaced by free templates.

2. Browser extension asks for too much permission.
   Trust and store approval are more important than convenience.

3. Monetization damages the homepage.
   Ads, dark affiliate behavior, or aggressive upsells can break user trust.

4. No migration path.
   Users already have bookmarks. Import and export are critical.

5. Mobile experience is ignored.
   Desktop is primary, but mobile viewing and editing should not be broken.

6. AI becomes a gimmick.
   AI must solve organization, search, cleanup, and workflow problems.

7. Team product arrives too early.
   Team features should follow a strong personal product, not replace it prematurely.

## North Star

The long-term north star:

> Become the user's first screen of the internet every day.

The practical short-term north star:

> Increase the number of users who set this product as their homepage or new-tab page and continue using it after 30 days.

## Phase 1之外的长期候选池

Phase 1 路线只保留当前 MVP、产品化体验收口、低成本组件、只读分享和受控后台 v1 的候选。需要商业化、高隐私、Storage 大能力、团队协作、复杂外部集成或平台化分发的方向记录在本节。

### AI 能力

长期方向包括：首页整理、链接分类、重复/失效链接清理、内容摘要、智能搜索和工作流启动。

前置条件：

- 明确哪些首页数据会发送给 AI provider。
- 用户显式授权和关闭入口。
- 调用审计、用量统计和额度控制。
- 提示注入风险评估。
- 结果可解释和可回滚。

### 商业化与权益

候选能力包括：Stripe 订阅或一次性购买、VIP/Pro entitlement、空间数量限制、高级组件权限、AI 额度、高级主题和动态背景、云端历史保留扩展、Storage 容量和文件保留时长。

前置条件：

- 统一 entitlement 和 quota 系统。
- 账号、支付客户、权益和功能开关之间的稳定映射。
- 退款、取消订阅、降级和超额策略。

### 用户自定义域名和公开主页

长期方向：

- 用户可把自定义域名绑定到某个 `home_space`。
- 编辑和账号管理仍通过产品主站完成。
- 自定义域名默认只服务于首页展示或公开只读访问。
- 支持 public slug、SEO 友好的公开只读主页、模板展示页和可分享的个人主页。

前置条件：

- 产品主域名稳定。
- 只读渲染层稳定。
- 分享/公开权限模型。
- 域名所有权验证、证书和路由策略。
- 撤销和隐藏机制。

### 加密文件缓存

长期方向：

- 登录用户在一个浏览器上传文件，另一个登录的首页空间中下载。
- 服务端只保存密文文件和必要元数据。
- 使用 Supabase Storage 或未来对象存储。

重要边界：

- 严格 E2EE 不应把文件解密密钥长期保存在 Supabase 表中。
- 推荐使用独立文件缓存口令派生主密钥。
- v1 需要单文件大小限制、过期清理、quota、失败补偿和 metadata 隐私设计。

### Password-protected 高隐私空间

长期方向：

- 账号可以看到空间元数据，但展示内容需要额外密码或恢复短语。
- 适合不希望账号托管恢复凭证和明文云端历史的用户。

前置条件：

- 新加密模型。
- 密钥恢复/丢失策略。
- 与账号托管、普通同步码空间的边界说明。
- 数据恢复中心和快照策略重新评估。

### 团队/家庭共享

长期方向包括多人维护同一首页空间、membership、role、invite、只读/编辑权限区分。

前置条件：

- 角色模型。
- 冲突处理升级。
- 审计和成员移除策略。
- 与同步码共享边界重新设计。

### 外部日历、邮件和消息集成

暂缓原因：

- OAuth 和 refresh token 风险高。
- 权限极敏感。
- 数据隐私和 token vault 需要受控服务端。
- 容易把首页变成完整工作平台。

### 长期共享底座

长期底座不应为单个功能临时实现，应尽量抽象后复用：

- 受控服务端入口：Edge Function 或独立后端，承载 service role、API key、OAuth token、AI provider 和管理员能力。
- Entitlement/Quota：统一控制 AI、Storage、付费组件、空间数量、云端历史、公开分享和自定义域名。
- Token Vault：保存第三方 OAuth token、API token 或用户授权凭证，不能进入静态前端、首页文档、localStorage 导出或错误上报。
- Data Lifecycle：账号删除、分享撤销、文件过期、云端历史清理、错误/埋点保留期和后台审计保留。
- Admin Audit：管理员查看、预览、导出、恢复辅助都必须留痕。
- Public Rendering：公开主页、自定义域名、分享链接、模板展示和后台预览都应复用只读渲染层。
