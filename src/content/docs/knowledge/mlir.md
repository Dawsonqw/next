---
title: MLIR 工具链
description: Dialect、Operation、Conversion Pattern、Pattern Rewrite、Pass 与模型部署工具链。
---

# MLIR 工具链

## 对应简历原句

> 基于 MLIR Dialect 和 Conversion Pattern 实现 Caffe 到 ONNX 的模型格式转换能力。
>
> 基于 MLIR Pattern Rewrite 实现子图模式匹配与图结构改写流程。

## 面试风险

这是简历里技术密度最高的模块之一。面试官可能不会只问“MLIR 是什么”，而会继续追问：Dialect 如何定义、Operation 由哪些部分组成、Conversion Pattern 和 Rewrite Pattern 有什么区别、Pass Pipeline 怎么组织、图优化如何保证语义等价、Caffe 到 ONNX 的算子映射如何验证。

## 一句话解释

MLIR 是 LLVM 生态中的多层级中间表示框架，适合把不同模型格式、不同抽象层级和不同硬件后端统一到一套可转换、可分析、可优化的 IR 基础设施里。

## 核心概念

### 1. IR 与多层级表示

传统 LLVM IR 更接近底层编译后端，而模型部署工具链往往需要同时表达高层模型语义和低层平台约束。例如 Caffe/ONNX 级别的 Conv、BatchNorm、Reshape 是高层算子；平台侧可能需要表达 layout、memory、tiling、fusion、device op 等更低层概念。MLIR 的多 Dialect 机制允许逐步 lowering，而不是一步从模型格式直接翻译到后端 runtime。

### 2. Dialect

Dialect 是 MLIR 的扩展单元，用来定义一组相关的 Operation、Type、Attribute 和语义约束。模型工具链中常见思路是：

- 前端 Dialect 表达源模型格式，例如 Caffe-like op；
- 中间 Dialect 表达通用神经网络图；
- 目标 Dialect 表达 ONNX 或硬件平台相关 op；
- 通过 Conversion Pattern 和 Pass 在不同 Dialect 间转换。

### 3. Operation

Operation 是 MLIR 中最核心的 IR 节点。一个 Operation 通常包含：

- name：例如 `onnx.Conv` 或自定义 dialect 中的 `caffe.Convolution`；
- operands：输入 SSA value；
- results：输出 SSA value；
- attributes：静态属性，例如 kernel、stride、padding、axis；
- regions / blocks：用于表达控制流或嵌套结构；
- location：调试和错误定位信息。

模型转换时最容易出错的往往不是节点名字，而是属性语义、shape、layout 和边界条件。

### 4. Pattern Rewrite

Pattern Rewrite 是“匹配某种 IR 结构，然后替换为另一种结构”的基础设施。它适合做：

- 算子替换：`relu(relu(x)) -> relu(x)`；
- 子图融合：`Conv + BatchNorm + ReLU -> FusedConvBNReLU`；
- 冗余消除：删除 Identity、无效 Reshape；
- 平台适配：把某些不支持的结构改写成支持的等价结构。

### 5. Dialect Conversion / Conversion Pattern

Dialect Conversion 更强调“非法 IR 到合法 IR”的转换。常见流程是：

1. 定义 ConversionTarget，标记哪些 Dialect/Operation 合法或非法；
2. 定义 TypeConverter，处理类型系统转换；
3. 注册 Conversion Pattern，说明某类 op 如何转换；
4. 运行 conversion driver，将非法 op 转成合法 op。

Caffe 到 ONNX 的转换就可以理解为：Caffe dialect 中的 op 在目标阶段是非法的，需要通过 Conversion Pattern 转成 ONNX dialect 或 ONNX 等价表达。

## Caffe 到 ONNX 转换的关注点

### 算子语义映射

同名或近似算子不代表语义完全一致。需要关注：

- 参数名称不同：kernel、stride、pad、dilation、group；
- 默认值不同：某些框架默认 padding 或 axis 不一致；
- layout 不同：NCHW / NHWC；
- broadcasting 规则；
- shape inference 行为；
- 训练态和推理态差异，例如 BatchNorm。

### 常见算子映射风险

| Caffe 算子 | ONNX 等价方向 | 风险点 |
|---|---|---|
| Convolution | Conv | padding、group、dilation、weight layout |
| BatchNorm / Scale | BatchNormalization / Mul/Add | 推理态参数融合、epsilon、均值方差含义 |
| InnerProduct | Gemm / MatMul + Add | flatten 位置、transpose、bias |
| Pooling | MaxPool / AveragePool | ceil_mode、global pooling、padding |
| ReLU / PReLU | Relu / PRelu | slope 参数、广播规则 |
| Reshape | Reshape | 0/-1 语义、动态 shape |
| Permute | Transpose | axes 顺序 |
| Concat | Concat | axis 语义 |

## 图优化如何保证语义等价

图优化不能只看结构相似，还要证明或验证语义等价。常见方式：

1. **规则层面约束**：只在满足属性条件时改写，例如 Conv+BN 融合要求 BN 处于推理态且参数已固定。
2. **shape/type 检查**：改写前后输出 shape 和 type 应一致或可解释。
3. **数值对齐测试**：使用固定输入比较改写前后输出误差。
4. **回归测试集**：覆盖历史业务模型和边界模型。
5. **可回滚 Pass**：将优化 pass 独立开关化，便于定位问题。

## 项目讲法模板

面试中可以这样讲：

> 我们使用 MLIR 主要是为了统一模型转换、模型编辑、图优化和后端平台适配。模型格式转换时，我负责把 Caffe 中常见算子通过 Conversion Pattern 转成 ONNX 等价表达，重点处理属性语义、shape、layout 和默认值差异。图优化部分则基于 Pattern Rewrite 做子图匹配和结构改写，例如将某些平台执行效率低的结构替换成硬件更友好的表达。验证上会结合模型级输出对齐、逐层输出对齐和历史模型回归测试。

## 高频追问

### Q1：为什么不用直接写 Caffe 到 ONNX 的转换脚本？

直接脚本适合一次性转换，但随着算子增多、平台增多、图优化规则增多，会出现规则分散、可维护性差、难复用的问题。MLIR 可以把模型转换、IR 编辑、Pattern Rewrite、Pass Pipeline 统一起来，新增平台或优化时可以复用基础设施。

### Q2：Conversion Pattern 和 Rewrite Pattern 有什么区别？

Rewrite Pattern 更泛化，核心是匹配并改写 IR；Conversion Pattern 通常用于 Dialect Conversion，带有合法性目标和类型转换，更强调把非法源 op 系统性转换为目标 dialect 的合法 op。

### Q3：Pass 和 Pattern 的区别是什么？

Pattern 是局部改写规则；Pass 是一次完整的 IR 遍历和变换过程，可以组织多个 pattern，也可以做分析、验证、pipeline 编排。一个图优化 pass 里通常会注册多条 rewrite pattern。

### Q4：怎么验证 50 多种算子转换正确？

至少需要三层验证：单算子测试、子图测试、整模型回归测试。单算子测试覆盖属性边界；子图测试覆盖 shape/layout 传播；整模型测试比较 Caffe 原始输出和 ONNX Runtime 或目标平台输出的误差。

### Q5：图优化 300% 加速可能来自哪里？

通常来自消除平台不友好的子图、减少访存、减少 kernel launch、融合连续算子、替换低效算子实现、减少 layout transform 或让计算落到更高效的 NPU kernel。面试时不要泛泛说“优化了算法”，要明确是“结构改写 + 平台更友好执行”。

## 最小 Demo 思路

可以实现一个 toy pass：

```text
输入 IR:  relu(relu(x))
匹配规则: 外层 relu 的输入也是 relu
改写结果: relu(x)
验证方式: 对随机输入比较改写前后输出完全一致
```

或者实现 Conv+BN 融合伪代码：

```text
W' = W * gamma / sqrt(var + eps)
b' = (b - mean) * gamma / sqrt(var + eps) + beta
Conv(x, W, b) + BN -> Conv(x, W', b')
```

## 需要补齐的个人项目细节

- 你实际负责过哪些 Caffe 算子；
- 哪些算子最难转换；
- 有没有遇到 shape/layout 不一致问题；
- 300% 加速来自哪类子图；
- 图优化 pass 的开关和回滚机制；
- 单元测试和回归测试怎么组织。

## 资料入口

- MLIR 官方站点：https://mlir.llvm.org/
- MLIR Language Reference：https://mlir.llvm.org/docs/LangRef/
- MLIR Pattern Rewriter：https://mlir.llvm.org/docs/PatternRewriter/
- MLIR Dialect Conversion：https://mlir.llvm.org/docs/DialectConversion/
- MLIR: Scaling Compiler Infrastructure for Domain Specific Computation：https://arxiv.org/abs/2002.11054
