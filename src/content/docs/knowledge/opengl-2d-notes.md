---
title: OpenGL 2D 补充笔记
description: 2D 渲染管线、纹理和动画状态。
---

# OpenGL 2D 补充笔记

## 渲染流程

```text
准备顶点数据
  -> 创建 VBO / VAO / EBO
  -> 编译 shader
  -> 加载纹理
  -> 设置变换矩阵
  -> draw call
  -> 显示结果
```

## 必须掌握

- VBO：存储顶点数据。
- VAO：记录顶点属性配置。
- EBO：存储索引。
- Vertex Shader：处理顶点坐标。
- Fragment Shader：计算像素颜色。
- Texture：存储图片或动画帧。
- Uniform：从 CPU 传参数到 shader。

## 2D 坐标变换

```text
局部坐标 -> 世界坐标 -> 视图坐标 -> 裁剪坐标 -> 屏幕坐标
```

重点关注屏幕像素坐标、OpenGL NDC 坐标、图片宽高比例、缩放、旋转、平移和图层顺序。

## 动画状态

情感陪伴机器人中，2D 渲染可以用于表情、状态和反馈动画。常见状态包括 idle、listening、thinking、speaking 和 emotion_feedback。

## 性能排查

- draw call 是否过多。
- 纹理是否频繁创建和释放。
- 是否每帧重复上传不变数据。
- 图片尺寸是否过大。
- 是否存在同步等待。

## 资料入口

- OpenGL Wiki：https://www.khronos.org/opengl/wiki/
- LearnOpenGL：https://learnopengl.com/
