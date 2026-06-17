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

## 后续衔接

Phase 1.7.1 可以直接在当前 `todo.list` widget config 上扩展任务结构和编辑 UI。建议继续保持任务数据内嵌在 `HomeDocumentV2.widgets[].config.items`，直到组件数据体积或协作需求明确超过首页文档模型。

Phase 1.7.2 可以在当前 `calendar.month` widget config 上扩展 `weekStartsOn`、当前月份、日期选择和本地化展示。节假日、农历和外部日程同步应留到后续版本，避免 Phase 1.7 过早引入地区和账号权限复杂度。
