---
title: 大模型推理
description: Transformer 推理、prefill/decode、KV Cache、投机采样和 LLM 量化。
---

# 大模型推理

## 对应简历原句

> 参与 7B～14B 大模型在特定计算卡平台上的推理加速方案调研与实验，分析量化、投机采样、KV Cache 等方法在吞吐、显存占用、精度损失和工程复杂度上的取舍。

## 面试风险

这个模块容易被连续追问。重点不是背术语，而是能把自回归解码为什么慢、KV Cache 解决什么、投机采样为什么能加速、接受率为什么影响收益、平台算子支持为什么决定最终落地讲清楚。

## 一句话解释

LLM 推理的核心瓶颈来自自回归逐 token 生成和 KV Cache 内存访问；投机采样用小模型先生成候选 token，再由大模型批量验证，从而减少大模型逐 token 调用次数。

## Prefill 与 Decode

### Prefill

Prefill 阶段处理完整 prompt，计算 prompt 中每个 token 的 hidden state，并为后续生成建立 KV Cache。这个阶段通常计算量较大，但可以并行处理整个输入序列。

### Decode

Decode 阶段每次生成一个新 token。新 token 会依赖之前所有 token 的 KV Cache，因此推理过程呈现强自回归特征。对于大模型，decode 常常受访存和 KV Cache 访问影响较大。

## KV Cache

Transformer 每层 attention 都需要历史 token 的 Key 和 Value。如果每生成一个 token 都重新计算所有历史 token 的 K/V，会产生大量重复计算。KV Cache 将历史 K/V 保存下来，新 token 只需要计算自己的 Q/K/V，并和历史 K/V 做 attention。

需要掌握的点：

- KV Cache 大小随层数、hidden size、head 数、序列长度、batch size 增长。
- 长上下文和高并发会显著增加 KV Cache 显存占用。
- KV Cache 优化不只看计算，还要看内存布局、复用、分页管理和 batch 调度。

## 投机采样流程

```text
当前上下文
  -> draft model 连续生成 k 个候选 token
  -> target model 对这 k 个 token 一次性批量验证
  -> 按概率接受若干 token
  -> 遇到拒绝时从修正分布采样并回退后续 token
  -> 进入下一轮
```

核心角色：

- **draft model**：小而快，负责提出候选 token；
- **target model**：原始大模型，负责验证候选 token；
- **acceptance rate**：候选 token 被接受的比例，直接影响加速收益；
- **verification**：target model 对候选序列做一次批量前向。

## 为什么不改变输出分布

经典投机采样使用拒绝采样修正机制。只要实现正确，最终采样分布与直接使用 target model 自回归采样一致。面试时不要只说“小模型猜，大模型检查”，还要强调“拒绝时需要从修正分布采样”，这是保证分布正确的关键。

## 加速收益取决于什么

| 因素 | 影响 |
|---|---|
| draft model 延迟 | 太慢会抵消收益 |
| 接受率 | 接受率越高，target model 每次验证能确认的 token 越多 |
| target model 批量验证效率 | 平台必须能高效处理候选序列 |
| KV Cache 复用 | 否则会产生额外内存和计算开销 |
| 算子支持 | 关键算子不能在加速器上执行时，端到端收益会下降 |
| batch 和动态 shape | 影响编译器和 runtime 是否能稳定执行 |

## GPTQ / AWQ / SmoothQuant 对比

| 方法 | 核心思想 | 适合回答 |
|---|---|---|
| GPTQ | 基于近似二阶信息做 one-shot 权重量化 | 强调低 bit 权重量化和误差补偿 |
| AWQ | 根据激活分布识别重要权重通道，保护少量 salient weights | 强调 weight-only、硬件友好、端侧部署 |
| SmoothQuant | 将 activation outlier 的量化难点迁移到 weight，实现 W8A8 | 强调 activation 更难量化，以及等价缩放变换 |

## 项目讲法模板

> 我参与的是投机采样在某计算卡平台上的工程化验证。核心流程包括 draft model 生成候选 token、target model 批量验证、接受/拒绝判断和回退生成。后续在平台适配时发现某个关键算子无法在 NPU 上执行，导致完整链路不能全部下沉到 NPU。如果回退到 CPU，端到端收益会被抵消，所以最终结论是该平台当前更适合优先考虑量化、KV Cache 或算子补齐方向。

## 高频追问

### Q1：投机采样为什么能加速？

因为 target model 对多个候选 token 的批量验证，通常比逐 token 多次调用更高效。如果一次验证接受多个 token，就减少了 target model 的调用轮数。

### Q2：接受率低会怎样？

接受率低时，每轮只确认很少 token，draft model 的生成开销和 target model 的验证开销会变成额外负担，整体可能不加速甚至变慢。

### Q3：draft model 越小越好吗？

不是。太小虽然快，但分布和 target model 差距大，接受率低；太大接受率可能高，但 draft 延迟变大。需要在 draft 延迟和接受率之间平衡。

### Q4：为什么平台算子支持会影响投机采样落地？

投机采样不是单一算子优化，而是端到端生成流程。只要关键节点不能在加速器上执行，就会引入数据搬运、CPU fallback 或额外同步，可能抵消理论加速收益。

## 需要补齐的个人项目细节

- draft model 和 target model 的规模关系；
- 候选 token 数 k 的设置；
- 无法执行的关键算子类型；
- 当时是否有 CPU fallback 方案；
- 平台编译器对动态 shape/batch 的限制；
- 最终输出的可行性结论。

## 资料入口

- Fast Inference from Transformers via Speculative Decoding：https://arxiv.org/abs/2211.17192
- Accelerating Large Language Model Decoding with Speculative Sampling：https://arxiv.org/abs/2302.01318
- Decoding Speculative Decoding：https://arxiv.org/abs/2402.01528
- GPTQ：https://arxiv.org/abs/2210.17323
- AWQ：https://arxiv.org/abs/2306.00978
- SmoothQuant：https://arxiv.org/abs/2211.10438
- vLLM / PagedAttention：https://arxiv.org/abs/2309.06180
