---
title: 高级工程师视角：NPU 与端侧 AI 加速器
description: 基于 Android NNAPI、LiteRT Delegates、LiteRT Micro、RKNN Toolkit2、ONNX Runtime EP 等官方资料整理的 NPU/端侧部署知识体系。
---

# 高级工程师视角：NPU 与端侧 AI 加速器

更新时间：2026-06-23

## 0. 为什么需要单独深入 NPU

NPU 经常被简化成一句话：

```text
把模型转成 NPU 格式，在板子上跑起来。
```

这远远不够。高级工程师需要能回答：

```text
NPU 和 CPU/GPU 的差异是什么？
为什么 NPU 不是所有模型都快？
为什么 NPU 部署经常要求静态 shape？
为什么 INT8/量化如此重要？
为什么算子支持表决定能不能落地？
为什么 fallback 会抵消加速收益？
为什么同一个模型在 PC runtime、板端 runtime、NPU runtime 结果不同？
为什么 profiling 要看 DDR、DMA、layout transform、CPU preprocess、NPU kernel？
为什么 converter 成功不代表端到端部署成功？
为什么模型本体快但应用整体慢？
```

NPU 部署的本质是：

```text
模型图合法化
  -> 量化和 layout 固化
  -> NPU compiler 生成可执行子图
  -> runtime 调度 NPU/CPU/DSP/GPU
  -> 驱动和硬件执行
  -> profiling 和数值校验
```

## 1. 官方资料锚点

| 资料 | 关键结论 | 工程含义 |
|---|---|---|
| Android NNAPI | NNAPI 是 Android C API，用于在设备上运行计算密集型 ML 操作；它给上层框架提供基础层，可把计算分配到神经网络硬件、GPU、DSP；Android 15 起 NNAPI deprecated，性能关键工作负载建议迁移到替代方案 | 移动端 NPU 生态碎片化，硬件加速常通过上层框架/Delegate/EP 间接使用；不能把 NNAPI 当未来唯一标准路径 |
| LiteRT Delegates | Delegate 通过设备上的 GPU/DSP 等加速器加速 LiteRT 模型；默认 CPU kernel 优化但 CPU 不是专用 ML 算术硬件；Delegate 可能使用不同精度，存在 accuracy/correctness tradeoff | 硬件加速必须同时验证 latency、power 和 accuracy，不是换 delegate 就结束 |
| LiteRT Micro | 面向只有几 KB 内存的微控制器；核心 runtime 可在 16KB 内适配，限制包括有限 op、低层 C++ API、无动态内存分配等 | MCU/NPU 部署关注内存、静态分配、算子子集和模型裁剪 |
| RKNN Toolkit2 | Rockchip NPU 部署链路是 PC 上用 RKNN-Toolkit2 转换训练模型为 RKNN 格式，再在板端用 RKNN C/Python API 推理；包含 Toolkit2、Lite2、Runtime、kernel driver | 典型 NPU 不是直接跑 ONNX，而是转成厂商模型格式并通过 runtime/driver 执行 |
| ONNX Runtime EP | ORT 通过 EP 框架对接 CPU/GPU/FPGA/专用 NPU，provider 优先级决定节点由哪个硬件执行；不支持节点会落到后续 provider | NPU 部署核心风险之一是 graph partition 与 CPU fallback |
| TensorRT Dynamic Shapes | 动态 shape 需要 runtime dimensions 和 optimization profile | NPU/GPU 编译器都需要在灵活性和编译期优化之间取舍 |

## 2. NPU 到底是什么

NPU 是面向神经网络计算优化的专用加速器。它通常更擅长：

- Conv；
- MatMul/Gemm；
- Depthwise Conv；
- Pooling；
- Elementwise；
- Quantized INT8/INT16；
- 固定 shape tensor pipeline；
- 高吞吐、低功耗的流式计算。

它通常不擅长：

- 任意 Python 控制流；
- 动态 shape 大量变化；
- 不规则 memory access；
- 稀疏且无硬件支持的结构；
- 大量小 op 的频繁调度；
- 后处理复杂逻辑，如 NMS、decode、tokenizer；
- unsupported custom op。

高级回答：NPU 不是“更快的 CPU”，而是对特定 tensor operator pattern、数据布局和量化格式优化的专用数据流硬件。

## 3. NPU 与 CPU/GPU/DSP 的差异

| 硬件 | 优势 | 劣势 | 典型用途 |
|---|---|---|---|
| CPU | 通用、控制流强、调试方便 | ML dense compute 能效低 | 前后处理、fallback、小模型 |
| GPU | 并行浮点强、生态成熟 | 功耗高、启动/拷贝成本 | 大模型、图像模型、高吞吐 |
| DSP | 信号处理能效好 | 编程/工具链较复杂 | 音频、图像 pipeline、部分 ML |
| NPU | INT8/低功耗 dense tensor 高效 | 算子/shape/layout 限制多 | 端侧 CNN、视觉、语音、轻量 Transformer |
| MCU + NPU | 极低功耗、实时 | 内存极小、op 子集小 | TinyML、传感器、唤醒词 |

## 4. 典型 NPU 软件栈

以 RKNN 这类厂商栈为例：

```text
PyTorch / TensorFlow / Caffe / ONNX
  -> PC conversion toolkit
  -> graph optimization
  -> quantization / calibration
  -> model format: RKNN / vendor blob / compiled graph
  -> board runtime: C API / Python API
  -> kernel driver
  -> NPU hardware
```

Android / LiteRT / NNAPI / Delegate 路线：

```text
TFLite / LiteRT model
  -> Delegate / NNAPI / GPU / DSP / vendor backend
  -> graph partition
  -> supported subgraph offload
  -> unsupported ops stay on CPU
```

ONNX Runtime EP 路线：

```text
ONNX graph
  -> ORT session
  -> Execution Provider capability query
  -> partition graph
  -> supported subgraph on NPU EP
  -> unsupported nodes fallback to CPU/GPU EP
```

## 5. NPU 工程链路拆解

NPU 部署可以拆成 7 个阶段：

```text
1. 模型准备
   训练框架导出 ONNX/TFLite/Caffe 等

2. 合法性检查
   op、shape、dtype、layout 是否被目标 toolkit 支持

3. 量化准备
   calibration 数据、预处理一致性、量化粒度确认

4. 转换编译
   toolkit 生成 vendor model / blob / graph

5. 板端集成
   runtime API、输入输出 buffer、内存对齐、线程模型

6. 正确性验证
   FP32 reference vs toolkit simulation vs board runtime

7. 性能验证
   per-layer latency、copy、preprocess、postprocess、power、thermal
```

面试回答应该覆盖这 7 层，而不是停在“转换模型”。

## 6. 为什么 NPU 经常要求模型转换

NPU 硬件一般不是直接理解 PyTorch 或原生 ONNX。它需要编译器把高层图转成硬件可执行形式：

```text
高层 op
  -> pattern fusion
  -> layout assignment
  -> quantization lowering
  -> tiling
  -> memory planning
  -> DMA schedule
  -> kernel selection
  -> binary/blob generation
```

这就是为什么 NPU 部署常有“模型转换工具”：RKNN-Toolkit2、CANN ATC、OpenVINO、QNN、CoreML tools、TensorRT、Vela 等。不同工具链术语不同，但工程本质相似。

## 7. NPU 编译器在优化什么

### 7.1 Op Fusion

把多个小 op 合成一个更适合硬件的子图：

```text
Conv + BN + ReLU -> FusedConv
Conv + Add + Relu -> Fused block
MatMul + Bias + Activation -> Fused GEMM
```

收益：

- 减少中间 tensor 写回；
- 减少 kernel 调度；
- 减少 DDR 带宽；
- 提高流水线利用率。

### 7.2 Layout Planning

NPU 往往偏好特定 layout，例如 NCHW、NHWC、NC1HWC2、blocked layout。

如果图中频繁插入 layout transform：

```text
NCHW -> NHWC -> NCHW -> vendor layout
```

可能大量时间消耗在搬运，而不是计算。

### 7.3 Tiling

NPU on-chip SRAM 有限，不能把所有 feature map 都放片上。编译器需要切块：

```text
大 tensor
  -> tile
  -> DMA load tile
  -> compute
  -> DMA store tile
```

切块策略影响：

- SRAM 利用；
- DDR 访问；
- DMA 与 compute overlap；
- latency；
- power。

### 7.4 Memory Planning

NPU 编译器会复用中间 buffer，减少内存峰值。动态 shape 会让 memory planning 变难，因为 buffer size 编译期不确定。

### 7.5 Scheduling 和 DMA

NPU 的性能不只来自 MAC 阵列，还来自数据是否能按时喂给计算单元。

常见瓶颈：

```text
compute 等数据
DMA 等内存总线
DDR 带宽不足
tile 太小导致调度开销大
tile 太大导致片上内存放不下
```

高级分析应该能区分：

- MAC 利用率低；
- DDR 带宽瓶颈；
- DMA/compute overlap 不好；
- layout transform 过多；
- CPU fallback 引起同步。

## 8. NPU 为什么偏好 INT8 / 静态 shape

### 8.1 INT8 的价值

INT8 带来：

- 权重更小；
- 激活更小；
- 带宽更低；
- SRAM 能放更多 tile；
- INT8 MAC 单元面积/功耗更低；
- 吞吐更高。

很多端侧 NPU 的高性能路径默认围绕 INT8/量化模型设计。FP16/FP32 即使支持，也可能慢得多或走 fallback。

### 8.2 静态 shape 的价值

静态 shape 让编译器提前确定：

- tensor size；
- buffer plan；
- tiling；
- fusion；
- kernel selection；
- DMA schedule；
- workspace；
- binary layout。

动态 shape 则需要 runtime 决策或多 profile，复杂度高。许多端侧 NPU 干脆只支持有限动态或完全静态。

### 8.3 动态 shape 的替代方案

| 场景 | 替代方案 |
|---|---|
| 多输入分辨率 | 固定几个常用尺寸，多模型/多 profile |
| 可变 batch | 端侧通常 batch=1，批处理放服务器 |
| 可变序列长度 | padding 到固定长度或分桶 |
| 动态 Resize | 前处理外置，模型输入固定 |
| 动态 NMS | 后处理 CPU 实现或使用平台支持的 plugin |

## 9. 算子支持表：NPU 落地的硬约束

高级工程师必须先看 operator support，而不是先写业务代码。

检查维度：

| 维度 | 示例 |
|---|---|
| op type | Conv、Resize、Gather、TopK、NMS 是否支持 |
| dtype | FP16、INT8、INT16、BOOL、INT64 是否支持 |
| layout | NCHW/NHWC/vendor layout |
| shape | static/dynamic，rank 限制 |
| attribute | Resize mode、Pad mode、Conv dilation/group |
| quantization | per-tensor/per-channel/asymmetric/symmetric |
| batch | batch=1 是否优化，batch>1 是否支持 |
| fusion pattern | Conv+BN+Relu 是否可融合 |

常见危险 op：

- Resize；
- Pad；
- Slice；
- Gather；
- TopK；
- NonMaxSuppression；
- DeformConv；
- dynamic Reshape；
- LSTM/GRU；
- LayerNorm；
- attention mask 相关 op；
- tokenizer/beam search；
- custom op。

### 9.1 Unsupported op 决策树

```text
unsupported op 出现在前处理/后处理？
  -> 尽量移出模型，在 CPU/ISP/GPU 中做

unsupported op 出现在主干热路径？
  -> 优先考虑改模型结构或等价改写

unsupported op 频率低、tensor 小？
  -> 可以评估 CPU fallback

unsupported op 是平台可扩展 op？
  -> 评估 custom op/plugin 开发成本

unsupported op 很多？
  -> 换模型结构或换平台更现实
```

## 10. Fallback：最容易被忽视的性能杀手

### 10.1 什么是 fallback

当 NPU 不支持某个 op 或子图时，runtime 可能让该部分跑在 CPU/GPU 上。

```text
NPU subgraph 1
  -> CPU unsupported op
  -> NPU subgraph 2
```

这会带来：

- NPU/CPU 数据来回拷贝；
- cache flush；
- layout transform；
- 同步等待；
- p99 抖动；
- NPU 利用率低。

### 10.2 为什么一个 unsupported op 会毁掉端到端性能

即使 95% FLOPs 在 NPU 上，如果中间插一个 CPU op：

```text
NPU output -> copy to CPU -> CPU op -> copy back to NPU
```

端到端 latency 可能由拷贝和同步主导。

### 10.3 排查 fallback

- 查看 converter log；
- 查看 subgraph partition；
- 查看 runtime profiling；
- 统计每层执行 backend；
- 对比 NPU-only supported subgraph 和 full model；
- 临时移除后处理；
- 观察 CPU 使用率和 NPU utilization。

### 10.4 Fallback 报告模板

```text
Model: xxx
Toolkit/runtime version:
Device/driver version:

Subgraph partition:
- NPU subgraphs: N
- CPU fallback nodes: list
- fallback tensor shapes:
- copy count:
- copy time:
- CPU op time:

Decision:
- accept fallback / rewrite op / custom op / change model / change platform
```

## 11. 前处理和后处理：NPU 部署经常慢在模型外

模型本体很快，不代表应用快。

常见外部耗时：

| 阶段 | 问题 |
|---|---|
| image decode | JPEG/PNG 解码在 CPU 上 |
| resize/crop | OpenCV CPU resize 慢 |
| color convert | BGR/RGB/NV12 转换 |
| normalization | CPU float 转换 |
| layout transform | HWC -> CHW |
| postprocess | NMS、decode、argmax、topk |
| memory copy | host/device buffer 拷贝 |

高级优化思路：

- camera pipeline 直接输出模型需要的 format；
- 前处理使用硬件 ISP/RGA/GPU；
- 尽量避免多次 layout transform；
- NMS 如果 NPU 不支持，评估 CPU 后处理成本；
- 使用 zero-copy 或 buffer reuse；
- 固定输入尺寸减少 runtime 分支。

## 12. 量化和校准：NPU 精度问题的核心

### 12.1 Calibration 数据

NPU INT8 部署通常需要 calibration。数据要代表真实输入分布。

错误做法：

```text
随便拿 10 张 demo 图片校准
```

正确思路：

- 覆盖真实场景；
- 覆盖边界光照、尺寸、目标数量；
- 前处理和部署完全一致；
- 记录 calibration 配置；
- 校准集和验证集分离；
- 比较 FP32/INT8/NPU 输出。

### 12.2 per-tensor / per-channel 支持

某些 NPU 对 per-channel weight quant 支持好，对 activation per-channel 不支持；有些只支持对称量化或特定 zero_point。必须对照平台文档和 converter log。

### 12.3 混合精度

如果某层掉点严重，可以：

- 保留 FP16；
- 回退 CPU；
- 改用更高 bit；
- 更换 calibration；
- 图改写；
- QAT。

但要注意：混合精度可能导致额外转换和性能下降。

### 12.4 NPU 量化掉点定位

```text
1. 原框架 FP32 vs ONNX FP32
2. ONNX FP32 vs toolkit simulation FP32
3. toolkit FP32 vs toolkit INT8
4. toolkit INT8 vs board runtime INT8
5. board output vs task metric
```

这样能把问题拆成：

- 转换错误；
- 量化错误；
- runtime/kernel 错误；
- 前后处理错误；
- 板端集成错误。

## 13. NPU 数值对齐

### 13.1 三层对齐

```text
原框架 FP32
  -> 中间格式 FP32/ONNX/TFLite
  -> 量化模型 INT8
  -> NPU runtime output
```

不要直接比较 PyTorch 和 NPU。中间必须拆：

1. 转换是否正确；
2. 量化是否正确；
3. NPU kernel 是否正确；
4. 前后处理是否一致。

### 13.2 逐层 dump

如果平台支持 dump 每层输出：

```text
CPU reference layer output
NPU layer output
  -> shape compare
  -> dtype compare
  -> cosine/MSE/max diff
  -> 找首次 divergence
```

如果平台不支持完整 dump：

- 分段导出子图；
- 用 fake quant 模拟；
- 对关键层插输出；
- 在 PC toolkit 上做模拟推理；
- 对比 converter intermediate。

### 13.3 对齐指标阈值不是固定的

不同模型和任务容忍度不同：

| 任务 | 更关注 |
|---|---|
| 分类 | top-k 一致率、logits 排序 |
| 检测 | bbox decode、score、NMS 后 mAP |
| 分割 | mask IoU、边界质量 |
| embedding | cosine、recall@k |
| 语音 | WER/CER、时序对齐 |
| 生成模型 | 质量指标、分布漂移、长序列稳定性 |

## 14. Profiling：不要只看总耗时

高级 profiling 至少拆：

| 指标 | 含义 |
|---|---|
| total latency | 端到端耗时 |
| NPU kernel time | NPU 计算时间 |
| CPU preprocess | 前处理时间 |
| CPU postprocess | 后处理时间 |
| copy time | host/device 或 buffer copy |
| layout transform | 数据格式转换时间 |
| DDR bandwidth | 访存瓶颈 |
| NPU utilization | NPU 是否吃满 |
| per-layer latency | 哪层慢 |
| fallback op time | CPU fallback 成本 |
| power/thermal | 端侧长期运行稳定性 |

### 14.1 常见现象解释

| 现象 | 可能原因 |
|---|---|
| NPU 时间很短，总耗时很长 | 前后处理或拷贝占主导 |
| 单层特别慢 | unsupported pattern、layout transform、大 feature map |
| INT8 不快 | 没走 INT8 kernel、Q/DQ 开销、fallback |
| p99 抖动 | 内存分配、温控降频、系统调度、fallback |
| 板端比 PC 模拟慢很多 | 真实带宽/驱动/热限制/CPU 后处理 |
| 精度 PC 模拟对，板端不对 | runtime/driver/kernel 版本差异或输入 buffer 问题 |

### 14.2 端侧 benchmark 设计

```text
warmup: 20-100 次
measurement: 1000 次或固定时间窗口
记录 p50/p90/p95/p99
拆 preprocess/inference/postprocess
记录 CPU/NPU utilization
记录温度和频率
固定电源模式和 governor
固定输入数据集
记录 toolkit/runtime/driver version
```

没有这些约束的 benchmark 很难比较。

## 15. 常见平台路线对比

| 路线 | 典型工具 | 特点 |
|---|---|---|
| Android NNAPI | NNAPI + TFLite/LiteRT | 已 deprecated，生态仍有历史项目，未来需关注替代方案 |
| LiteRT Delegate | GPU/DSP/其他 delegate | 更偏移动端框架集成，关注 delegate 支持和精度差异 |
| LiteRT Micro | C++ runtime on MCU | 无 OS、低内存、有限 op，适合 TinyML |
| RKNN | RKNN-Toolkit2 + RKNN Runtime | PC 转 RKNN，板端 runtime/C API，典型国产 NPU 部署链 |
| ONNX Runtime EP | ORT + vendor EP | 统一 ORT API，实际由 EP 决定支持和 fallback |
| TensorRT / DLA | TensorRT engine | NVIDIA 生态，dynamic shape/profile、engine build、plugin |
| CANN / Ascend | ATC/ACL/CANN | 华为 Ascend 生态，模型转换和算子适配复杂 |
| OpenVINO | IR / OpenVINO runtime | Intel CPU/GPU/NPU/VPU 生态 |

## 16. NPU 项目中的常见坑

### 16.1 转换阶段

- 模型有 unsupported op；
- opset 太新或太旧；
- dynamic shape 不支持；
- weight dtype 不支持；
- batch 维度不固定；
- postprocess 被错误放进图；
- converter 版本和 runtime 版本不匹配。

### 16.2 量化阶段

- calibration 数据不代表真实分布；
- 输入预处理和校准预处理不一致；
- per-channel 不支持导致掉点；
- activation outlier；
- 首尾层敏感；
- softmax/resize/nms 量化误差放大。

### 16.3 板端运行阶段

- runtime so 版本不匹配；
- driver 版本不匹配；
- 输入 buffer 对齐要求没满足；
- cache flush/同步问题；
- 多线程调用不安全；
- 内存不足；
- 温控降频；
- NPU 被其他进程占用。

## 17. 项目排查 Runbook

### 17.1 模型转不成功

```text
1. 看 converter log 第一处 error
2. 确认输入模型 opset / framework version
3. 统计 unsupported op
4. 固定 shape 后再试
5. 移除后处理子图
6. 将复杂 op 改成等价基础 op
7. 检查 dtype，例如 int64 index
8. 降低 opset 或换 export 方式
9. 用最小子图复现并提交给 FAE/vendor
```

### 17.2 板端输出不一致

```text
1. 确认输入 byte 完全一致
2. 确认 RGB/BGR、layout、mean/std
3. 对比 PC toolkit simulation
4. 对比 board runtime output
5. 逐层 dump 或分段子图
6. 检查量化参数
7. 检查 runtime/driver/toolkit 版本
8. 检查 buffer 对齐和 cache 同步
```

### 17.3 性能不达标

```text
1. 拆 preprocess / inference / postprocess
2. 看 per-layer latency
3. 看 fallback node
4. 看 layout transform 和 copy time
5. 看 CPU/NPU utilization
6. 固定频率和温度条件复测
7. 尝试固定 shape / INT8 / fusion
8. 改模型结构或后处理策略
```

## 18. 面试高级追问

1. 为什么 NPU 不是所有模型都快？
2. NPU 为什么偏好静态 shape？
3. NPU 为什么常和 INT8 绑定？
4. 算子支持表应该看哪些维度？
5. fallback 为什么可能抵消全部加速收益？
6. 如何判断慢在 NPU 计算还是前后处理？
7. 为什么 PC 模拟推理和板端结果可能不同？
8. 如何做 NPU 逐层精度对齐？
9. NPU 编译器的 tiling / memory planning 在解决什么？
10. 为什么 layout transform 会成为瓶颈？
11. 如果 NMS 不支持 NPU，应该怎么处理？
12. 如果某个 op 不支持，是改模型、CPU fallback、写 custom op 还是换平台？
13. 如何构造 calibration 数据集？
14. 如何设计端侧长期运行 benchmark？
15. 如何解释“单层 NPU 很快但端到端不快”？
16. 为什么 converter 成功不代表 runtime 一定正确？
17. 为什么版本矩阵很重要？
18. 如何设计可复现的 NPU benchmark？

## 19. 工程实践任务

1. 选一个 MobileNet/YOLO 小模型，先在 PyTorch/ONNX 上跑通。
2. 做 FP32 ONNX 与原框架输出对齐。
3. 用目标 NPU toolkit 转换，记录 converter log 和 unsupported op。
4. 准备 100-500 条代表性 calibration 数据。
5. 生成 INT8 模型，比较 FP32/INT8/NPU 输出。
6. 如果支持逐层 dump，定位首次误差放大层。
7. 查看每层 latency，找慢 op 和 fallback。
8. 把前处理、推理、后处理拆开计时。
9. 尝试把 resize/color convert 移出或移入硬件 pipeline。
10. 对比 batch=1、不同输入分辨率、不同线程策略。
11. 运行 30 分钟稳定性测试，记录温度、p95/p99、内存。
12. 写部署报告：支持 op、精度、性能、瓶颈、风险、fallback、下一步。
13. 构建版本矩阵：toolkit、runtime、driver、固件、模型 hash、校准集 hash。
14. 构造 unsupported op 最小复现子图。

## 20. 一句话总答

> NPU 部署不是把模型丢给硬件，而是一个从图合法化、算子支持、静态 shape、量化校准、layout planning、tiling、memory planning、runtime 调度到 profiling 的完整工程链路。NPU 对特定 tensor pattern 和 INT8 路径能效很高，但对动态 shape、unsupported op、复杂后处理和频繁 fallback 很敏感。高级工程师要能解释为什么加速、为什么不加速、精度在哪里丢、性能瓶颈在哪，以及如何用工具链日志、逐层 dump、profiling 和端到端 benchmark 证明部署可用。

## 21. 资料入口

- Android NNAPI：https://developer.android.com/ndk/guides/neuralnetworks
- LiteRT Delegates：https://developers.google.com/edge/litert/performance/delegates
- LiteRT Microcontrollers：https://developers.google.com/edge/litert/microcontrollers/overview
- RKNN Toolkit2：https://github.com/airockchip/rknn-toolkit2
- ONNX Runtime Execution Providers：https://onnxruntime.ai/docs/execution-providers/
- TensorRT Dynamic Shapes：https://docs.nvidia.com/deeplearning/tensorrt/latest/inference-library/work-dynamic-shapes.html
