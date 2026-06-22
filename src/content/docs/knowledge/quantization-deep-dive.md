---
title: 量化与精度分析深度笔记
description: PTQ、QAT、量化公式、逐层误差定位、GPTQ、AWQ、SmoothQuant。
---

# 量化与精度分析深度笔记

## 1. 学习目标

这篇笔记对应简历中的“权重分布、激活分布、计算卡推理前后中间层数据、定位量化后精度下降的异常层和异常算子”。面试重点是：量化为什么会掉点、如何定位、如何恢复。

## 2. 基本概念

量化是把高精度浮点数映射到低精度整数或低 bit 表示，减少模型大小、内存带宽和部分硬件上的计算成本。

常见仿射量化公式：

```text
q = round(x / scale) + zero_point
x_hat = (q - zero_point) * scale
```

其中 `x` 是浮点值，`q` 是量化整数，`scale` 控制缩放比例，`zero_point` 表示浮点 0 对应的整数值。

## 3. 对称量化与非对称量化

| 类型 | 特点 | 适用 |
|---|---|---|
| 对称量化 | zero_point 通常为 0，硬件实现简单 | 权重量化常见 |
| 非对称量化 | 能表示偏移分布，zero_point 不一定为 0 | 激活量化常见 |

如果数据分布大致以 0 为中心，对称量化更简单。如果分布明显偏移，非对称量化可能更好利用整数范围。

## 4. per-tensor 与 per-channel

| 粒度 | 含义 | 优缺点 |
|---|---|---|
| per-tensor | 整个 tensor 共用一组 scale | 简单，但容易被 outlier 影响 |
| per-channel | 每个输出通道有独立 scale | 精度更好，常用于 Conv/Linear 权重 |

卷积权重的不同输出通道分布差异可能很大，per-channel 能减少单个极端通道拉大量化范围的问题。

## 5. PTQ 与 QAT

- **PTQ**：训练后量化。成本低，适合部署工具链快速尝试。依赖 calibration 数据估计激活范围。
- **QAT**：量化感知训练。训练时模拟量化误差，通常精度更好，但需要训练数据和训练成本。

工程经验：先 PTQ，若掉点严重，再考虑敏感层回退、混合精度、调整 calibration、QAT 或模型结构调整。

## 6. Calibration 数据

Calibration 数据用于估计激活分布。选择原则：

1. 与真实业务输入分布一致；
2. 覆盖常见场景和边界场景；
3. 前处理必须和部署一致；
4. 数量不是越多越好，代表性更重要；
5. 对检测、分割、关键点任务，要覆盖尺度、光照、目标数量变化。

## 7. 逐层精度分析

只看最终输出无法定位问题。建议流程：

```text
FP32 参考模型推理
  -> dump 每层输出
量化模型或 NPU 模型推理
  -> dump 每层输出
层名和 shape 对齐
  -> 计算 cosine / MSE / MAE / max abs diff
  -> 找到误差首次明显扩大的层
  -> 分析该层算子、输入分布、量化参数和平台实现
```

| 指标 | 用途 |
|---|---|
| cosine similarity | 判断向量方向一致性，适合中间层整体相似度 |
| MSE/RMSE | 衡量平均平方误差，对大误差敏感 |
| MAE | 衡量平均绝对误差，直观稳定 |
| max abs diff | 发现局部极端误差 |
| top-k 一致率 | 分类模型最终结果对齐 |

## 8. 常见掉点原因

- calibration 数据不代表真实分布；
- 激活 outlier 拉大 scale；
- 敏感层被 INT8 量化；
- 多次量化/反量化造成误差累积；
- per-tensor 粒度过粗；
- 平台算子实现与参考框架存在数值差异；
- 前处理或后处理不一致，被误判为量化掉点。

## 9. 恢复策略

1. 更换或补充 calibration 数据；
2. 对敏感层保留 FP16/FP32；
3. 权重从 per-tensor 改 per-channel；
4. 对 outlier 做 clipping 或 smooth；
5. Conv+BN 融合减少中间误差；
6. 使用 QAT；
7. 对平台不友好算子做等价改写。

## 10. LLM 量化方法

| 方法 | 核心思想 | 面试讲法 |
|---|---|---|
| GPTQ | 使用近似二阶信息做 one-shot 权重量化 | 强调低 bit weight-only 和误差补偿 |
| AWQ | 根据激活分布识别重要权重通道并保护 | 强调 salient weights 和硬件友好部署 |
| SmoothQuant | 将 activation outlier 的量化难点迁移到 weight | 强调 W8A8 和等价缩放 |

## 11. 项目讲法模板

> 我们做量化精度分析时，不只是比较最终输出，而是结合权重分布、激活分布和逐层中间结果。定位时先跑 FP32 参考模型，再跑量化或目标平台模型，逐层计算 cosine、MSE、max diff 等指标，找到误差首次明显放大的节点，再结合该节点的算子类型、输入分布、scale 和平台实现判断原因。

## 12. 资料入口

- ONNX Runtime Quantization：https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html
- GPTQ：https://arxiv.org/abs/2210.17323
- AWQ：https://arxiv.org/abs/2306.00978
- SmoothQuant：https://arxiv.org/abs/2211.10438
