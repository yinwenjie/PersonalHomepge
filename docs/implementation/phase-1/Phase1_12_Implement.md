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
- 月历已满足公历月视图 MVP，但周起始设置还内嵌在内容区，折叠摘要信息量不足；Phase 1.12.3/1.12.4 应把配置入口和摘要规则统一。
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

## 验收记录

Phase 1.12.0 为文档和设计规范阶段，未改动运行时代码。Phase 1.12.1 和 Phase 1.12.2 已接入运行时代码，但不改首页文档 schema。

已完成：

- 新增组件体验审计与设计规范。
- 将 Phase 1.12.0 标记为已完成。
- 新增统一 `WidgetShell`，并将 `WidgetPanel` 的外壳职责迁移到 shell。
- 将 Phase 1.12.1 标记为已完成。
- 完成 Todo List 输入、空状态、筛选、完成项摘要和触屏点击区优化。
- 将 Phase 1.12.2 标记为已完成。
- 将下一步主线推进到 Phase 1.12.3 月历体验优化。
- 更新文档索引和 backlog 中的 Phase 1.12 状态。

已验证：

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`

后续代码阶段仍需继续执行：

- 桌面、平板、手机和触屏输入回归。
