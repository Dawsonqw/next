---
title: 量化与精度分析深度笔记
description: PTQ、QAT、量化公式、逐层误差定位、GPTQ、AWQ、SmoothQuant 的面试追问树。
---

# 量化与精度分析深度笔记

更新时间：2026-06-23

## 1. 学习目标

这篇笔记对应简历中的“权重分布、激活分布、计算卡推理前后中间层数据、定位量化后精度下降的异常层和异常算子”。面试重点是：

```text
量化为什么会掉点
  -> scale/zero_point 怎么来
  -> 对称/非对称怎么选
  -> per-tensor/per-channel/per-group 为什么影响精度
  -> calibration 数据怎么选
  -> 逐层 dump 怎么定位
  -> 掉点后怎么恢复
  -> GPTQ/AWQ/SmoothQuant 解决什么
  -> 为什么量化不一定加速
```

## 2. 基本概念

量化是把高精度浮点数映射到低精度整数或低 bit 表示，减少模型大小、内存带宽和部分硬件上的计算成本。

常见仿射量化公式：

```text
q = clamp(round(x / scale) + zero_point, qmin, qmax)
x_hat = (q - zero_point) * scale
```

其中：

| 符号 | 含义 |
|---|---|
| `x` | 原始浮点值 |
| `q` | 量化后的整数值 |
| `scale` | 浮点范围到整数范围的比例 |
| `zero_point` | 浮点 0 映射到整数空间的位置 |
| `qmin/qmax` | 整数量化范围，例如 int8 的 -128 到 127 |
| `x_hat` | 反量化近似值 |

## 3. 量化误差来源

### 3.1 舍入误差

连续浮点值映射到离散整数网格，必然有舍入误差。scale 越大，网格越粗，误差越大。

### 3.2 截断/饱和误差

如果真实值超出量化范围，会被 clamp 到 qmin/qmax，对 outlier 特别敏感。

### 3.3 outlier 拉大量化范围

如果一层激活大多数值在 [-1, 1]，但偶尔有 50 这样的 outlier，MinMax calibration 会把 scale 拉得很大，导致 [-1, 1] 内的大量正常值分辨率下降。

### 3.4 累积误差

多层网络中，前面层的小误差可能在后面被放大。尤其是非线性、归一化、softmax、检测 head 等位置，误差传播可能影响最终任务指标。

## 4. 对称量化与非对称量化

| 类型 | 公式特点 | 优点 | 风险 |
|---|---|---|---|
| 对称量化 | zero_point 通常为 0 | 硬件实现简单，矩阵乘友好 | 对偏移分布利用率低 |
| 非对称量化 | zero_point 可非零 | 能更好覆盖非零中心分布 | kernel 实现和校正项更复杂 |

### 面试追问：权重和激活常怎么选？

- 权重通常分布相对稳定，常用对称量化；
- 激活依赖输入数据，分布可能偏移，可能使用非对称量化；
- 具体还要看 runtime 和硬件 kernel 支持。

### 面试追问：非对称量化一定更好吗？

不一定。非对称能更好表示偏移分布，但会引入 zero_point 校正开销；如果硬件对对称 int8 kernel 优化更好，非对称未必更快。

## 5. per-tensor / per-channel / per-group

| 粒度 | 含义 | 优点 | 缺点 |
|---|---|---|---|
| per-tensor | 整个 tensor 一组 scale | 简单、kernel 友好 | 容易被某个 channel outlier 影响 |
| per-channel | 每个输出通道一组 scale | Conv/Linear 权重精度更好 | scale 更多，kernel 更复杂 |
| per-group | 每组通道或 block 一组 scale | LLM INT4 常见，精度/性能折中 | group size 需要调 |
| per-token | 每个 token 动态 scale | 适合某些 LLM 激活场景 | runtime 开销高 |

### 面试追问：为什么 Conv 权重常用 per-channel？

不同输出通道的权重分布差异可能很大。per-tensor 会被最大范围通道控制，导致其他通道分辨率不足。per-channel 让每个输出通道有自己的 scale，通常能显著降低权重量化误差。

### 面试追问：group size 怎么影响 LLM INT4？

group size 越小，scale 粒度越细，精度通常越好，但 scale 元数据更多，kernel 访问更复杂；group size 越大，元数据少、速度可能更好，但精度可能下降。

## 6. PTQ、QAT、Dynamic、Weight-only

| 方法 | 量化参数来源 | 是否训练 | 典型场景 | 风险 |
|---|---|---|---|---|
| Dynamic Quantization | 推理时动态估计激活范围 | 否 | 简单 CPU/LLM 部分场景 | 有运行时开销 |
| Static PTQ | calibration 离线估计 | 否 | CNN/端侧 INT8 | 依赖 calibration 数据 |
| QAT | 训练时模拟量化 | 是 | PTQ 掉点严重 | 成本高，需要训练数据 |
| Weight-only | 主要量化权重 | 通常否 | LLM INT8/INT4 | 依赖高效 matmul kernel |
| KV Cache Quantization | 量化 KV Cache | 否或少量校准 | 长上下文/高并发 LLM | 可能影响生成质量 |

### 面试追问：为什么先做 PTQ？

因为 PTQ 成本低，不需要重新训练，适合先验证模型对量化的敏感程度。如果 PTQ 掉点可接受，就没有必要做更复杂的 QAT。如果掉点严重，再考虑 calibration、混合精度、敏感层回退、QAT。

### 面试追问：QAT 为什么通常精度更好？

QAT 在训练过程中模拟量化和反量化，让模型参数适应量化噪声，因此比训练后直接量化更容易恢复精度。但它需要训练数据、训练成本和更复杂的工程流程。

## 7. Calibration 数据

Calibration 数据用于估计激活分布。选择原则：

1. 与真实业务输入分布一致；
2. 覆盖常见场景和边界场景；
3. 前处理必须和部署一致；
4. 数量不是越多越好，代表性更重要；
5. 对检测、分割、关键点任务，要覆盖尺度、光照、目标数量变化；
6. 对文本/LLM，要覆盖实际 prompt 长度、语言、任务类型。

### Calibration 方法

| 方法 | 思路 | 优缺点 |
|---|---|---|
| MinMax | 用最大最小值确定范围 | 简单，但受 outlier 影响大 |
| Percentile | 丢弃极端分位 outlier | 减少 outlier 影响，但可能截断有用值 |
| KL/Entropy | 选择分布损失较小阈值 | 常用于分类 CNN，计算复杂 |
| MSE | 选择重构误差最小范围 | 更直接，但搜索成本高 |
| Moving Average | 平滑统计范围 | 适合校准过程中稳定估计 |

### 面试追问：calibration 数据越多越好吗？

不一定。代表性比数量更重要。数据很多但分布偏，仍会导致线上掉点。数据太少则可能估计不稳定。实际要结合业务分布、边界样本和指标验证。

## 8. ONNX QDQ 与 QOperator

| 格式 | 表达 | 调试特点 |
|---|---|---|
| QDQ | `QuantizeLinear -> Op -> DequantizeLinear` | 量化边界清晰，便于调试 |
| QOperator | 直接量化算子，如 `QLinearConv` | 更像最终量化执行表达 |

### 面试追问：QDQ 图一定会加速吗？

不一定。QDQ 只是图表示。真正加速取决于 runtime 能否把 QDQ pattern 融合/lower 到低精度 kernel。如果 Q/DQ 节点没有被融合，反而可能更慢。

## 9. 逐层精度分析

只看最终输出无法定位问题。建议流程：

```text
FP32 参考模型推理
  -> dump 每层输出
量化模型或 NPU 模型推理
  -> dump 每层输出
层名和 shape 对齐
  -> 计算 cosine / MSE / MAE / max abs diff / SQNR
  -> 找到误差首次明显扩大的层
  -> 分析该层算子、输入分布、量化参数和平台实现
```

### 指标解释

| 指标 | 用途 | 注意 |
|---|---|---|
| cosine similarity | 判断向量方向一致性 | 对整体 scale 不敏感 |
| MSE/RMSE | 衡量平均平方误差 | 对大误差敏感 |
| MAE | 平均绝对误差 | 直观稳定 |
| max abs diff | 发现局部极端误差 | 容易被单个 outlier 影响 |
| SQNR | 信号与量化噪声比 | 更贴近量化噪声分析 |
| top-k 一致率 | 分类最终结果 | 不能定位中间问题 |

### 面试追问：为什么找“首次明显放大”的层？

因为最后输出大错可能只是前面某层误差传播的结果。找到首次误差明显放大的层，才能定位真正问题源头。

### 面试追问：层名对不上怎么办？

- 转换时保留原始 node/layer 名；
- 按拓扑顺序匹配；
- 按 op_type 和输入输出 shape 匹配；
- 在图中插入 debug output；
- 对子图而不是单节点做对齐。

## 10. 常见掉点原因

| 原因 | 表现 | 处理 |
|---|---|---|
| calibration 数据不代表真实分布 | 离线好，线上差 | 重选 calibration 数据 |
| 激活 outlier | 某层 scale 很大，正常值量化粗 | clipping、SmoothQuant、回退 |
| 敏感层被量化 | 首层/末层/head 掉点 | 混合精度保留 FP16/FP32 |
| per-tensor 粒度过粗 | 某些 channel 误差大 | per-channel/per-group |
| Q/DQ 未融合 | 精度正常但速度慢 | 检查 runtime graph/profiling |
| CPU fallback | 设备利用率低 | 改写 op 或换 backend |
| 前后处理不一致 | 被误判成量化问题 | 先对齐 FP32 ONNX |
| dtype 溢出 | 某些中间结果异常 | 检查 accumulator 和 scale |

## 11. 恢复策略

按成本从低到高：

1. 校正前后处理，确认不是输入输出问题；
2. 更换或补充 calibration 数据；
3. 改 calibration 方法，例如 MinMax -> Percentile/KL/MSE；
4. 权重 per-tensor 改 per-channel；
5. 对敏感层保留 FP16/FP32；
6. 对 outlier 做 clipping 或 SmoothQuant；
7. 对图结构做融合或等价改写；
8. 使用 QAT；
9. 调整模型结构或重新训练。

### 面试追问：哪些层常被回退？

- 模型第一层；
- 模型最后分类/检测 head；
- Softmax / LayerNorm / attention score 相关层；
- 对任务指标敏感的分支；
- 量化误差首次放大的层。

## 12. LLM 量化方法

| 方法 | 核心思想 | 面试讲法 |
|---|---|---|
| GPTQ | 使用近似二阶信息做 one-shot 权重量化 | 强调低 bit weight-only 和误差补偿 |
| AWQ | 根据激活分布识别重要权重通道并保护 | 强调 salient weights 和硬件友好部署 |
| SmoothQuant | 将 activation outlier 的量化难点迁移到 weight | 强调 W8A8 和等价缩放 |
| FP8 | 使用低精度浮点格式 | 依赖硬件支持，常用于训练/推理加速 |
| KV Cache Quant | 降低 KV Cache 存储精度 | 长上下文和高并发显存优化 |

### GPTQ 怎么讲？

GPTQ 主要针对 LLM weight-only 低 bit 量化，利用近似二阶信息衡量权重量化误差，并在量化过程中做误差补偿。重点不是“简单 round 到 int4”，而是尽量减少量化对输出的影响。

### AWQ 怎么讲？

AWQ 观察到并不是所有权重同等重要，会根据激活分布识别对输出更敏感的 salient weight/channel，对这些重要部分进行保护或缩放，从而在低 bit 下保持精度。

### SmoothQuant 怎么讲？

SmoothQuant 处理的是 activation outlier 导致 W8A8 难的问题。它通过数学等价的缩放，把 activation 的量化难度迁移到 weight，使 activation 更平滑，从而更容易做 INT8 activation quantization。

### 面试追问：这些方法能直接用于所有模型吗？

不能。它们主要针对 Transformer/LLM 场景，效果依赖模型结构、bit 数、校准数据、硬件 kernel、任务指标和 serving 框架支持。

## 13. 量化是否一定加速？

不一定。

### 不加速的原因

| 原因 | 解释 |
|---|---|
| 没有低精度 kernel | 量化图最后仍用 FP32/FP16 执行 |
| Q/DQ 开销 | 量化/反量化节点没融合 |
| CPU fallback | 某些量化 op 不支持设备执行 |
| 数据搬运 | host-device 或 layout transform 抵消收益 |
| batch 太小 | 硬件利用率不足 |
| memory-bound | 算力不是瓶颈，访存/调度才是瓶颈 |
| 精度回退太多 | 大量层保留高精度，收益有限 |

### 正确 benchmark

要同时测：

- latency；
- throughput；
- p95/p99；
- 显存/内存；
- 模型大小；
- accuracy/任务指标；
- CPU/GPU/NPU utilization；
- fallback 比例。

## 14. 面试高频问答

### Q：量化为什么会掉精度？

因为连续浮点值映射到有限离散整数，会有舍入误差；超出范围会被截断；outlier 会拉大量化范围，使正常值分辨率不足；多层网络中误差还可能累积和放大。

### Q：如何定位量化后的异常层？

先确认 FP32 ONNX 与原框架一致，再使用同一输入分别跑 FP32 和量化模型，dump 每层 tensor，计算 cosine、MSE、MAE、max diff、SQNR，找到误差首次明显放大的层，再检查该层量化参数、输入分布、op 类型和 backend kernel。

### Q：calibration 数据怎么选？

选代表真实业务输入分布的数据，覆盖常见场景和边界场景，前处理必须和部署一致。数量不是越多越好，代表性更重要。

### Q：per-channel 为什么通常比 per-tensor 精度好？

因为不同 channel 分布可能差异很大。per-tensor 共用一个 scale，容易被最大范围 channel 控制；per-channel 每个输出通道单独 scale，能降低其他通道的量化误差。

### Q：GPTQ、AWQ、SmoothQuant 区别？

GPTQ 强调基于近似二阶信息的 weight-only 误差补偿；AWQ 根据激活识别重要权重通道并保护；SmoothQuant 通过等价缩放把 activation outlier 的难点迁移到 weight，以支持 W8A8。

## 15. 项目讲法模板

> 我们做量化精度分析时，不只是比较最终输出，而是结合权重分布、激活分布和逐层中间结果。定位时先跑 FP32 参考模型，再跑量化或目标平台模型，逐层计算 cosine、MSE、max diff 等指标，找到误差首次明显放大的节点，再结合该节点的算子类型、输入分布、scale 和平台实现判断原因。恢复策略上会先检查 calibration 和前后处理，再考虑敏感层回退、per-channel、混合精度或 QAT。

## 16. 资料入口

- ONNX Runtime Quantization：https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html
- torchao Quantization：https://docs.pytorch.org/ao/stable/index.html
- TensorRT Quantization：https://docs.nvidia.com/deeplearning/tensorrt/latest/index.html
- GPTQ：https://arxiv.org/abs/2210.17323
- AWQ：https://arxiv.org/abs/2306.00978
- SmoothQuant：https://arxiv.org/abs/2211.10438
- vLLM Quantization：https://docs.vllm.ai/en/latest/features/quantization/
