---
title: 高级工程师视角：模型部署与量化
description: 基于 ONNX、ONNX Runtime、TensorRT、MLIR 官方文档整理的高级模型部署与量化工程笔记。
---

# 高级工程师视角：模型部署与量化

更新时间：2026-06-23

## 0. 官方资料锚点

| 资料 | 关键结论 | 工程含义 |
|---|---|---|
| ONNX Concepts | ONNX 目标是提供通用语言描述模型，使生产环境只需要 runtime 执行 ONNX graph；ONNX 强类型，不支持隐式类型转换；每个 graph 带 opset version | 部署不是保存模型文件，而是稳定表达 graph、operator、type、opset 和 runtime 兼容性 |
| ONNX Runtime Graph Optimizations | ORT 图优化包括节点消除、常量折叠、节点融合、layout 优化，可 online/offline 执行，优化级别分 Basic、Extended、Layout | 性能来自图层级变换，但调试时要意识到优化会改变节点边界 |
| ONNX Runtime Quantization | ORT 量化是 8-bit linear quantization；支持 QOperator 和 QDQ 两种表示；预处理包括 symbolic shape inference、graph optimization、ONNX shape inference | 量化不是单一步骤，而是形状推断、图优化、量化格式、debugging 的组合流程 |
| TensorRT Dynamic Shapes | 动态 shape 通过 `-1` 标记 runtime dimension，并需要 build-time optimization profiles 限定输入维度范围和优化维度 | 动态 shape 的本质是编译期优化和运行时灵活性之间的 trade-off |
| MLIR LangRef / Dialect Conversion | MLIR 基于 Operation/Value/Region/Block；Dialect 可扩展；Dialect Conversion 用 legality target 和 pattern 将非法 op 转成合法 op | MLIR 不是“另一个模型格式”，而是表达、合法化、lowering 和优化 pipeline 的框架 |

## 1. 高级工程师如何理解模型部署

初级回答：把 PyTorch/Caffe 转成 ONNX，然后用 runtime 跑。

高级回答：模型部署是把训练框架的计算语义、张量类型、shape、layout、权重、动态行为和数值精度，转换成目标 runtime 和硬件可执行、可优化、可验证的形式。

核心问题：

```text
表达：模型如何被表示成 graph/IR？
语义：每个 op 的属性和默认行为是否一致？
合法性：目标 runtime/hardware 是否支持该 op/type/shape？
优化：哪些 graph rewrite 是语义保持的？
数值：FP32/FP16/INT8/INT4 是否满足精度？
性能：瓶颈是 compute、memory、kernel launch 还是 fallback？
调试：输出不一致时如何定位到第一处 divergence？
```

## 2. ONNX：不是 runtime，而是强类型计算图交换格式

### 2.1 ONNX 的生产价值

ONNX 的价值在于把不同训练框架模型统一成 graph 和 operators，让生产环境可以围绕 runtime 建立统一部署流程。

但这不意味着“转成 ONNX 就部署完成”。ONNX 只解决表达问题，不自动解决：

- 算子语义一致；
- opset 兼容；
- 动态 shape 支持；
- 后端 kernel 覆盖；
- 量化精度；
- 性能瓶颈；
- 前后处理一致。

### 2.2 ONNX graph 的关键对象

| 对象 | 高级理解 |
|---|---|
| ModelProto | 模型容器，包含 metadata、opset_import、graph |
| GraphProto | 计算图，不只是节点列表，还有输入输出和 initializer |
| NodeProto | 算子调用，包含 op_type、domain、inputs、outputs、attributes |
| Initializer | 常量 tensor，通常是权重或 bias |
| ValueInfo | 类型和 shape 信息，是 shape inference 和调试的重要依据 |
| Opset | 算子语义版本；同名 op 在不同版本下可能有不同定义 |

### 2.3 强类型的工程含义

ONNX 强类型且不做隐式 cast。工程后果：

- 输入 dtype 错会直接失败或输出不一致；
- index tensor 的 int64/int32 差异可能影响 backend；
- 某些 runtime/NPU 只支持特定 dtype；
- 需要显式 Cast，不能依赖框架隐式转换。

### 2.4 opset 不是版本号装饰

opset 定义 graph 内 operator 的语义版本。高级工程师会问：

```text
目标 runtime 支持到哪个 opset？
这个 op 在当前 opset 下属性默认值是什么？
导出时 opset 变化是否改变 Resize/Pad/Softmax/BatchNorm 行为？
如果要降 opset，是否会改变语义？
```

## 3. 算子语义：部署 bug 的主战场

### 3.1 Conv

Conv 不能只看 op name。要核对：

```text
input layout: NCHW / NHWC
weight layout: OIHW / HWIO / custom
pads / strides / dilations
group / depthwise
bias
rounding / accumulation dtype
```

高级问题：如果 Caffe 和 ONNX Conv 输出不一致，第一层就错，优先查什么？

回答：输入前处理、RGB/BGR、NCHW/NHWC、weight layout、padding、group、bias 和 dtype。

### 3.2 BatchNorm 和 Scale

Caffe 常见 BN + Scale 组合在转换时容易出错。部署时必须区分训练态和推理态。

Conv+BN 融合：

```text
W' = W * gamma / sqrt(var + eps)
b' = (b - mean) * gamma / sqrt(var + eps) + beta
```

高级工程点：融合减少 kernel 和中间 tensor 读写，但融合前必须确认 BN 是推理态、参数固定、输出没有被其他分支以特殊方式使用。

### 3.3 Reshape / Transpose / Slice

这些低 FLOPs 算子经常是部署大坑：

| 算子 | 高级风险 |
|---|---|
| Reshape | 目标 shape 可能来自 runtime tensor，NPU 不支持动态形状 |
| Transpose | 大量 layout transform 会吞掉计算优化收益 |
| Slice | starts/ends/axes/steps 动态化后硬件不支持 |
| Concat | axis 错误导致张量语义错误 |
| Flatten | 起始 axis 不同导致 classifier 输入错 |

### 3.4 Softmax

Softmax 的 axis 是语义关键。axis 错误会让概率归一化维度错误，分类或 attention 输出直接失效。

## 4. MLIR：从格式转换到合法化 pipeline

### 4.1 为什么 MLIR 适合模型部署工具链

ONNX 解决交换格式，MLIR 更适合构建可扩展 compiler pipeline：

```text
source dialect: Caffe-like / ONNX-like
  -> canonicalization
  -> shape/type inference
  -> legality checks
  -> conversion patterns
  -> target dialect / hardware dialect
  -> lowering
```

### 4.2 Operation / Value / Region / Block

MLIR 的核心抽象：

| 概念 | 工程意义 |
|---|---|
| Operation | 表示任意层级计算，可扩展，不限于固定 op 列表 |
| Value | SSA 值，来自 op result 或 block argument |
| Region | op 内部的嵌套 IR，可表达控制流/图区域 |
| Block | operation 序列和 block arguments |
| Dialect | 一组 op/type/attr 的命名空间和语义集合 |

高级理解：MLIR 能表达高层模型图，也能逐步 lower 到更接近硬件的 IR。

### 4.3 Pattern Rewrite 和 Dialect Conversion 的区别

| 机制 | 目标 |
|---|---|
| Pattern Rewrite | 局部匹配和改写，例如 Conv+BN 融合、冗余 Reshape 消除 |
| Dialect Conversion | 根据合法性目标，把非法 op/type 转成目标合法 op/type |

Dialect Conversion 的高级点是 legality：

```text
Legal: 目标允许
Illegal: 必须转换
Dynamic: 某些条件下合法
Unknown: 根据 conversion mode 处理
```

这比“写一个转换函数”更工程化，因为整个 pipeline 可以检查是否所有非法 op 都被合法化。

### 4.4 TypeConverter 为什么重要

模型部署中 type 不只是 `float -> int`。还可能有：

- tensor type -> memref type；
- dynamic shape -> static/profiled shape；
- framework dtype -> target dtype；
- quantized type materialization。

TypeConverter 让 conversion pattern 接收到已经合法化的 operand type，并在必要时插入 materialization，保证 IR 类型契约不被破坏。

## 5. Runtime 图优化：性能和可调试性的权衡

### 5.1 ORT 优化层级

ONNX Runtime 的 graph optimization 包括：

| 层级 | 示例 | 工程影响 |
|---|---|---|
| Basic | constant folding、identity/dropout/slice 消除、Conv+BN 融合 | 通常全 EP 可用，减少无用计算 |
| Extended | GELU、Attention、LayerNorm 等复杂融合 | 依赖特定 execution provider |
| Layout | NCHWc 等 layout 优化 | 提升 CPU 性能，但改变调试时张量布局 |

### 5.2 online vs offline

| 模式 | 优点 | 风险 |
|---|---|---|
| online | session 初始化时自动优化，使用简单 | 启动有开销，线上行为与版本强相关 |
| offline | 优化后 graph 保存到磁盘，可复用 | 需要管理优化产物和 runtime 版本兼容 |

高级工程建议：

- correctness debug 时先降低优化级别；
- performance benchmark 时开启目标优化；
- 保存优化后 graph 用于 diff；
- 记录 ORT version、EP、optimization level。

## 6. 动态 shape：编译期优化和运行时灵活性的 trade-off

TensorRT 动态 shape 的核心流程：

```text
用 -1 标记 runtime dimension
build time 定义 optimization profile
runtime 选择覆盖当前输入的 profile
设置实际 input dimensions
TensorRT 推导 output dimensions
enqueue work
```

### 6.1 为什么动态 shape 难

动态 shape 会影响：

- 内存规划；
- kernel selection；
- tactic search；
- fusion 条件；
- workspace 大小；
- engine cache；
- latency 稳定性。

### 6.2 高级设计原则

| 场景 | 处理 |
|---|---|
| 输入尺寸种类少 | 多个 static engine 或窄 profile |
| 输入范围宽 | profile 分桶，避免一个 profile 覆盖太大 |
| 在线 serving | 统计真实 shape 分布，按 P95/P99 设置 profile |
| 端侧 NPU | 尽量静态 shape，动态逻辑放前后处理 |
| Transformer | 单独处理 batch/seq_len/KV cache 维度 |

## 7. 量化：数值表示、硬件 kernel、精度恢复三者一起看

### 7.1 线性量化

ORT 文档中的核心关系：

```text
val_fp32 = scale * (val_quantized - zero_point)
```

工程理解：

- scale 决定离散网格宽度；
- zero_point 保证浮点 0 可表示；
- zero padding 在 CNN 中常见，0 是否可精确表示会影响精度；
- clamp/saturation 是掉点来源之一。

### 7.2 QOperator vs QDQ

| 格式 | 机制 | 工程影响 |
|---|---|---|
| QOperator | 直接用量化算子，如 QLinearConv | 表达紧凑，但调试边界较粗 |
| QDQ | 在原 op 周围插入 QuantizeLinear/DequantizeLinear | 更容易观察量化边界，常用于 QAT/export |

高级判断：QDQ 不是自动加速。只有 runtime 将 QDQ pattern lower/fuse 到低精度 kernel，才会有性能收益。

### 7.3 Dynamic / Static / QAT

| 方法 | 原理 | 用法 |
|---|---|---|
| Dynamic Quantization | runtime 计算部分量化参数 | RNN/Transformer 常见 |
| Static Quantization | calibration 离线确定激活范围 | CNN/端侧常见 |
| QAT | 训练时模拟量化 | PTQ 达不到精度目标时使用 |

ORT 文档建议一般 RNN/Transformer 可优先 dynamic，CNN 可优先 static；如果 PTQ 达不到精度目标，再考虑 QAT。

### 7.4 INT4 / Weight-only

低 bit 量化不是简单把所有 tensor 变成 INT4。ORT 对部分 op 支持 block-wise weight-only INT4，例如 MatMul 的常量 B。工程上要看：

- 是否是权重量化；
- block size；
- op 是否支持；
- opset 是否兼容；
- kernel 是否真的加速；
- 精度是否可接受。

## 8. 逐层调试：高级工程师必须会做的事情

### 8.1 总流程

```text
原框架 FP32 输出
  -> ONNX FP32 输出
  -> runtime FP32/FP16 输出
  -> quantized/runtime 输出
  -> 逐层对齐
  -> 找首次 divergence
```

### 8.2 指标解释

| 指标 | 用途 | 限制 |
|---|---|---|
| max abs diff | 找极端 outlier | 易被单点影响 |
| mean abs diff | 看整体偏移 | 对大误差不够敏感 |
| MSE/RMSE | 大误差敏感 | 单位依赖 scale |
| cosine similarity | 特征方向一致性 | 对整体 scale 不敏感 |
| SQNR | 量化噪声分析 | 需要稳定参考 |
| task metric | 最终业务有效性 | 不能定位原因 |

### 8.3 层名对不上怎么办

- 转换时保留 source location；
- 按拓扑顺序匹配；
- 按 op type + shape 匹配；
- 对子图级别比较；
- 关闭图优化后再 dump；
- 保存优化前/后 graph 做 diff。

## 9. 性能定位：不要只看 latency

### 9.1 必须拆指标

| 指标 | 为什么重要 |
|---|---|
| TTFT / latency | 单请求体验 |
| throughput | 服务容量 |
| p95/p99 | 稳定性和尾延迟 |
| memory/VRAM | 最大并发和部署成本 |
| H2D/D2H copy | 数据搬运瓶颈 |
| kernel time | 设备计算瓶颈 |
| CPU fallback ratio | 后端覆盖问题 |
| graph optimization time | 冷启动成本 |
| build time | TensorRT/engine 构建成本 |

### 9.2 常见性能失败模式

| 现象 | 可能原因 |
|---|---|
| INT8 不比 FP16 快 | 没有低精度 kernel、QDQ 未融合、batch 太小 |
| GPU 利用率低 | CPU preprocessing、H2D copy、同步等待、batch 不足 |
| NPU 跑一段慢 op | unsupported op fallback、layout transform、dynamic shape |
| 冷启动慢 | online graph optimization、TensorRT engine build |
| p99 很高 | shape/profile 切换、队列积压、内存分配 |

## 10. 应用到你的项目经历

### 10.1 Caffe 到 ONNX / MLIR

高级讲法：

```text
我不是简单调用转换工具，而是围绕 source op 到 target op 的语义合法化做工程实现。
重点包括属性默认值、shape/layout、opset、dtype、单算子测试、子图测试和整模型回归。
在 MLIR 中，这类工作可以抽象为 dialect conversion：定义 target legality，写 conversion pattern，必要时处理 type conversion。
```

### 10.2 图优化 300% 加速

不要只说“图优化加速”。要拆成：

- 减少 kernel launch；
- 减少中间 tensor 读写；
- 消除冗余 transpose/reshape；
- Conv+BN/Activation fusion；
- 替换平台不友好 op；
- 提高后端 kernel 命中率；
- 降低 CPU fallback。

### 10.3 量化精度分析

高级讲法：

```text
先证明 FP32 转换正确，再进入量化。
量化掉点后，不直接猜 calibration 或某个 op，而是逐层 dump FP32 与 quantized 输出，找首次误差放大的节点。
然后结合该层的分布、scale、zero_point、量化粒度、op 类型和 backend kernel 判断原因。
恢复策略从 calibration、per-channel、敏感层回退，到 SmoothQuant/AWQ/GPTQ/QAT。
```

## 11. 高级面试追问

1. ONNX 为什么是强类型？这对部署有什么影响？
2. opset 升级/降级为什么可能改变模型语义？
3. shape inference 能解决什么，不能解决什么？
4. ORT Basic/Extended/Layout 优化有什么差别？
5. 为什么图优化会让逐层 dump 更难？
6. TensorRT dynamic shape 为什么需要 optimization profile？
7. Caffe BN+Scale 转 ONNX 最容易错在哪里？
8. Conv+BN 融合为什么能加速？什么时候不能融合？
9. QDQ 图为什么不一定加速？
10. INT8 量化为什么可能掉精度？
11. calibration 数据怎么评估代表性？
12. 如何判断瓶颈是 compute-bound 还是 memory-bound？
13. 不支持算子是 fallback、plugin 还是改图？如何决策？
14. MLIR ConversionTarget 的 legality 为什么比手写转换函数更稳？

## 12. 工程实践任务

1. 用 PyTorch 导出 TinyCNN ONNX，记录 opset 和 graph structure。
2. 用 Netron 和 ONNX shape inference 检查 shape。
3. 关闭/开启 ORT graph optimization，比较优化前后 graph。
4. 手写 Conv+BN fusion，比较误差。
5. 故意改 Softmax axis，观察输出错误。
6. 用 ORT 做 static PTQ，生成 QDQ 图。
7. 比较 FP32 与 INT8 每层输出，找首次 divergence。
8. 用不同 calibration 集比较精度。
9. 用 TensorRT dynamic shape profile 跑不同输入尺寸。
10. 写一个 MLIR toy conversion：source.add -> target.add，定义 legality。

## 13. 资料入口

- ONNX Concepts：https://onnx.ai/onnx/intro/concepts.html
- ONNX Runtime Graph Optimizations：https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html
- ONNX Runtime Quantization：https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html
- TensorRT Dynamic Shapes：https://docs.nvidia.com/deeplearning/tensorrt/latest/inference-library/work-dynamic-shapes.html
- MLIR LangRef：https://mlir.llvm.org/docs/LangRef/
- MLIR Pattern Rewriter：https://mlir.llvm.org/docs/PatternRewriter/
- MLIR Dialect Conversion：https://mlir.llvm.org/docs/DialectConversion/
