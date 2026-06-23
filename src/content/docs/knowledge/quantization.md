---
title: 量化与精度分析
description: 量化基础、PTQ/QAT、异常层定位和精度恢复策略。
---

# 量化与精度分析

更新时间：2026-06-23

## 学习目标

量化不是“把 float32 变成 int8”这么简单。工程上真正重要的是：

1. 哪些张量被量化：权重、激活、KV Cache、optimizer state；
2. 用什么格式量化：INT8、INT4、FP8、FP4、weight-only、QDQ、QOperator；
3. 量化参数如何得到：动态计算、静态 calibration、训练中模拟；
4. 精度掉在哪里：某层权重、某层激活、某个 outlier、某个 backend kernel；
5. 性能是否真的变好：低精度只有在硬件和 runtime 有对应 kernel 时才可能带来收益。

## 必须掌握

- 对称 / 非对称量化。
- per-tensor / per-channel / per-group / block-wise。
- 权重分布、激活分布和中间层数据对齐。
- PTQ、QAT、weight-only quantization 的区别。
- 量化后精度下降的异常层和异常算子定位。
- GPTQ、AWQ、SmoothQuant 的基本区别。

## 基础公式

线性量化把浮点数映射到整数空间。常见写法：

```text
q = round(x / scale) + zero_point
x_hat = (q - zero_point) * scale
```

其中：

- `x`：原始浮点值；
- `q`：量化后的整数值；
- `scale`：浮点空间和整数空间之间的比例；
- `zero_point`：浮点 0 在整数空间中的映射位置；
- `x_hat`：反量化后的近似浮点值。

量化误差来自两部分：

1. **舍入误差**：连续值被映射到有限离散格点；
2. **截断/饱和误差**：超出量化范围的值被 clip。

## 对称与非对称量化

| 类型 | 形式 | 优点 | 风险 |
|---|---|---|---|
| 对称量化 | `zero_point = 0` 或接近 0 | 硬件实现简单，矩阵乘更友好 | 对分布偏移明显的数据利用率低 |
| 非对称量化 | `zero_point` 可变 | 能覆盖非零中心分布 | kernel 实现和校正项更复杂 |

经验：权重常用对称量化，激活更可能需要非对称量化，因为激活分布受输入数据影响更大。

## Granularity：per-tensor / per-channel / per-group

| 粒度 | 含义 | 适用场景 | 代价 |
|---|---|---|---|
| per-tensor | 整个张量共享一组 scale/zero_point | 简单、速度友好 | 某个 outlier 会拉大量化范围 |
| per-channel | 每个输出通道一组参数 | Conv / Linear 权重量化常用 | 参数更多，kernel 复杂度增加 |
| per-group | 按 group/block 一组参数 | LLM INT4/weight-only 常见 | 需要选择 group size，影响速度和精度 |
| per-token | 每个 token 动态范围 | LLM activation/KV 相关场景 | runtime 代价高 |

一个常见结论：**粒度越细，精度通常越好，但 kernel 和元数据管理越复杂**。

## PTQ、QAT、Dynamic Quantization

| 方法 | 什么时候量化 | 是否需要训练 | 优点 | 风险 |
|---|---|---|---|---|
| Dynamic Quantization | 推理时动态计算激活量化参数 | 不需要 | 使用简单，激活范围更贴近当前输入 | 推理时额外计算 scale/zero_point |
| Static PTQ | 离线 calibration 后固定参数 | 不需要 | CNN/端侧部署常用，推理路径稳定 | calibration 数据不代表真实分布会掉精度 |
| QAT | 训练中模拟量化误差 | 需要 | 精度恢复能力最强 | 成本高，流程复杂，需要训练数据 |
| Weight-only | 主要量化权重，激活仍高精度或动态处理 | 通常不需要完整训练 | LLM 场景常见，显著省显存/带宽 | 依赖特定 matmul kernel |

面试时要能说清楚：Dynamic 和 Static 的核心差异是激活的 scale/zero_point 在推理时算，还是用 calibration 预先固定；QAT 则是在训练或微调阶段让模型适应量化噪声。

## QDQ 与 QOperator

ONNX 量化模型常见两种表示：

| 格式 | 表达方式 | 适合理解 |
|---|---|---|
| QDQ | 在原始 op 周围插入 `QuantizeLinear` / `DequantizeLinear` | 模拟量化边界，便于调试和 backend 识别 |
| QOperator | 直接使用量化算子，例如 `QLinearConv` | 算子级量化表达，依赖 runtime 支持 |

工程上如果要做精度分析，QDQ 往往更容易观察“哪个张量被量化、量化边界在哪里”。但最终性能仍取决于 runtime 是否能把 QDQ pattern lower 到真正的低精度 kernel。

## Calibration 数据如何选

calibration 的目标是估计激活范围，不是训练模型。数据选择原则：

- 覆盖真实输入分布，而不是只拿几张干净样例；
- 覆盖边界场景，例如暗光、模糊、长文本、极端尺寸；
- 保持和部署时一致的预处理；
- 样本量不一定越大越好，但要覆盖分布；
- 记录 calibration 配置，便于复现实验。

常见 calibration 方法：

| 方法 | 思路 | 适用情况 |
|---|---|---|
| MinMax | 记录最大最小值 | 简单，但容易受 outlier 影响 |
| Percentile | 丢弃极端分位的 outlier | 激活有少量异常值时常用 |
| Entropy / KL | 选择让分布损失较小的阈值 | 分类视觉模型中常见 |
| MSE | 选择重构误差较小的范围 | 需要额外搜索，成本较高 |

## 精度分析流程

量化掉点时不要先猜原因，按流程定位：

```text
FP32 基线模型
  -> 量化模型
  -> 相同输入、相同预处理、相同后处理
  -> 对齐最终输出
  -> dump 中间层
  -> 匹配 FP32 / INT8 对应张量
  -> 计算每层误差
  -> 找到首次误差明显放大的节点
  -> 回退、换粒度、换 calibration、改图或换 kernel
```

建议每次实验记录：

| 字段 | 示例 |
|---|---|
| 模型版本 | `resnet50_v1.onnx` |
| 量化方式 | static PTQ / QDQ / S8S8 |
| calibration 数据 | 500 张真实业务样本 |
| provider/backend | CPUExecutionProvider / TensorRT EP / RKNN |
| 指标 | accuracy、cosine、mAP、latency、memory |
| fallback 层 | 哪些层保留 FP16/FP32 |
| 结论 | 是否可上线、问题在哪 |

## 逐层误差定位指标

| 指标 | 说明 | 适合场景 |
|---|---|---|
| max abs diff | 最大绝对误差 | 找极端 outlier |
| mean abs diff | 平均绝对误差 | 看整体偏移 |
| MSE | 平方误差 | 对大误差更敏感 |
| cosine similarity | 方向相似度 | embedding、feature map 对齐 |
| SQNR | 信号量化噪声比 | 量化噪声分析 |
| TopK 一致率 | 分类排序是否一致 | 分类模型 |

定位时关注“首次明显放大”的层，而不是最后输出误差最大的层。最后一层大偏差可能只是前面某层误差传播后的结果。

## 常见掉精度原因

| 原因 | 表现 | 处理策略 |
|---|---|---|
| activation outlier | 某层 scale 被极端值拉大，大多数值分辨率不足 | percentile、SmoothQuant、保留该层高精度 |
| calibration 不代表真实数据 | 离线精度好，线上掉点 | 重采样 calibration，按场景分 bucket |
| per-tensor 粒度太粗 | 某些 channel 误差特别大 | 改 per-channel 或 per-group |
| 敏感层被量化 | 首层、末层、归一化层、检测 head 掉点明显 | mixed precision，局部回退 FP16/FP32 |
| QDQ pattern 未被 backend 融合 | 精度还行但速度不升反降 | 查看 profiling，确认是否走低精度 kernel |
| 图优化和量化耦合 | 量化前后节点对不上，难调试 | 先单独图优化，再量化，再调试 |
| 前后处理不一致 | 输出整体错，非单层量化问题 | 先用 FP32 ONNX 对齐原框架 |

## GPTQ / AWQ / SmoothQuant 对比

| 方法 | 核心思想 | 主要对象 | 适合回答 |
|---|---|---|---|
| GPTQ | 使用近似二阶信息做 one-shot 权重量化，降低量化误差 | LLM 权重 | 强调低 bit weight-only、误差补偿、离线量化 |
| AWQ | 根据激活分布识别重要权重通道，保护少量 salient weights | LLM 权重 | 强调激活感知、硬件友好、端侧部署 |
| SmoothQuant | 把 activation outlier 的量化难点迁移到 weight，实现 W8A8 | 权重 + 激活 | 强调 activation 更难量化，以及等价缩放变换 |

不要把这些方法说成“通用万能压缩”。它们的收益依赖模型结构、目标硬件、kernel 支持和任务容忍度。

## LLM 量化补充

LLM 场景和 CNN 不完全一样：

- 权重巨大，weight-only INT4/INT8 可以显著降低显存和带宽压力；
- decode 阶段常受访存和 KV Cache 影响，量化不一定只看 GEMM；
- KV Cache 量化能降低长上下文和高并发显存压力，但可能影响生成质量；
- FP8/FP4 需要硬件、框架和 kernel 同时支持；
- 量化后的 benchmark 应同时看 TTFT、TPOT、throughput、显存和质量指标。

## 面试高频问法

### Q1：量化为什么会掉精度？

因为连续浮点值被映射到有限离散值，会产生舍入误差；如果真实值超出量化范围，还会产生 clipping/saturation。激活 outlier 会拉大量化范围，使大多数正常值可用分辨率变差。

### Q2：如何定位量化后的异常层？

先保证 FP32 ONNX 和原框架一致，再对 FP32 与量化模型使用同一输入 dump 中间激活，按节点匹配并计算 max diff、MSE、cosine 等指标，找到首次误差明显放大的层，然后检查该层的量化参数、输入分布、kernel 实现和图优化变化。

### Q3：为什么 calibration 数据很重要？

Static PTQ 的激活 scale/zero_point 由 calibration 数据离线估计。如果 calibration 数据不能覆盖真实输入分布，部署时激活范围就可能不匹配，导致 clipping 或分辨率不足。

### Q4：量化一定会加速吗？

不一定。只有 runtime 能把量化图 lower 到目标硬件支持的低精度 kernel，并且额外的 Q/DQ、layout transform、CPU fallback、动态 scale 计算不会抵消收益时，才会端到端加速。

### Q5：精度掉了怎么恢复？

按成本从低到高：换 calibration 数据、改 calibration 方法、per-channel/per-group、排除敏感层、保留首尾层高精度、图优化调整、SmoothQuant/AWQ/GPTQ、QAT 或重新训练。

## 实践任务

### 任务 1：画分布

对一层权重和一层激活画 histogram，观察是否有 outlier。记录：

- min/max；
- mean/std；
- 99%、99.9% 分位数；
- 对称量化和非对称量化下的 scale。

### 任务 2：逐层误差表

构造一个 CSV：

| node_name | op_type | max_abs_diff | mean_abs_diff | mse | cosine | suspicious |
|---|---|---|---|---|---|
| conv1 | Conv | 0.02 | 0.001 | 1e-5 | 0.999 | no |
| conv3 | Conv | 1.8 | 0.2 | 0.09 | 0.91 | yes |

只要能输出这样的表，精度分析就从“感觉模型掉点”变成了可定位工程问题。

## 资料入口

- ONNX Runtime Quantization：https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html
- torchao Documentation：https://docs.pytorch.org/ao/stable/index.html
- NVIDIA TensorRT Quantization：https://docs.nvidia.com/deeplearning/tensorrt/latest/index.html
- GPTQ：https://arxiv.org/abs/2210.17323
- AWQ：https://arxiv.org/abs/2306.00978
- SmoothQuant：https://arxiv.org/abs/2211.10438
- vLLM Quantization：https://docs.vllm.ai/en/latest/features/quantization/
