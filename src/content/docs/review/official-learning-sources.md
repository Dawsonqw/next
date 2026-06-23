---
title: 官方学习资料索引
description: 按技术主题整理的官方文档、论文和实践入口，方便后续持续扩写学习笔记。
---

# 官方学习资料索引

更新时间：2026-06-23

这个页面不是资料堆砌，而是给后续学习文档填充提供“可信入口”。优先级原则：

1. **官方文档优先**：规范、API、runtime 行为以官方文档为准；
2. **论文用于理解方法来源**：不要用论文替代工程文档；
3. **实践项目用于验证**：每个主题都要落到最小 demo、指标和边界说明；
4. **简历相关优先**：优先补能解释项目经历和面试追问的资料。

## 文档站自身

| 主题 | 入口 | 用途 |
|---|---|---|
| Astro Starlight Sidebar | https://starlight.astro.build/guides/sidebar/ | 维护 `astro.config.mjs` 侧边栏结构 |
| Starlight Markdown 写作 | https://starlight.astro.build/guides/authoring-content/ | 写 Markdown/MDX 页面、frontmatter、组件 |
| GitHub Pages Actions | https://docs.github.com/pages/getting-started-with-github-pages/about-github-pages | 后续部署和发布排查 |

## C++ / Linux / 工程能力

| 主题 | 入口 | 学习重点 |
|---|---|---|
| C++ 语言与标准库 | https://en.cppreference.com/ | RAII、移动语义、容器、并发、原子、内存模型 |
| Linux Kernel Docs | https://docs.kernel.org/ | 进程、内存、文件系统、网络、驱动、tracing |
| Linux man-pages | https://man7.org/linux/man-pages/ | 系统调用、socket、epoll、pthread、procfs |
| CMake | https://cmake.org/cmake/help/latest/ | 现代 CMake、target、依赖、交叉编译 |
| GoogleTest | https://google.github.io/googletest/ | 单元测试、mock、参数化测试 |

建议先补：`RAII -> move -> thread/atomic -> epoll/socket -> cmake/gtest -> perf/ftrace`。

## 交易系统

| 主题 | 入口 | 学习重点 |
|---|---|---|
| FIX Trading Community | https://fixtrading.org/standards/ | 订单、成交、行情、交易消息标准 |
| FIX Protocol Online Specification | https://www.onixs.biz/fix-dictionary.html | ExecutionReport、OrderCancel、订单状态字段 |
| NautilusTrader Docs | https://nautilustrader.io/docs/ | 事件驱动交易引擎、回测、实盘、数据模型 |
| CCXT Docs | https://docs.ccxt.com/ | 交易所 API 抽象、订单与行情接口 |

建议用“订单生命周期”作为主线：`New -> PartiallyFilled -> Filled / Canceled / Rejected`，再展开撮合、风控、行情、回测一致性。

## 模型部署 / ONNX / Runtime

| 主题 | 入口 | 学习重点 |
|---|---|---|
| ONNX Concepts | https://onnx.ai/onnx/intro/concepts.html | Model、Graph、Node、Initializer、Opset |
| ONNX Operators | https://onnx.ai/onnx/operators/ | Conv、BatchNorm、Gemm、Reshape、Softmax 等算子语义 |
| ONNX Checker | https://onnx.ai/onnx/api/checker.html | 模型合法性检查和调试入口 |
| ONNX Runtime Docs | https://onnxruntime.ai/docs/ | InferenceSession、Execution Provider、性能优化 |
| PyTorch ONNX Export | https://docs.pytorch.org/docs/stable/onnx.html | PyTorch 到 ONNX 的导出路径和限制 |
| TensorRT Docs | https://docs.nvidia.com/deeplearning/tensorrt/latest/index.html | engine 构建、动态 shape、precision、plugin、profiling |
| Netron | https://netron.app/ | 模型结构可视化和算子检查 |

建议先补：`ONNX 图结构 -> opset/operator -> shape inference -> ONNX Runtime 跑通 -> TensorRT engine -> profiling`。

## MLIR / 图优化 / 编译器工具链

| 主题 | 入口 | 学习重点 |
|---|---|---|
| MLIR Docs | https://mlir.llvm.org/docs/ | MLIR 总览、LangRef、Pass、Dialect |
| MLIR Language Reference | https://mlir.llvm.org/docs/LangRef/ | Operation、Region、Block、SSA、Type、Attribute |
| MLIR Pattern Rewriter | https://mlir.llvm.org/docs/PatternRewriter/ | RewritePattern、PatternRewriter、Greedy driver |
| MLIR Dialect Conversion | https://mlir.llvm.org/docs/DialectConversion/ | ConversionTarget、TypeConverter、合法化流程 |
| LLVM Docs | https://llvm.org/docs/ | LLVM IR、Pass、TableGen、工具链基础 |

建议用 toy case 学：`relu(relu(x)) -> relu(x)`、`Conv+BN -> Conv`、`Caffe op -> ONNX op`。

## 量化 / 精度分析

| 主题 | 入口 | 学习重点 |
|---|---|---|
| ONNX Runtime Quantization | https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html | dynamic/static、QDQ/QOperator、debugging、calibration |
| torchao | https://docs.pytorch.org/ao/stable/index.html | PyTorch-native quantization、QAT、weight-only、float8 |
| TensorRT Quantization | https://docs.nvidia.com/deeplearning/tensorrt/latest/index.html | INT8/FP8/INT4/FP4、precision control、calibration |
| GPTQ | https://arxiv.org/abs/2210.17323 | 二阶近似、one-shot LLM weight quantization |
| AWQ | https://arxiv.org/abs/2306.00978 | activation-aware weight quantization |
| SmoothQuant | https://arxiv.org/abs/2211.10438 | W8A8、activation outlier 平滑 |

建议先补：`线性量化公式 -> per-channel -> calibration -> QDQ -> 逐层误差定位 -> LLM weight-only`。

## 端侧 NPU / 嵌入式部署

| 主题 | 入口 | 学习重点 |
|---|---|---|
| RKNN Toolkit2 | https://github.com/airockchip/rknn-toolkit2 | RKNN 转换、量化、runtime、性能排查 |
| ExecuTorch | https://pytorch.org/executorch/ | PyTorch 端侧部署栈、移动端/嵌入式执行 |
| TensorFlow Lite | https://www.tensorflow.org/lite | TFLite 模型、delegate、移动端部署 |
| ONNX Runtime Mobile | https://onnxruntime.ai/docs/tutorials/mobile/ | 移动端 runtime、模型裁剪、EP |

建议关注“平台约束”：算子支持、输入布局、量化格式、内存限制、CPU fallback、profiling 工具。

## 大模型推理

| 主题 | 入口 | 学习重点 |
|---|---|---|
| vLLM Docs | https://docs.vllm.ai/en/latest/ | PagedAttention、serving、batching、quantization |
| TensorRT-LLM Docs | https://nvidia.github.io/TensorRT-LLM/ | NVIDIA LLM 推理、engine、KV Cache、plugins |
| Hugging Face Transformers | https://huggingface.co/docs/transformers/ | generate、KV cache、模型加载、量化集成 |
| Speculative Decoding | https://arxiv.org/abs/2211.17192 | draft/target、verification、acceptance rate |
| Speculative Sampling | https://arxiv.org/abs/2302.01318 | 分布保持、拒绝采样修正 |
| PagedAttention | https://arxiv.org/abs/2309.06180 | KV Cache 分页管理和 serving 吞吐 |

建议围绕 `prefill -> decode -> KV Cache -> batching -> quantization -> speculative decoding` 写学习笔记。

## Agent / RAG / Memory / Embedding

| 主题 | 入口 | 学习重点 |
|---|---|---|
| Milvus Docs | https://milvus.io/docs/overview.md | 向量库、ANN、HNSW、hybrid search、filtering |
| LangChain Docs | https://docs.langchain.com/ | Agent harness、tools、short-term memory、long-term memory、retrieval |
| LlamaIndex Docs | https://developers.llamaindex.ai/python/framework/getting_started/concepts/ | RAG pipeline、indexing、retrieval、agent、memory |
| OWASP LLM Top 10 | https://owasp.org/www-project-top-10-for-large-language-model-applications/ | prompt injection、敏感信息、供应链、越权风险 |
| MemGPT | https://arxiv.org/abs/2310.08560 | 分层记忆、上下文管理 |
| HNSW | https://arxiv.org/abs/1603.09320 | 图索引、ANN 检索基础 |
| RAG 原始论文 | https://arxiv.org/abs/2005.11401 | retrieval augmented generation 基础范式 |

建议明确边界：情感陪伴机器人里的 memory 不是传统文档 RAG，重点是用户事实、偏好、事件、关系状态和上下文注入。

## OpenGL 2D 渲染

| 主题 | 入口 | 学习重点 |
|---|---|---|
| OpenGL Reference Pages | https://registry.khronos.org/OpenGL-Refpages/gl4/ | API、shader、texture、buffer、draw call |
| LearnOpenGL | https://learnopengl.com/ | 入门实践、坐标、shader、texture、camera |
| GLFW Docs | https://www.glfw.org/docs/latest/ | 窗口、输入、OpenGL context |
| Dear ImGui | https://github.com/ocornut/imgui | 即时模式 GUI、调试面板、工具 UI |

建议学习顺序：`窗口/context -> shader -> VBO/VAO/EBO -> texture -> transform -> batching -> UI/debug overlay`。

## 每次扩写文档的模板

补一个主题时按这个结构写：

```text
1. 一句话解释
2. 为什么项目中会用到
3. 核心概念表
4. 最小 demo 或伪代码
5. 常见错误和排查路径
6. 面试高频追问
7. 官方资料入口
8. 我自己的项目边界说明
```

## 下次优先扩写建议

1. `knowledge/model-deployment.md`：补 Caffe/ONNX/Runtime 全链路。
2. `knowledge/quantization.md`：补 PTQ、QDQ、逐层误差定位。
3. `knowledge/trading-system.md`：补订单生命周期和撮合状态机。
4. `knowledge/cpp-linux.md`：补 RAII、线程、epoll、性能排查。
5. `knowledge/agent-rag-memory.md`：补 Memory 评估、召回污染和隐私边界。
