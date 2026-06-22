---
title: 图优化与性能分析
description: 子图融合、算子替换、性能 profiling 和推理优化。
---

# 图优化与性能分析

## 对应简历原句

> 基于 MLIR Pattern Rewrite 实现子图模式匹配与图结构改写流程；在部分特定结构模型上实现最高约 300% 的推理加速效果。

## 一句话解释

图优化是在保持模型语义等价的前提下，通过删除冗余节点、融合连续算子、替换低效结构和减少数据搬运来提升推理效率。

## 常见优化类型

| 优化 | 作用 |
|---|---|
| 常量折叠 | 编译期计算固定表达式，减少运行时计算 |
| 死节点删除 | 删除不影响输出的节点 |
| 算子融合 | 减少 kernel 调度和中间数据读写 |
| Conv + BN 融合 | 将 BN 参数合入 Conv 权重和 bias |
| Layout 优化 | 减少 NCHW / NHWC 反复转换 |
| 算子替换 | 将平台低效结构替换成更高效的等价表达 |

## 为什么子图融合能加速

许多推理瓶颈不只来自算术计算，还来自访存、中间 tensor 写回、kernel 启动和调度开销。把连续的小算子融合为一个平台友好的 kernel，可以减少中间结果读写和调度成本。

## 语义等价如何保证

1. 改写规则必须有明确前置条件。
2. 改写前后 shape、type 和输出语义要一致。
3. 使用单元测试覆盖边界属性。
4. 使用整模型回归测试验证最终输出。
5. 每个优化 pass 最好可开关，方便定位问题。

## 300% 加速如何表达边界

面试中不要说所有模型都能加速 300%。稳妥表达是：

> 这个收益是在部分特定结构模型和特定计算平台上，通过子图融合或结构改写获得的。它依赖模型结构、输入规模、平台 kernel 支持和 profiling 口径，不能直接泛化到所有模型。

## profiling 关注点

- 单层耗时；
- 整体端到端耗时；
- 是否存在 fallback；
- layout transform 次数；
- 中间 tensor 内存读写；
- 小算子调度开销；
- 优化前后输出误差。

## 高频追问

### Q1：图优化和量化有什么区别？

图优化主要改变计算图结构，量化主要改变数值表示。两者都可能影响性能，但风险点不同：图优化关注语义等价，量化关注数值误差。

### Q2：优化 pass 出问题怎么定位？

使用 pass 开关逐步定位，比较优化前后 IR 和输出；如果最终输出异常，再做逐层输出对齐，找到误差开始扩大的节点。

### Q3：为什么减少 layout transform 能提升性能？

layout transform 本身会产生数据重排和内存访问成本，而且可能打断算子融合，让后端无法使用连续的高效 kernel。

## 资料入口

- MLIR Pattern Rewriter：https://mlir.llvm.org/docs/PatternRewriter/
- MLIR Pass Management：https://mlir.llvm.org/docs/PassManagement/
- ONNX Runtime Graph Optimizations：https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html
