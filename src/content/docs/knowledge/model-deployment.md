---
title: 模型部署基础
description: 深度学习基础、模型格式、转换校验、推理运行时与端到端部署链路。
---

# 模型部署基础

更新时间：2026-06-23

## 学习目标

这页用于建立“模型从训练框架走到目标硬件”的端到端心智模型。面试或项目复盘时，不要只说“把模型转成 ONNX 然后部署”，而要能解释每一步为什么存在、可能失败在哪里、如何验证正确性。

一个完整部署链路通常是：

```text
训练框架模型
  -> 导出 / 冻结 / 清理训练态
  -> 中间格式：ONNX / 自定义 IR / MLIR Dialect
  -> 图检查 / shape 推断 / 图优化 / 量化
  -> Runtime 或硬件编译器构建 engine
  -> 输入输出对齐 / 数值校验 / 性能 profiling
  -> 线上或端侧集成 / 监控 / 回滚
```

## 必须掌握

- Tensor、Shape、Layout、权重、激活和中间层输出。
- Caffe、ONNX、PyTorch 的模型表示差异。
- CNN 常见算子：Conv、Pooling、BN、ReLU、Gemm、Softmax。
- 模型转换、图优化、量化、推理运行时、profiling 和部署校验。
- 静态 shape、动态 shape、opset、runtime provider、硬件 kernel 支持之间的关系。

## ONNX 图结构

ONNX 是模型交换格式，不是某一个训练框架的运行时。学习 ONNX 时先看清楚这些对象：

| 概念 | 作用 | 常见排查点 |
|---|---|---|
| `ModelProto` | 整个模型容器 | opset、producer、ir_version 是否匹配 runtime |
| `GraphProto` | 计算图 | 输入输出、节点拓扑、initializer 是否完整 |
| `NodeProto` | 算子节点 | op_type、domain、attribute、输入输出名称 |
| `TensorProto` | 权重和常量 | dtype、shape、raw_data、外部权重文件 |
| `ValueInfoProto` | 张量类型和 shape 元信息 | shape 是否缺失，动态维度是否合理 |
| `Opset` | 算子语义版本 | 同一个算子在不同 opset 下属性或行为可能变化 |

最常见错误不是“图无法打开”，而是**图能跑，但语义不完全一致**。例如 `Resize`、`BatchNormalization`、`Pad`、`Flatten`、`Gemm`、`Pooling` 这类算子，属性默认值、坐标规则、axis、ceil_mode、layout 差异都可能造成输出偏差。

## Caffe / PyTorch / ONNX 对照

| 维度 | Caffe | PyTorch | ONNX |
|---|---|---|---|
| 模型表达 | prototxt + caffemodel | eager / TorchScript / ExportedProgram | protobuf 计算图 |
| 主要优势 | 结构简单，老模型常见 | 训练与动态图生态强 | 跨框架、跨 runtime 交换 |
| 常见风险 | layer 参数语义老旧且不统一 | 动态控制流、trace/export 差异 | opset、shape inference、runtime 支持 |
| 部署关注点 | layer 到目标 op 的映射 | export 是否覆盖真实输入路径 | runtime 是否支持目标 opset 和算子 |
| 校验方式 | 原始 Caffe 输出对齐 | PyTorch eager 输出对齐 | ONNX Runtime / 目标 runtime 输出对齐 |

## Caffe 到 ONNX 转换流程

### 1. 梳理模型输入输出

转换前先记录：

- 输入名称、dtype、shape、layout，例如 `NCHW`；
- 预处理：resize、crop、mean/std、BGR/RGB、归一化范围；
- 输出含义：logits、概率、检测框、mask、embedding；
- 训练态是否已去除，例如 Dropout 是否关闭、BatchNorm 是否固化。

### 2. 建立算子映射表

| Caffe Layer | ONNX 方向 | 重点检查 |
|---|---|---|
| Convolution | Conv | group、dilation、padding、weight layout |
| BatchNorm + Scale | BatchNormalization 或 Mul/Add | mean/var/scale/bias、epsilon、推理态融合 |
| InnerProduct | Gemm 或 MatMul + Add | flatten 位置、transpose、bias |
| Pooling | MaxPool / AveragePool / GlobalAveragePool | ceil_mode、padding、global_pooling |
| ReLU / PReLU | Relu / PRelu | negative_slope、广播规则 |
| Reshape | Reshape | `0` / `-1` 语义、动态维度 |
| Permute | Transpose | axes 顺序 |
| Concat | Concat | axis 对齐 |
| Softmax | Softmax | axis 默认值和 opset 语义 |

### 3. 图合法性检查

至少做三类检查：

```bash
python -m onnx.checker model.onnx
python -m onnx.shape_inference model.onnx inferred.onnx
python - <<'PY'
import onnxruntime as ort
sess = ort.InferenceSession("model.onnx", providers=["CPUExecutionProvider"])
print(sess.get_inputs())
print(sess.get_outputs())
PY
```

`onnx.checker` 只能证明模型结构满足 ONNX 规则，不能证明转换语义正确；shape inference 可以暴露部分维度问题，但对动态 shape、特殊算子、未知维度并不总是充分。

### 4. 数值对齐

推荐按四层做校验：

| 层级 | 目标 | 通过标准 |
|---|---|---|
| 单算子 | 验证每个 layer 映射是否正确 | 随机输入 + 边界参数输出误差可解释 |
| 子图 | 验证常见组合，例如 Conv+BN+ReLU | 输出 shape 和数值误差稳定 |
| 整模型 | 验证最终输出 | top-k、分类结果、检测结果或业务指标一致 |
| 逐层 dump | 定位首次明显偏差 | 找到第一个误差放大的节点 |

误差指标建议同时记录：

```text
max_abs_diff = max(abs(a - b))
mean_abs_diff = mean(abs(a - b))
mse = mean((a - b)^2)
cosine_similarity = dot(a, b) / (norm(a) * norm(b))
```

不同任务关注点不同：分类任务可以看 top-1/top-5 是否变化；检测任务还要看 bbox decode、NMS、score threshold；embedding 任务更关注 cosine similarity 和召回指标。

## 动态 Shape 为什么麻烦

动态 shape 的核心问题不是“shape 里有 -1”，而是 runtime 和硬件编译器需要提前知道哪些维度会变化、变化范围是多少、是否影响 kernel 选择和内存规划。

| 问题 | 影响 |
|---|---|
| batch 动态 | engine 可能需要 profile 或多 engine |
| height/width 动态 | 卷积、resize、padding、内存规划更复杂 |
| sequence length 动态 | Transformer 的 attention 和 KV Cache 管理复杂 |
| reshape 依赖运行时数据 | 编译期 shape inference 可能失败 |
| control flow 动态 | 部分硬件后端或 runtime 不支持 |

工程上常见处理方式：

- 先用固定 shape 跑通正确性；
- 给动态维度设置明确 min/opt/max；
- 对高频输入尺寸单独构建 engine；
- 避免把不必要的预处理动态逻辑塞进模型；
- 用真实线上分布做 shape profile，而不是随便给范围。

## 推理 Runtime 与硬件后端

部署时要区分三层：

1. **模型格式层**：ONNX、Torch Export、MLIR、自定义 IR。
2. **Runtime 层**：ONNX Runtime、TensorRT、OpenVINO、RKNN Runtime、厂商 Runtime。
3. **硬件执行层**：CPU、GPU、NPU、DSP、DLA 或专用 AI 加速器。

面试时可以这样表达：

> 模型能转成 ONNX 只是第一步，真正部署还取决于目标 runtime 是否支持对应 opset、目标 execution provider 是否支持算子、动态 shape 是否可编译、量化格式是否匹配硬件 kernel，以及前后处理是否与训练时一致。

## 常见失败案例

| 现象 | 可能原因 | 排查方式 |
|---|---|---|
| 转换时报不支持算子 | 源模型用了框架私有 op | 自定义 symbolic / 改写子图 / 手写 plugin |
| ONNX 能打开但 runtime 不能跑 | opset 或数据类型不支持 | 降 opset、换 provider、查看 runtime operator support |
| 输出 shape 不对 | Flatten/Reshape/Concat axis 不一致 | 打印中间 shape，检查 opset 语义 |
| 数值整体偏移 | 预处理不一致、BN 参数错误 | 对齐输入张量和第一层输出 |
| 某一层后误差暴涨 | 算子属性、layout、padding 差异 | 逐层 dump 找到首次异常层 |
| 量化后精度大幅下降 | calibration 数据不足、激活 outlier、敏感层被量化 | 回退敏感层、换 calibration、用 QAT |
| 端侧运行慢 | CPU fallback、layout transform 太多、kernel 不支持 | profiling 看每层耗时和数据搬运 |

## 最小实践任务

### 任务 1：ONNX 模型体检

拿一个简单 CNN ONNX 模型，完成：

1. 用 Netron 查看图结构；
2. 用 `onnx.checker` 做合法性检查；
3. 用 ONNX Runtime 跑随机输入；
4. 打印每个输入输出的 name、dtype、shape；
5. 手动记录模型中的 Conv、BN、Relu、Gemm 数量。

### 任务 2：转换正确性实验

用一个 PyTorch 小模型导出 ONNX：

```python
import torch
import torch.nn as nn

class TinyCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(3, 8, 3, padding=1),
            nn.BatchNorm2d(8),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((1, 1)),
            nn.Flatten(),
            nn.Linear(8, 4),
        )

    def forward(self, x):
        return self.net(x)

model = TinyCNN().eval()
x = torch.randn(1, 3, 224, 224)
torch.onnx.export(model, x, "tiny.onnx", input_names=["input"], output_names=["logits"], opset_version=17)
```

然后分别用 PyTorch 和 ONNX Runtime 推理，比较输出误差。

## 面试高频问法

### Q1：ONNX 图由哪些部分组成？

回答要覆盖 graph、node、initializer、attribute、opset、value_info。重点补一句：opset 不是装饰信息，它决定算子语义版本；同一个 op 在不同 opset 下可能行为不同。

### Q2：Caffe 到 ONNX 最容易错在哪里？

最容易错在算子语义差异，而不是语法转换。比如 BN/Scale 融合、Pooling 的 ceil_mode、InnerProduct 的 flatten、Softmax 的 axis、Reshape 的 0/-1 语义、NCHW/NHWC layout。

### Q3：如何证明转换后模型正确？

不能只看最终模型能否运行，要用原框架输出作为基准，做单算子、子图、整模型和逐层 dump 对齐。发现误差时定位第一个误差明显放大的节点，再检查该节点属性、shape、layout 和 runtime 实现。

### Q4：为什么同一个 ONNX 在不同 runtime 上结果或性能不同？

因为 ONNX 是交换格式，runtime 会根据 provider、kernel、图优化、量化策略、内存布局和硬件能力选择不同执行路径。语义一致不代表性能一致，某些算子还可能 fallback 到 CPU。

## 资料入口

- ONNX Concepts：https://onnx.ai/onnx/intro/concepts.html
- ONNX Operators：https://onnx.ai/onnx/operators/
- ONNX Checker：https://onnx.ai/onnx/api/checker.html
- ONNX Runtime Docs：https://onnxruntime.ai/docs/
- ONNX Runtime Quantization：https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html
- PyTorch ONNX Exporter：https://docs.pytorch.org/docs/stable/onnx.html
- NVIDIA TensorRT Documentation：https://docs.nvidia.com/deeplearning/tensorrt/latest/index.html
- Netron：https://netron.app/
