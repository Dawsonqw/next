# 面试防穿透知识库

这是一个基于 Astro Starlight 的静态文档站点，用于维护面试知识地图、项目复盘、简历防穿透表和 AI 填充模板。

原始大纲保留在 `reference/简历面试学习计划.md`，站点内容位于 `src/content/docs/`。

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
