---
title: 量化补充笔记
description: 量化与精度分析的补充学习笔记。
---

# 量化补充笔记

量化是模型部署中的常见优化方式，核心是用更低精度的数据类型表示权重或激活，从而降低存储、带宽和部分计算成本。

## 基础公式

```text
q = round(x / scale) + zero_point
x_hat = (q - zero_point) * scale
```

## 需要掌握

- 对称量化与非对称量化。
- per-tensor 与 per-channel。
- PTQ 与 QAT。
- calibration 数据选择。
- 权重分布、激活分布和逐层输出对齐。
- cosine、MSE、MAE、max abs diff 等误差指标。

## 面试讲法

量化精度分析不能只看最终输出，需要逐层 dump 中间结果，找到误差首次明显放大的节点，再结合该层算子、输入分布、量化参数和平台实现定位问题。

## 资料入口

- ONNX Runtime Quantization：https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html
- GPTQ：https://arxiv.org/abs/2210.17323
- AWQ：https://arxiv.org/abs/2306.00978
- SmoothQuant：https://arxiv.org/abs/2211.10438
