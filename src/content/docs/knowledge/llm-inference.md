---
title: 大模型推理
description: Transformer、KV Cache、投机采样和 LLM 量化。
---

## 必须掌握

- Transformer 推理流程、prefill、decode、KV Cache。
- 7B-14B 模型的显存、吞吐和延迟约束。
- 投机采样中的 draft model、target model、批量验证、接受率判断和 token 回退生成。
- 动态 shape、batch 维度构造和 KV Cache 复用。

## 可能问法

- KV Cache 为什么能加速 decode？
- 投机采样为什么能保证分布正确？
- 接受率低时加速效果会怎样？
- draft model 和 target model 如何选择？
- NPU 平台关键算子不支持时如何处理？

## 待填充

- 投机采样流程图
- KV Cache 数据结构
- 接受率与吞吐分析
- 量化方案对比
