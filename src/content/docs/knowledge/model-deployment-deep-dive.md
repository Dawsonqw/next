---
title: 模型部署深度笔记
description: Caffe、ONNX、算子语义、shape/layout、转换校验与部署排查的面试追问树。
---

# 模型部署深度笔记

更新时间：2026-06-23

## 1. 学习目标

这篇笔记用于支撑简历中的“模型格式转换、算子兼容性处理、输入输出对齐、推理结果校验、部署问题排查”。面试时需要证明自己理解完整链路，而不是只会调用转换工具。

面试常见追问链：

```text
你把什么模型转成什么格式？
  -> ONNX 图结构是什么？
  -> opset 为什么重要？
  -> Caffe/PyTorch/ONNX 算子语义哪里不一致？
  -> 转换后输出不一致怎么定位？
  -> shape/layout/dtype 怎么排查？
  -> runtime 不支持算子怎么办？
  -> 动态 shape 和量化如何影响部署？
```

## 2. 模型部署完整链路

```text
训练框架模型
  -> 导出 / 解析模型结构和权重
  -> 转为中间表示，例如 ONNX、MLIR、自定义 IR
  -> shape/type 推断和图合法性检查
  -> 图优化：常量折叠、死节点删除、算子融合、layout 优化
  -> 量化：FP32/FP16/INT8 或混合精度
  -> 平台编译：生成 NPU/GPU/CPU runtime 可执行模型
  -> runtime 集成：输入输出 tensor、内存、线程、设备上下文
  -> 业务校验：前处理、后处理、精度、性能、稳定性
```

真正的部署问题通常出现在边界处：框架之间的算子语义差异、layout 差异、动态 shape、平台算子支持、量化误差和业务前后处理不一致。

## 3. ONNX 图结构追问

### Q1：ONNX 是什么？

ONNX 是模型交换格式，用 protobuf 表达计算图、权重、算子、属性和版本语义。它不是训练框架，也不是某个具体 runtime。

### Q2：ONNX 模型有哪些核心对象？

| 元素 | 含义 | 面试要点 |
|---|---|---|
| ModelProto | 整个模型 | ir_version、opset_import、producer 信息 |
| GraphProto | 计算图 | nodes、inputs、outputs、initializer |
| NodeProto | 算子节点 | op_type、domain、input、output、attribute |
| TensorProto | tensor 数据 | 权重、常量、dtype、shape |
| Initializer | 图中的常量 tensor | 常见是 Conv/MatMul 权重和 bias |
| Attribute | 节点静态属性 | kernel、stride、pads、axis、epsilon 等 |
| ValueInfo | tensor 元信息 | shape、dtype、符号维度 |
| Opset | 算子版本集合 | 同名 op 在不同 opset 下语义可能变化 |

### Q3：initializer 和 input 的关系？

早期 ONNX 模型中权重 initializer 也可能出现在 graph input 中；较新的导出方式通常把真正外部输入和 initializer 区分得更清楚。面试中不用展开历史细节，但要知道：initializer 多数表示权重/常量，不是业务输入图片或文本。

### Q4：opset 为什么重要？

opset 是算子语义版本集合。runtime 支持的 opset 有范围，同一个 op 在不同 opset 下可能有不同属性、默认值或行为。转换模型时不能只看能否导出，还要看目标 runtime 是否支持该 opset。

追问例子：

- Softmax 的 axis 语义；
- Resize 的坐标变换规则；
- Pad 的属性表达变化；
- BatchNormalization 的参数和训练/推理语义。

## 4. Caffe、PyTorch、ONNX 的差异

| 维度 | Caffe | PyTorch | ONNX |
|---|---|---|---|
| 图形态 | prototxt 静态图 | eager 动态图为主，也支持 export | 静态交换图 |
| 权重 | caffemodel | state_dict | initializer |
| 算子 | layer 定义 | Python module/op | op schema |
| shape | 多数较静态 | 动态灵活 | 支持静态和符号 shape |
| 部署风险 | 老模型多，语义历史包袱 | 导出路径复杂 | runtime/opset 兼容性 |

Caffe 到 ONNX 转换中最常见的坑是：同一个 layer 的参数名、默认值、axis、padding、ceil_mode、group、layout 在 ONNX 中不完全对应。

## 5. CNN 算子语义重点

### 5.1 Conv

必须能说清：

```text
input:  N, C_in, H, W
weight: C_out, C_in/group, kH, kW
output: N, C_out, H_out, W_out
```

关键属性：

- strides；
- pads；
- dilations；
- group；
- bias；
- weight layout；
- auto_pad。

追问：depthwise conv 和 group conv 关系？

答：depthwise conv 可以看作 group conv 的特殊情况，通常 group 等于输入通道数，每个通道独立卷积。不同平台对 group/depthwise 支持和性能差异很大。

### 5.2 BatchNorm

训练态和推理态不同。部署时通常使用固定 running mean/variance、gamma、beta。

Conv+BN 融合公式：

```text
W' = W * gamma / sqrt(var + eps)
b' = (b - mean) * gamma / sqrt(var + eps) + beta
```

如果原 Conv 没有 bias，可以把 b 当 0。

追问：什么时候不能随便融合？

- BN 仍处于训练态；
- mean/variance 不是固定推理参数；
- 图中 BN 输出被多个后续节点共享且融合会改变图结构语义；
- 数值精度或 dtype 变化超过容忍范围；
- 量化流程要求保留某些 Q/DQ 边界。

### 5.3 Pooling

关注：

- kernel；
- stride；
- padding；
- ceil_mode；
- count_include_pad；
- global pooling。

AveragePool 在边界 padding 是否计入平均值，不同框架或属性设置会影响结果。

### 5.4 Reshape / Transpose / Concat / Slice

这些算子计算量不一定大，但最容易出部署问题：

| 算子 | 常见问题 |
|---|---|
| Reshape | `0` / `-1` 语义、动态 shape、目标 shape 来自 runtime tensor |
| Transpose | NCHW/NHWC 转换过多导致性能差 |
| Concat | axis 错、输入 shape 不一致 |
| Slice | starts/ends/axes/steps 动态化，NPU 不支持 |
| Flatten | flatten 起始 axis 和默认行为不一致 |
| Softmax | axis 错导致概率完全不对 |

## 6. Shape / Layout / Dtype

### 6.1 Shape

shape 问题分三类：

1. 静态维度错；
2. 符号维度传播失败；
3. runtime 动态 shape 超出后端支持范围。

排查方式：

- Netron 看输入输出；
- ONNX shape inference；
- runtime 打印每层 tensor；
- 对比源框架中间 shape；
- 固定一组输入先跑通，再考虑动态 shape。

### 6.2 Layout

常见 layout：

```text
NCHW: batch, channel, height, width
NHWC: batch, height, width, channel
```

layout 错误通常表现为：

- 输出完全错；
- 第一层 Conv 后就明显不一致；
- 颜色或通道混乱；
- 性能很差，因为插入大量 transpose。

### 6.3 Dtype

常见 dtype 问题：

- 输入 uint8 还是 float32；
- 是否已归一化到 0-1；
- FP32/FP16 精度差异；
- INT8 量化范围；
- index tensor 是否 int64，而某些 backend 只支持 int32。

## 7. 转换正确性验证

### 7.1 单算子验证

为每个算子构造输入和属性边界，比较源框架与目标框架输出。适合验证 Conversion Pattern 是否正确。

测试例子：

- Conv：不同 padding、stride、group、dilation；
- Pooling：ceil_mode、global_pooling；
- Reshape：0、-1、动态 shape；
- Softmax：不同 axis；
- Concat：正负 axis；
- Slice：边界、负索引、step。

### 7.2 子图验证

覆盖真实结构：

- Conv + BN + ReLU；
- Reshape + Transpose + Concat；
- Pooling + Flatten + Gemm；
- Detection Head + Decode；
- Preprocess + Model + Postprocess。

### 7.3 整模型验证

使用代表性输入跑完整模型，比较：

| 任务 | 指标 |
|---|---|
| 分类 | top-1/top-5、logits diff、prob diff |
| 检测 | bbox、score、class、mAP、NMS 后结果 |
| 分割 | mask IoU、pixel accuracy |
| embedding | cosine similarity、recall@k |
| OCR/ASR | edit distance、WER/CER |

### 7.4 逐层 dump

当最终输出异常时，逐层 dump 是最有效方式。

```text
源模型输出每层 tensor
目标模型输出每层 tensor
  -> 层名/拓扑对齐
  -> shape/dtype 对齐
  -> 计算 cosine、MSE、MAE、max diff
  -> 找到误差首次明显放大的层
```

追问：层名对不上怎么办？

答：可以按拓扑顺序、op type、输入输出 shape、图结构关系建立映射；必要时在转换时保留 source location 或原始 layer name。

## 8. 输出不一致排查路径

### 8.1 先排除前后处理

很多“模型转换错了”其实是前后处理错。

检查：

1. 输入文件是否一致；
2. RGB/BGR 是否一致；
3. resize 算法是否一致；
4. crop/pad 是否一致；
5. mean/std/scale 是否一致；
6. NCHW/NHWC 是否一致；
7. dtype 是否一致；
8. 后处理 decode/NMS/坐标映射是否一致。

### 8.2 再查图和权重

- 权重是否完整加载；
- initializer shape 是否正确；
- transpose 是否重复或漏掉；
- bias 是否漏；
- BN/Scale 参数顺序是否正确；
- opset 是否兼容；
- runtime 是否替换了某些图优化。

### 8.3 最后查 backend

- provider 是否真的走 GPU/NPU；
- 是否有 CPU fallback；
- 某些 op 是否由不同 kernel 实现；
- FP16 是否引入可接受误差；
- INT8 是否有量化误差；
- 动态 shape 是否触发慢路径。

## 9. 算子不支持的工程选择

| 方法 | 适用 | 风险 |
|---|---|---|
| 等价改写 | 可分解为支持算子 | 要验证语义等价和性能 |
| 降 opset | 新 op 旧版本可表达 | 可能影响语义 |
| 自定义 plugin/kernel | 性能关键 op | 开发维护成本高 |
| CPU fallback | 低频非热点 op | 数据搬运可能拖慢整体 |
| 模型结构调整 | 可重新训练 | 成本最高 |
| 前后处理外置 | 非核心图逻辑 | 需要保证部署一致性 |

面试表达：

> 我会先判断这个 op 是不是性能关键路径。如果是低频 shape 操作，可能接受 CPU fallback；如果在主干网络热路径，就要考虑图改写或自定义 kernel，否则端到端性能会被数据搬运抵消。

## 10. 动态 shape 追问

### Q1：动态 shape 为什么麻烦？

因为部署后端需要提前做内存规划、kernel 选择、fusion 和 engine 构建。动态维度越多，优化空间越难确定。

### Q2：怎么处理？

- 固定常见输入尺寸；
- 设置 min/opt/max profile；
- 按业务尺寸构建多个 engine；
- 把预处理从图里拆出去；
- 避免 runtime 数据决定 reshape；
- 对真实线上 shape 分布做统计。

## 11. 性能排查

模型部署不仅要输出一致，还要性能可接受。

### 11.1 指标

| 指标 | 含义 |
|---|---|
| latency | 单请求耗时 |
| throughput | 单位时间处理请求数 |
| p50/p95/p99 | 延迟分位数 |
| memory | CPU/GPU/NPU 内存占用 |
| utilization | 设备利用率 |
| CPU fallback ratio | 回退到 CPU 的比例 |
| copy time | host-device 或 layout 转换耗时 |

### 11.2 常见性能问题

| 问题 | 表现 | 处理 |
|---|---|---|
| 小算子太多 | kernel launch 多 | fusion、图优化 |
| layout transform 多 | transpose 占时 | 固定 layout、消除冗余转换 |
| CPU fallback | 设备利用率低 | op 改写、plugin、换 backend |
| batch 不合适 | 吞吐低或延迟高 | 调 batch/profile |
| 动态 shape 慢 | engine 选择差 | 收窄 profile、固定尺寸 |
| 数据拷贝多 | H2D/D2H 占时 | zero-copy、预分配、复用 buffer |

## 12. 面试高频问答

### Q：ONNX opset 是什么？

opset 是 ONNX 算子语义的版本集合。runtime 支持的 opset 有范围，转换时需要选择目标 runtime 支持的版本；同一个 op 在不同 opset 下属性或默认行为可能不同。

### Q：动态 shape 为什么影响部署？

很多端侧 NPU 编译器依赖静态 shape 做内存规划、算子选择和融合。动态 shape 会让编译期优化变困难，也可能触发 runtime fallback 或直接不支持。

### Q：模型转换后精度不一致怎么处理？

先确认前处理和后处理，再确认模型结构、权重和算子属性；如果仍不一致，做逐层 dump，找到误差首次扩大的层，针对该层排查 layout、dtype、shape、量化参数和平台实现。

### Q：为什么 ONNX 能跑不代表部署成功？

因为还要看目标 runtime 是否支持所有 op、是否有 CPU fallback、性能是否满足要求、动态 shape 是否支持、前后处理是否一致、量化是否掉点、内存和延迟是否可接受。

## 13. 项目讲法模板

> 我参与的模型部署工作不是简单调用转换工具，而是围绕模型格式、算子语义、shape/layout、图优化和校验做工程处理。比如 Caffe 到 ONNX 转换时，我会关注 Conv、BN、Pooling、Reshape、Softmax 这类算子的属性差异。验证上会先做单算子和子图测试，再做整模型输出对齐；如果不一致，就通过逐层 dump 找到误差首次放大的节点，再排查该节点的属性、layout、dtype 或平台实现。

## 14. 资料入口

- ONNX 官方文档：https://onnx.ai/
- ONNX Concepts：https://onnx.ai/onnx/intro/concepts.html
- ONNX Operators：https://onnx.ai/onnx/operators/
- ONNX Runtime：https://onnxruntime.ai/
- PyTorch ONNX Export：https://pytorch.org/docs/stable/onnx.html
- TensorRT Documentation：https://docs.nvidia.com/deeplearning/tensorrt/latest/index.html
- Netron：https://netron.app/
