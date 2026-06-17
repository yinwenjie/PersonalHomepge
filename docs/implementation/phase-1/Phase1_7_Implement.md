# Phase 1.7 组件开发实施记录

## Phase 1.7 总体边界

Phase 1.7 的目标是把首页从纯链接集合逐步升级为轻量工作台。组件数据继续写入 `HomeDocumentV2.widgets`，不新增 Supabase SQL、不拆独立组件表、不改变同步码加密同步协议。

本阶段按小步推进：

- Phase 1.7.0：组件框架与 Widget Registry。
- Phase 1.7.1：Todo List v1。
- Phase 1.7.2：日历/万年历 v1。
- Phase 1.7.3：组件布局与编辑体验。
- Phase 1.7.4：组件默认配置。

## Phase 1.7.0：组件框架与 Widget Registry

Phase 1.7.0 已完成最小组件框架。本阶段只落基础设施和可验证交互，不提前实现 Todo 和日历的完整业务编辑能力。

用户侧变化：

- 首页右侧组件区不再展示静态 registry 文本，而是读取当前 `HomeDocumentV2.widgets`。
- 用户可以从组件入口添加 `Todo` 和 `月历`。
- `月历` 组件当前限制单实例，重复添加入口会禁用。
- 用户可以上移、下移和删除已添加组件。
- 删除组件前会二次确认。
- Todo 组件先展示任务数和完成数摘要。
- 月历组件先展示当前年月和当天摘要。

系统实现：

- 新增 `src/domain/widget-registry.ts`，集中定义 `WidgetDefinition`、`WIDGET_DEFINITIONS`、`WIDGET_REGISTRY`、类型判断和 config normalize。
- `todo.list` 默认配置为 `{ items: [] }`，并对已有 items 做基础清洗、排序和 completed 归一化。
- `calendar.month` 默认配置为 `{ weekStartsOn: 1 }`，并把 `weekStartsOn` 归一化为 `0` 或 `1`。
- `src/domain/home-document.ts` 的 widgets normalize 改为依赖 registry，未知 widget type 会被过滤，已知 widget 会使用 registry 默认标题和 config normalize。
- 新增 `renumberWidgets(...)`，组件排序统一按 `order` 收口。
- `WidgetPanel` 接入 `commitHomeDocument`，组件增删排序走现有本地保存、revision、updatedAt 和后续同步链路。
- 首页状态面板中的组件计数继续复用 `documentValue.widgets.length`。

本阶段没有做：

- Todo 任务的新增、编辑、完成、删除和拖拽排序。
- 日历月视图、日期切换、节假日、农历或日程数据。
- 设置页组件管理后台。
- 后端组件表、账号偏好中的组件默认配置或组件市场。

## Phase 1.7.0 验收标准

- 未添加组件时，右侧组件区显示空状态。
- 点击添加入口可以添加 Todo 组件。
- 点击添加入口可以添加月历组件。
- 月历添加后不能重复添加第二个实例。
- 已添加组件可以上移和下移，刷新后顺序保持。
- 删除组件前出现确认，确认后组件从 `HomeDocumentV2.widgets` 移除。
- Todo 和月历的 placeholder 预览不阻塞首页链接区使用。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。
- 本地浏览器验证首页加载和组件区挂载。

## Phase 1.7.1：Todo List v1

Phase 1.7.1 已在 `todo.list` 组件上接入轻量任务清单能力。本阶段继续沿用 `HomeDocumentV2.widgets[].config.items` 存储任务，不新增 Supabase SQL、不新增任务表、不改变同步码或账号托管同步协议。

用户侧变化：

- Todo 组件支持新增任务。
- 任务支持完成/取消完成。
- 任务标题支持内联编辑，按 Enter 或失焦保存，按 Escape 还原当前标题。
- 任务支持删除。
- 任务支持上移和下移排序。
- Todo 组件显示未完成数和总数。
- 存在已完成任务时，可一键清除已完成任务，并在清除前二次确认。
- 多个 Todo 组件互相独立，各自维护自己的 `items`。

系统实现：

- 新增 `src/domain/todo-widget.ts`，集中定义 `TodoItem`、`TodoWidgetConfig`、任务创建、标题清洗、排序归一化和统计 helper。
- `src/domain/widget-registry.ts` 的 `todo.list` config normalize 改为复用 `todo-widget` helper。
- 新增 `src/components/widgets/todo-list-widget.tsx`，承载 Todo 任务交互，避免把任务业务逻辑继续堆进 `WidgetPanel`。
- `WidgetPanel` 对 `todo.list` 渲染真实 Todo 组件，对其他组件继续渲染占位预览。
- 所有 Todo 修改最终调用 `commitHomeDocument(...)`，因此会更新本地首页文档、递增 revision、更新 `updatedAt`，并复用现有同步码/账号托管自动同步链路。

同步边界：

- 本地模式下，Todo 数据保存在当前浏览器的本地首页文档中。
- 同步码模式下，Todo 数据随完整 `HomeDocumentV2` 客户端加密后上传到当前同步空间。
- 账号托管模式下，Todo 数据随账号托管首页空间同步；空白设备登录恢复账号托管空间后会恢复 Todo。
- Supabase 仍只保存加密后的首页文档，不新增 Todo 明文表。
- 多设备同时编辑同一个 Todo 组件时，v1 仍沿用现有整份首页文档 revision 冲突处理，不做任务级自动合并。

本阶段没有做：

- 截止日期、提醒通知、标签、优先级或子任务。
- Todo 与日历联动。
- 任务级多设备 merge。
- 任务拖拽排序；v1 使用上移/下移按钮。

## Phase 1.7.1 验收标准

- 添加 Todo 组件后可以新增任务。
- 刷新页面后任务仍存在。
- 勾选、取消勾选、编辑标题、删除任务和任务排序后数据正确。
- 清除已完成任务前有确认，确认后只移除 completed 任务。
- 多个 Todo 组件互不影响。
- 导出 JSON 包含 Todo 数据，导入后可恢复。
- Todo 数据跟随同步码和账号托管完整首页文档同步。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。
- 本地功能测试已完成。

## Phase 1.7.2：日历/万年历 v1

Phase 1.7.2 已在 `calendar.month` 组件上接入公历月视图。本阶段继续沿用 `HomeDocumentV2.widgets[].config` 保存组件配置，不新增 Supabase SQL、不新增日程表、不改变同步码或账号托管同步协议。

用户侧变化：

- 月历组件显示真实公历月视图。
- 支持查看上个月和下个月。
- 支持回到今天所在月份。
- 今天日期会高亮。
- 当前月日期和补位日期有视觉区分。
- 支持周一或周日作为一周开始。
- `calendar.month` 仍保持单实例，避免首页右侧区域堆叠多个重复月历。

系统实现：

- 新增 `src/domain/calendar-widget.ts`，集中定义 `CalendarMonthConfig`、`WeekStart`、月视图网格生成、月份增减、本地日期比较和 config normalize。
- `src/domain/widget-registry.ts` 的 `calendar.month` config normalize 改为复用 `calendar-widget` helper。
- 新增 `src/components/widgets/calendar-month-widget.tsx`，承载月历视图、月份切换、回到今天和周起始设置。
- `WidgetPanel` 对 `calendar.month` 渲染真实月历组件；Todo 继续渲染 Todo 组件。
- 月份切换只保存在组件本地 state，不写入首页文档，避免每次翻月都递增 revision 或触发同步。
- 周起始设置写入 `widget.config.weekStartsOn`，会随完整首页文档保存和同步。

同步边界：

- 本地模式下，月历组件存在状态和周起始设置保存在当前浏览器的本地首页文档中。
- 同步码模式下，月历组件配置随完整 `HomeDocumentV2` 客户端加密后上传到当前同步空间。
- 账号托管模式下，月历组件配置随账号托管首页空间同步；空白设备登录恢复账号托管空间后会恢复周起始设置。
- Supabase 仍只保存加密后的首页文档，不新增日程或节假日明文表。
- 翻月状态是当前浏览器临时视图状态，不跨设备同步。

本阶段没有做：

- 农历。
- 法定节假日。
- 纪念日。
- 日程或事件创建。
- Todo 与日期联动。
- Google Calendar、Outlook 等外部日历接入。

## Phase 1.7.2 验收标准

- 添加月历组件后显示真实公历月视图。
- 上个月、下个月和今天按钮工作正常。
- 今天日期高亮正确。
- 周一/周日开头切换后月视图排列正确。
- 刷新页面后月历组件仍存在。
- 修改周起始设置后刷新仍保持。
- Todo 组件不受月历组件影响。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过。
- 本地功能测试已完成。

## 后续衔接

Phase 1.7.1 已继续保持任务数据内嵌在 `HomeDocumentV2.widgets[].config.items`。后续只有当 Todo 数据体积、提醒能力或协作需求明确超过首页文档模型时，才考虑拆分任务表或任务级同步协议。

Phase 1.7.2 已继续保持月历配置内嵌在 `HomeDocumentV2.widgets[].config`。节假日、农历、日程事件和外部日历同步应留到后续版本，避免 Phase 1.7 过早引入地区、账号权限和第三方授权复杂度。
