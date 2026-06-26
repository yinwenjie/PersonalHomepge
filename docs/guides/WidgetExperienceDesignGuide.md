# 组件体验审计与设计规范

## Summary

本文档是 Phase 1.12.0 的主要交付物，用于指导 Phase 1.12.1-1.12.6 的组件体验优化。当前组件系统已经具备 registry、添加、删除、排序、折叠、Todo 和月历能力；下一阶段的重点不是扩张组件数量，而是统一组件外壳、配置入口、空状态、错误态、移动端和模板默认组合。

本规范不新增 Supabase 表，不改变 `HomeDocumentV2.widgets` 的核心模型，不引入复杂组件市场。所有后续组件优化都应先保持现有首页文档可读、可同步、可恢复，再评估是否需要扩展 schema。

## Current Audit

| 范围 | 当前能力 | 主要问题 | 后续阶段 |
|---|---|---|---|
| WidgetPanel | 可添加 Todo/月历；支持管理模式、重命名、折叠、删除、拖拽排序和上移/下移兜底；Phase 1.12.1 已新增统一 `WidgetShell` | 配置入口仍未统一；日常模式和管理模式后续还可继续配合设置入口收口 | Phase 1.12.4 |
| Todo List | 支持新增、完成、编辑、删除、拖动排序、清除完成；Phase 1.12.2 已新增轻量筛选、三点菜单、空状态引导、桌面隐藏复选框和触屏点击区优化 | 后续如果继续扩展，仍应避免截止日期、提醒、标签、子任务和任务级同步过早进入首页 Todo | 后续候选 |
| 月历 | 支持公历月视图、上月/下月、回到今天、今天高亮、周一/周日起始 | 周起始设置内嵌在组件内容里，不符合未来统一配置入口；折叠摘要信息量低；窄屏下控制区需要更稳定 | Phase 1.12.3/1.12.4 |
| 模板默认组件 | 六个模板可预设 Todo/月历，空白首页不预设组件 | 默认组合基本可用，但标题、折叠状态和组件摘要还没有按模板使用场景细化 | Phase 1.12.5 |
| 移动端与输入方式 | 侧栏在窄屏下变为单列；已有 focus 样式和 coarse pointer 经验 | 部分按钮尺寸低于触屏优先的 44px 目标；组件管理不能依赖 hover；拖拽要保留按钮兜底 | Phase 1.12.1-1.12.4 |
| 数据与同步 | 组件数据随完整 `HomeDocumentV2` 走本地、同步码和账号托管同步；快照可完整预览组件 | Todo 仍沿用整份首页文档冲突处理；后续配置扩展必须避免同步体积无界增长 | 全阶段 |

## Product Principles

- 组件是首页的轻量工作台，不是独立应用市场。默认优先帮助用户完成高频小任务，而不是追求复杂功能堆叠。
- 日常首页应保持安静。管理、排序、删除、配置等低频操作可以收进统一入口，但添加、折叠和必要内容操作必须可发现。
- 触屏设备没有 hover。关键入口不能只靠 hover 显示；按钮和可点击区域在 coarse pointer 下应按 44px 级别设计。
- 键盘用户必须能完成添加、配置、折叠、排序兜底和删除确认。
- 组件内容和组件外壳要分层。组件外壳负责标题、管理、折叠、拖拽、配置入口和通用状态；组件内容只负责自身业务。
- 持久状态才写入 `HomeDocumentV2`。例如 Todo items、月历周起始、组件标题、顺序和折叠状态要同步；临时打开的 picker、当前查看月份、modal 开关不写入文档。
- 错误、埋点和本地审计不得记录 Todo 内容、组件具体配置、网站 URL、搜索词、同步码或 secret。

## Widget Shell Standard

统一组件外壳建议拆成以下区域：

| 区域 | 职责 | 规则 |
|---|---|---|
| Container | 组件卡片边界、背景、间距和状态色 | 与现有 `widget-card` 视觉保持一致；不要嵌套卡片；半径继续使用全局 `--radius` |
| Header | 标题、描述、摘要和常用状态 | 标题一行优先，超长可截断；描述只展示类型或当前摘要，不放长说明 |
| Action Strip | 折叠、设置、管理、排序、删除 | 采用固定尺寸 icon/button；危险操作进入二次确认；排序必须保留上移/下移兜底 |
| Content | 组件主体内容 | 只承载业务交互，不承载外壳级设置；内容区高度变化不能导致按钮错位 |
| Collapsed Summary | 折叠后的只读摘要 | 必须比“已折叠”更有信息量；Todo 显示未完成/总数，月历显示当前月或今天信息 |
| Empty State | 无内容时的低噪声引导 | 一句话说明当前为空，并提供自然的下一步；不得使用大面积营销式空状态 |
| Error State | 组件局部错误或配置损坏提示 | 不阻塞整个首页；可恢复时提供重试或恢复默认配置；错误内容需脱敏 |
| Config Entry | 进入组件设置的统一入口 | 所有可配置组件使用同一入口和同一面板模式；不在每个组件内部随意放配置控件 |

### Header Rules

- 日常模式显示：标题、类型/摘要、折叠按钮、设置入口。
- 管理模式显示：拖拽句柄、标题编辑、上移、下移、删除；仍保留折叠。
- 标题编辑只在管理模式或统一配置面板中出现，避免日常误触。
- 标题为空时回退到 registry 的 `defaultTitle`。
- 描述文本必须短，适合 280px 级侧栏宽度。

### Action Rules

- 内容操作留在组件内部，例如 Todo 新增任务、勾选任务、清除完成。
- 外壳操作留在 shell，例如折叠、设置、管理、排序、删除。
- 破坏性操作必须二次确认，确认文案要包含组件标题。
- 桌面端按钮视觉可以紧凑，但 coarse pointer 下点击目标应扩展到 44px 级别。
- 拖拽只绑定在 handle 上，不能让输入框、复选框、日期按钮触发拖拽。

### Collapsed Summary Rules

- Todo：`{active} 未完成 / {total} 总计`；无任务时显示 `暂无任务`。
- 月历：显示当前本地月份、今天日期或周起始摘要，例如 `本月概览 · 周一开始`。
- 后续组件：至少包含一个用户能判断内容状态的核心指标。
- 折叠摘要只读，不触发保存或同步。

### Empty State Rules

- 空状态使用短文本和就近入口，不使用长解释。
- Todo 空状态建议从 `暂无任务` 升级为 `暂无任务，添加第一项` 级别的引导。
- 组件面板空状态应提示可以添加组件，但不强推某个组件。
- 模板不应为了避免空状态而预填虚假任务。

### Error State Rules

- Config normalize 能修复的配置损坏应静默修复并继续显示。
- 无法渲染的 widget type 仍由 `normalizeHomeDocument` 过滤，避免破坏首页。
- 组件局部错误应显示在组件内容区域，不让整个首页崩溃。
- 错误监控只记录 widget type、阶段、错误类别和脱敏 message，不记录 Todo 标题或完整 config。

## Configuration Standard

Phase 1.12.4 之前可以先保持现有内联配置，但从 1.12.4 开始应统一：

- 每个可配置组件在 shell header 中显示设置入口。
- 设置入口打开统一配置面板，可以是轻量弹窗或侧栏内展开面板，但模式必须一致。
- 配置面板字段使用组件 registry 提供的描述或本地组件定义，不让各组件自由拼装完全不同的体验。
- 保存配置时写入 `widget.config`，并继续经过对应 `normalizeConfig`。
- 取消配置不写入 `HomeDocumentV2`，不触发 revision。
- 高频内容操作不进入设置面板，例如 Todo 新增任务仍留在组件内部。

建议后续 registry 扩展方向：

```ts
interface WidgetDefinition {
  type: HomeWidgetType;
  title: string;
  defaultTitle: string;
  description: string;
  allowMultiple: boolean;
  defaultConfig: () => Record<string, unknown>;
  normalizeConfig: (input: unknown) => Record<string, unknown>;
  // Phase 1.12.4 candidate:
  // settings?: WidgetSettingDefinition[];
}
```

该扩展不是 Phase 1.12.0 的代码改动，只作为 1.12.4 的设计候选。

## Data And Architecture Boundaries

- Phase 1.12 默认不新增 SQL、Storage bucket、RPC 或独立 widget 表。
- Todo 和月历继续内嵌在 `HomeDocumentV2.widgets[].config`。
- 组件标题、顺序和折叠状态继续写入 `HomeDocumentV2.widgets[]`。
- 模板默认组件仍通过 preset 生成普通 `HomeWidget`，只影响新建/套模板首页，不自动修改用户已有首页。
- 增加新 widget type 时必须同步更新：
  - `HomeWidgetType`
  - `WIDGET_DEFINITIONS`
  - `isWidgetType`
  - 对应 `normalizeConfig`
  - 组件渲染分支
  - 数据恢复预览
  - 模板摘要
  - 数据包导出/恢复回归
- 如果某个候选组件需要网络 API、账号权限、Storage 或大体积数据，应先进入 Phase 1.12.6 评估，不直接实现。

## Phase Acceptance Baseline

所有 Phase 1.12 代码阶段至少满足：

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- 桌面宽屏、980px、720px 和 420px 级宽度下组件不遮挡、不横向溢出。
- 浅色、深色、图片背景、紧凑密度和不同字体下文字可读。
- 键盘能聚焦所有关键按钮，focus ring 可见。
- 触屏设备关键入口可见，不能只依赖 hover。
- `prefers-reduced-motion` 下拖拽和 reveal 动画不影响可用性。
- 组件修改后本地历史、云端历史和数据恢复中心仍能完整预览组件摘要。

## Follow-Up Mapping

| 子阶段 | 必须遵守的规范重点 | 不做的事 |
|---|---|---|
| Phase 1.12.1 | 已完成：抽出 `WidgetShell`，统一标题区、操作区、折叠摘要和触屏外壳按钮尺寸 | 不改变 `HomeDocumentV2.widgets` schema；不引入自由网格 |
| Phase 1.12.2 | 已完成：Todo 优化保持轻量，收口输入、完成项摘要、UI 本地态筛选、空状态、三点菜单、组件内拖动排序、删除和移动端点击区域 | 不做截止日期、提醒、标签、子任务或任务级同步 |
| Phase 1.12.3 | 月历优化要保持公历月视图，改善切换、今天、窄屏和折叠摘要 | 不做农历、节假日、日程或外部日历接入 |
| Phase 1.12.4 | 配置入口统一，配置保存走 `normalizeConfig` | 不把所有内容操作都塞进设置面板 |
| Phase 1.12.5 | 模板只调整新建首页的默认组件组合和标题 | 不自动迁移或修改用户已有首页 |
| Phase 1.12.6 | 候选组件先评估价值、数据边界和后端成本 | 不实现复杂组件市场、联网组件或付费组件权益 |
