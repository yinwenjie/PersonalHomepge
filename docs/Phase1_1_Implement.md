# 本地可编辑首页实施规划

## Summary
第一阶段只改当前单文件 `homepage.html`，不引入后端、不做登录、不做全网同步。目标是把现有静态链接数据改成“本地可编辑、刷新后保留”的首页：默认是查看模式，点击编辑进入管理模式；所有分组和网站编辑保存到当前浏览器的 `localStorage`；页面启动时优先读取本地数据，读不到时使用内置默认数据。

## Implementation Changes
- 数据模型改为完整首页文档：
```json
{
  "version": 1,
  "updatedAt": "ISO_DATE",
  "groups": [
    {
      "id": "group_id",
      "title": "技术与开发",
      "keywords": "代码 仓库 编程 开发 云服务",
      "order": 1,
      "sites": [
        {
          "id": "site_id",
          "name": "GitHub",
          "url": "https://github.com/",
          "keywords": "git 代码 仓库",
          "mark": "GH",
          "order": 1
        }
      ]
    }
  ],
  "widgets": [],
  "theme": {},
  "syncMeta": {
    "mode": "local"
  }
}
```
- 本地存储：
  - 主 key：`homepage:data:v1`
  - 编辑时更新内存中的 `homeDocument`，再 `JSON.stringify` 写入 `localStorage`。
  - 每次保存更新 `updatedAt`。
  - 数据损坏或版本不兼容时回退到默认首页，不让页面白屏。
- 页面启动流程：
  - 将现有 `categories` 重命名为 `DEFAULT_GROUPS` 或转换为 `DEFAULT_HOME_DOCUMENT`。
  - 调用 `loadHomeDocument()`：
    - 优先读取 `localStorage.getItem("homepage:data:v1")`。
    - 成功解析并通过基础校验后作为页面数据。
    - 失败或不存在时使用默认数据。
  - 调用 `render(homeDocument, searchQuery, editMode)` 渲染页面。
- 渲染逻辑：
  - `render()` 不再直接读取全局 `categories`，而是读取当前 `homeDocument.groups`。
  - 搜索过滤继续支持分组标题、网站名称、mark、keywords。
  - favicon 逻辑保留。
  - 渲染用户输入内容时必须转义文本，避免用户输入 HTML 后被执行。
- 编辑模式：
  - 顶部新增一个轻量“编辑/完成”切换按钮。
  - 查看模式：保持当前极简首页体验。
  - 编辑模式：
    - 每个分组显示：重命名、上移、下移、删除。
    - 每个网站显示：编辑、上移、下移、删除。
    - 页面底部或分组内显示：新增分组、新增网站。
    - 删除分组/网站使用 `confirm()` 二次确认。
- 表单能力：
  - 新增/编辑分组字段：`title`、`keywords`。
  - 新增/编辑网站字段：`name`、`url`、`keywords`、`mark`。
  - `mark` 可自动从名称生成，用户也可手动改。
  - URL 只允许 `http://` 和 `https://`，非法 URL 不保存。
- 导入导出：
  - 新增“导出 JSON”：下载当前 `homeDocument`。
  - 新增“导入 JSON”：选择 JSON 文件，解析、校验、确认后覆盖本地首页。
  - 新增“恢复默认”：二次确认后清除 `homepage:data:v1` 并重新加载默认数据。

## Operation Sequence
1. 抽取默认数据：
   - 保留当前 49 个网站。
   - 给每个分组和网站补 `id`、`order`。
   - 生成 `DEFAULT_HOME_DOCUMENT`。
2. 添加本地数据层：
   - `createId()`
   - `loadHomeDocument()`
   - `saveHomeDocument()`
   - `validateHomeDocument()`
   - `normalizeHomeDocument()`
3. 改造渲染：
   - `render(query)` 改为使用当前 `homeDocument`。
   - 加入 `editMode` 分支，控制是否显示编辑按钮和表单。
4. 添加编辑动作：
   - `addGroup`
   - `updateGroup`
   - `deleteGroup`
   - `moveGroup`
   - `addSite`
   - `updateSite`
   - `deleteSite`
   - `moveSite`
   - 每个动作完成后统一调用 `commitHomeDocument()` 保存并重渲染。
5. 添加导入导出和恢复默认。
6. 做本地浏览器验证。

## Test Plan
- 初始打开页面：
  - 没有本地数据时显示默认 49 个网站。
  - DuckDuckGo 搜索、favicon、过滤功能保持正常。
- 本地保存：
  - 新增分组后刷新页面，分组仍存在。
  - 新增网站后刷新页面，网站仍存在。
  - 编辑名称、URL、keywords 后刷新仍保留。
  - 删除网站/分组后刷新不恢复。
- 排序：
  - 分组上移/下移后刷新顺序保持。
  - 网站上移/下移后刷新顺序保持。
- 搜索：
  - 编辑后的新网站能被名称和 keywords 搜到。
  - `git` 仍能搜到 GitHub/Gitee/BitBucket/Coding。
- 安全和健壮性：
  - 输入 `<script>alert(1)</script>` 只作为文本显示，不执行。
  - 输入非法 URL 时阻止保存并提示。
  - 手动把 `localStorage` 改成坏 JSON 后，页面能回退默认数据。
- 导入导出：
  - 导出 JSON 后清空本地数据，再导入能恢复。
  - 导入格式错误的 JSON 不覆盖当前数据。
- 响应式：
  - 桌面和手机宽度下编辑控件不重叠、不撑破布局。

## Assumptions
- 本阶段只实现本地编辑，不做同步码、不做登录、不接 Supabase。
- 本阶段继续保持单文件 `homepage.html`。
- 本地数据使用 `localStorage`，因为当前数据规模很小，读写简单，足够支撑第 1 阶段。
- 编辑模式优先功能完整和安全，拖拽排序延后；先用上移/下移按钮降低实现风险。
