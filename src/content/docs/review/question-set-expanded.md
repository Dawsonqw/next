---
title: 扩展问答清单
description: 面试复习用扩展问题集合。
---

# 扩展问答清单

## MLIR

- MLIR 和 LLVM IR 的区别是什么？
- Dialect 的作用是什么？
- Operation 由哪些部分组成？
- Conversion Pattern 和 Rewrite Pattern 的区别是什么？
- Dialect Conversion 的合法性机制是什么？
- Pass 和 Pattern 的区别是什么？
- 如何写一个模型图优化 pass？
- 子图融合为什么能提升性能？
- 图优化如何保证语义等价？

## 模型部署

- ONNX 图结构由哪些部分组成？
- opset 是什么？为什么转换时要关注 opset？
- Caffe 到 ONNX 转换最容易出错在哪里？
- NCHW 和 NHWC layout 不一致会导致什么问题？
- shape inference 有什么用？
- 转换后输出不一致如何排查？
- 算子不支持时有哪些工程选择？

## 量化与端侧部署

- 量化为什么会掉精度？
- 对称量化和非对称量化有什么区别？
- per-tensor 和 per-channel 有什么区别？
- PTQ 和 QAT 的区别是什么？
- calibration 数据怎么选择？
- 如何逐层 dump 定位异常层？
- RKNN / STM32 NPU 部署的一般流程是什么？
- NPU 输出和 PyTorch 输出不一致怎么排查？

## 大模型推理

- Transformer 自回归生成为什么慢？
- Prefill 和 Decode 的区别是什么？
- KV Cache 缓存的是什么？
- 投机采样为什么能加速？
- 投机采样为什么不改变 target model 的输出分布？
- acceptance rate 低会怎样？
- draft model 如何选择？
- 为什么关键算子不支持会影响落地？

## Agent Memory

- Agent 和普通 ChatBot 的区别是什么？
- 情感陪伴机器人为什么需要长期记忆？
- 哪些信息应该写入长期记忆？
- 如何避免记忆污染？
- 如何处理用户纠正或记忆冲突？
- 记忆召回只用向量 TopK 有什么问题？
- RAG 和 Memory 的区别是什么？
- Prompt 注入记忆时如何控制长度和语气？
