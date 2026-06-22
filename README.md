# 技术学习笔记

这是一个基于 Astro Starlight 的静态文档站点，用于维护技术知识地图、项目记录、问答清单和 AI 填充模板。

站点内容位于 `src/content/docs/`。

## 本地开发

```bash
nvm use
npm install
npm run dev
```

## 构建

```bash
nvm use
npm run build
npm run preview
```

## 骨架校验

```bash
nvm use
npm run check:skeleton
```

## 更新方式

- 手动编辑 `src/content/docs/` 下的 Markdown / MDX 页面。
- 使用 `templates/ai-fill-prompt` 中的提示词让本地 AI 补全文档。
- 提交并推送后，由后续部署流程自动更新静态站点。

## GitHub Pages

仓库推送到 `main` 后会通过 GitHub Actions 构建并部署到 GitHub Pages。

首次启用时，需要在 GitHub 仓库的 `Settings -> Pages` 中把 `Source` 设置为 `GitHub Actions`。
