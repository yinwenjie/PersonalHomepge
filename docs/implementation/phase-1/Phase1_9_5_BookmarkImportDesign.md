# Phase 1.9.5 Bookmark Import Design：收藏/标签导入需求设计

## 阶段定位

Phase 1.9.5 是浏览器收藏/标签导入需求集的设计基线，目标是先把浏览器能力边界、可行导入入口、导入草稿模型、隐私边界和 MVP 候选说明白。本阶段只产出设计文档和技术方案，不实现导入 UI、解析器或数据写入逻辑。

后续阶段按这个基线继续拆分：

- Phase 1.9.6：大批量导入体验设计，重点处理上千收藏的清洗、预览、分组映射、性能和回滚。
- Phase 1.9.7：导入 MVP 实现候选，选择书签 HTML 导入、URL 列表粘贴或二者组合进入实现。

## 核心结论

- 普通网页不能直接读取用户浏览器收藏夹、当前打开标签页或历史记录。
- Web 页面可行的导入路径必须从用户主动提供数据开始，例如选择书签 HTML 文件、拖放文件或粘贴 URL 列表。
- 浏览器扩展可以申请 bookmarks/tabs 权限，但它是单独产品形态，涉及扩展发布、权限说明、跨浏览器适配和隐私信任，不应作为 Phase 1.9 MVP 的默认路径。
- MVP 优先考虑前端本地解析，不上传原始收藏文件，不引入云端批处理。
- 导入过程不应直接写入正式首页，应该先生成导入草稿，让用户预览、过滤、去重、选择分组并确认后再提交。

## 目标

- 明确普通网页、用户主动文件导入、粘贴 URL 和浏览器扩展之间的权限边界。
- 给出导入入口优先级和 MVP 推荐路径。
- 定义导入草稿数据模型，作为后续 parser、preview、commit 的契约。
- 说明导入结果如何映射到当前 `HomeDocumentV2.groups[].sites`。
- 说明本阶段对前端、后端、Supabase、同步和隐私安全的影响。
- 为 Phase 1.9.6 的大批量体验设计提供输入；Phase 1.9.6 已在 [`Phase1_9_6_BulkImportExperienceDesign.md`](Phase1_9_6_BulkImportExperienceDesign.md) 中细化。

## 非目标

- 不直接实现浏览器书签读取能力。
- 不开发浏览器扩展。
- 不新增 Supabase 表、RPC、Storage bucket 或 Edge Function。
- 不改 `HomeDocumentV2` 的正式 schema。
- 不做远程抓取网页标题、摘要、favicon 或内容分析。
- 不做 AI 自动分类。
- 不承诺一次性导入后自动生成完美首页结构。

## 浏览器能力边界

| 能力 | 普通网页是否可直接访问 | 可行方式 | 说明 |
|---|---:|---|---|
| 浏览器收藏夹 | 否 | 用户导出书签 HTML 后主动上传 | 页面只能读取用户通过 file input/drop 提供的文件。 |
| 当前打开标签页 | 否 | 用户粘贴 URL 列表，或后续浏览器扩展读取 | tabs 权限属于扩展能力，不属于普通网页能力。 |
| 浏览历史 | 否 | 不进入 Phase 1.9 范围 | 隐私敏感度高，且普通网页无权限。 |
| 剪贴板 URL | 部分可行 | 用户主动粘贴到文本框 | 不依赖静默读取剪贴板，使用 paste 或用户输入。 |
| 本地文件内容 | 部分可行 | 用户主动选择或拖放文件 | 只读取当前用户选择的文件，不扫描磁盘。 |
| 浏览器扩展 bookmarks/tabs API | 网页不可用 | 单独扩展安装并授权 | 后续可作为高级导入能力评估。 |

这个边界需要在 UI 文案中保持诚实：不能写“自动读取浏览器收藏夹”或“扫描当前标签页”。更准确的表达是“导入浏览器导出的书签文件”或“粘贴一组 URL”。

## 用户故事

- 作为有大量浏览器收藏的用户，我希望把浏览器导出的 bookmarks HTML 文件导入首页，并保留原有文件夹层级作为候选分组。
- 作为只有少量链接要迁移的用户，我希望直接粘贴一组 URL，不需要先生成书签文件。
- 作为已有首页内容的用户，我希望导入前看到哪些链接会新增、哪些重复、哪些无效，避免把首页弄乱。
- 作为有上千收藏的用户，我希望能分批预览、搜索、过滤和选择，而不是一次性全部写进首页。
- 作为关注隐私的用户，我希望原始书签文件只在浏览器本地解析，确认导入前不会上传到服务器。
- 作为登录用户，我希望确认后的导入结果能沿用当前首页空间的同步机制，在我的账号空间或同步码空间中保持一致。

## 导入入口对比

| 入口 | 用户成本 | 能力覆盖 | 隐私风险 | 技术复杂度 | MVP 推荐 |
|---|---|---|---|---|---|
| 书签 HTML 文件导入 | 中，需要用户从浏览器导出文件 | 高，适合大量收藏和文件夹结构 | 低，前端本地解析 | 中 | 推荐 |
| URL 列表粘贴 | 低，直接复制粘贴 | 中，适合少量迁移或跨工具复制 | 低，只处理用户粘贴内容 | 低 | 推荐 |
| 浏览器扩展 | 高，需要安装授权 | 很高，可读取收藏夹和当前标签页 | 中到高，权限敏感 | 高 | 后续评估 |
| 云端批处理 | 中，需要上传文件 | 中 | 高，会上传原始收藏文件 | 中到高 | 不推荐 |

推荐 MVP 组合：

- 第一优先级：书签 HTML 文件导入。
- 第二优先级：URL 列表粘贴。
- 暂不实现：浏览器扩展和云端批处理。

## 推荐用户流程

### 入口层

设置页的“高级操作”或后续独立“导入”入口中新增“导入收藏/链接”操作。点击后进入导入向导，不直接写入当前首页。

导入向导第一步提供两个主入口：

- 选择书签 HTML 文件。
- 粘贴 URL 列表。

浏览器扩展入口可以先作为“后续能力说明”或隐藏候选，不在 MVP 中展示为可用动作。

### 草稿层

用户提供数据后，前端本地解析并生成导入草稿：

- 统计总条目数、可导入条目数、重复条目数、无效 URL 数、候选分组数。
- 标记重复项和无效项。
- 根据书签文件夹或粘贴批次生成候选分组。
- 默认只选中可导入的新链接。

### 预览层

用户在预览页中完成整理：

- 查看摘要和风险提示。
- 搜索、过滤和抽样预览条目。
- 调整分组映射。
- 选择重复项处理策略。
- 勾选或取消勾选待导入条目。

Phase 1.9.6 已细化上千条目下的分页预览、分批选择和撤销方案；虚拟列表作为后续增强。

### 提交层

用户确认后，系统将被选中的草稿条目转换为 `HomeSite`，合并进当前 `HomeDocumentV2.groups`，再调用现有首页文档提交链路。

提交后：

- 未登录本地模式：写入当前浏览器 localStorage。
- 同步码模式：随完整首页文档继续使用现有端到端加密同步。
- 账号托管模式：随当前账号托管首页空间同步。

导入本身不需要新增独立后端。

## 技术架构草案

导入能力后续实现时建议拆成三层：

```text
source input
  -> parser
  -> import draft
  -> preview and mapping
  -> commit plan
  -> HomeDocumentV2
```

建议模块：

| 模块 | 职责 | 是否在 Phase 1.9.5 实现 |
|---|---|---:|
| `domain/bookmark-import.ts` | 导入草稿类型、URL 规范化、去重、提交计划 | 否 |
| `domain/bookmark-html-parser.ts` | 解析浏览器导出的 bookmarks HTML | 否 |
| `domain/url-list-import.ts` | 解析粘贴的 URL 列表 | 否 |
| `components/bookmark-import-dialog.tsx` | 导入向导 UI | 否 |
| `components/bookmark-import-preview.tsx` | 预览、过滤、分组映射 UI | 否 |
| `hooks/use-bookmark-import-draft.ts` | 草稿状态和本地临时保存 | 否 |

Phase 1.9.5 只固化方案，不创建这些文件。

## 导入草稿数据模型

草稿模型不进入 `HomeDocumentV2`，优先作为导入向导内部状态。Phase 1.9.6 已建议将解析后的最小草稿临时写入 localStorage，以支持误关闭恢复，但不保存原始书签 HTML。

```ts
export type ImportSourceKind = "bookmark-html" | "url-list" | "browser-extension";

export type ImportDuplicateStatus =
  | "new"
  | "duplicate-current-url"
  | "duplicate-current-host"
  | "duplicate-import-url"
  | "invalid-url";

export interface BookmarkImportDraft {
  id: string;
  sourceKind: ImportSourceKind;
  sourceName: string;
  createdAt: string;
  stats: BookmarkImportStats;
  groups: BookmarkImportDraftGroup[];
  items: BookmarkImportDraftItem[];
}

export interface BookmarkImportStats {
  totalItems: number;
  validItems: number;
  selectedItems: number;
  duplicateItems: number;
  invalidItems: number;
  candidateGroups: number;
}

export interface BookmarkImportDraftGroup {
  id: string;
  sourcePath: string[];
  suggestedTitle: string;
  targetGroupId: string | null;
  targetGroupTitle: string;
  mode: "create" | "merge" | "ungrouped" | "skip";
}

export interface BookmarkImportDraftItem {
  id: string;
  sourceKind: ImportSourceKind;
  rawTitle: string;
  rawUrl: string;
  normalizedUrl: string;
  suggestedName: string;
  suggestedMark: string;
  sourceFolderPath: string[];
  draftGroupId: string | null;
  targetGroupId: string | null;
  targetGroupTitle: string;
  duplicateStatus: ImportDuplicateStatus;
  selected: boolean;
  reason: string | null;
}
```

提交前再生成 commit plan：

```ts
export interface BookmarkImportCommitPlan {
  draftId: string;
  createdAt: string;
  selectedItemCount: number;
  targetGroups: BookmarkImportCommitGroup[];
}

export interface BookmarkImportCommitGroup {
  targetGroupId: string | null;
  targetGroupTitle: string;
  mode: "create" | "merge" | "ungrouped";
  sites: Array<Pick<HomeSite, "name" | "url" | "keywords" | "mark">>;
}
```

最终写入现有结构时：

- `name` 使用 `suggestedName`，没有标题时使用 hostname。
- `url` 使用原始可访问 URL，不能使用空值。
- `keywords` MVP 可为空，或使用 hostname、文件夹路径和标题生成基础关键词。
- `mark` 使用标题首字母或 hostname 首字母生成，保持当前网站标签的视觉一致。
- `order` 由合并后的 `renumberSites` 生成。

## 书签 HTML 解析方案

主流浏览器导出的书签文件通常接近 Netscape Bookmark File 格式，核心结构是嵌套的 `DL`、`DT`、`H3` 和 `A`：

- `H3` 表示文件夹。
- `A` 的 `HREF` 表示书签 URL。
- `A` 的文本内容表示标题。
- 额外属性如 `ADD_DATE`、`ICON`、`LAST_MODIFIED` 可读取但 MVP 不依赖。

解析原则：

- 使用浏览器 `DOMParser` 在前端本地解析 HTML 字符串。
- 遍历 `DL/DT` 嵌套结构，保留文件夹路径为 `sourceFolderPath`。
- 忽略没有 `href` 的条目。
- 忽略不支持的 scheme，例如 `javascript:`, `mailto:`, `file:`, `chrome:`, `edge:`, `about:`。
- 只允许 `http://` 和 `https://` 最终进入提交计划。
- 深层文件夹默认保留完整路径，目标分组建议优先使用叶子文件夹名；Phase 1.9.6 已补充大量分组下的折叠、搜索和批量映射策略。

需要兼容：

- Chrome/Edge 导出。
- Firefox 导出。
- Safari 导出。
- 重复标题。
- 空文件夹。
- 很深的文件夹层级。
- 大文件中的 favicon data URL 或 icon 属性，MVP 不导入 icon。

## URL 列表粘贴方案

URL 列表入口面向少量或中等规模链接，适合从聊天、文档、其他收藏工具中复制。

MVP 支持：

- 一行一个 URL。
- 行内前后空白自动 trim。
- 支持 `https://example.com` 和 `http://example.com`。
- 可考虑将 `example.com` 识别为 `https://example.com`，但需要在预览中明确展示补全后的 URL。

后续可选增强：

- 识别 Markdown 链接：`[title](url)`。
- 识别 HTML anchor。
- 识别逗号、tab 或 CSV 格式。
- 从同一行中提取标题和 URL。

标题兜底：

- 如果能从 Markdown 或结构化文本中得到标题，使用标题。
- 否则使用 hostname 作为 `suggestedName`。
- 不远程抓取页面 title，避免 CORS、性能和隐私问题。

## URL 规范化与校验

需要区分“展示 URL”和“去重 key”：

- 展示 URL：尽量保留用户原始可访问 URL。
- 去重 key：用于比较重复项，可以做更强规范化。

建议的规范化规则：

- trim 空白。
- 若无 scheme 且形似域名，可补 `https://` 作为候选 URL。
- 只允许 `http:` 和 `https:`。
- host 转小写。
- 默认移除 URL hash，避免同页面锚点造成大量重复。
- 默认移除末尾单个 `/`，但不改路径内部内容。
- 不默认移除 query，因为很多 Web app 链接依赖 query。
- 不默认解码或重排 query，避免破坏跳转。

重复判断优先级：

1. 与当前首页已有网站 normalized URL 完全相同：`duplicate-current-url`。
2. 与同一导入批次中 normalized URL 完全相同：`duplicate-import-url`。
3. 与当前首页已有网站 host 相同但路径不同：`duplicate-current-host`，默认不视为硬重复，只提示。
4. URL 无效或 scheme 不支持：`invalid-url`。

## 分组映射策略

书签文件通常有文件夹层级，但当前首页是一级分组加组内网站。因此需要从多级文件夹映射到一级首页分组。

MVP 默认策略：

- 顶层或叶子文件夹生成候选首页分组。
- 没有文件夹的书签进入“未分组”候选。
- 如果候选分组标题与当前首页已有分组标题相同，默认合并。
- 如果候选分组为空或只包含无效项，默认跳过。
- 用户可以将候选分组改为：创建新分组、合并到现有分组、导入到未分组、跳过。

深层路径示例：

```text
Bookmarks Bar / Work / Docs / API
```

可选映射方式：

- 使用叶子文件夹：`API`
- 使用一级业务文件夹：`Work`
- 使用路径折叠标题：`Work / Docs / API`

Phase 1.9.6 已确认默认用叶子文件夹，同时在分组映射 UI 中展示完整来源路径，避免用户迷路。

## 去重和选择策略

默认选择策略：

- 新链接：默认选中。
- 与当前首页 URL 完全重复：默认不选中。
- 与导入批次内 URL 重复：只保留第一次，后续重复默认不选中。
- host 相同但路径不同：默认选中，但显示提示。
- 无效 URL：不可选中。

用户可调整：

- 全选当前过滤结果。
- 取消全选当前过滤结果。
- 仅选择新链接。
- 包含 host 相同项。
- 手动勾选特定重复项。

去重不应自动删除用户当前首页已有网站，只影响本次导入是否新增。

## 隐私与安全

隐私原则：

- 原始书签 HTML 默认只在浏览器本地解析。
- 不把原始收藏文件上传到 Supabase、GitHub Pages 或任何第三方服务。
- 不远程抓取网页标题、正文或截图。
- 不记录原始导入文件内容到账号偏好或数据导出包。
- 用户确认提交前，不改变当前首页文档。

安全原则：

- 只允许 `http://` 和 `https://` URL 进入首页。
- 所有标题、文件夹名和 URL 都作为文本渲染，不拼接 `innerHTML`。
- 外链继续使用现有 `target="_blank"` 和 `rel="noopener noreferrer"` 策略。
- 导入文件大小需要限制，避免异常大文件导致浏览器卡死。初始建议上限 10 MB，Phase 1.9.6 可结合测试调整。
- 导入条目数需要软限制。初始建议 5,000 条以内完整支持，超过后提示分批导入或只预览部分。
- 浏览器扩展如果未来实现，必须明确列出申请权限和本地/云端数据流。

## 前端影响

Phase 1.9.5 不改前端代码。后续实现时主要影响：

- 设置页新增导入入口或导入面板。
- 新增导入向导 modal/dialog。
- 新增解析、预览、分组映射、去重策略、提交结果状态。
- 大批量预览需要虚拟列表或分页。
- 需要与现有 `useHomeDocumentController` 或编辑提交链路衔接，提交最终的 `HomeDocumentV2`。
- 需要复用当前 `HomeSite`、`HomeGroup`、`renumberGroups`、`renumberSites` 和 `createId` 规则。

## 后端与 Supabase 影响

Phase 1.9.5 和推荐 MVP 不新增后端能力：

- 不新增 Supabase 表。
- 不新增 RPC。
- 不新增 Storage bucket。
- 不新增 Edge Function。
- 不改变账号托管空间、同步码空间或加密同步协议。

确认导入后的首页内容会成为普通 `HomeDocumentV2` 的一部分，因此：

- 本地模式只影响 localStorage。
- 同步码模式继续走现有加密 push/pull。
- 账号托管模式继续走当前账号首页空间同步。

Phase 1.9.6 已建议支持“最近一次导入撤销”，优先在本地保存提交前快照和新增 group/site id，不急着上后端表。

## 性能策略

大批量收藏的主要风险是解析、去重和预览 UI 卡顿。

设计约束：

- 解析和规范化应拆成可测试的纯函数。
- 去重需要使用 `Map`/`Set`，避免 O(n²)。
- 预览列表不能一次渲染全部上千 DOM 节点，Phase 1.9.6 已建议 MVP 使用分页，虚拟列表后置。
- 搜索过滤需要 debounce。
- 文件读取、解析和预览过程中需要显示进度或至少显示处理中状态。
- 如 DOMParser 解析大文件在主线程表现不佳，后续可评估 Web Worker，但 MVP 不默认引入。

初始性能目标：

- 1,000 条收藏：解析和草稿生成在普通桌面浏览器中保持可接受。
- 5,000 条收藏：允许显示处理中状态，预览 UI 不应明显卡死。
- 超过 5,000 条：提示用户分批导入或进入受限预览。

## 回滚策略

Phase 1.9.5 只定义方向，Phase 1.9.6 已细化。

候选方案：

- 提交前快照：确认导入前保存当前 `HomeDocumentV2` 快照，允许“撤销最近一次导入”。
- 批次 metadata：提交时记录本次新增的 group/site id，撤销时删除这些 id。
- 本地备份复用：复用现有恢复默认前备份思路，但导入是更常见操作，需要更明确的“最近一次导入可撤销”文案。

MVP 推荐：

- 先做提交前快照和一次性撤销。
- 不把撤销记录同步到云端作为长期历史。
- 如果用户在导入后又进行了其他编辑，撤销需要谨慎提示，避免覆盖后续编辑。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 用户误以为网页能自动读取收藏夹 | 预期落差和信任损失 | 文案明确“导入浏览器导出的书签文件”。 |
| 上千收藏一键导入导致首页失控 | 首页不可用，用户需要大量清理 | 使用草稿、预览、默认跳过重复项、分组映射和确认。 |
| 重复链接过多 | 首页杂乱 | normalized URL 去重，默认不导入硬重复。 |
| 书签 HTML 格式差异 | 解析失败或丢数据 | parser 独立测试，覆盖 Chrome/Edge/Firefox/Safari 样例。 |
| 隐私担忧 | 用户不敢导入 | 默认本地解析，不上传原始文件，不远程抓取标题。 |
| 大文件卡顿 | 导入体验差 | 文件大小限制、处理中状态、虚拟列表或分页。 |
| 多级文件夹映射错误 | 分组混乱 | 导入前展示完整来源路径并允许手动调整。 |
| 同步冲突 | 多设备编辑时覆盖风险 | 导入提交复用现有首页文档同步和冲突处理。 |

## MVP 推荐范围

Phase 1.9.7 如果进入实现，建议 MVP 包含：

- 书签 HTML 文件选择和本地解析。
- URL 列表粘贴。
- 导入摘要。
- 基础去重。
- 基础分组映射。
- 预览和勾选。
- 确认后写入当前首页。
- 最近一次导入撤销。

MVP 暂不包含：

- 浏览器扩展。
- 当前标签页自动读取。
- 远程抓取页面 title。
- AI 自动分类。
- 跨设备导入历史。
- 导入批次云端审计。
- 多人协作导入。

## Phase 1.9.6 衔接结果

Phase 1.9.6 已在 [`Phase1_9_6_BulkImportExperienceDesign.md`](Phase1_9_6_BulkImportExperienceDesign.md) 中细化：

- 导入向导的具体 UI 步骤。
- 1,000 到 5,000 条收藏的预览方式。
- 分组映射默认策略：叶子文件夹、一级文件夹或路径折叠。
- 大量重复项的过滤和批量操作。
- 最近一次导入撤销的交互和边界。
- 是否将导入草稿临时保存到 localStorage。
- 测试样例：不同浏览器导出的书签 HTML、异常 HTML、超大文件、重复 URL、无效 URL。

## 验收标准

- 文档明确普通网页不能直接读取浏览器收藏夹、当前标签页或历史记录。
- 文档列出书签 HTML、URL 列表、浏览器扩展和云端批处理的方案对比。
- 文档给出推荐 MVP：书签 HTML 文件导入和 URL 列表粘贴。
- 文档定义导入草稿模型、提交计划和到 `HomeDocumentV2.groups[].sites` 的映射方式。
- 文档明确隐私边界：默认本地解析，不上传原始收藏文件，不远程抓取网页内容。
- 文档说明本阶段不新增 Supabase 表、RPC、Storage bucket 或首页文档 schema。
- 文档为 Phase 1.9.6 大批量导入体验设计留下明确输入，并已由 Phase 1.9.6 文档承接。
