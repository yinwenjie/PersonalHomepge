# Phase 1.12 组件设计优化实施记录

## Phase 1.12 总体边界

Phase 1.12 的目标是把已经落地的组件能力从“可用”推进到“日常好用”。本阶段优先优化现有 Todo、月历、组件外壳、组件配置入口和模板默认组件组合，不默认扩展复杂组件市场，不新增 Supabase 表，不改变普通同步码和账号托管同步模型。

组件数据继续以完整首页文档为边界：

- `HomeDocumentV2.widgets[]` 保存组件列表、标题、顺序、折叠状态和配置。
- `todo.list` 的任务继续保存在 `widget.config.items`。
- `calendar.month` 的周起始配置继续保存在 `widget.config.weekStartsOn`。
- 模板默认组件继续通过 preset 生成普通 `HomeWidget`。
- 本地历史版本、账号托管云端历史版本和数据包恢复都继续以完整 `HomeDocumentV2` 为恢复单元。

## Phase 1.12.0：组件体验审计与设计规范

Phase 1.12.0 已完成组件体验审计和后续设计规范沉淀。本阶段没有修改业务代码、没有新增 migration，也没有改变 `HomeDocumentV2.widgets` schema；交付重点是为 Phase 1.12.1-1.12.6 提供明确的实现边界、验收基准和风险约束。

新增文档：

- `docs/guides/WidgetExperienceDesignGuide.md`

审计范围：

- `src/components/widget-panel.tsx`
- `src/components/widgets/todo-list-widget.tsx`
- `src/components/widgets/calendar-month-widget.tsx`
- `src/domain/widget-registry.ts`
- `src/domain/home-document.ts`
- `src/domain/home-template.ts`
- `app/globals.css`
- `docs/implementation/phase-1/Phase1_7_Implement.md`

主要结论：

- 当前组件系统的数据模型选择仍然正确：组件继续内嵌在 `HomeDocumentV2`，能复用本地保存、同步码、账号托管、历史快照、云端历史和数据包恢复。
- 当前最需要收口的是组件外壳，而不是新增更多组件。`WidgetPanel` 同时承担外壳、管理状态、排序、标题编辑和内容分发，Phase 1.12.1 应优先抽出统一 `Widget Shell`。
- Todo 已满足轻量任务清单 MVP，但空状态、完成项、清除完成、移动端按钮密度和轻量筛选需要优化；不应在 Phase 1.12.2 扩张到提醒、标签、截止日期或子任务。
- 月历在 Phase 1.12.0 审计时已满足公历月视图 MVP，但周起始设置还内嵌在内容区，折叠摘要信息量不足；Phase 1.12.3/1.12.4 已把配置入口和摘要规则统一。
- 模板默认组件已经能生成普通 widgets，但六个模板的标题、折叠状态和组合策略还可以更贴近使用场景；Phase 1.12.5 只影响新建/套模板首页，不自动修改已有首页。
- 移动端和键盘可访问性需要作为组件规范的底线。关键入口不能只依赖 hover，排序必须保留按钮兜底，coarse pointer 下点击目标应向 44px 级别靠拢。

已定义规范：

- 统一组件外壳区域：Container、Header、Action Strip、Content、Collapsed Summary、Empty State、Error State、Config Entry。
- 标题区规则：日常模式只展示标题/短摘要/必要操作；标题编辑进入管理模式或统一配置入口。
- 操作区规则：内容操作留在组件内部，外壳操作留在 shell；危险操作二次确认；拖拽只绑定 handle。
- 折叠摘要规则：Todo 显示未完成/总数，月历显示当前月或周起始摘要，后续组件至少给出一个核心状态指标。
- 空状态规则：短文本、就近下一步、低噪声；模板不能为了避免空状态预填虚假任务。
- 错误态规则：组件局部失败不影响整个首页；错误监控和埋点不得记录 Todo 内容或完整 config。
- 配置入口规则：后续可配置组件统一进入设置入口和配置面板，配置保存继续走 `normalizeConfig`。
- 数据边界：Phase 1.12 默认不新增 SQL、Storage、RPC 或独立 widget 表；新增 widget type 必须同步更新 registry、normalize、渲染、恢复预览和模板摘要。

对后续阶段的约束：

- Phase 1.12.1：先抽统一 shell，不改变 `HomeDocumentV2.widgets` schema，不引入自由网格和 resize。
- Phase 1.12.2：Todo 只做轻量体验优化，不做复杂项目管理。
- Phase 1.12.3：月历只优化公历月视图和配置体验，不做农历、节假日、日程或外部日历。
- Phase 1.12.4：配置入口统一后，配置状态写入 `widget.config` 并通过 registry normalize。
- Phase 1.12.5：模板组件组合只影响新建首页，不触碰用户已有首页。
- Phase 1.12.6：候选组件只做价值、数据边界、后端成本和风险评估，不直接实现复杂组件市场。

## Phase 1.12.1：Widget Shell 统一

Phase 1.12.1 已把组件卡片外壳从 `WidgetPanel` 中抽离出来，形成统一 `WidgetShell`。本阶段没有新增 Supabase migration，没有改变 `HomeDocumentV2.widgets` schema，也没有引入自由网格、resize 或多区域布局。

用户侧变化：

- Todo 和月历的组件标题区、折叠按钮、管理模式、排序兜底和删除入口使用同一套外壳。
- 组件标题和描述在窄宽度下会稳定截断，不再挤压操作按钮。
- 触屏或粗指针设备下，组件外壳的拖拽句柄、折叠按钮和管理按钮点击区域放大。
- 月历折叠摘要从笼统提示改为展示当前月份和周起始，例如 `2026年6月 · 周一开始`。
- Todo、月历内容区交互保持不变，用户已有任务、月历周起始和组件折叠状态不受影响。

系统实现：

- 新增 `src/components/widgets/widget-shell.tsx`，集中处理组件卡片外壳、标题编辑、折叠摘要、外壳操作区、排序兜底和删除入口。
- `src/components/widget-panel.tsx` 保留组件列表、添加组件、排序编排、保存首页文档和具体 widget content 分发。
- `SortableWidgetCard` 仍负责 `@dnd-kit` 的 `useSortable(...)` 绑定，并把拖拽 handle 作为 slot 传入 `WidgetShell`，避免 shell 直接依赖 dnd-kit。
- Todo 和月历内容组件继续作为业务内容插入 shell；内容操作仍留在各自组件内部。
- 月历折叠摘要复用 `normalizeCalendarConfig(...)` 读取周起始配置，不新增持久状态。
- `app/globals.css` 补充组件 shell action strip、标题/描述截断和 coarse pointer 下外壳按钮尺寸。

数据与架构边界：

- 未改动 `HomeWidget`、`HomeWidgetLayout`、`HomeWidgetType` 或 registry 数据结构。
- 组件标题、顺序、折叠状态和配置仍按原方式写入 `HomeDocumentV2.widgets`。
- 管理模式、拖拽中状态、标题草稿仍是当前浏览器 UI 临时状态，不写入首页文档。
- 统一配置入口仍留给 Phase 1.12.4；Todo 和月历业务体验优化分别留给 Phase 1.12.2 和 Phase 1.12.3。

关键文件：

- `src/components/widgets/widget-shell.tsx`
- `src/components/widget-panel.tsx`
- `app/globals.css`

## Phase 1.12.2：Todo List 体验优化

Phase 1.12.2 已在现有 `todo.list` 组件上做轻量体验优化。本阶段不新增后端表，不改 `HomeDocumentV2.widgets` schema，不做任务级同步，也不引入截止日期、提醒、标签、子任务或 Todo 与日历联动。

用户侧变化：

- 新增任务输入框占位文案改为 `添加任务，按 Enter 保存`，更明确连续录入方式。
- 空输入时添加按钮禁用，减少误点。
- 添加任务后输入框保持焦点，方便连续添加多条任务。
- Todo 摘要从未完成/总计扩展为未完成、已完成、总计。
- 有任务时新增 `全部 / 未完成 / 已完成` 三段筛选。
- 筛选状态只保存在当前组件 UI state，刷新后回到默认 `全部`，不会写入首页文档或触发同步。
- 空状态从 `暂无任务` 改为 `暂无任务，添加第一项`；筛选结果为空时显示对应提示。
- 任务行默认优先展示任务标题，桌面细指针设备下复选框默认隐藏，hover/focus 时显示；触屏或粗指针设备下复选框常显。
- 每条任务右侧从常驻上移/下移/删除按钮改为三点菜单，菜单内提供拖动排序和删除。
- 触屏或粗指针设备下，添加输入、添加按钮、复选框、三点菜单和菜单操作点击区域放大。

系统实现：

- `src/components/widgets/todo-list-widget.tsx` 新增本地 `TodoFilter` state 和 `visibleItems` 派生列表。
- 新增任务仍通过 `createTodoItem(...)` 写入 `widget.config.items`，并继续经过 `renumberTodoItems(...)` 归一化。
- 筛选只影响渲染列表，不影响任务真实顺序。
- 任务排序改为复用 `@dnd-kit` 的组件内 sortable 列表；拖动 handle 只出现在三点菜单中，避免挤占标题区域。
- `app/globals.css` 新增 Todo 筛选 segmented control、三点菜单、菜单拖动 handle、隐藏复选框、拖动 overlay、空状态布局和 coarse pointer 点击区规则。

数据与架构边界：

- 任务数据继续保存在 `HomeDocumentV2.widgets[].config.items`。
- 未新增 SQL、RPC、Storage bucket 或账号偏好字段。
- 筛选状态、输入草稿和当前焦点都是临时 UI 状态，不进入本地历史、云端历史或同步文档。
- 多设备同时编辑同一 Todo 时仍沿用完整首页文档 revision 冲突处理。

关键文件：

- `src/components/widgets/todo-list-widget.tsx`
- `app/globals.css`

## Phase 1.12.3：月历体验优化

Phase 1.12.3 已在现有 `calendar.month` 组件上做轻量体验收口。本阶段不新增后端表，不改 `HomeDocumentV2.widgets` schema，不引入日程、农历、节假日或外部日历；月历仍保持公历月视图，周起始继续保存在 `widget.config.weekStartsOn`，当前查看月份只作为本地 UI state。

用户侧变化：

- 月份标题区改为居中标题加今天日期提示，用户在翻到其他月份时仍能看到今天所在日期。
- 上月/下月按钮改为更稳定的圆形导航按钮，提升窄宽度下的可点性。
- “回今天”按钮在当前月弱化并禁用，在浏览其他月份时作为明确返回入口。
- 周起始设置从两个单字按钮调整为 `周一 / 周日` segmented control，状态更清楚。
- 日期网格保留稳定 7 列结构，周末日期做弱强调，今天继续高亮并带 `aria-current="date"`。
- 窄屏下控制区自动改为单列，触屏设备下月份导航、回今天和周起始按钮点击区域放大。
- 月历折叠摘要从当前月和周起始扩展为当前月、今日日期和周起始，例如 `2026年6月 · 今日 29日 · 周一开始`。

系统实现：

- `src/components/widgets/calendar-month-widget.tsx` 重构月历 header、control row 和周起始切换结构。
- `src/domain/calendar-widget.ts` 为日期单元补充 `isWeekend` 派生字段，用于视觉弱强调，不新增持久状态。
- `src/components/widget-panel.tsx` 更新月历折叠摘要。
- `app/globals.css` 新增月历 header、圆形导航按钮、segmented control、窄屏布局和 coarse pointer 点击区规则。

数据与架构边界：

- 周起始配置仍按原方式写入 `HomeDocumentV2.widgets[].config.weekStartsOn`。
- 翻月、当前月份视图和按钮状态仍是当前组件本地 UI 状态，不进入同步、历史快照或数据包恢复。
- 本阶段不接入统一组件配置入口；该能力已在 Phase 1.12.4 收口。

关键文件：

- `src/components/widgets/calendar-month-widget.tsx`
- `src/domain/calendar-widget.ts`
- `src/components/widget-panel.tsx`
- `app/globals.css`

## Phase 1.12.4：组件配置入口统一

Phase 1.12.4 已建立统一组件配置入口和配置弹窗。本阶段不新增后端表，不改 `HomeDocumentV2.widgets` schema，不实现完整 schema-driven form 引擎；先用轻量 registry 元信息和手写配置表单覆盖 Todo、月历两个现有组件。

用户侧变化：

- 每个组件在日常模式下都有统一设置按钮，和折叠按钮并列。
- 点击设置后打开同一套配置弹窗，取消不保存，保存才写入首页文档。
- Todo 配置面板支持修改组件名称，并显示未完成、已完成和总计任务数。
- 月历配置面板支持修改组件名称和周起始；月历内容区只保留月份切换、回今天和日期查看。
- 管理模式仍负责拖拽、上移、下移、删除和快速标题编辑；配置弹窗不和拖拽交互混在一起。
- 触屏设备下设置按钮和配置表单控件保持可点击尺寸。

系统实现：

- `WidgetShell` 新增 `onOpenSettings`，日常模式展示统一设置入口。
- `WidgetPanel` 新增当前配置组件状态，并渲染 `WidgetConfigDialog`。
- 新增 `src/components/widgets/widget-config-dialog.tsx`，统一处理标题、Todo 状态和月历周起始配置。
- `calendar.month` 的周起始配置从组件内容区迁入配置弹窗，仍通过 `normalizeCalendarConfig(...)` 读取和保存。
- `WidgetDefinition` 新增轻量 `settings` 元信息，为后续组件配置入口提供标题和描述。
- `app/globals.css` 新增配置弹窗字段、状态网格、segmented control 和移动端布局样式。

数据与架构边界：

- 组件名称继续写入 `HomeDocumentV2.widgets[].title`。
- 月历周起始继续写入 `HomeDocumentV2.widgets[].config.weekStartsOn`。
- Todo 筛选状态仍是当前组件 UI state，不进入配置面板或首页文档。
- 本阶段不把 registry 扩展为通用表单描述器，避免两个组件阶段过早抽象；后续新增组件时可继续复用统一弹窗模式。

关键文件：

- `src/components/widgets/widget-shell.tsx`
- `src/components/widgets/widget-config-dialog.tsx`
- `src/components/widget-panel.tsx`
- `src/components/widgets/calendar-month-widget.tsx`
- `src/domain/widget-registry.ts`
- `app/globals.css`

## Phase 1.12.5：模板组件组合优化

Phase 1.12.5 已收口六个模板的默认组件组合、标题和折叠状态。本阶段不新增 widget type，不新增后端表，不改 `HomeDocumentV2.widgets` schema；所有改动只影响之后从模板创建的新首页，不自动迁移或修改用户已有首页。

用户侧变化：

- 空白首页继续不预设任何组件，保持干净起点。
- 极简起步只保留一个 `本月概览` 月历组件，并默认折叠，减少极简模板首屏负担。
- 通用效率默认组件改为 `今日待办` + `月历`。
- 工作办公默认组件改为 `工作待办` + `会议与日程`。
- 开发者工作台默认组件改为 `开发任务` + `本月节奏`。
- 学习研究默认组件改为 `学习计划` + `学习日历`。
- 模板卡片和创建流程中的组件摘要会随上述标题自动更新。

系统实现：

- `src/domain/home-template.ts` 更新各模板的 widget preset。
- 模板 `widget(...)` helper 支持透传 `collapsed` 和后续 `config` 等 preset 选项。
- 继续复用 `createHomeWidgetsFromPresets(...)` 生成普通 `HomeWidget`，不引入模板专用组件模型。

数据与架构边界：

- 标题写入新建首页的 `HomeDocumentV2.widgets[].title`。
- 折叠状态写入新建首页的 `HomeDocumentV2.widgets[].layout.collapsed`。
- 当前只有极简起步将月历默认折叠；其他模板保持展开，便于用户立即看到 Todo 和月历内容。
- 已有本地首页、账号托管空间、同步码空间、本地历史和云端历史不受影响。

关键文件：

- `src/domain/home-template.ts`

## Phase 1.12.6：后续组件候选设计

Phase 1.12.6 已完成后续组件候选设计。本阶段只做 backlog 和排序，不新增运行时代码、不新增 widget type、不修改 `HomeDocumentV2.widgets` schema、不新增 SQL、RPC、Storage 或第三方 API 接入。

新增文档：

- `docs/backlog/WidgetCandidatesBacklog.md`

主要结论：

- 低风险优先候选：Notes / 便签、Countdown / 倒计时、World Clock / 世界时钟。
- 中风险候选：RSS、Weather / 天气、GitHub。它们需要后端代理、API key、缓存、OAuth/token 或 rate limit 策略，不直接进入近期实现。
- 暂缓候选：外部日历集成、文件/附件、邮件/消息、AI 摘要、股票/比赛比分、复杂看板或项目管理套件。
- 后续任何候选组件进入实现前，都必须补齐组件名称、目标用户、展开态、折叠摘要、空状态、错误态、配置字段、数据边界、同步/快照影响、后端/API 需求和脱敏规则。

数据与架构边界：

- Notes 正文、倒计时标题、城市名称、RSS feed URL、GitHub repo 名称都可能带有用户意图，不能进入基础埋点、错误监控或本地审计 metadata。
- 纯前端组件优先写入 `HomeDocumentV2.widgets[].config`，继续复用本地保存、同步码、账号托管、本地历史、云端历史和数据包恢复。
- 大体积列表、RSS 文章缓存、天气 API 响应和 GitHub API 响应不应直接写入首页文档。
- 任何 token、OAuth refresh token、API key、service role 或第三方凭证都不能进入 GitHub Pages 前端代码、首页文档、localStorage 数据包导出或错误上报。

推荐后续顺序：

1. Notes v1：纯前端短便签，先做长度/条数限制和隐私边界。
2. Countdown v1：纯前端目标日期和标题，适合工作、学习、发布和生活场景。
3. World Clock v1：纯前端时区列表，适合开发者和跨时区协作。
4. RSS / 天气 / GitHub：先等服务端或 API 策略稳定后再进入实现。

## 验收记录

Phase 1.12.0 和 Phase 1.12.6 为文档和设计阶段，未改动运行时代码。Phase 1.12.1、Phase 1.12.2、Phase 1.12.3、Phase 1.12.4 和 Phase 1.12.5 已接入运行时代码，但不改首页文档 schema。

已完成：

- 新增组件体验审计与设计规范。
- 将 Phase 1.12.0 标记为已完成。
- 新增统一 `WidgetShell`，并将 `WidgetPanel` 的外壳职责迁移到 shell。
- 将 Phase 1.12.1 标记为已完成。
- 完成 Todo List 输入、空状态、筛选、完成项摘要和触屏点击区优化。
- 将 Phase 1.12.2 标记为已完成。
- 完成月历月份切换、回今天、周起始 segmented control、窄屏布局和折叠摘要优化。
- 将 Phase 1.12.3 标记为已完成。
- 完成统一组件设置入口、配置弹窗、Todo 名称配置和月历周起始配置迁移。
- 将 Phase 1.12.4 标记为已完成。
- 完成六个模板默认组件组合、标题和折叠状态优化。
- 将 Phase 1.12.5 标记为已完成。
- 新增 `WidgetCandidatesBacklog.md`，完成后续组件候选设计、分层排序和数据/后端边界评估。
- 将 Phase 1.12.6 标记为已完成。
- 将下一步主线推进到 Phase 1.13 产品化体验收口与主域名准备。
- 更新文档索引和 backlog 中的 Phase 1.12 状态。

已验证：

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`

后续代码阶段仍需继续执行：

- 桌面、平板、手机和触屏输入回归。
