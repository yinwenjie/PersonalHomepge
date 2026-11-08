# Phase 2.5 公开快照预览改为文字结构

状态：设计待确认（2026-11-08）。本文是交给 Codex 实现的说明，Claude 负责验收。不涉及数据库、Edge Function 或公开文档格式。

## 背景

设置页 → 账号托管空间 → “公开快照分享”面板里有一块“实际公开预览”。它直接用 `ReadOnlyHomeRenderer` 把要公开的快照完整画出来：大号首页标题、分组卡片、网站图标、按钮样式。在设置页里它占很大一块，信息却只是“会公开哪些分组和网站”。

Gerald 的要求（2026-11-08）：

1. 预览只显示关键信息：首页标题、分组名、组内网站列表，按“标题 → 分组 → 网站”三级文字显示。
2. 不显示按钮、图标和主题颜色，文字用适合设置页的字号。
3. 增加“显示预览”按钮，默认收起，点开才显示快照内容。

## 范围

| 改动 | 是否在本次范围 |
|---|---|
| 设置页公开分享面板里的预览（`src/components/public-home-share-panel.tsx` 的 `PublicSharePreview`） | 是 |
| 对应 CSS（`app/globals.css` 的 `.public-share-preview*`） | 是 |
| i18n 文案（`src/i18n/messages.ts`，8 种语言） | 是 |
| 静态检查（`scripts/verify-public-home-share.mjs`） | 是 |
| 访客打开的公开页 `/share#token`（`public-home-share-page.tsx`） | 否，保持现在的完整主页样式 |
| `ReadOnlyHomeRenderer` / `ReadOnlyThemeStyleBridge` | 不改（公开页还在用） |
| 公开文档 `PublicHomeDocumentV1` 的字段（仍包含 theme、url、mark） | 不改 |
| 发布、更新、撤销、复制链接的逻辑 | 不改 |

公开页是否也要改成文字版，由 Gerald 另行决定；本文默认不改。

## 1. 交互

预览块默认收起，只显示一行头部：

```
┌──────────────────────────────────────────────────────────┐
│ 公开内容预览                                  [显示预览] │
│ 12 个分组 · 47 个网站                                    │
└──────────────────────────────────────────────────────────┘
```

点“显示预览”后展开，按钮文字变为“隐藏预览”：

```
┌──────────────────────────────────────────────────────────┐
│ 公开内容预览                                  [隐藏预览] │
│ 12 个分组 · 47 个网站                                    │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Gerald Ian's Homepage                                │ │
│ │                                                      │ │
│ │ ┃ 未分组  2                                          │ │
│ │ ┃ X              MyCarletonOne                       │ │
│ │                                                      │ │
│ │ ┃ AI  7                                              │ │
│ │ ┃ ChatGPT        ElevenLabs       DeepSeek           │ │
│ │ ┃ NotebookLM     智谱              MiniMax            │ │
│ │ ┃ Deeptutor                                          │ │
│ │ ...                                                  │ │
│ └──────────────────────────────────────────────────────┘ │
│ 预览只显示文字结构。公开页面会按你的主题显示图标和颜色。 │
└──────────────────────────────────────────────────────────┘
```

规则：

- 展开状态是组件内的 `useState(false)`，每次进入设置页都是收起。**不要**存到 localStorage / sessionStorage（`verify:public-share` 禁止面板使用它们）。
- 收起时不渲染列表（条件渲染，不是 `hidden`），网站多时（上限 2000 个）不额外占 DOM。
- 头部的分组数、网站数在收起时也显示，用户不用展开就能确认规模。
- 去掉原来的“只读”徽章，位置换成切换按钮。
- 发布、更新快照后不自动展开或收起，保持用户当前选择。
- `projection.ok === false` 时和现在一样只显示警告，不显示预览块和按钮。

## 2. 结构与无障碍

建议在 `public-home-share-panel.tsx` 内重写 `PublicSharePreview`（文件内私有组件即可，不必新建文件）：

```tsx
function PublicSharePreview({ documentValue }: { documentValue: PublicHomeDocumentV1 }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const siteCount = documentValue.groups.reduce((total, group) => total + group.sites.length, 0);

  return (
    <section className="public-share-preview" aria-labelledby="publicSharePreviewTitle">
      <header>
        <div>
          <h4 id="publicSharePreviewTitle">{t("settings.publicShare.previewTitle")}</h4>
          <p>{t("settings.publicShare.previewMetrics", { groups: ..., sites: siteCount })}</p>
        </div>
        <button
          className="utility-button"
          type="button"
          aria-expanded={expanded}
          aria-controls="publicSharePreviewOutline"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("settings.publicShare.previewHide") : t("settings.publicShare.previewShow")}
        </button>
      </header>
      {expanded ? (
        <>
          <div className="public-share-outline" id="publicSharePreviewOutline">
            <p className="public-share-outline-title">{documentValue.documentTitle}</p>
            <ol className="public-share-outline-groups">
              {groups.map((group) => (
                <li key={group.id}>
                  <p className="public-share-outline-group">
                    <span>{group.title}</span>
                    <span className="public-share-outline-count">{group.sites.length}</span>
                  </p>
                  <ul className="public-share-outline-sites">
                    {sites.map((site) => <li key={site.id} title={site.name}>{site.name}</li>)}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
          <p className="public-share-outline-note">{t("settings.publicShare.previewTextNotice")}</p>
        </>
      ) : null}
    </section>
  );
}
```

要点：

- 标题用 `<p>`，不用 `<h1>`/`<h5>`，避免设置页标题层级被用户内容打乱；分组和网站用 `ol` / `ul`，读屏能读出层级和数量。
- 分组按 `order` 排序，组内网站按 `order` 排序（和 `ReadOnlyHomeRenderer` 一致）。投影已经去掉空分组、保证标题非空，这里不需要再做空值兜底。
- 网站只显示名称：**不渲染 `<a>`、不显示 URL、不用 `SiteIcon`、不读 `mark` 和 `theme`**。
- 所有用户内容只作为文本节点输出，不用 `dangerouslySetInnerHTML`。
- 面板不再导入 `ReadOnlyHomeRenderer`、`ReadOnlyHomeRendererBoundary`、`SiteIcon`、`ReadOnlyThemeStyleBridge`。纯文本渲染不会抛出数据相关错误，不需要再包错误边界。这样也从根上避免了 PR #39 那种预览改写设置页根变量（背景图消失）的问题。
- `settings.publicShare.previewBadge`、`previewUnavailable`、`previewEmpty` 只有这个面板在用，改完后从 8 种语言里一起删除。

## 3. 样式

只用设置页现有的 token（`--text`、`--muted`、`--line`、`--glass-bg-soft`、`--background`、`--radius`），不读主题强调色，不用 `.page`、`.section`、`.site-tile` 等主页类名。

| 元素 | 样式 |
|---|---|
| 外框 `.public-share-outline` | `max-height: 360px; overflow: auto; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--background);` |
| 首页标题 `.public-share-outline-title` | 16px，`font-weight: 700`，`color: var(--text)`，下边距 10px，超长换行（`overflow-wrap: anywhere`） |
| 分组列表 `.public-share-outline-groups` | `list-style: none; margin: 0; padding: 0; display: grid; gap: 12px;` |
| 分组项 `li` | `padding-left: 10px; border-left: 2px solid var(--line);` |
| 分组名 `.public-share-outline-group` | 14px，`font-weight: 650`，`display: flex; align-items: baseline; gap: 6px;`，下边距 4px |
| 分组数量 `.public-share-outline-count` | 12px，`color: var(--muted)`，`font-weight: 400` |
| 网站列表 `.public-share-outline-sites` | `list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 2px 12px;` |
| 网站名 `li` | 13px，`line-height: 1.6`，`color: var(--text)`，单行省略（`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0`），完整名称放在 `title` |
| 说明 `.public-share-outline-note` | 和 `.public-share-preview > header p` 一样：12px，`var(--muted)` |

- 删除不再使用的规则：`.public-share-preview-frame` 及其子规则（约 3573–3598 行），以及窄屏媒体查询里的 `.public-share-preview-frame .read-only-section`（约 5401 行）。`.public-share-preview > header > span` 的徽章样式随徽章一起删掉。
- `auto-fill` 在手机宽度下自然变成 1–2 列，不需要额外媒体查询。
- 字体沿用设置页正文字体，不跟随主题的等宽字体（截图里的大号等宽字是主页主题样式带进来的）。

## 4. 文案

修改和新增的 key（中文为 `DEFAULT_MESSAGES`，其余 7 种语言同步，`npm run verify:i18n` 必须通过）：

| key | zh-CN | en |
|---|---|---|
| `settings.publicShare.previewTitle`（改） | 公开内容预览 | Public content preview |
| `settings.publicShare.previewShow`（新） | 显示预览 | Show preview |
| `settings.publicShare.previewHide`（新） | 隐藏预览 | Hide preview |
| `settings.publicShare.previewTextNotice`（新） | 预览只显示文字结构。公开页面会按你的主题显示图标和颜色。 | This preview shows the text outline only. The public page uses your theme, icons and colors. |

zh-TW、fr、es、ja、ko、it 由 Codex 按同样意思翻译。`includedFields`（“包含：首页标题、主题风格……”）不改，因为公开文档仍然包含主题。

## 5. 静态检查

更新 `scripts/verify-public-home-share.mjs` 的 `verifyClientPrivacyContract()`：

- 删除对 `<ReadOnlyHomeRenderer ... applyThemeToDocument={false}>` 的断言（面板不再使用渲染器）。
- 新增断言：设置面板源码不包含 `ReadOnlyHomeRenderer`、`ReadOnlyThemeStyleBridge`、`SiteIcon`、`dangerouslySetInnerHTML`。
- 新增断言：面板包含 `aria-expanded`，且预览展开状态默认值为 `false`（例如匹配 `useState(false)`）。
- 保留现有的 localStorage / sessionStorage / 埋点禁止项。

## 6. 验收清单（Claude 验收时逐项检查）

1. `npm run lint`、`npx tsc --noEmit`、`npm run verify:i18n`、`npm run verify:public-share`、`npm run build` 全部通过。
2. 本地 mock 一个账号托管空间（见项目记忆里的 Playwright mock 方法），设置页公开分享面板：
   - 默认只看到标题、分组/网站数量和“显示预览”按钮，看不到列表。
   - 点开后看到“首页标题 → 分组名 + 数量 → 网站名”三级文字，无图标、无链接、无主题色、无大号等宽字。
   - 再点收起；刷新页面后仍是收起。
   - 展开预览后，设置页背景图和 Banner 仍正常（PR #39 回归）。
   - 宽屏和 390px 手机宽度截图各一张，网站名超长时单行省略，无横向滚动。
3. `/share#<token>` 公开页外观不变（与改动前截图对比）。
4. 发布 / 更新快照 / 撤销 / 复制链接流程不受影响。
5. diff 只涉及第 2–5 节列出的文件。

## 7. 上线

普通前端改动：Codex 在分支上实现 → Claude 验收 → 合并 master → Gerald 确认后推 `production` 上线，Gerald 用真实账号检查设置页。
