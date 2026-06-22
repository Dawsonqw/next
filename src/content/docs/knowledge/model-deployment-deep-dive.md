---
title: 模型部署深度笔记
description: Caffe、ONNX、算子语义、shape/layout、转换校验与部署排查。
---

# 模型部署深度笔记

## 1. 学习目标

这篇笔记用于支撑简历中的“模型格式转换、算子兼容性处理、输入输出对齐、推理结果校验、部署问题排查”。面试时需要证明自己理解完整链路，而不是只会调用转换工具。

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

## 3. ONNX 图结构

ONNX 是跨框架模型交换格式。一个 ONNX 模型不是简单的节点列表，而是一张带权重、属性和版本语义的计算图。

| 元素 | 含义 | 面试要点 |
|---|---|---|
| Graph | 整张计算图 | 包含 nodes、inputs、outputs、initializer |
| Node | 算子节点 | 包含 op_type、input、output、attribute |
| Initializer | 常量 tensor | 常见是 Conv/MatMul 权重和 bias |
| Attribute | 节点静态属性 | kernel、stride、pads、axis、epsilon 等 |
| Opset | 算子版本集合 | 同名 op 在不同 opset 下语义可能变化 |
| ValueInfo | tensor 元信息 | shape、dtype、符号维度 |

面试回答：ONNX 的关键价值是标准化图和算子语义，但标准化不等于零成本迁移，转换仍需处理源框架语义、默认值和目标 runtime 支持范围。

## 4. Caffe、PyTorch、ONNX 的差异

| 维度 | Caffe | PyTorch | ONNX |
|---|---|---|---|
| 图形态 | prototxt 静态图 | eager 动态图为主 | 静态交换图 |
| 权重 | caffemodel | state_dict | initializer |
| 算子 | layer 定义 | Python module/op | op schema |
| shape | 多数较静态 | 动态灵活 | 支持静态和符号 shape |
| 部署风险 | 老模型多，语义历史包袱 | 导出路径复杂 | runtime/opset 兼容性 |

Caffe 到 ONNX 转换中最常见的坑是：同一个 layer 的参数名、默认值、axis、padding、ceil_mode、group、layout 在 ONNX 中不完全对应。

## 5. CNN 算子语义重点

### Conv

需要明确：输入 shape、权重 shape、bias、stride、pads、dilation、group。普通 Conv、group Conv、depthwise Conv 在平台支持上可能差异很大。weight layout 不一致会导致结果错得很明显。

### BatchNorm

训练态和推理态不同。推理时使用固定 mean/variance/gamma/beta。Conv+BN 融合公式：

```text
W' = W * gamma / sqrt(var + eps)
b' = (b - mean) * gamma / sqrt(var + eps) + beta
```

融合后减少一个 BN op，也减少中间 tensor 读写。

### Pooling

重点关注 padding、ceil_mode、global pooling。不同框架对边界窗口是否计入平均值可能不同。

### Reshape / Transpose / Concat / Slice

这些算子通常计算量不大，但部署风险很高：shape 推断失败、动态维度不支持、layout transform 增多、NPU 不支持某种切片模式。

### Softmax

重点是 axis。分类输出常见，但 axis 错误会导致概率分布完全不对。

## 6. 转换正确性验证

### 单算子验证

为每个算子构造输入和属性边界，比较源框架与目标框架输出。适合验证 Conversion Pattern 是否正确。

### 子图验证

覆盖 Conv+BN+ReLU、Reshape+Transpose+Concat、Pooling+Flatten+Gemm 等真实结构。

### 整模型验证

使用代表性输入跑完整模型，比较分类 top-k、检测框、关键点或业务指标。

### 逐层 dump

当最终输出异常时，逐层 dump 是最有效方式。流程：

```text
源模型输出每层 tensor
目标模型输出每层 tensor
  -> 层名/拓扑对齐
  -> shape/dtype 对齐
  -> 计算 cosine、MSE、MAE、max diff
  -> 找到误差首次明显放大的层
```

## 7. 常见排查路径

输出不一致时，先不要怀疑大框架，按顺序检查：

1. 输入文件是否一致；
2. RGB/BGR 是否一致；
3. resize、crop、padding 是否一致；
4. mean/std/scale 是否一致；
5. NCHW/NHWC 是否一致；
6. 模型权重是否正确加载；
7. opset 和算子属性是否一致；
8. 后处理 decode/NMS/坐标映射是否一致；
9. 逐层 dump 定位误差起点。

## 8. 面试高频问答

### Q：ONNX opset 是什么？

opset 是 ONNX 算子语义的版本集合。runtime 支持的 opset 有范围，转换时需要选择目标 runtime 支持的版本；同一个 op 在不同 opset 下属性或默认行为可能不同。

### Q：动态 shape 为什么影响部署？

很多端侧 NPU 编译器依赖静态 shape 做内存规划、算子选择和融合。动态 shape 会让编译期优化变困难，也可能触发 runtime fallback 或直接不支持。

### Q：模型转换后精度不一致怎么处理？

先确认前处理和后处理，再确认模型结构、权重和算子属性；如果仍不一致，做逐层 dump，找到误差首次扩大的层，针对该层排查 layout、dtype、shape、量化参数和平台实现。

## 9. 资料入口

- ONNX 官方文档：https://onnx.ai/
- ONNX Operators：https://onnx.ai/onnx/operators/
- ONNX Runtime：https://onnxruntime.ai/
- PyTorch ONNX Export：https://pytorch.org/docs/stable/onnx.html
- Netron：https://netron.app/
