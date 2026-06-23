---
title: 知识库阅读入口
description: 整合后的学习入口，说明各主题应优先阅读的主文档和维护原则。
---

# 知识库阅读入口

更新时间：2026-06-23

## 为什么重构

此前为了快速填充学习材料，同一主题下生成了多个版本：基础版、深度版、原理到应用版、高级工程师视角版。这些页面覆盖内容大量重复，导致后续复习时容易迷路，也不利于继续维护。

本次重构原则：

1. **每个主题只保留一篇主文档**：优先保留“高级工程师视角”或内容最系统的一版。
2. **专项知识独立成页**：ONNX、NPU 这类会被深入追问的主题单独保留。
3. **旧版重复页面删除**：不再在侧边栏保留多份相似页面。
4. **Review 区保留面试材料**：资料映射、问答清单、边界说明继续作为复习辅助。
5. **后续新增内容先合并到主文档**：除非主题足够大，否则不要再创建同名变体页面。

## 推荐阅读路径

### 1. C++ / Linux 系统工程

主文档：`高级工程师视角：C++ / Linux 系统工程`

阅读重点：

- RAII 不是技巧，而是资源安全架构；
- 所有权模型和接口设计；
- mutex 保护不变量，不只是保护变量；
- epoll 的 interest list / ready list；
- ET 模式为什么必须非阻塞并读写到 `EAGAIN`；
- CPU、内存、延迟问题如何建立证据链；
- CMake target usage requirements。

适用面试方向：C++ 后端、Linux 系统开发、交易系统、模型部署工具链、推理服务。

### 2. 交易系统

主文档：`高级工程师视角：交易系统`

阅读重点：

- 交易系统是分布式、异步、状态一致性系统；
- market data 是事件流，不是完美价格数组；
- 订单状态机不变量；
- client_order_id 幂等；
- fill 是资金和持仓唯一来源；
- OHLC 回测的不可观测路径问题；
- 回测与实盘一致性；
- 重启恢复和 reconcile。

适用面试方向：量化交易系统、回测框架、事件驱动系统、订单状态机。

### 3. 模型部署与量化

主文档：`高级工程师视角：模型部署与量化`

阅读重点：

- 模型部署是表达、语义、合法性、优化、数值、性能、调试的综合工程；
- ONNX 是强类型计算图交换格式，不是 runtime；
- ORT graph optimization 和调试边界；
- TensorRT dynamic shape 与 optimization profile；
- MLIR Dialect Conversion 的 legality 思路；
- QOperator / QDQ；
- 逐层 dump 和 divergence 定位；
- 性能瓶颈拆解。

适用面试方向：模型部署、推理优化、编译器工具链、量化精度分析。

### 4. ONNX 深入专题

主文档：`高级工程师视角：ONNX 深入专题`

阅读重点：

- ModelProto / GraphProto / NodeProto / TensorProto；
- ONNX graph 的 SSA 和拓扑约束；
- opset 是算子语义版本；
- shape inference 的能力和限制；
- checker 只能证明合法性，不能证明正确性；
- external data；
- Execution Provider 和 silent fallback；
- QDQ / QOperator；
- Caffe/PyTorch 转 ONNX 的常见坑。

适用面试方向：ONNX 转换、ONNX Runtime、NPU/EP 对接、模型格式转换。

### 5. MLIR 与图优化

主文档：`MLIR 工具链`、`图优化与性能分析`

阅读重点：

- Dialect、Operation、Value、Region、Block；
- Pattern Rewrite；
- Dialect Conversion；
- TypeConverter；
- 图优化如何保证语义等价；
- Conv+BN、冗余 Reshape、layout transform 消除；
- 加速来自哪里，如何验证。

适用面试方向：模型部署工具链、编译器、图优化、算子转换。

### 6. NPU 与端侧 AI 加速器

主文档：`高级工程师视角：NPU 与端侧 AI 加速器`

阅读重点：

- NPU 不是更快的 CPU，而是专用 tensor 数据流硬件；
- NPU 软件栈：转换工具、runtime、driver、hardware；
- NPU compiler 的 fusion、layout planning、tiling、memory planning；
- INT8 和静态 shape 为什么重要；
- 算子支持表怎么读；
- fallback 为什么抵消收益；
- 前处理和后处理可能比模型本体更慢；
- profiling 应拆 NPU kernel、copy、layout transform、CPU preprocess/postprocess。

适用面试方向：端侧部署、RKNN、NNAPI/LiteRT、NPU profiling、端侧量化。

### 7. 大模型推理

主文档：`大模型推理`

阅读重点：

- Prefill 和 Decode；
- KV Cache；
- 自回归生成瓶颈；
- 投机采样；
- acceptance rate；
- draft/target model；
- 平台算子支持和落地边界。

适用面试方向：LLM 推理服务、投机采样、KV Cache、量化推理。

### 8. Agent Memory

主文档：`高级工程师视角：Agent Memory 架构`

阅读重点：

- Memory 是跨会话用户状态管理系统；
- 短期、长期、程序性记忆；
- semantic / episodic / procedural memory；
- schema、confidence、sensitivity、source、version；
- hot path vs background 写入；
- 向量召回不能只靠 TopK；
- HNSW 参数和评估；
- prompt injection、sensitive disclosure、delete governance。

适用面试方向：Agent、RAG、Memory、Embedding、向量数据库、长期记忆系统。

### 9. OpenGL 2D

主文档：`OpenGL 2D 渲染`、`OpenGL 2D 补充笔记`

阅读重点：

- OpenGL context；
- shader；
- VBO/VAO/EBO；
- texture；
- 坐标变换；
- alpha blending；
- 2D batching；
- UI/动画状态。

适用面试方向：图形渲染、2D UI、互动展示项目。

## 后续维护原则

### 不再创建这些类型的重复页

不要再创建：

```text
xxx 基础
xxx 深度笔记
xxx 原理到应用
xxx 高级工程师视角
```

同一主题只保留一个主线页面。新增内容直接合并到主文档中。

### 什么时候可以新增专项页

只有满足以下任一条件才新增：

1. 主题足够大，例如 ONNX、NPU；
2. 面试会被独立深入追问；
3. 有明确官方资料体系；
4. 主文档继续扩写会过长且结构变乱。

### 每篇主文档建议结构

```text
0. 官方资料锚点
1. 高级工程师如何理解这个主题
2. 核心原理
3. 工程应用
4. 常见故障和排查路径
5. 性能/正确性/安全取舍
6. 项目结合讲法
7. 面试高级追问
8. 工程实践任务
9. 资料入口
```

### Review 区的定位

Review 区不存放系统知识正文，只保留：

- 资料映射；
- 面试问答；
- 边界表达；
- 项目记录；
- 官方资料索引。

系统知识正文统一放在 Knowledge 区。
