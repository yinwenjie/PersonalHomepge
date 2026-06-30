# GitHub Pages 部署说明

## 当前部署方式

本项目使用 Next.js static export + GitHub Pages Actions。

- 构建命令：`npm run build`
- 构建后校验：`npm run verify:export`
- 发布产物目录：`out/`
- 工作流文件：`.github/workflows/deploy-pages.yml`
- Pages 兼容文件：`public/.nojekyll`

## URL 规则

- 如果仓库名是 `<user>.github.io`，站点默认部署到根路径，例如 `https://yinwenjie.github.io/`。
- 如果仓库名是普通项目仓库，例如 `PersonalHomepge`，站点默认部署到项目路径，例如 `https://yinwenjie.github.io/PersonalHomepge/`。
- 工作流会自动计算路径，并在构建时设置 `NEXT_PUBLIC_BASE_PATH`。
- `NEXT_PUBLIC_BASE_PATH` 会被规范化：空值或 `/` 表示根路径；项目路径应写成 `/PersonalHomepge`；尾部斜杠会被去除。

## GitHub 上的配置步骤

1. 把本地修改提交并推送到 GitHub。
2. 打开仓库页面。
3. 进入 `Settings`。
4. 在左侧进入 `Pages`。
5. 在 `Build and deployment` 里把 `Source` 改成 `GitHub Actions`。
6. 确认要发布的代码已经合并到 `production` 分支。当前工作流监听的是 `production`。
7. 推送 `production` 分支，或者在 `Actions` 页手动运行 `Deploy to GitHub Pages`。
8. 等工作流里的 `build` 和 `deploy` 两个 job 都变绿。
9. 回到 `Settings > Pages` 查看最终站点地址。

## 自定义路径

如果你想覆盖自动推导出来的路径：

1. 打开 GitHub 仓库。
2. 进入 `Settings`。
3. 在左侧进入 `Secrets and variables` -> `Actions`。
4. 新建一个 repository variable：`PAGES_BASE_PATH`。
5. 值按下面规则填写：
   - 部署到根路径：填写 `/`。
   - 部署到项目路径：例如 `/PersonalHomepge`。
   - 未设置或留空时，普通项目仓库会继续按仓库名自动推导，例如 `/PersonalHomepge`。
6. 重新运行部署工作流。

## 静态导出校验

工作流会在 `npm run build` 之后执行：

```bash
npm run verify:export
```

这个脚本会检查：

- `out/index.html` 是否存在。
- `out/_next` 是否存在。
- 导出 HTML 中的 `_next` 资源路径是否匹配当前 `NEXT_PUBLIC_BASE_PATH`。
- 是否出现重复 base path 或重复斜杠。

如果 GitHub Pages legacy 构建使用 `/PersonalHomepge`，则 `_next` 资源应以 `/PersonalHomepge/_next/` 开头。正式主域名根路径构建则应以 `/_next/` 开头。

## 常见情况

- 想要 `https://yinwenjie.github.io/`
  - 最稳的做法是把站点代码放到名为 `yinwenjie.github.io` 的仓库里，或者给当前仓库绑定自定义域名。
- 想要 `https://yinwenjie.github.io/PersonalHomepge/`
  - 保持当前仓库名不变即可，工作流会自动处理。

## 本地验证

部署前建议先本地检查一次：

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm run verify:export
```

构建成功后检查 `out/` 是否生成首页和 `_next` 资源文件。

如需本地验证 GitHub Pages 项目路径：

```powershell
$env:NEXT_PUBLIC_BASE_PATH="/PersonalHomepge"
npm run build
npm run verify:export
Remove-Item Env:NEXT_PUBLIC_BASE_PATH -ErrorAction SilentlyContinue
```
