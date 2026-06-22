---
title: 端侧 NPU 部署深度笔记
description: RKNN、STM32 NPU、模型转换、算子兼容、预处理对齐与 profiling。
---

# 端侧 NPU 部署深度笔记

## 1. 学习目标

这篇笔记用于支撑简历中的 RKNN、STM32 NPU、端侧 CV 模型部署、推理链路调试和性能分析。目标是能讲清端侧部署流程、常见问题、排查路径和工程边界。

## 2. 端侧部署特点

端侧 NPU 与服务器 GPU 不同，约束更多：

| 维度 | 服务器 GPU | 端侧 NPU / MCU |
|---|---|---|
| 算力 | 较充足 | 受芯片规格限制 |
| 内存 | 显存较大 | RAM/Flash 有强限制 |
| shape | 动态支持较好 | 多数更偏静态 shape |
| 算子 | 框架支持丰富 | 支持集合有限 |
| 调试 | 工具完善 | dump/profiling 能力有限 |
| 目标 | 吞吐、并发 | 实时性、功耗、成本、稳定性 |

## 3. 通用部署链路

```text
训练侧模型
  -> 导出 ONNX / Caffe / TFLite 等格式
  -> 平台转换工具导入
  -> 配置输入输出、mean/std、layout、量化参数
  -> 平台编译生成可执行模型
  -> 端侧 runtime 加载
  -> 输入预处理
  -> 推理执行
  -> 后处理
  -> 精度对齐和性能 profiling
```

## 4. RKNN 方向

RKNN 部署通常关注：

- 模型导入格式是否受支持；
- opset 和算子支持情况；
- 量化 calibration 数据是否正确；
- 输入 layout 和 channel order；
- runtime 输入输出 tensor 配置；
- 是否发生 CPU fallback；
- 每层耗时和端到端耗时。

排查重点是：模型能转不代表能跑得快，能跑得快也不代表精度对齐。

## 5. STM32 NPU / MCU 方向

MCU 场景更强调资源约束：

- 模型需要尽量小；
- INT8 更常见；
- 静态内存规划很重要；
- 前处理和后处理不能太重；
- 算子要尽量使用平台支持的常见结构；
- 需要考虑实时性和功耗。

面试不要把 STM32 NPU 讲成服务器级推理平台，要强调嵌入式资源约束。

## 6. 精度不一致排查

优先检查非模型因素：

1. 输入图片是否完全一致；
2. RGB/BGR 是否一致；
3. resize、crop、padding 是否一致；
4. mean、std、scale 是否一致；
5. NCHW/NHWC 是否一致；
6. dtype 和量化输入范围是否一致；
7. 后处理 decode、NMS、坐标映射是否一致；
8. 逐层 dump 定位误差开始位置。

## 7. 性能不达预期排查

常见原因：

- 某些算子 fallback 到 CPU；
- layout transform 太多；
- 小算子过多，调度开销大；
- 输入输出拷贝频繁；
- 量化没有命中高效 INT8 kernel；
- 模型结构不适合目标芯片；
- batch/shape 配置触发低效路径。

## 8. 算子不支持怎么办

| 方案 | 适合场景 | 风险 |
|---|---|---|
| 等价算子组合 | 平台支持基础算子 | 可能增加节点数和耗时 |
| 改模型结构 | 训练侧可调整 | 需要重新验证精度 |
| 自定义算子 | 平台支持 plugin | 工程复杂度高 |
| CPU fallback | 少量低频节点 | 数据搬运可能抵消收益 |
| 推动平台补算子 | 长期方案 | 周期不可控 |

## 9. 面试讲法模板

> 端侧部署时，我会先保证模型能转换并在 runtime 上跑通，然后对齐输入输出和业务后处理。精度不一致时优先排查前处理和 layout，再做逐层输出对齐。性能不达预期时会看 profiling，确认是否有 CPU fallback、layout transform、数据拷贝或未命中 NPU 高效 kernel。

## 10. 资料入口

- RKNN Toolkit2：https://github.com/airockchip/rknn-toolkit2
- STM32Cube.AI / X-CUBE-AI：https://www.st.com/en/embedded-software/x-cube-ai.html
- ONNX Runtime：https://onnxruntime.ai/
