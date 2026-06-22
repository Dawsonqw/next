---
title: 端侧 NPU 部署
description: RKNN、STM32 NPU、fallback 和平台适配。
---

## 必须掌握

- 端侧模型部署完整链路。
- RKNN 模型转换、量化、推理和 profiling。
- STM32 NPU / MCU AI 的资源约束和部署边界。
- NPU 不支持算子、CPU fallback、输入输出预处理 / 后处理对齐。

## 面试追问

- 端侧部署和服务器部署的主要差异是什么？
- NPU 平台不支持某个算子时怎么办？
- 如何验证端侧推理结果和原模型一致？
- profiling 发现 NPU 没有明显加速时如何分析？

## 待填充

- RKNN 流程
- STM32 NPU 约束
- fallback 策略
- 平台适配 checklist
