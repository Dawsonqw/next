---
title: 模型部署与量化原理到应用
description: 从计算图、算子语义、shape/layout、runtime、硬件执行到量化精度分析的系统学习路线。
---

# 模型部署与量化原理到应用

更新时间：2026-06-23

## 0. 为什么模型部署不是“转个 ONNX”

很多人对模型部署的理解是：

```text
PyTorch 模型 -> 导出 ONNX -> runtime 跑起来
```

这只覆盖了最浅一层。真实部署要回答：

- 模型图如何表示计算？
- 算子语义在不同框架中是否一致？
- shape 和 layout 为什么会影响正确性和性能？
- runtime 为什么能优化图？
- 硬件为什么偏好某些算子和数据布局？
- 量化为什么会掉精度？
- 如何证明转换和量化后模型仍然正确？
- 输出不一致时如何定位到某一层、某个算子、某个参数？

这篇按“原理 -> 转换 -> 校验 -> 优化 -> 量化 -> 排查 -> 面试”组织。

## 1. 模型本质：计算图 + 张量 + 参数

一个神经网络部署到推理系统时，核心是把训练框架中的计算表达转换成可执行图。

```text
Tensor 数据
  -> Operator 计算
  -> Graph 拓扑连接
  -> Weights / Initializers
  -> Attributes
  -> Runtime 执行计划
```

### 1.1 Tensor

Tensor 是多维数组，部署中最关心：

| 属性 | 为什么重要 |
|---|---|
| dtype | FP32/FP16/INT8 不同精度和性能 |
| shape | 决定内存大小和算子参数 |
| layout | 决定通道和空间维度解释 |
| stride | 决定内存连续性和访问方式 |
| scale/zero_point | 量化 tensor 的数值解释 |

### 1.2 Operator

算子不是只有名字。一个 Conv 的真实语义包括：

```text
input shape
weight shape
padding
stride
dilation
group
bias
layout
dtype
rounding behavior
```

两个框架都叫 Conv，不代表所有默认值完全一致。

### 1.3 Graph

Graph 不是简单的节点列表。它包含：

- 拓扑顺序；
- 输入输出；
- 常量权重；
- 多输出节点；
- 分支和合并；
- shape/type 元信息；
- opset 版本。

## 2. 为什么需要 ONNX / IR

训练框架和部署后端之间直接适配会导致组合爆炸：

```text
PyTorch -> TensorRT
PyTorch -> RKNN
PyTorch -> ONNX Runtime
Caffe -> TensorRT
Caffe -> 自研 NPU
TensorFlow -> TFLite
```

中间表示的价值是统一表达：

```text
训练框架模型
  -> 中间 IR / ONNX / MLIR
  -> 图优化和合法化
  -> 后端 runtime / compiler
```

ONNX 更偏模型交换格式；MLIR 更偏可扩展、多层级 IR 和 compiler infrastructure。

## 3. ONNX 的核心原理

ONNX 用 protobuf 表示模型。

| 对象 | 作用 |
|---|---|
| ModelProto | 整个模型容器 |
| GraphProto | 计算图 |
| NodeProto | 算子节点 |
| TensorProto | 权重或常量 |
| Initializer | 图中的常量 tensor |
| AttributeProto | 算子属性 |
| ValueInfoProto | tensor shape/type 信息 |
| OpsetImport | 算子版本集合 |

### 3.1 为什么 opset 很重要

opset 决定算子语义版本。同一个算子在不同 opset 下可能：

- 属性名不同；
- 默认值不同；
- 输入输出数量不同；
- 对动态 shape 支持不同；
- runtime 支持范围不同。

所以部署时不是“导出成功就可以”，还要确认目标 runtime 支持该 opset。

### 3.2 ONNX checker 能证明什么

`onnx.checker` 能证明模型结构符合 ONNX 规则，但不能证明：

- 源框架和 ONNX 输出一致；
- 前处理一致；
- runtime 执行数值一致；
- 目标硬件支持所有算子；
- 性能满足要求。

它是合法性检查，不是正确性证明。

## 4. 算子语义差异

### 4.1 Conv

Conv 关注：

```text
NCHW / NHWC
weight layout
pads
strides
dilations
group
bias
auto_pad
```

为什么 group 重要？

普通卷积、group convolution、depthwise convolution 对硬件 kernel 要求不同。某些 NPU 对普通 Conv 很快，但对特殊 group 设置可能 fallback 或性能差。

### 4.2 BatchNorm

训练态 BN 和推理态 BN 不一样。

推理态使用固定：

```text
mean
variance
gamma
beta
epsilon
```

Conv+BN 融合可以减少算子和中间 tensor 读写：

```text
W' = W * gamma / sqrt(var + eps)
b' = (b - mean) * gamma / sqrt(var + eps) + beta
```

为什么融合能加速？

- 少一次 BN kernel；
- 少一次中间 tensor 写回和读取；
- 减少 memory bandwidth；
- 更适合后端生成 fused kernel。

### 4.3 Reshape / Transpose 为什么危险

这些算子 FLOPs 很低，但部署风险高：

- shape 可能由 runtime tensor 决定；
- NPU 不支持动态 reshape；
- transpose 导致 layout transform；
- concat axis 错会直接改变语义；
- flatten 默认 axis 不同可能导致分类头输入错。

### 4.4 Softmax 为什么常出错

Softmax 的 axis 决定在哪个维度归一化。axis 错了，概率分布可能完全错。

分类模型通常对 class 维度 softmax；如果对 batch 或空间维度 softmax，输出就没有业务意义。

## 5. Shape / Layout / Dtype 三座大山

### 5.1 Shape

shape 决定每个 tensor 的大小和算子输出。

动态 shape 难点：

```text
内存不能完全提前规划
kernel 选择不确定
图融合条件不确定
runtime 需要 profile 或 fallback
某些后端要求静态 shape
```

处理方式：

- 先固定 shape 跑通；
- 再引入有限动态范围；
- 对常见尺寸构建多个 engine；
- 统计线上真实 shape 分布；
- 避免无意义动态维度。

### 5.2 Layout

常见图像 layout：

```text
NCHW: batch, channel, height, width
NHWC: batch, height, width, channel
```

layout 错误可能导致：

- 第一层输出就错；
- RGB/BGR 通道混乱；
- 插入大量 transpose；
- NPU/GPU 性能下降。

### 5.3 Dtype

dtype 影响正确性和性能：

| dtype | 特点 |
|---|---|
| FP32 | 精度高，慢，内存大 |
| FP16 | 常用推理加速，精度通常可接受 |
| BF16 | 动态范围大，常见于训练/推理平台 |
| INT8 | 需要量化参数，依赖硬件 kernel |
| INT4 | LLM weight-only 常见，压缩强 |
| FP8 | 新硬件上用于训练/推理加速 |

## 6. Runtime 为什么能优化

Runtime 不只是“解释执行 ONNX”。它会做：

- 常量折叠；
- 死节点删除；
- 算子融合；
- layout 优化；
- memory planning；
- kernel selection；
- provider partition；
- quantized kernel lowering。

### 6.1 图优化为什么可能影响调试

图优化后节点可能被融合、删除或重命名，逐层 dump 对齐会变难。

所以排查时常用：

```text
先关闭部分图优化，确认正确性
再逐步打开优化，确认哪个 pass 引入问题
```

## 7. 转换正确性：怎么证明模型没变

### 7.1 四层验证

| 层级 | 目的 |
|---|---|
| 单算子 | 验证每个 op 映射正确 |
| 子图 | 验证常见组合结构正确 |
| 整模型 | 验证最终任务输出正确 |
| 逐层 dump | 定位不一致来源 |

### 7.2 单算子测试为什么必要

如果你转换了 50 个 Caffe 算子，不可能只靠一个整模型证明所有算子都正确。

单算子测试覆盖：

- 属性边界；
- shape 边界；
- dtype；
- broadcasting；
- axis；
- padding；
- group；
- dynamic shape。

### 7.3 逐层 dump 的思路

```text
源框架模型：dump 每层输出
目标 ONNX/runtime：dump 每层输出
  -> 按拓扑或名称对齐
  -> 比较 shape/dtype
  -> 计算误差指标
  -> 找首次明显变差的层
```

指标：

- max abs diff；
- mean abs diff；
- MSE；
- cosine similarity；
- top-k consistency；
- task metric。

## 8. 量化原理

### 8.1 为什么量化能加速

神经网络推理常受两类资源限制：

```text
计算：矩阵乘/卷积 FLOPs
访存：权重、激活、中间 tensor 读写
```

量化可以：

- 减小模型大小；
- 降低内存带宽；
- 提高 cache 命中；
- 使用低精度硬件指令；
- 提高 batch/并发容量。

但前提是硬件和 runtime 有对应低精度 kernel。

### 8.2 仿射量化公式

```text
q = clamp(round(x / scale) + zero_point, qmin, qmax)
x_hat = (q - zero_point) * scale
```

误差来源：

| 来源 | 解释 |
|---|---|
| round | 连续值映射到离散整数 |
| clamp | 超出范围的值被截断 |
| scale 太大 | 分辨率低 |
| outlier | 拉大量化范围 |
| 累积误差 | 多层误差传播 |

### 8.3 对称和非对称

| 类型 | 特点 | 常见用途 |
|---|---|---|
| 对称 | zero_point 常为 0 | 权重量化、硬件友好 |
| 非对称 | zero_point 可偏移 | 激活量化、非零中心分布 |

非对称不一定更快，因为 zero_point 校正可能增加 kernel 复杂度。

### 8.4 per-tensor / per-channel / per-group

粒度越细，通常精度越好，但元数据和 kernel 复杂度越高。

```text
per-tensor: 一个 tensor 一个 scale
per-channel: 每个输出通道一个 scale
per-group: 每组通道/block 一个 scale
```

LLM INT4 常用 group-wise weight quantization，本质是在压缩率、精度和 kernel 效率之间折中。

## 9. PTQ / QAT / Weight-only

| 方法 | 原理 | 适合场景 |
|---|---|---|
| Dynamic Quantization | 推理时动态算激活范围 | 简单场景，部分 CPU/LLM |
| Static PTQ | calibration 离线估计激活范围 | 端侧/CNN INT8 |
| QAT | 训练中模拟量化误差 | PTQ 掉点严重 |
| Weight-only | 主要量化权重 | LLM 降显存/带宽 |
| KV Cache Quant | 量化 KV Cache | 长上下文/高并发 |

### 9.1 为什么 PTQ 依赖 calibration

Static PTQ 需要提前估计激活范围。如果 calibration 数据不代表真实分布，scale 就会不合适：

```text
scale 太小 -> 大值被 clamp
scale 太大 -> 正常值分辨率低
```

### 9.2 为什么 QAT 更贵但更稳

QAT 在训练过程中模拟量化噪声，让模型参数适应量化误差。它更稳，但需要训练数据、训练成本和训练框架支持。

## 10. 量化精度分析

### 10.1 先确认不是转换问题

量化前必须先确认：

```text
原框架 FP32
  ~= ONNX FP32
  ~= runtime FP32/FP16
```

否则你看到的掉点可能是转换错误，不是量化错误。

### 10.2 逐层定位流程

```text
FP32 reference
  -> Quantized model
  -> same input
  -> dump activations
  -> align layers
  -> compute metrics
  -> find first divergence
  -> inspect distribution and quant params
```

### 10.3 恢复策略

从低成本到高成本：

1. 修正前后处理；
2. 更换 calibration 数据；
3. MinMax 改 Percentile/KL/MSE；
4. per-tensor 改 per-channel；
5. 敏感层回退 FP16/FP32；
6. SmoothQuant/AWQ/GPTQ；
7. QAT；
8. 改模型结构。

## 11. 为什么量化不一定加速

量化只是表示变低精度，不代表实际执行低精度。

不加速原因：

- runtime 没有低精度 kernel；
- Q/DQ 没融合；
- CPU fallback；
- 数据搬运多；
- layout transform 多；
- batch 太小；
- 混合精度回退太多；
- 实际瓶颈是调度或 IO，不是矩阵乘。

正确 benchmark：

```text
latency
throughput
p95/p99
memory
model size
device utilization
fallback ratio
accuracy/task metric
```

## 12. LLM 量化扩展

### 12.1 GPTQ

GPTQ 用近似二阶信息做 weight-only 量化，重点是减少权重量化对输出的影响。它不是简单 round，而是带误差补偿。

### 12.2 AWQ

AWQ 根据激活分布识别重要权重通道或 salient weights，保护对输出更敏感的部分，强调低 bit 下的精度和硬件友好。

### 12.3 SmoothQuant

SmoothQuant 处理 activation outlier。它通过等价缩放把 activation 的量化难点迁移到 weight，让 activation 更容易 INT8 化，从而支持 W8A8。

### 12.4 KV Cache 量化

LLM 长上下文和高并发时，KV Cache 占用巨大。量化 KV Cache 可以降低显存，但会影响 attention 计算的数值质量，需要测生成质量和长上下文稳定性。

## 13. 应用到你的项目

### 13.1 Caffe 到 ONNX / MLIR 转换

要讲清：

- 为什么需要中间 IR；
- 每个 Caffe layer 如何映射；
- 算子属性如何处理；
- shape/layout 如何校验；
- 单算子/子图/整模型如何测试；
- 不支持算子如何改写。

### 13.2 图优化和 300% 加速

不要只说“优化了图”。要说可能来自：

- Conv+BN 融合；
- 消除多余 transpose；
- 减少 layout transform；
- 删除无用节点；
- 子图融合减少 kernel launch；
- 替换平台不友好 op；
- 减少中间 tensor 读写。

### 13.3 量化精度分析

讲法：

```text
先保证 FP32 转换一致
再做量化
量化掉点后逐层 dump
找到首次误差放大层
结合该层分布、scale、zero_point、op 类型、backend kernel 分析
再尝试 calibration、per-channel、敏感层回退或 QAT
```

## 14. 面试扩展问题

### 原理层

- 为什么模型可以表示成计算图？
- ONNX 为什么需要 opset？
- shape inference 能解决什么，不能解决什么？
- 为什么 layout 会影响性能？
- 为什么 Conv+BN 可以融合？

### 工程层

- Caffe 到 ONNX 哪些算子最容易错？
- 输出不一致如何定位？
- 层名对不上怎么逐层 dump？
- runtime 不支持算子怎么办？
- CPU fallback 为什么会拖慢端到端？

### 量化层

- scale 和 zero_point 怎么理解？
- outlier 为什么导致掉点？
- calibration 数据怎么选？
- QDQ 图为什么不一定加速？
- GPTQ/AWQ/SmoothQuant 区别？

### 性能层

- latency 和 throughput 如何权衡？
- batch 为什么影响 GPU/NPU 利用率？
- memory-bound 和 compute-bound 如何判断？
- 如何确认真的走了 NPU/GPU kernel？
- 图优化会不会影响精度？

## 15. 最小实践路线

1. 用 PyTorch 写 TinyCNN，导出 ONNX。
2. 用 Netron 查看 graph、node、initializer。
3. 用 ONNX Runtime 对齐 PyTorch 输出。
4. 手动修改输入 layout，观察第一层输出差异。
5. 做 Conv+BN 融合，对比输出误差。
6. 对模型做 ONNX Runtime static PTQ。
7. 用不同 calibration 数据比较精度。
8. dump FP32 和 INT8 中间层，找误差首次放大层。
9. 把某个敏感层回退 FP16/FP32，观察恢复效果。
10. benchmark FP32/FP16/INT8 的 latency、memory、accuracy。

## 16. 一句话总答

> 模型部署的核心是把训练框架中的计算图、权重、shape、layout 和算子语义，转换成目标 runtime 和硬件能高效执行的形式。ONNX/MLIR 只是中间表达，真正难点在算子语义对齐、动态 shape、layout、runtime 支持、图优化和量化。量化通过降低数值精度减少带宽和计算成本，但会引入舍入、截断、outlier 和累积误差，因此必须用 calibration、逐层 dump、敏感层回退、per-channel、QAT 等方法做精度分析和恢复。部署成功不只是能跑，还要正确、快、稳定、可解释。

## 17. 资料入口

- ONNX Concepts：https://onnx.ai/onnx/intro/concepts.html
- ONNX Operators：https://onnx.ai/onnx/operators/
- ONNX Runtime Quantization：https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html
- PyTorch ONNX Export：https://docs.pytorch.org/docs/stable/onnx.html
- TensorRT Documentation：https://docs.nvidia.com/deeplearning/tensorrt/latest/index.html
- Netron：https://netron.app/
- GPTQ：https://arxiv.org/abs/2210.17323
- AWQ：https://arxiv.org/abs/2306.00978
- SmoothQuant：https://arxiv.org/abs/2211.10438
